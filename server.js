const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

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

// Регистрация по номеру телефона (один раз на устройство)
app.post('/api/register', (req, res) => {
    const { phone, name, deviceId } = req.body;
    
    // Ищем пользователя по номеру телефона или deviceId
    let user = users.find(u => u.phone === phone || u.deviceId === deviceId);
    
    if (!user) {
        user = {
            id: Date.now().toString(),
            phone: phone,
            name: name || phone,
            deviceId: deviceId,
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name || phone)}&background=3390ec&color=fff&bold=true`,
            createdAt: new Date()
        };
        users.push(user);
        console.log(`✅ Новый пользователь: ${user.name} (${user.phone})`);
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
        online: onlineUsers.has(u.id)
    })));
});

// Получение чатов пользователя
app.get('/api/chats', (req, res) => {
    const userId = req.query.userId;
    const userChats = chats.filter(chat => chat.members.includes(userId));
    
    const result = userChats.map(chat => {
        const lastMsg = messages.filter(m => m.chatId === chat.id).pop();
        return {
            ...chat,
            lastMessage: lastMsg?.text || '',
            lastMessageTime: lastMsg?.timestamp || chat.createdAt
        };
    });
    
    res.json(result);
});

// Создание личного чата
app.post('/api/create-chat', (req, res) => {
    const { userId, targetUserId } = req.body;
    
    let existingChat = chats.find(c => 
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

// WebSocket
io.on('connection', (socket) => {
    console.log('🔌 Новое подключение');
    let currentUserId = null;
    
    socket.on('auth', (userId) => {
        currentUserId = userId;
        onlineUsers.set(userId, socket.id);
        
        const user = users.find(u => u.id === userId);
        if (user) user.online = true;
        
        const userChats = chats.filter(chat => chat.members.includes(userId));
        const userMessages = messages.filter(msg => userChats.some(chat => chat.id === msg.chatId));
        socket.emit('chat history', userMessages);
        
        io.emit('users online', Array.from(onlineUsers.keys()));
        io.emit('users list', users);
        io.emit('chats list', chats);
    });
    
    // Отправка сообщения
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
            timestamp: Date.now(),
            readBy: [currentUserId]
        };
        
        messages.push(message);
        if (messages.length > 1000) messages = messages.slice(-1000);
        
        const chat = chats.find(c => c.id === data.chatId);
        if (chat) {
            chat.members.forEach(memberId => {
                if (memberId !== currentUserId && onlineUsers.has(memberId)) {
                    io.to(onlineUsers.get(memberId)).emit('new message', message);
                }
            });
        }
        
        socket.emit('message sent', message);
    });
    
    // ========== ГОЛОСОВЫЕ ЗВОНКИ (WebRTC) ==========
    socket.on('call user', (data) => {
        const { targetUserId, offer } = data;
        const targetSocketId = onlineUsers.get(targetUserId);
        
        if (targetSocketId) {
            io.to(targetSocketId).emit('incoming call', {
                from: currentUserId,
                fromName: users.find(u => u.id === currentUserId)?.name,
                offer: offer
            });
        } else {
            socket.emit('call error', { message: 'Пользователь не в сети' });
        }
    });
    
    socket.on('answer call', (data) => {
        const { targetUserId, answer } = data;
        const targetSocketId = onlineUsers.get(targetUserId);
        
        if (targetSocketId) {
            io.to(targetSocketId).emit('call answered', { answer: answer });
        }
    });
    
    socket.on('ice candidate', (data) => {
        const { targetUserId, candidate } = data;
        const targetSocketId = onlineUsers.get(targetUserId);
        
        if (targetSocketId) {
            io.to(targetSocketId).emit('ice candidate', { candidate: candidate });
        }
    });
    
    socket.on('end call', (data) => {
        const { targetUserId } = data;
        const targetSocketId = onlineUsers.get(targetUserId);
        
        if (targetSocketId) {
            io.to(targetSocketId).emit('call ended');
        }
    });
    
    // Печатание
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
    
    socket.on('disconnect', () => {
        if (currentUserId) {
            onlineUsers.delete(currentUserId);
            const user = users.find(u => u.id === currentUserId);
            if (user) user.online = false;
            io.emit('users online', Array.from(onlineUsers.keys()));
            io.emit('users list', users);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ╔════════════════════════════════════════════╗
    ║     ✅ VANOGRAM PRO ЗАПУЩЕН!               ║
    ╠════════════════════════════════════════════╣
    ║  📱 Откройте в браузере:                   ║
    ║     https://vanogram.onrender.com          ║
    ╠════════════════════════════════════════════╣
    ║  📞 ГОЛОСОВЫЕ ЗВОНКИ:                      ║
    ║     Нажмите на контакт → кнопка звонка     ║
    ╚════════════════════════════════════════════╝
    `);
});
