const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { notify } = require('../notify');

const router = express.Router();
router.use(authMiddleware);

// ---------- Publier un post (texte et/ou média) ----------
router.post('/', async (req, res) => {
  const { content, media_url } = req.body;
  if (!content?.trim() && !media_url) {
    return res.status(400).json({ error: 'Le post doit contenir du texte ou un média' });
  }

  const id = uuid();
  await db
    .prepare('INSERT INTO posts (id, user_id, content, media_url) VALUES (?, ?, ?, ?)')
    .run(id, req.user.id, content?.trim() || null, media_url || null);

  res.status(201).json(await getPostById(id));
});

// ---------- Repartager un post existant ----------
router.post('/:id/share', async (req, res) => {
  const original = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Publication introuvable' });

  const id = uuid();
  await db
    .prepare('INSERT INTO posts (id, user_id, content, media_url, shared_from_id) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.user.id, original.content, original.media_url, original.id);

  await notify(req.app.get('io'), { user_id: original.user_id, actor_id: req.user.id, type: 'share', post_id: original.id });

  res.status(201).json(await getPostById(id));
});

// ---------- Aimer / ne plus aimer ----------
router.post('/:id/like', async (req, res) => {
  const post = await db.prepare('SELECT id, user_id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Publication introuvable' });

  const already = await db
    .prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);

  if (already) {
    await db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  } else {
    await db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)').run(req.params.id, req.user.id);
    await notify(req.app.get('io'), { user_id: post.user_id, actor_id: req.user.id, type: 'like', post_id: post.id });
  }

  const countRow = await db.prepare('SELECT COUNT(*) AS n FROM post_likes WHERE post_id = ?').get(req.params.id);
  res.json({ liked: !already, like_count: countRow.n });
});

// ---------- Favoris ----------
router.post('/:id/bookmark', async (req, res) => {
  const post = await db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Publication introuvable' });

  const already = await db
    .prepare('SELECT 1 FROM post_bookmarks WHERE post_id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);

  if (already) {
    await db.prepare('DELETE FROM post_bookmarks WHERE post_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  } else {
    await db.prepare('INSERT INTO post_bookmarks (post_id, user_id) VALUES (?, ?)').run(req.params.id, req.user.id);
  }

  res.json({ bookmarked: !already });
});

// ---------- Commentaires ----------
router.get('/:id/comments', async (req, res) => {
  const comments = await db
    .prepare(
      `SELECT c.id, c.content, c.created_at, u.id AS user_id, u.username, u.avatar_url
       FROM post_comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? ORDER BY c.created_at ASC`
    )
    .all(req.params.id);
  res.json(comments);
});

router.post('/:id/comments', async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Commentaire vide' });

  const post = await db.prepare('SELECT id, user_id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Publication introuvable' });

  const id = uuid();
  await db
    .prepare('INSERT INTO post_comments (id, post_id, user_id, content) VALUES (?, ?, ?, ?)')
    .run(id, req.params.id, req.user.id, content.trim());

  await notify(req.app.get('io'), { user_id: post.user_id, actor_id: req.user.id, type: 'comment', post_id: post.id });

  const comment = await db
    .prepare(
      `SELECT c.id, c.content, c.created_at, u.id AS user_id, u.username, u.avatar_url
       FROM post_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`
    )
    .get(id);
  res.status(201).json(comment);
});

// ---------- Fil de publications (le plus récent en premier) ----------
router.get('/', async (req, res) => {
  const { user_id } = req.query;
  const rows = await db
    .prepare(
      `SELECT p.id, p.user_id, u.username, u.avatar_url, u.badge, p.content, p.media_url, p.created_at,
              (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS like_count,
              EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked_by_me,
              (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.id) AS comment_count,
              (SELECT COUNT(*) FROM posts sp WHERE sp.shared_from_id = p.id) AS share_count,
              EXISTS(SELECT 1 FROM post_bookmarks b WHERE b.post_id = p.id AND b.user_id = ?) AS bookmarked_by_me,
              su.username AS shared_from_username
       FROM posts p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN posts so ON so.id = p.shared_from_id
       LEFT JOIN users su ON su.id = so.user_id
       ${user_id ? 'WHERE p.user_id = ?' : ''}
       ORDER BY p.created_at DESC
       LIMIT 100`
    )
    .all(...(user_id ? [req.user.id, req.user.id, user_id] : [req.user.id, req.user.id]));
  res.json(rows);
});

// ---------- Supprimer son propre post ----------
router.delete('/:id', async (req, res) => {
  const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Publication introuvable' });
  if (post.user_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });

  await db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

async function getPostById(id) {
  return db
    .prepare(
      `SELECT p.id, p.user_id, u.username, u.avatar_url, u.badge, p.content, p.media_url, p.created_at,
              0 AS like_count, false AS liked_by_me, 0 AS comment_count, 0 AS share_count,
              false AS bookmarked_by_me, su.username AS shared_from_username
       FROM posts p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN posts so ON so.id = p.shared_from_id
       LEFT JOIN users su ON su.id = so.user_id
       WHERE p.id = ?`
    )
    .get(id);
}

module.exports = router;
