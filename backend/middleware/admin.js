const db = require('../db');

function adminMiddleware(req, res, next) {
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.user.id);
  if (!user?.is_admin) {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  }
  next();
}

module.exports = adminMiddleware;
