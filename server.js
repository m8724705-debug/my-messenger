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

// ДЕМО-ПОЛЬЗОВАТЕЛИ (для теста, чтобы было с кем общаться)
const demoUsers = [
    { id: 'demo1', phone: '+79001111111', name: 'Анна', avatar: 'https://ui-avatars.com/api/?name=Анна&background=3390ec&color=fff' },
    { id: 'demo2', phone: '+79002222222', name: 'Дмитрий', avatar: 'https://ui-avatars.com/api/?name=Дмитрий&background=3390ec&color=fff' },
    { id: 'demo3', phone: '+79003333333', name: 'Елена', avatar: 'https://ui-avatars.com/api/?name=Елена&background=3390ec&color=fff' },
    { id: 'demo4', phone: '+79004444444', name: 'Максим', avatar: 'https://ui-avatars.com/api/?name=Максим&background=3390ec&color=fff' }
];

// Добавляем демо-пользователей при запуске
demoUsers.forEach(demo => {
    if (!users.find(u => u.id === demo.id)) {
        users.push(demo);
    }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Регистрация/вход
app.post('/api/login', (req, res) => {
    const { phone, name, deviceId } = req.body;
    
    let user = users.find(u => u.phone === phone);
    
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
        console.log('✅ Новый пользователь:', user.name);
    }
    
    console.log('📱 Всего пользователей:', users.length);
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
    const userList = users.map(u => ({
        id: u.id,
        phone: u.phone,
        name: u.name,
        avatar: u.avatar,
        online: onlineUsers.has(u.id)
    }));
    console.log('📋 Отправляем пользователей:', userList.length);
    res.json(userList);
});

// Получение чатов (всех других пользователей)
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

// WebSocket
io.on('connection', (socket) => {
    console.log('🔌 Клиент подключился');
    let currentUserId = null;
    
    socket.on('auth', (userId) => {
        currentUserId = userId;
        onlineUsers.set(userId, socket.id);
        console.log('👤 Авторизован:', userId);
        
        // Отправляем историю сообщений
        socket.emit('chat history', messages);
        
        // Рассылаем всем обновлённые списки
        io.emit('users online', Array.from(onlineUsers.keys()));
        io.emit('users list', users);
        io.emit('chats list', users.filter(u => u.id !== userId).map(u => ({
            id: u.id,
            name: u.name,
            avatar: u.avatar
        })));
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
        console.log('📨 Сообщение отправлено в чат:', data.chatId);
    });
    
    socket.on('disconnect', () => {
        if (currentUserId) {
            onlineUsers.delete(currentUserId);
            io.emit('users online', Array.from(onlineUsers.keys()));
            console.log('❌ Пользователь отключился:', currentUserId);
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
    ╠════════════════════════════════════════════╣
    ║  👥 Демо-пользователи:                     ║
    ║     Анна, Дмитрий, Елена, Максим           ║
    ╚════════════════════════════════════════════╝
    `);
});
