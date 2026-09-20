const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const LIFETIME_HOURS = Number(process.env.STORY_LIFETIME_HOURS || 24);

// ---------- Publier une story (ou repartager une story existante) ----------
router.post('/', async (req, res) => {
  const { media_url, caption, shared_from_id } = req.body;
  if (!media_url) return res.status(400).json({ error: 'media_url requis (image ou vidéo)' });

  const id = uuid();
  await db
    .prepare(
      `INSERT INTO stories (id, user_id, media_url, caption, shared_from_id, expires_at)
       VALUES (?, ?, ?, ?, ?, NOW() + INTERVAL '${LIFETIME_HOURS} hours')`
    )
    .run(id, req.user.id, media_url, caption || null, shared_from_id || null);

  const story = await db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
  res.status(201).json(story);
});

// ---------- Repartager une story existante dans son propre fil ----------
router.post('/:id/share', async (req, res) => {
  const original = await db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Story introuvable' });

  const id = uuid();
  await db
    .prepare(
      `INSERT INTO stories (id, user_id, media_url, caption, shared_from_id, expires_at)
       VALUES (?, ?, ?, ?, ?, NOW() + INTERVAL '${LIFETIME_HOURS} hours')`
    )
    .run(id, req.user.id, original.media_url, original.caption, original.id);

  const story = await db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
  res.status(201).json(story);
});

// ---------- Aimer / ne plus aimer une story ----------
router.post('/:id/like', async (req, res) => {
  const story = await db.prepare('SELECT id FROM stories WHERE id = ?').get(req.params.id);
  if (!story) return res.status(404).json({ error: 'Story introuvable' });

  const already = await db
    .prepare('SELECT 1 FROM story_likes WHERE story_id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);

  if (already) {
    await db.prepare('DELETE FROM story_likes WHERE story_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  } else {
    await db.prepare('INSERT INTO story_likes (story_id, user_id) VALUES (?, ?)').run(req.params.id, req.user.id);
  }

  const countRow = await db.prepare('SELECT COUNT(*) AS n FROM story_likes WHERE story_id = ?').get(req.params.id);
  res.json({ liked: !already, like_count: countRow.n });
});

// ---------- Commentaires ----------
router.get('/:id/comments', async (req, res) => {
  const comments = await db
    .prepare(
      `SELECT c.id, c.content, c.created_at, u.id AS user_id, u.username, u.avatar_url
       FROM story_comments c JOIN users u ON u.id = c.user_id
       WHERE c.story_id = ? ORDER BY c.created_at ASC`
    )
    .all(req.params.id);
  res.json(comments);
});

router.post('/:id/comments', async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Commentaire vide' });

  const story = await db.prepare('SELECT id FROM stories WHERE id = ?').get(req.params.id);
  if (!story) return res.status(404).json({ error: 'Story introuvable' });

  const id = uuid();
  await db
    .prepare('INSERT INTO story_comments (id, story_id, user_id, content) VALUES (?, ?, ?, ?)')
    .run(id, req.params.id, req.user.id, content.trim());

  const comment = await db
    .prepare(
      `SELECT c.id, c.content, c.created_at, u.id AS user_id, u.username, u.avatar_url
       FROM story_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`
    )
    .get(id);
  res.status(201).json(comment);
});

// ---------- Fil des stories actives, groupées par utilisateur ----------
// (contacts = personnes avec qui on a déjà une conversation, + soi-même)
router.get('/feed', async (req, res) => {
  await db.prepare('DELETE FROM stories WHERE expires_at <= NOW()').run();

  const rows = await db
    .prepare(
      `SELECT s.id, s.user_id, u.username, u.avatar_url, s.media_url, s.caption, s.created_at, s.expires_at,
              EXISTS(SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.viewer_id = ?) AS viewed_by_me,
              (SELECT COUNT(*) FROM story_likes l WHERE l.story_id = s.id) AS like_count,
              EXISTS(SELECT 1 FROM story_likes l WHERE l.story_id = s.id AND l.user_id = ?) AS liked_by_me,
              (SELECT COUNT(*) FROM story_comments c WHERE c.story_id = s.id) AS comment_count,
              su.username AS shared_from_username
       FROM stories s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN stories so ON so.id = s.shared_from_id
       LEFT JOIN users su ON su.id = so.user_id
       WHERE s.expires_at > NOW()
         AND (
           s.user_id = ?
           OR s.user_id IN (
             SELECT cm2.user_id FROM conversation_members cm1
             JOIN conversation_members cm2 ON cm2.conversation_id = cm1.conversation_id AND cm2.user_id != cm1.user_id
             WHERE cm1.user_id = ?
           )
         )
       ORDER BY s.created_at DESC`
    )
    .all(req.user.id, req.user.id, req.user.id, req.user.id);

  // Regroupe par auteur
  const grouped = {};
  for (const r of rows) {
    if (!grouped[r.user_id]) {
      grouped[r.user_id] = { user_id: r.user_id, username: r.username, avatar_url: r.avatar_url, stories: [] };
    }
    grouped[r.user_id].stories.push(r);
  }
  res.json(Object.values(grouped));
});

// ---------- Marquer une story comme vue + voir qui l'a vue ----------
router.post('/:id/view', async (req, res) => {
  await db
    .prepare('INSERT INTO story_views (story_id, viewer_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
    .run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.get('/:id/viewers', async (req, res) => {
  const story = await db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id);
  if (!story) return res.status(404).json({ error: 'Story introuvable' });
  if (story.user_id !== req.user.id) return res.status(403).json({ error: 'Seul l\'auteur peut voir la liste' });

  const viewers = await db
    .prepare(
      `SELECT u.id, u.username, u.avatar_url, v.viewed_at FROM story_views v
       JOIN users u ON u.id = v.viewer_id WHERE v.story_id = ? ORDER BY v.viewed_at DESC`
    )
    .all(req.params.id);
  res.json(viewers);
});

// ---------- Supprimer sa propre story ----------
router.delete('/:id', async (req, res) => {
  const story = await db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id);
  if (!story) return res.status(404).json({ error: 'Story introuvable' });
  if (story.user_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });

  await db.prepare('DELETE FROM stories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
