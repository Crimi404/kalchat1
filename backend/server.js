require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const storiesRoutes = require('./routes/stories');
const postsRoutes = require('./routes/posts');
const notificationsRoutes = require('./routes/notifications');
const usersRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.set('io', io);
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ---------- Upload de médias (photos, vidéos, avatars) ----------
const uploadDir = path.join(__dirname, 'uploads');
require('fs').mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 20 * 1024 * 1024 } });

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  res.json({ url: `/uploads/${req.file.filename}` });
});
app.use('/uploads', express.static(uploadDir));

// ---------- Routes API ----------
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/stories', storiesRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ---------- Frontend statique (front simple servi par le même serveur) ----------
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ---------- Socket.io : chat en temps réel ----------
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = payload;
    next();
  } catch {
    next(new Error('Authentification WebSocket échouée'));
  }
});

io.on('connection', (socket) => {
  socket.join(`user:${socket.user.id}`);

  socket.on('join', (conversationId) => {
    socket.join(conversationId);
  });

  socket.on('leave', (conversationId) => {
    socket.leave(conversationId);
  });

  socket.on('typing', ({ conversation_id, is_typing }) => {
    socket.to(conversation_id).emit('typing', {
      conversation_id,
      user_id: socket.user.id,
      username: socket.user.username,
      is_typing,
    });
  });
});

const PORT = process.env.PORT || 4000;

db.initSchema()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Kalchat backend démarré sur http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Impossible d\'initialiser la base Postgres (Supabase). Vérifie DATABASE_URL.', err);
    process.exit(1);
  });
