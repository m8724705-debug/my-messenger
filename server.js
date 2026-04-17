const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" } // Разрешаем подключения с любых источников
});

// Папка для статических файлов (CSS, JS клиента)
app.use(express.static(path.join(__dirname, 'public')));

// Для обработки JSON-запросов (например, для фото)
app.use(express.json({ limit: '50mb' }));

// Отдаём главную страницу чата
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Логика чата ---
// Временное хранилище сообщений (в реальном проекте используй базу данных)
let messages = [];

io.on('connection', (socket) => {
    console.log('✅ Новый пользователь подключился');

    // 1. Отправляем новому пользователю историю сообщений
    socket.emit('chat history', messages);

    // 2. Обработка получения нового сообщения от клиента
    socket.on('chat message', (msg) => {
        console.log('📨 Получено сообщение:', msg);
        // Добавляем сообщение в историю
        messages.push(msg);
        // Ограничиваем историю последними 100 сообщениями
        if (messages.length > 100) messages = messages.shift();

        // 3. Рассылаем это сообщение ВСЕМ подключённым пользователям
        io.emit('chat message', msg);
    });

    socket.on('disconnect', () => {
        console.log('❌ Пользователь отключился');
    });
});

// Запускаем сервер
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ╔══════════════════════════════════════════════╗
    ║     ✅ VANOGRAM СЕРВЕР ЗАПУЩЕН!              ║
    ╠══════════════════════════════════════════════╣
    ║  🚀 Сервер работает на порту: ${PORT}         ║
    ║  🔗 Адрес: https://vanogramess.onrender.com  ║
    ╚══════════════════════════════════════════════╝
    `);
});
