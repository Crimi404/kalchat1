const express = require('express');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');

const router = express.Router();
router.use(authMiddleware, adminMiddleware);

// ---------- Statistiques globales ----------
router.get('/stats', (req, res) => {
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const posts = db.prepare('SELECT COUNT(*) AS n FROM posts').get().n;
  const messages = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
  const stories = db.prepare("SELECT COUNT(*) AS n FROM stories WHERE expires_at > datetime('now')").get().n;
  const blocked = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_blocked = 1').get().n;
  res.json({ users, posts, messages, active_stories: stories, blocked });
});

// ---------- Liste de tous les utilisateurs ----------
router.get('/users', (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.avatar_url, u.badge, u.is_admin, u.is_blocked, u.created_at,
              (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) AS post_count
       FROM users u
       ORDER BY u.created_at DESC`
    )
    .all();
  res.json(rows.map((u) => ({ ...u, is_admin: !!u.is_admin, is_blocked: !!u.is_blocked })));
});

// ---------- Attribuer / retirer un badge ----------
router.patch('/users/:id/badge', (req, res) => {
  const { badge } = req.body; // 'gold' | 'diamond' | 'blue' | null
  const allowed = [null, 'gold', 'diamond', 'blue'];
  if (!allowed.includes(badge)) return res.status(400).json({ error: 'Badge invalide' });

  db.prepare('UPDATE users SET badge = ? WHERE id = ?').run(badge, req.params.id);
  res.json({ ok: true });
});

// ---------- Bloquer / débloquer un utilisateur ----------
router.patch('/users/:id/block', (req, res) => {
  const { blocked } = req.body;
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Impossible de te bloquer toi-même' });

  db.prepare('UPDATE users SET is_blocked = ? WHERE id = ?').run(blocked ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
