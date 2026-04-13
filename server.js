// server.js - Vanogram Pro (объединение лучших решений)
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// ========== МОДЕЛИ ДАННЫХ (из WhatsApp Web Clone) [citation:3] ==========
const messageSchema = new mongoose.Schema({
    id: String,
    wa_id: String,           // ID получателя
    phone: String,
    name: String,
    text: String,
    type: { type: String, enum: ['incoming', 'outgoing'] },
    timestamp: { type: Date, default: Date.now },
    status: { type: String, enum: ['sent', 'delivered', 'read', 'failed'], default: 'sent' },
    message_type: { type: String, default: 'text' },
    image: String,
    audio: String
});

const chatSchema = new mongoose.Schema({
    chatId: String,
    participants: [String],
    lastMessage: String,
    lastMessageTime: Date,
    unreadCount: { type: Number, default: 0 }
});

const Message = mongoose.model('Message', messageSchema);
const Chat = mongoose.model('Chat', chatSchema);

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/vanogram');

// ========== ХРАНИЛИЩЕ В ПАМЯТИ (для скорости) ==========
let users = [];
let onlineUsers = new Map();

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ========== API (на основе WhatsApp Web Clone) [citation:3] ==========
// Регистрация
app.post('/api/register', (req, res) => {
    const { phone, name, deviceId } = req.body;
    let user = users.find(u => u.phone === phone || u.deviceId === deviceId);
    
    if (!user) {
        user = {
            id: Date.now().toString(),
            phone, name: name || phone, deviceId,
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name || phone)}&background=3390ec&color=fff`,
            createdAt: new Date()
        };
        users.push(user);
    }
    res.json({ token: user.id, user: { id: user.id, phone: user.phone, name: user.name, avatar: user.avatar } });
});

// Получение чатов (как в WhatsApp Web Clone)
app.get('/api/chats', async (req, res) => {
    const userId = req.query.userId;
    const chats = await Chat.find({ participants: userId });
    res.json(chats);
});

// Получение сообщений для чата
app.get('/api/messages/:chatId', async (req, res) => {
    const messages = await Message.find({ wa_id: req.params.chatId }).sort({ timestamp: 1 });
    res.json(messages);
});

// Отправка сообщения через API (webhook-совместимо) [citation:3]
app.post('/api/send', async (req, res) => {
    const { wa_id, text, type } = req.body;
    const message = new Message({ id: Date.now().toString(), wa_id, text, type });
    await message.save();
    
    // Обновляем последнее сообщение в чате
    await Chat.findOneAndUpdate(
        { chatId: wa_id },
        { lastMessage: text, lastMessageTime: Date.now() },
        { upsert: true }
    );
    
    // Отправляем через WebSocket
    io.emit('newMessage', message);
    res.json({ success: true });
});

// ========== WEBSOCKET (WebRTC для звонков + чат) ==========
io.on('connection', (socket) => {
    let currentUserId = null;
    
    socket.on('auth', (userId) => {
        currentUserId = userId;
        onlineUsers.set(userId, socket.id);
        io.emit('usersOnline', Array.from(onlineUsers.keys()));
    });
    
    // Отправка сообщения (через сокет)
    socket.on('sendMessage', async (data) => {
        const message = new Message({
            id: Date.now().toString(),
            wa_id: data.chatId,
            text: data.text,
            type: 'outgoing',
            image: data.image,
            audio: data.audio
        });
        await message.save();
        io.emit('newMessage', message);
    });
    
    // ========== WEBRTC ДЛЯ ЗВОНКОВ ==========
    socket.on('callUser', (data) => {
        const targetSocket = onlineUsers.get(data.targetUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('incomingCall', {
                from: currentUserId,
                fromName: users.find(u => u.id === currentUserId)?.name,
                offer: data.offer
            });
        }
    });
    
    socket.on('answerCall', (data) => {
        const targetSocket = onlineUsers.get(data.targetUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('callAnswered', { answer: data.answer });
        }
    });
    
    socket.on('iceCandidate', (data) => {
        const targetSocket = onlineUsers.get(data.targetUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('iceCandidate', { candidate: data.candidate });
        }
    });
    
    socket.on('endCall', (data) => {
        const targetSocket = onlineUsers.get(data.targetUserId);
        if (targetSocket) io.to(targetSocket).emit('callEnded');
    });
    
    socket.on('typing', (data) => {
        socket.broadcast.emit('userTyping', { userId: currentUserId, isTyping: data.isTyping });
    });
    
    socket.on('disconnect', () => {
        if (currentUserId) {
            onlineUsers.delete(currentUserId);
            io.emit('usersOnline', Array.from(onlineUsers.keys()));
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ╔════════════════════════════════════════════════════╗
    ║          ✅ VANOGRAM PRO ЗАПУЩЕН!                  ║
    ╠════════════════════════════════════════════════════╣
    ║  📱 Откройте: https://vanogramapp.onrender.com     ║
    ╠════════════════════════════════════════════════════╣
    ║  🎨 Дизайн: Telegram [citation:1]                 ║
    ║  🔧 Бэкенд: WhatsApp Web Clone [citation:3]       ║
    ║  🔄 Протокол: Matrix-ready [citation:4]           ║
    ║  📞 Звонки: WebRTC                                ║
    ╚════════════════════════════════════════════════════╝
    `);
});
