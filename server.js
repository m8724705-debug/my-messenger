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
app.use(express.static(__dirname)); // <-- Ищет файлы в корне

// Главная страница - index.html в корне
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Регистрация/вход по номеру телефона
app.post('/api/login', (req, res) => {
    const { phone, name } = req.body;
    
    let user = users.find(u => u.phone === phone);
    
    if (!user) {
        user = {
            id: Date.now().toString(),
            phone: phone,
            name: name || phone,
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name || phone)}&background=2aab6e&color=fff`,
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
    
    if (!user) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    
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

// WebSocket
io.on('connection', (socket) => {
    console.log('🔌 Новое подключение');
    let currentUserId = null;
    
    socket.on('auth', (userId) => {
        currentUserId = userId;
        onlineUsers.set(userId, socket.id);
        
        const user = users.find(u => u.id === userId);
        if (user) user.online = true;
        
        socket.emit('chat history', messages);
        io.emit('users online', Array.from(onlineUsers.keys()));
        io.emit('users list', users);
    });
    
    socket.on('send message', (data) => {
        const user = users.find(u => u.id === currentUserId);
        if (!user) return;
        
        const message = {
            id: Date.now(),
            userId: currentUserId,
            userName: user.name,
            userPhone: user.phone,
            userAvatar: user.avatar,
            text: data.text,
            image: data.image || null,
            audio: data.audio || null,
            timestamp: Date.now()
        };
        
        messages.push(message);
        if (messages.length > 500) messages = messages.slice(-500);
        
        io.emit('new message', message);
    });
    
    socket.on('typing', (isTyping) => {
        socket.broadcast.emit('user typing', { userId: currentUserId, isTyping });
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
    ║     ✅ VANOGRAM ЗАПУЩЕН!                   ║
    ╠════════════════════════════════════════════╣
    ║  📱 Откройте в браузере:                   ║
    ║     https://vanogram.onrender.com          ║
    ╚════════════════════════════════════════════╝
    `);
});
