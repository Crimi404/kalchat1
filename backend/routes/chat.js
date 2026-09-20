const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { notify } = require('../notify');

const router = express.Router();
router.use(authMiddleware);

// ---------- Liste des conversations de l'utilisateur ----------
router.get('/conversations', async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT c.id, c.is_group, c.name, c.avatar_url,
              (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
              (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id
       WHERE cm.user_id = ?
       ORDER BY last_message_at DESC NULLS LAST`
    )
    .all(req.user.id);

  // Pour les discussions 1:1, on ajoute le nom/avatar de l'autre personne
  const enriched = await Promise.all(
    rows.map(async (c) => {
      if (!c.is_group) {
        const other = await db
          .prepare(
            `SELECT u.id, u.username, u.avatar_url, u.badge FROM users u
             JOIN conversation_members cm ON cm.user_id = u.id
             WHERE cm.conversation_id = ? AND u.id != ?`
          )
          .get(c.id, req.user.id);
        return { ...c, name: other?.username, avatar_url: other?.avatar_url, other_user_id: other?.id, badge: other?.badge };
      }
      return c;
    })
  );

  res.json(enriched);
});

// ---------- Créer une conversation 1:1 ou un groupe ----------
router.post('/conversations', async (req, res) => {
  try {
    const { member_ids = [], is_group = false, name } = req.body;

    if (!is_group && member_ids.length !== 1) {
      return res.status(400).json({ error: 'Une conversation privée nécessite exactement un autre membre' });
    }
    if (is_group && !name) {
      return res.status(400).json({ error: 'Un groupe doit avoir un nom' });
    }

    // Évite de dupliquer une conversation 1:1 déjà existante
    if (!is_group) {
      const otherId = member_ids[0];

      const accepted = await db
        .prepare(
          `SELECT 1 FROM follows WHERE status = 'accepted' AND (
             (follower_id = ? AND followed_id = ?) OR (follower_id = ? AND followed_id = ?)
           )`
        )
        .get(req.user.id, otherId, otherId, req.user.id);
      if (!accepted) {
        return res.status(403).json({ error: 'Vous devez vous abonner (et être accepté) avant de pouvoir écrire à cette personne' });
      }

      const existing = await db
        .prepare(
          `SELECT c.id FROM conversations c
           JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
           JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
           WHERE c.is_group = 0`
        )
        .get(req.user.id, otherId);
      if (existing) {
        return res.json({ id: existing.id, already_existed: true });
      }
    }

    const id = uuid();
    await db
      .prepare('INSERT INTO conversations (id, is_group, name, created_by) VALUES (?, ?, ?, ?)')
      .run(id, is_group ? 1 : 0, is_group ? name : null, req.user.id);

    const insertMember = db.prepare('INSERT INTO conversation_members (conversation_id, user_id, is_admin) VALUES (?, ?, ?)');
    await insertMember.run(id, req.user.id, 1);
    for (const uid of member_ids) {
      await insertMember.run(id, uid, 0);
    }

    res.status(201).json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ---------- Ajouter un membre à un groupe ----------
router.post('/conversations/:id/members', async (req, res) => {
  const { user_id } = req.body;
  const conv = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv || !conv.is_group) return res.status(404).json({ error: 'Groupe introuvable' });

  await db
    .prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
    .run(req.params.id, user_id);

  res.json({ ok: true });
});

// ---------- Historique des messages d'une conversation ----------
router.get('/conversations/:id/messages', async (req, res) => {
  const isMember = await db
    .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!isMember) return res.status(403).json({ error: 'Accès refusé' });

  const messages = await db
    .prepare(
      `SELECT m.id, m.sender_id, u.username AS sender_username, m.content, m.media_url, m.created_at
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = ? ORDER BY m.created_at ASC LIMIT 200`
    )
    .all(req.params.id);

  res.json(messages);
});

// ---------- Envoyer un message (aussi disponible via Socket.io) ----------
router.post('/conversations/:id/messages', async (req, res) => {
  const { content, media_url } = req.body;
  const isMember = await db
    .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!isMember) return res.status(403).json({ error: 'Accès refusé' });

  const id = uuid();
  await db
    .prepare('INSERT INTO messages (id, conversation_id, sender_id, content, media_url) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.params.id, req.user.id, content || null, media_url || null);

  const message = await db
    .prepare(
      `SELECT m.id, m.sender_id, u.username AS sender_username, m.content, m.media_url, m.created_at
       FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`
    )
    .get(id);

  // Diffusion en temps réel si Socket.io est initialisé
  const io = req.app.get('io');
  io?.to(req.params.id).emit('new_message', { conversation_id: req.params.id, message });

  const otherMembers = await db
    .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?')
    .all(req.params.id, req.user.id);
  for (const m of otherMembers) {
    await notify(io, { user_id: m.user_id, actor_id: req.user.id, type: 'message', conversation_id: req.params.id, message_id: id });
  }

  res.status(201).json(message);
});

module.exports = router;
