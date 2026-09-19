const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// ---------- Inscription ----------
router.post('/register', async (req, res) => {
  const { username, password, avatar_url } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit faire au moins 6 caractères' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: 'Ce nom d\'utilisateur est déjà pris' });
  }

  const id = uuid();
  const password_hash = await bcrypt.hash(password, 10);
  const isFirstUser = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;

  db.prepare(
    'INSERT INTO users (id, username, password_hash, avatar_url, is_admin, badge) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, username, password_hash, avatar_url || null, isFirstUser ? 1 : 0, isFirstUser ? 'gold' : null);

  const token = jwt.sign({ id, username }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.status(201).json({ token, user: { id, username, avatar_url: avatar_url || null, is_admin: isFirstUser } });
});

// ---------- Connexion ----------
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  if (user.is_blocked) {
    return res.status(403).json({ error: 'Ce compte a été bloqué par un administrateur' });
  }

  const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });

  res.json({
    token,
    user: { id: user.id, username: user.username, avatar_url: user.avatar_url, status_text: user.status_text, is_admin: !!user.is_admin },
  });
});

// ---------- Profil courant ----------
router.get('/me', authMiddleware, (req, res) => {
  const user = db
    .prepare('SELECT id, username, avatar_url, status_text, bio, badge, is_admin, created_at FROM users WHERE id = ?')
    .get(req.user.id);
  res.json({ ...user, is_admin: !!user.is_admin });
});

// ---------- Recherche d'utilisateurs (pour démarrer une conversation) ----------
router.get('/search', authMiddleware, (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const users = db
    .prepare(
      'SELECT id, username, avatar_url FROM users WHERE username LIKE ? AND id != ? LIMIT 20'
    )
    .all(q, req.user.id);
  res.json(users);
});

module.exports = router;
