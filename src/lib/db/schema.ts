import { sql } from '@vercel/postgres';

export async function ensureSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('rss', 'manual_url')),
      config JSONB NOT NULL DEFAULT '{}',
      enabled BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS digests (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id),
      provider TEXT DEFAULT 'anthropic',
      generated_at TIMESTAMPTZ DEFAULT NOW(),
      article_count INTEGER DEFAULT 0
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      source_id TEXT NOT NULL REFERENCES sources(id),
      external_id TEXT,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      raw_content TEXT,
      summary TEXT,
      relevance_score REAL,
      relevance_reason TEXT,
      is_serendipity BOOLEAN DEFAULT FALSE,
      provider TEXT DEFAULT 'anthropic',
      digest_id TEXT REFERENCES digests(id),
      published_at TIMESTAMPTZ,
      ingested_at TIMESTAMPTZ DEFAULT NOW(),
      sentiment TEXT CHECK (sentiment IN ('liked', 'neutral', 'disliked')),
      is_read BOOLEAN DEFAULT FALSE,
      is_bookmarked BOOLEAN DEFAULT FALSE,
      is_archived BOOLEAN DEFAULT FALSE,
      archived_at TIMESTAMPTZ,
      UNIQUE(source_id, external_id, provider)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS interests (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id),
      category TEXT NOT NULL,
      description TEXT,
      weight REAL DEFAULT 1.0,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // Feedback is an append-only event log — no UNIQUE constraint
  await sql`
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id),
      article_id TEXT NOT NULL REFERENCES articles(id),
      action TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS learned_preferences (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id),
      preference_text TEXT NOT NULL,
      derived_from_count INTEGER DEFAULT 0,
      confidence REAL DEFAULT 0.5,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ingestion_logs (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id),
      provider TEXT NOT NULL,
      trigger TEXT NOT NULL CHECK (trigger IN ('cron', 'manual')),
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error')),
      started_at TIMESTAMPTZ DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      duration_ms INTEGER,
      summary JSONB DEFAULT '{}',
      events JSONB DEFAULT '[]',
      error TEXT
    )
  `;

  // Run migration for existing databases
  await migrateEngagementColumns();
}

/**
 * Adds engagement columns to existing articles table and migrates
 * existing feedback data. Safe to run multiple times (idempotent).
 */
async function migrateEngagementColumns(): Promise<void> {
  // Add new columns if they don't exist (ALTER TABLE IF NOT EXISTS isn't standard,
  // so we catch the "already exists" error)
  const columns = [
    { name: 'sentiment', def: "TEXT CHECK (sentiment IN ('liked', 'neutral', 'disliked'))" },
    { name: 'is_read', def: 'BOOLEAN DEFAULT FALSE' },
    { name: 'is_bookmarked', def: 'BOOLEAN DEFAULT FALSE' },
    { name: 'is_archived', def: 'BOOLEAN DEFAULT FALSE' },
    { name: 'archived_at', def: 'TIMESTAMPTZ' },
  ];

  for (const col of columns) {
    try {
      await sql.query(`ALTER TABLE articles ADD COLUMN ${col.name} ${col.def}`);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('already exists')) continue;
      // Column already exists, skip
      if (e instanceof Error && e.message.includes('duplicate')) continue;
      throw e;
    }
  }

  // Migrate existing feedback data to article columns
  // thumbs_up → sentiment = 'liked'
  await sql`
    UPDATE articles SET sentiment = 'liked'
    WHERE sentiment IS NULL AND id IN (
      SELECT article_id FROM feedback WHERE action = 'thumbs_up'
    )
  `;
  // thumbs_down → sentiment = 'disliked'
  await sql`
    UPDATE articles SET sentiment = 'disliked'
    WHERE sentiment IS NULL AND id IN (
      SELECT article_id FROM feedback WHERE action = 'thumbs_down'
    )
  `;
  // bookmark → is_bookmarked = true
  await sql`
    UPDATE articles SET is_bookmarked = TRUE
    WHERE is_bookmarked = FALSE AND id IN (
      SELECT article_id FROM feedback WHERE action = 'bookmark'
    )
  `;
  // dismiss → is_archived = true
  await sql`
    UPDATE articles SET is_archived = TRUE
    WHERE is_archived = FALSE AND id IN (
      SELECT article_id FROM feedback WHERE action = 'dismiss'
    )
  `;
  // click → is_read = true
  await sql`
    UPDATE articles SET is_read = TRUE
    WHERE is_read = FALSE AND id IN (
      SELECT article_id FROM feedback WHERE action = 'click'
    )
  `;

  // Drop the old UNIQUE constraint on feedback if it exists
  try {
    await sql`ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_user_id_article_id_action_key`;
  } catch {
    // Constraint may not exist or have a different name
  }

  // Drop the old CHECK constraint on feedback.action if it exists, so new action types work
  try {
    await sql`ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_action_check`;
  } catch {
    // Constraint may not exist
  }

  // Add indexes for performance
  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_articles_digest_archived ON articles(digest_id, is_archived)`;
  } catch { /* already exists */ }
  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_articles_bookmarked ON articles(is_bookmarked) WHERE is_bookmarked = true`;
  } catch { /* already exists */ }
}
