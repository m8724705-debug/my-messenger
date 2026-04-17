const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Хранилище данных (в реальном проекте используй базу данных)
let users = [];
let messages = [];

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// ========== API для Android приложения ==========

// Регистрация пользователя
app.post('/api/register', (req, res) => {
    const { userId, name } = req.body;
    
    let user = users.find(u => u.userId === userId);
    
    if (!user) {
        user = {
            userId: userId,
            name: name,
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=3390ec&color=fff`,
            online: true,
            lastSeen: Date.now()
        };
        users.push(user);
        console.log('✅ Новый пользователь:', name);
    }
    
    res.json({ success: true, user: user });
});

// Получение всех сообщений
app.get('/api/messages', (req, res) => {
    // Сортируем по времени (старые сначала)
    const sortedMessages = [...messages].sort((a, b) => a.time - b.time);
    res.json(sortedMessages);
});

// Отправка сообщения
app.post('/api/send', (req, res) => {
    const { userId, userName, text } = req.body;
    
    if (!userId || !text) {
        return res.status(400).json({ error: 'Не хватает данных' });
    }
    
    const message = {
        id: Date.now().toString(),
        fromId: userId,
        fromName: userName || 'Пользователь',
        text: text,
        time: Date.now(),
        isSystem: false
    };
    
    messages.push(message);
    
    // Ограничиваем количество сообщений (последние 500)
    if (messages.length > 500) {
        messages = messages.slice(-500);
    }
    
    // Отправляем через WebSocket всем подключённым клиентам
    io.emit('new_message', message);
    
    res.json({ success: true, message: message });
});

// Получение списка пользователей
app.get('/api/users', (req, res) => {
    res.json(users);
});

// ========== Веб-интерфейс ==========

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ========== WebSocket для реального времени ==========

io.on('connection', (socket) => {
    console.log('🔌 Клиент подключился');
    let currentUserId = null;
    
    socket.on('auth', (data) => {
        currentUserId = data.userId;
        console.log('👤 Авторизован:', currentUserId);
        
        // Отправляем историю сообщений
        socket.emit('chat history', messages);
        
        // Отправляем список пользователей
        socket.emit('users list', users);
    });
    
    socket.on('send message', (data) => {
        const user = users.find(u => u.userId === currentUserId);
        if (!user) return;
        
        const message = {
            id: Date.now().toString(),
            fromId: currentUserId,
            fromName: user.name,
            text: data.text,
            time: Date.now(),
            isSystem: false
        };
        
        messages.push(message);
        if (messages.length > 500) messages = messages.slice(-500);
        
        io.emit('new message', message);
        console.log('📨 Сообщение от', user.name);
    });
    
    socket.on('disconnect', () => {
        if (currentUserId) {
            console.log('❌ Отключился:', currentUserId);
        }
    });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ╔════════════════════════════════════════════════════╗
    ║     ✅ VANOGRAM СЕРВЕР ЗАПУЩЕН!                    ║
    ╠════════════════════════════════════════════════════╣
    ║  📱 API доступно по адресу:                        ║
    ║     https://vanogramess.onrender.com               ║
    ╠════════════════════════════════════════════════════╣
    ║  🔧 Эндпоинты:                                     ║
    ║     POST /api/register  - регистрация              ║
    ║     GET  /api/messages  - получить сообщения       ║
    ║     POST /api/send      - отправить сообщение      ║
    ║     GET  /api/users     - список пользователей     ║
    ╚════════════════════════════════════════════════════╝
    `);
});
