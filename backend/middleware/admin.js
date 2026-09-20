const db = require('../db');

async function adminMiddleware(req, res, next) {
  const user = await db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.user.id);
  if (!user?.is_admin) {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  }
  next();
}

module.exports = adminMiddleware;
