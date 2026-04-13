const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Хранилище данных
let messages = [];
let users = new Map(); // userId -> { id, phone, name, online }

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    console.log('Новый пользователь:', socket.id);
    
    // Отправляем историю
    socket.emit('chat history', messages);
    
    // Отправляем список пользователей
    const userList = Array.from(users.values());
    socket.emit('users list', userList);
    
    // Регистрация по номеру телефона
    socket.on('user join', (phoneNumber) => {
        const user = {
            id: socket.id,
            phone: phoneNumber,
            name: phoneNumber,
            online: true
        };
        users.set(socket.id, user);
        
        io.emit('users list', Array.from(users.values()));
        
        const systemMsg = {
            id: Date.now(),
            userId: 'system',
            userName: 'Система',
            text: `${phoneNumber} присоединился к чату`,
            timestamp: Date.now(),
            isSystem: true
        };
        messages.push(systemMsg);
        io.emit('new message', systemMsg);
    });
    
    // Отправка сообщения
    socket.on('send message', (data) => {
        const user = users.get(socket.id);
        if (!user) return;
        
        const message = {
            id: Date.now(),
            userId: socket.id,
            userName: user.name,
            text: data.text,
            timestamp: Date.now(),
            isSystem: false
        };
        
        messages.push(message);
        if (messages.length > 200) messages = messages.slice(-200);
        
        io.emit('new message', message);
    });
    
    // Отключение
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            users.delete(socket.id);
            io.emit('users list', Array.from(users.values()));
            
            const systemMsg = {
                id: Date.now(),
                userId: 'system',
                userName: 'Система',
                text: `${user.name} покинул чат`,
                timestamp: Date.now(),
                isSystem: true
            };
            messages.push(systemMsg);
            io.emit('new message', systemMsg);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Сервер Vanogram запущен на порту ${PORT}`);
});
