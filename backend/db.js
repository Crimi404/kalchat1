const { Pool, types } = require('pg');

// Par défaut, node-postgres renvoie les BIGINT (type des résultats de COUNT(*)) sous forme
// de string pour éviter les pertes de précision. Comme tout le code ici a été écrit en
// supposant des nombres JS classiques (comme le faisait SQLite), on force la conversion.
types.setTypeParser(20, (val) => parseInt(val, 10)); // OID 20 = int8/bigint

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL manquant. Ajoute la chaîne de connexion Supabase dans les variables d\'environnement.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------- Compatibilité : conversion des `?` en `$1, $2, ...` (syntaxe Postgres) ----------
function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// ---------- Petite couche de compatibilité façon better-sqlite3, mais asynchrone ----------
function prepare(sql) {
  const pgSql = toPgSql(sql);
  return {
    get: async (...params) => (await pool.query(pgSql, params)).rows[0],
    all: async (...params) => (await pool.query(pgSql, params)).rows,
    run: async (...params) => {
      const result = await pool.query(pgSql, params);
      return { changes: result.rowCount };
    },
  };
}

async function exec(sql) {
  await pool.query(sql);
}

// ---------- Schéma ----------
async function initSchema() {
  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      status_text TEXT DEFAULT 'Salut, j''utilise Kalchat !',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      is_group INTEGER NOT NULL DEFAULT 0,
      name TEXT,
      avatar_url TEXT,
      created_by TEXT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_admin INTEGER NOT NULL DEFAULT 0,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (conversation_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT,
      media_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS message_reads (
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      media_url TEXT NOT NULL,
      caption TEXT,
      shared_from_id TEXT REFERENCES stories(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS story_views (
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      viewer_id TEXT NOT NULL,
      viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (story_id, viewer_id)
    );

    CREATE TABLE IF NOT EXISTS story_likes (
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (story_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS story_comments (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT,
      media_url TEXT,
      shared_from_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS post_likes (
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS post_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS post_bookmarks (
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      post_id TEXT,
      conversation_id TEXT,
      message_id TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_stories_user ON stories(user_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);

    CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      followed_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      responded_at TIMESTAMPTZ,
      PRIMARY KEY (follower_id, followed_id)
    );

    CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows(followed_id, status);
  `);

  // ---------- Migrations légères (colonnes ajoutées après la première version) ----------
  // Postgres supporte IF NOT EXISTS nativement sur ADD COLUMN, beaucoup plus simple qu'avec SQLite.
  await exec(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS badge TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;
  `);

  console.log('✅ Schéma Postgres (Supabase) prêt.');
}

module.exports = { prepare, exec, pool, initSchema };
