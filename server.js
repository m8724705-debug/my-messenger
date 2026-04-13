const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Хранилище данных
let users = [];
let chats = [];
let messages = [];
let onlineUsers = new Map();

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Регистрация/вход
app.post('/api/login', (req, res) => {
    const { phone, name } = req.body;
    
    let user = users.find(u => u.phone === phone);
    
    if (!user) {
        user = {
            id: Date.now().toString(),
            phone: phone,
            name: name || phone,
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name || phone)}&background=3390ec&color=fff&bold=true`,
            createdAt: new Date()
        };
        users.push(user);
        
        // Создаём общий чат
        const generalChat = {
            id: 'general',
            type: 'group',
            name: 'Общий чат',
            avatar: '💬',
            members: [user.id],
            createdBy: 'system',
            createdAt: Date.now()
        };
        if (!chats.find(c => c.id === 'general')) {
            chats.push(generalChat);
        }
    }
    
    res.json({ 
        token: user.id, 
        user: { 
            id: user.id, 
            phone: user.phone, 
            name: user.name, 
            avatar: user.avatar 
        } 
    });
});

// Проверка токена
app.post('/api/verify', (req, res) => {
    const { token } = req.body;
    const user = users.find(u => u.id === token);
    if (!user) return res.status(401).json({ error: 'Не авторизован' });
    res.json({ user });
});

// Получение всех пользователей
app.get('/api/users', (req, res) => {
    res.json(users.map(u => ({
        id: u.id,
        phone: u.phone,
        name: u.name,
        avatar: u.avatar,
        online: onlineUsers.has(u.id),
        lastSeen: u.lastSeen
    })));
});

// Получение всех чатов
app.get('/api/chats', (req, res) => {
    const userChats = chats.map(chat => {
        const lastMsg = messages.filter(m => m.chatId === chat.id).pop();
        const unread = messages.filter(m => m.chatId === chat.id && !m.readBy?.includes(req.query.userId)).length;
        return {
            ...chat,
            lastMessage: lastMsg?.text || '',
            lastMessageTime: lastMsg?.timestamp || chat.createdAt,
            unread: unread
        };
    });
    res.json(userChats);
});

// Создание личного чата
app.post('/api/create-chat', (req, res) => {
    const { userId, targetUserId } = req.body;
    
    const existingChat = chats.find(c => 
        c.type === 'private' && 
        c.members.includes(userId) && 
        c.members.includes(targetUserId)
    );
    
    if (existingChat) {
        return res.json(existingChat);
    }
    
    const targetUser = users.find(u => u.id === targetUserId);
    const newChat = {
        id: Date.now().toString(),
        type: 'private',
        name: targetUser.name,
        avatar: targetUser.avatar,
        members: [userId, targetUserId],
        createdAt: Date.now()
    };
    
    chats.push(newChat);
    res.json(newChat);
});

// Создание группы
app.post('/api/create-group', (req, res) => {
    const { name, createdBy } = req.body;
    
    const newGroup = {
        id: Date.now().toString(),
        type: 'group',
        name: name,
        avatar: '👥',
        members: [createdBy],
        createdBy: createdBy,
        createdAt: Date.now()
    };
    
    chats.push(newGroup);
    res.json(newGroup);
});

// Присоединение к группе
app.post('/api/join-group', (req, res) => {
    const { chatId, userId } = req.body;
    const chat = chats.find(c => c.id === chatId);
    
    if (chat && !chat.members.includes(userId)) {
        chat.members.push(userId);
        res.json(chat);
    } else {
        res.status(400).json({ error: 'Не удалось присоединиться' });
    }
});

// WebSocket
io.on('connection', (socket) => {
    console.log('🔌 Новое подключение');
    let currentUserId = null;
    
    socket.on('auth', (userId) => {
        currentUserId = userId;
        onlineUsers.set(userId, socket.id);
        
        const user = users.find(u => u.id === userId);
        if (user) {
            user.online = true;
            user.lastSeen = Date.now();
        }
        
        // Отправляем историю сообщений для чатов пользователя
        const userChats = chats.filter(chat => chat.members.includes(userId));
        const userMessages = messages.filter(msg => userChats.some(chat => chat.id === msg.chatId));
        socket.emit('chat history', userMessages);
        
        io.emit('users online', Array.from(onlineUsers.keys()));
        io.emit('users list', users);
        io.emit('chats list', chats);
    });
    
    socket.on('send message', (data) => {
        const user = users.find(u => u.id === currentUserId);
        if (!user) return;
        
        const message = {
            id: Date.now().toString(),
            chatId: data.chatId,
            userId: currentUserId,
            userName: user.name,
            userAvatar: user.avatar,
            text: data.text,
            image: data.image || null,
            audio: data.audio || null,
            replyTo: data.replyTo || null,
            timestamp: Date.now(),
            readBy: [currentUserId]
        };
        
        messages.push(message);
        if (messages.length > 1000) messages = messages.slice(-1000);
        
        const chat = chats.find(c => c.id === data.chatId);
        if (chat) {
            chat.members.forEach(memberId => {
                if (memberId !== currentUserId) {
                    io.to(onlineUsers.get(memberId)).emit('new message', message);
                }
            });
        }
        
        socket.emit('message sent', message);
    });
    
    socket.on('typing', (data) => {
        const { chatId, isTyping } = data;
        const chat = chats.find(c => c.id === chatId);
        
        if (chat) {
            chat.members.forEach(memberId => {
                if (memberId !== currentUserId && onlineUsers.has(memberId)) {
                    io.to(onlineUsers.get(memberId)).emit('user typing', {
                        chatId: chatId,
                        userId: currentUserId,
                        userName: users.find(u => u.id === currentUserId)?.name,
                        isTyping: isTyping
                    });
                }
            });
        }
    });
    
    socket.on('mark read', (data) => {
        const { chatId, messageId } = data;
        const message = messages.find(m => m.id === messageId);
        if (message && !message.readBy.includes(currentUserId)) {
            message.readBy.push(currentUserId);
            io.emit('message read', { chatId, messageId, userId: currentUserId });
        }
    });
    
    socket.on('delete message', (data) => {
        const { messageId } = data;
        const index = messages.findIndex(m => m.id === messageId);
        if (index !== -1) {
            const message = messages[index];
            messages.splice(index, 1);
            io.emit('message deleted', { chatId: message.chatId, messageId });
        }
    });
    
    socket.on('edit message', (data) => {
        const { messageId, newText } = data;
        const message = messages.find(m => m.id === messageId);
        if (message && message.userId === currentUserId) {
            message.text = newText;
            message.edited = true;
            io.emit('message edited', { chatId: message.chatId, messageId, newText });
        }
    });
    
    socket.on('disconnect', () => {
        if (currentUserId) {
            onlineUsers.delete(currentUserId);
            const user = users.find(u => u.id === currentUserId);
            if (user) {
                user.online = false;
                user.lastSeen = Date.now();
            }
            io.emit('users online', Array.from(onlineUsers.keys()));
            io.emit('users list', users);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ╔════════════════════════════════════════════╗
    ║     ✅ VANOGRAM 2.0 ЗАПУЩЕН!               ║
    ╠════════════════════════════════════════════╣
    ║  📱 Откройте в браузере:                   ║
    ║     https://vanogram.onrender.com          ║
    ╚════════════════════════════════════════════╝
    `);
});
