const { v4: uuid } = require('uuid');
const db = require('./db');

/**
 * Crée une notification pour `user_id` et la pousse en temps réel si l'utilisateur est connecté.
 * Ne notifie jamais quelqu'un pour sa propre action (ex: liker son propre post).
 */
function notify(io, { user_id, actor_id, type, post_id = null, conversation_id = null, message_id = null }) {
  if (user_id === actor_id) return;

  const id = uuid();
  db.prepare(
    `INSERT INTO notifications (id, user_id, actor_id, type, post_id, conversation_id, message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, user_id, actor_id, type, post_id, conversation_id, message_id);

  const full = db
    .prepare(
      `SELECT n.id, n.type, n.post_id, n.conversation_id, n.message_id, n.is_read, n.created_at,
              a.id AS actor_id, a.username AS actor_username, a.avatar_url AS actor_avatar_url
       FROM notifications n JOIN users a ON a.id = n.actor_id
       WHERE n.id = ?`
    )
    .get(id);

  io?.to(`user:${user_id}`).emit('notification', full);
  return full;
}

module.exports = { notify };
