const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Хранилище данных
let users = [];        // { id, phone, name, online }
let messages = [];
let onlineUsers = new Map();

app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// РЕГИСТРАЦИЯ/ВХОД ПО НОМЕРУ ТЕЛЕФОНА (без пароля!)
app.post('/api/login', (req, res) => {
    const { phone, name } = req.body;
    
    // Ищем пользователя
    let user = users.find(u => u.phone === phone);
    
    if (!user) {
        // Новый пользователь - регистрируем автоматически
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

// Получение всех пользователей (контакты)
app.get('/api/users', (req, res) => {
    res.json(users.map(u => ({
        id: u.id,
        phone: u.phone,
        name: u.name,
        avatar: u.avatar,
        online: onlineUsers.has(u.id)
    })));
});

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket для чата
io.on('connection', (socket) => {
    console.log('🔌 Новое подключение');
    let currentUserId = null;
    
    socket.on('auth', (userId) => {
        currentUserId = userId;
        onlineUsers.set(userId, socket.id);
        
        // Обновляем статус пользователя
        const user = users.find(u => u.id === userId);
        if (user) user.online = true;
        
        // Отправляем историю сообщений
        socket.emit('chat history', messages);
        
        // Рассылаем обновлённый список онлайн
        io.emit('users online', Array.from(onlineUsers.keys()));
        io.emit('users list', users);
    });
    
    // Отправка сообщения
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
    
    // Пользователь печатает
    socket.on('typing', (isTyping) => {
        socket.broadcast.emit('user typing', { userId: currentUserId, isTyping });
    });
    
    // Отключение
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
server.listen(PORT, () => {
    console.log(`
    ╔════════════════════════════════════════════╗
    ║     ✅ VANOGRAM ЗАПУЩЕН!                   ║
    ╠════════════════════════════════════════════╣
    ║  📱 Откройте в браузере:                   ║
    ║     http://localhost:${PORT}                ║
    ╠════════════════════════════════════════════╣
    ║  👥 Для друзей (в одной сети):             ║
    ║     http://ВАШ_IP:${PORT}                  ║
    ║     (узнайте IP командой ipconfig)         ║
    ╠════════════════════════════════════════════╣
    ║  💡 Вход только по номеру телефона!        ║
    ║     Без пароля!                            ║
    ╚════════════════════════════════════════════╝
    `);
});
