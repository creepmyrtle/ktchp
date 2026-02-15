import { sql } from '@vercel/postgres';

export async function ensureSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      display_name TEXT,
      is_active BOOLEAN DEFAULT TRUE,
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
      is_default BOOLEAN DEFAULT FALSE,
      created_by TEXT,
      max_items INTEGER DEFAULT 25,
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
      provider TEXT DEFAULT 'anthropic',
      published_at TIMESTAMPTZ,
      ingested_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(source_id, external_id, provider)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS user_articles (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id),
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      digest_id TEXT REFERENCES digests(id),
      relevance_score REAL,
      relevance_reason TEXT,
      is_serendipity BOOLEAN DEFAULT FALSE,
      sentiment TEXT CHECK (sentiment IN ('liked', 'neutral', 'disliked')),
      is_read BOOLEAN DEFAULT FALSE,
      is_bookmarked BOOLEAN DEFAULT FALSE,
      is_archived BOOLEAN DEFAULT FALSE,
      archived_at TIMESTAMPTZ,
      scored_at TIMESTAMPTZ,
      UNIQUE(user_id, article_id)
    )
  `;

  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_user_articles_user_digest ON user_articles(user_id, digest_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_user_articles_user_archived ON user_articles(user_id, is_archived)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_user_articles_user_bookmarked ON user_articles(user_id, is_bookmarked) WHERE is_bookmarked = true`;
  } catch { /* indexes may already exist */ }

  await sql`
    CREATE TABLE IF NOT EXISTS user_source_settings (
      user_id TEXT NOT NULL REFERENCES users(id),
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      enabled BOOLEAN DEFAULT TRUE,
      UNIQUE(user_id, source_id)
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

  await sql`
    CREATE TABLE IF NOT EXISTS invite_codes (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      code TEXT UNIQUE NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      used_by TEXT REFERENCES users(id),
      used_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}
