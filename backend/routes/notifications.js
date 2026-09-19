const express = require('express');
const db = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ---------- Liste des notifications (les plus récentes en premier) ----------
router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT n.id, n.type, n.post_id, n.conversation_id, n.message_id, n.is_read, n.created_at,
              a.id AS actor_id, a.username AS actor_username, a.avatar_url AS actor_avatar_url
       FROM notifications n JOIN users a ON a.id = n.actor_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT 50`
    )
    .all(req.user.id);
  res.json(rows);
});

// ---------- Nombre de notifications non lues ----------
router.get('/unread-count', (req, res) => {
  const { n } = db
    .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(req.user.id);
  res.json({ count: n });
});

// ---------- Marquer une notification comme lue ----------
router.post('/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- Tout marquer comme lu ----------
router.post('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
