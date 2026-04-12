const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Хранилища данных
let users = new Map();           // { socketId: { id, name, online } }
let privateChats = new Map();    // { chatId: { users: [id1, id2], messages: [] } }
let groupChats = new Map();      // { groupId: { name, members, messages, inviteCode, avatar } }
let unreadMessages = new Map();  // { userId: { chatId: count } }

// Генерация ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

app.use(express.static(__dirname));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    console.log('Новое подключение:', socket.id);
    
    // Регистрация пользователя
    socket.on('register', (userData) => {
        const user = {
            id: socket.id,
            name: userData.name,
            avatar: userData.avatar || getAvatarEmoji(userData.name),
            online: true,
            lastSeen: Date.now()
        };
        users.set(socket.id, user);
        
        // Отправляем список пользователей
        broadcastUsersList();
        
        // Отправляем список чатов для этого пользователя
        const userChats = getUserChats(socket.id);
        socket.emit('chats list', userChats);
        
        console.log(`${user.name} присоединился`);
    });
    
    // Создание личного чата
    socket.on('create private chat', (targetUserId) => {
        const chatId = `private_${sortIds(socket.id, targetUserId)}`;
        
        if (!privateChats.has(chatId)) {
            privateChats.set(chatId, {
                id: chatId,
                type: 'private',
                users: [socket.id, targetUserId],
                messages: [],
                createdAt: Date.now()
            });
        }
        
        const chat = privateChats.get(chatId);
        socket.emit('chat created', formatChat(chat, socket.id));
        io.to(targetUserId).emit('new chat', formatChat(chat, targetUserId));
    });
    
    // Создание группы
    socket.on('create group', (groupData) => {
        const groupId = generateId();
        groupChats.set(groupId, {
            id: groupId,
            type: 'group',
            name: groupData.name,
            avatar: groupData.avatar || '👥',
            members: [socket.id],
            messages: [],
            inviteCode: generateId().substr(0, 8).toUpperCase(),
            createdBy: socket.id,
            createdAt: Date.now()
        });
        
        const group = groupChats.get(groupId);
        socket.emit('chat created', formatChat(group, socket.id));
        
        // Системное сообщение
        addSystemMessage(groupId, `${users.get(socket.id).name} создал группу`);
    });
    
    // Присоединение к группе по коду
    socket.on('join group', (inviteCode) => {
        const group = Array.from(groupChats.values()).find(g => g.inviteCode === inviteCode);
        
        if (group && !group.members.includes(socket.id)) {
            group.members.push(socket.id);
            addSystemMessage(group.id, `${users.get(socket.id).name} присоединился к группе`);
            
            // Обновляем чаты у всех участников
            group.members.forEach(memberId => {
                io.to(memberId).emit('chats list', getUserChats(memberId));
            });
            
            socket.emit('group joined', formatChat(group, socket.id));
        } else {
            socket.emit('error', 'Неверный код приглашения');
        }
    });
    
    // Отправка сообщения
    socket.on('send message', (data) => {
        const { chatId, text, replyTo, mentions } = data;
        
        let chat = privateChats.get(chatId);
        let isGroup = false;
        
        if (!chat) {
            chat = groupChats.get(chatId);
            isGroup = true;
        }
        
        if (chat) {
            const user = users.get(socket.id);
            const message = {
                id: generateId(),
                from: socket.id,
                fromName: user.name,
                fromAvatar: user.avatar,
                text: text,
                time: Date.now(),
                replyTo: replyTo || null,
                mentions: mentions || []
            };
            
            chat.messages.push(message);
            
            // Ограничиваем историю
            if (chat.messages.length > 500) {
                chat.messages = chat.messages.slice(-500);
            }
            
            // Отправляем всем участникам
            const recipients = isGroup ? chat.members : chat.users;
            recipients.forEach(recipientId => {
                if (recipientId !== socket.id) {
                    // Увеличиваем счетчик непрочитанных
                    const unread = unreadMessages.get(recipientId) || new Map();
                    unread.set(chatId, (unread.get(chatId) || 0) + 1);
                    unreadMessages.set(recipientId, unread);
                }
                
                io.to(recipientId).emit('new message', {
                    chatId: chat.id,
                    message: message
                });
            });
            
            // Отправляем самому отправителю
            socket.emit('message sent', {
                chatId: chat.id,
                message: message
            });
            
            // Обновляем список чатов у всех
            recipients.forEach(recipientId => {
                io.to(recipientId).emit('chats list', getUserChats(recipientId));
            });
        }
    });
    
    // Пользователь печатает
    socket.on('typing', (data) => {
        const { chatId, isTyping } = data;
        
        let chat = privateChats.get(chatId);
        let isGroup = false;
        
        if (!chat) {
            chat = groupChats.get(chatId);
            isGroup = true;
        }
        
        if (chat) {
            const recipients = isGroup ? chat.members : chat.users;
            recipients.forEach(recipientId => {
                if (recipientId !== socket.id) {
                    io.to(recipientId).emit('user typing', {
                        chatId: chat.id,
                        userId: socket.id,
                        userName: users.get(socket.id).name,
                        isTyping: isTyping
                    });
                }
            });
        }
    });
    
    // Получение истории чата
    socket.on('get chat history', (chatId) => {
        let chat = privateChats.get(chatId);
        if (!chat) chat = groupChats.get(chatId);
        
        if (chat) {
            socket.emit('chat history', {
                chatId: chat.id,
                messages: chat.messages
            });
            
            // Сбрасываем счетчик непрочитанных
            const unread = unreadMessages.get(socket.id);
            if (unread) {
                unread.delete(chatId);
                unreadMessages.set(socket.id, unread);
                socket.emit('chats list', getUserChats(socket.id));
            }
        }
    });
    
    // Редактирование группы
    socket.on('edit group', (data) => {
        const { groupId, name, avatar } = data;
        const group = groupChats.get(groupId);
        
        if (group && group.members.includes(socket.id)) {
            if (name) group.name = name;
            if (avatar) group.avatar = avatar;
            
            group.members.forEach(memberId => {
                io.to(memberId).emit('chats list', getUserChats(memberId));
            });
        }
    });
    
    // Выход из группы
    socket.on('leave group', (groupId) => {
        const group = groupChats.get(groupId);
        
        if (group && group.members.includes(socket.id)) {
            group.members = group.members.filter(id => id !== socket.id);
            addSystemMessage(groupId, `${users.get(socket.id).name} покинул группу`);
            
            if (group.members.length === 0) {
                groupChats.delete(groupId);
            } else {
                group.members.forEach(memberId => {
                    io.to(memberId).emit('chats list', getUserChats(memberId));
                });
            }
            
            socket.emit('chats list', getUserChats(socket.id));
        }
    });
    
    // Отключение
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            user.online = false;
            user.lastSeen = Date.now();
            users.set(socket.id, user);
            
            broadcastUsersList();
            console.log(`${user.name} отключился`);
            
            // Удаляем через 30 секунд
            setTimeout(() => {
                if (users.get(socket.id) && !users.get(socket.id).online) {
                    users.delete(socket.id);
                    broadcastUsersList();
                }
            }, 30000);
        }
    });
});

// Вспомогательные функции
function sortIds(id1, id2) {
    return id1 < id2 ? `${id1}_${id2}` : `${id2}_${id1}`;
}

function getAvatarEmoji(name) {
    const firstChar = name.charAt(0).toUpperCase();
    if (firstChar >= 'A' && firstChar <= 'Z') return firstChar;
    if (firstChar >= 'А' && firstChar <= 'Я') return '👤';
    return '😊';
}

function addSystemMessage(chatId, text) {
    let chat = groupChats.get(chatId);
    if (!chat) return;
    
    const systemMsg = {
        id: generateId(),
        from: 'system',
        fromName: 'Система',
        text: text,
        time: Date.now(),
        isSystem: true
    };
    
    chat.messages.push(systemMsg);
    
    chat.members.forEach(memberId => {
        io.to(memberId).emit('new message', {
            chatId: chat.id,
            message: systemMsg
        });
    });
}

function getUserChats(userId) {
    const chats = [];
    
    // Приватные чаты
    for (let chat of privateChats.values()) {
        if (chat.users.includes(userId)) {
            const otherUserId = chat.users.find(id => id !== userId);
            const otherUser = users.get(otherUserId);
            const unread = unreadMessages.get(userId)?.get(chat.id) || 0;
            
            chats.push({
                id: chat.id,
                type: 'private',
                name: otherUser ? otherUser.name : 'Неизвестный',
                avatar: otherUser ? otherUser.avatar : '👤',
                lastMessage: chat.messages[chat.messages.length - 1]?.text || '',
                lastMessageTime: chat.messages[chat.messages.length - 1]?.time || chat.createdAt,
                unread: unread
            });
        }
    }
    
    // Группы
    for (let group of groupChats.values()) {
        if (group.members.includes(userId)) {
            const unread = unreadMessages.get(userId)?.get(group.id) || 0;
            
            chats.push({
                id: group.id,
                type: 'group',
                name: group.name,
                avatar: group.avatar,
                lastMessage: group.messages[group.messages.length - 1]?.text || '',
                lastMessageTime: group.messages[group.messages.length - 1]?.time || group.createdAt,
                unread: unread,
                inviteCode: group.inviteCode,
                membersCount: group.members.length
            });
        }
    }
    
    // Сортируем по времени
    chats.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
    
    return chats;
}

function formatChat(chat, userId) {
    if (chat.type === 'private') {
        const otherUserId = chat.users.find(id => id !== userId);
        const otherUser = users.get(otherUserId);
        return {
            id: chat.id,
            type: 'private',
            name: otherUser ? otherUser.name : 'Неизвестный',
            avatar: otherUser ? otherUser.avatar : '👤'
        };
    } else {
        return {
            id: chat.id,
            type: 'group',
            name: chat.name,
            avatar: chat.avatar,
            inviteCode: chat.inviteCode,
            membersCount: chat.members.length
        };
    }
}

function broadcastUsersList() {
    const userList = Array.from(users.values()).map(u => ({
        id: u.id,
        name: u.name,
        avatar: u.avatar,
        online: u.online,
        lastSeen: u.lastSeen
    }));
    io.emit('users list', userList);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
    ╔══════════════════════════════════════════════╗
    ║     ✨ Мессенджер обновлён! ✨               ║
    ╠══════════════════════════════════════════════╣
    ║  🚀 Новые функции:                           ║
    ║  📱 Личные сообщения                         ║
    ║  👥 Групповые чаты                           ║
    ║  🔗 Приглашения по коду                      ║
    ║  📊 Непрочитанные сообщения                  ║
    ║  🎨 Аватары пользователей                    ║
    ╠══════════════════════════════════════════════╣
    ║  Открыть: http://localhost:${PORT}            ║
    ╚══════════════════════════════════════════════╝
    `);
});
