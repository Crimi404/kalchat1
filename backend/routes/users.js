const express = require('express');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { notify } = require('../notify');

const router = express.Router();
router.use(authMiddleware);

function followStatusBetween(aId, bId) {
  // Statut de la relation vue depuis "aId" vers "bId"
  return db.prepare('SELECT status FROM follows WHERE follower_id = ? AND followed_id = ?').get(aId, bId)?.status || null;
}

function canMessage(aId, bId) {
  return !!db
    .prepare(
      `SELECT 1 FROM follows
       WHERE status = 'accepted' AND (
         (follower_id = ? AND followed_id = ?) OR (follower_id = ? AND followed_id = ?)
       )`
    )
    .get(aId, bId, bId, aId);
}

// ---------- Mon propre profil (édition) ----------
router.patch('/me', (req, res) => {
  const { bio, avatar_url, status_text } = req.body;
  db.prepare('UPDATE users SET bio = COALESCE(?, bio), avatar_url = COALESCE(?, avatar_url), status_text = COALESCE(?, status_text) WHERE id = ?')
    .run(bio ?? null, avatar_url ?? null, status_text ?? null, req.user.id);

  const user = db
    .prepare('SELECT id, username, avatar_url, bio, status_text, badge, created_at FROM users WHERE id = ?')
    .get(req.user.id);
  res.json(user);
});

// ---------- Demandes d'abonnement reçues, en attente ----------
router.get('/me/requests', (req, res) => {
  const rows = db
    .prepare(
      `SELECT f.follower_id, f.created_at, u.username, u.avatar_url
       FROM follows f JOIN users u ON u.id = f.follower_id
       WHERE f.followed_id = ? AND f.status = 'pending'
       ORDER BY f.created_at DESC`
    )
    .all(req.user.id);
  res.json(rows);
});

// ---------- Répondre à une demande d'abonnement ----------
router.post('/requests/:followerId/respond', (req, res) => {
  const { accept } = req.body;
  const reqRow = db
    .prepare("SELECT * FROM follows WHERE follower_id = ? AND followed_id = ? AND status = 'pending'")
    .get(req.params.followerId, req.user.id);
  if (!reqRow) return res.status(404).json({ error: 'Demande introuvable' });

  if (accept) {
    db.prepare("UPDATE follows SET status = 'accepted', responded_at = datetime('now') WHERE follower_id = ? AND followed_id = ?")
      .run(req.params.followerId, req.user.id);
    notify(req.app.get('io'), { user_id: req.params.followerId, actor_id: req.user.id, type: 'follow_accept' });
  } else {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?').run(req.params.followerId, req.user.id);
  }
  res.json({ ok: true });
});

// ---------- Profil public d'un utilisateur ----------
router.get('/:username', (req, res) => {
  const user = db
    .prepare('SELECT id, username, avatar_url, bio, status_text, badge, first_name, last_name, created_at FROM users WHERE username = ?')
    .get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const follower_count = db.prepare("SELECT COUNT(*) AS n FROM follows WHERE followed_id = ? AND status = 'accepted'").get(user.id).n;
  const following_count = db.prepare("SELECT COUNT(*) AS n FROM follows WHERE follower_id = ? AND status = 'accepted'").get(user.id).n;
  const post_count = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE user_id = ?').get(user.id).n;

  const isMe = user.id === req.user.id;
  const relationship = isMe ? 'me' : followStatusBetween(req.user.id, user.id) || 'none';

  res.json({
    ...user,
    follower_count,
    following_count,
    post_count,
    relationship,
    can_message: isMe ? false : canMessage(req.user.id, user.id),
  });
});

// ---------- Liste des abonnés / abonnements d'un utilisateur ----------
router.get('/:username/followers', (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const rows = db
    .prepare(
      `SELECT u.username, u.avatar_url, u.badge
       FROM follows f JOIN users u ON u.id = f.follower_id
       WHERE f.followed_id = ? AND f.status = 'accepted'
       ORDER BY f.responded_at DESC`
    )
    .all(user.id);
  res.json(rows);
});

router.get('/:username/following', (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const rows = db
    .prepare(
      `SELECT u.username, u.avatar_url, u.badge
       FROM follows f JOIN users u ON u.id = f.followed_id
       WHERE f.follower_id = ? AND f.status = 'accepted'
       ORDER BY f.responded_at DESC`
    )
    .all(user.id);
  res.json(rows);
});

// ---------- Envoyer une demande d'abonnement ----------
router.post('/:username/follow', (req, res) => {
  const target = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Impossible de s\'abonner à soi-même' });

  const existing = followStatusBetween(req.user.id, target.id);
  if (existing) return res.json({ status: existing });

  db.prepare("INSERT INTO follows (follower_id, followed_id, status) VALUES (?, ?, 'pending')").run(req.user.id, target.id);
  notify(req.app.get('io'), { user_id: target.id, actor_id: req.user.id, type: 'follow_request' });
  res.status(201).json({ status: 'pending' });
});

// ---------- Se désabonner / annuler une demande ----------
router.delete('/:username/follow', (req, res) => {
  const target = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });

  db.prepare('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?').run(req.user.id, target.id);
  res.json({ status: 'none' });
});

module.exports = router;
