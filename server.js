const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Хранилище данных
let users = [];
let messages = [];
let onlineUsers = new Map();

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Регистрация/вход
app.post('/api/login', (req, res) => {
    const { phone, name, deviceId } = req.body;
    
    let user = users.find(u => u.phone === phone || u.deviceId === deviceId);
    
    if (!user) {
        user = {
            id: Date.now().toString(),
            phone: phone,
            name: name || phone,
            deviceId: deviceId,
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name || phone)}&background=3390ec&color=fff`,
            createdAt: new Date()
        };
        users.push(user);
    }
    
    res.json({ token: user.id, user });
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

// Получение чатов
app.get('/api/chats', (req, res) => {
    const userId = req.query.userId;
    const otherUsers = users.filter(u => u.id !== userId);
    const chats = otherUsers.map(u => ({
        id: u.id,
        type: 'private',
        name: u.name,
        avatar: u.avatar,
        members: [userId, u.id],
        lastMessage: '',
        lastMessageTime: Date.now()
    }));
    res.json(chats);
});

// Создание чата
app.post('/api/create-chat', (req, res) => {
    const { userId, targetUserId } = req.body;
    const targetUser = users.find(u => u.id === targetUserId);
    res.json({
        id: targetUserId,
        type: 'private',
        name: targetUser.name,
        avatar: targetUser.avatar,
        members: [userId, targetUserId]
    });
});

// WebSocket
io.on('connection', (socket) => {
    console.log('✅ Клиент подключился');
    let currentUserId = null;
    
    socket.on('auth', (userId) => {
        currentUserId = userId;
        onlineUsers.set(userId, socket.id);
        console.log('👤 Авторизован:', userId);
        
        socket.emit('chat history', messages);
        io.emit('users online', Array.from(onlineUsers.keys()));
        io.emit('users list', users);
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
            text: data.text || '',
            image: data.image || null,
            timestamp: Date.now()
        };
        
        messages.push(message);
        if (messages.length > 500) messages = messages.slice(-500);
        
        io.emit('new message', message);
        console.log('📨 Сообщение отправлено');
    });
    
    socket.on('disconnect', () => {
        if (currentUserId) {
            onlineUsers.delete(currentUserId);
            io.emit('users online', Array.from(onlineUsers.keys()));
            console.log('❌ Пользователь отключился');
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ╔════════════════════════════════════════════╗
    ║     ✅ VANOGRAM ЗАПУЩЕН!                   ║
    ╠════════════════════════════════════════════╣
    ║  📱 Откройте: http://localhost:${PORT}      ║
    ╚════════════════════════════════════════════╝
    `);
});
