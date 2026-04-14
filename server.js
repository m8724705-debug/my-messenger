const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: { origin: "*" }
});

let users = [];
let messages = [];
let onlineUsers = new Map(); // userId -> socketId

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Регистрация
app.post('/api/register', (req, res) => {
    const { phone, name, deviceId } = req.body;
    
    let user = users.find(u => u.phone === phone);
    
    if (!user) {
        user = {
            id: Date.now().toString(),
            phone: phone,
            name: name || phone,
            deviceId: deviceId,
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name || phone)}&background=3390ec&color=fff`,
            online: false
        };
        users.push(user);
        console.log('📱 Новый пользователь:', user.name);
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

// Список пользователей
app.get('/api/users', (req, res) => {
    const userList = users.map(u => ({
        id: u.id,
        phone: u.phone,
        name: u.name,
        avatar: u.avatar,
        online: onlineUsers.has(u.id)
    }));
    res.json(userList);
});

// WebSocket
io.on('connection', (socket) => {
    console.log('🔌 Клиент подключился');
    let currentUserId = null;
    
    socket.on('auth', (userId) => {
        currentUserId = userId;
        onlineUsers.set(userId, socket.id);
        
        // Обновляем статус пользователя
        const user = users.find(u => u.id === userId);
        if (user) user.online = true;
        
        console.log('👤 Онлайн:', userId);
        
        // Отправляем историю сообщений
        socket.emit('history', messages);
        
        // Рассылаем ВСЕМ обновлённый список онлайн
        const onlineList = Array.from(onlineUsers.keys());
        io.emit('users_online', onlineList);
        
        // Рассылаем обновлённый список всех пользователей
        io.emit('users_list', users.map(u => ({
            id: u.id,
            name: u.name,
            avatar: u.avatar,
            online: onlineUsers.has(u.id)
        })));
    });
    
    socket.on('message', (data) => {
        const user = users.find(u => u.id === currentUserId);
        if (!user) return;
        
        const message = {
            id: Date.now().toString(),
            fromId: currentUserId,
            fromName: user.name,
            fromAvatar: user.avatar,
            toId: data.toId,
            text: data.text,
            image: data.image || null,
            time: Date.now()
        };
        
        messages.push(message);
        if (messages.length > 500) messages = messages.slice(-500);
        
        // Отправляем получателю (если он онлайн)
        const targetSocketId = onlineUsers.get(data.toId);
        if (targetSocketId) {
            io.to(targetSocketId).emit('message', message);
        }
        
        // Отправляем отправителю (подтверждение)
        socket.emit('message_sent', message);
    });
    
    socket.on('disconnect', () => {
        if (currentUserId) {
            onlineUsers.delete(currentUserId);
            
            // Обновляем статус пользователя
            const user = users.find(u => u.id === currentUserId);
            if (user) user.online = false;
            
            console.log('❌ Отключился:', currentUserId);
            
            // Рассылаем ВСЕМ обновлённый список онлайн
            const onlineList = Array.from(onlineUsers.keys());
            io.emit('users_online', onlineList);
            
            // Рассылаем обновлённый список всех пользователей
            io.emit('users_list', users.map(u => ({
                id: u.id,
                name: u.name,
                avatar: u.avatar,
                online: onlineUsers.has(u.id)
            })));
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
    ║  🟢 Онлайн статус работает!                ║
    ╚════════════════════════════════════════════╝
    `);
});
