import { sql } from '@vercel/postgres';
import { config } from '../config';

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
      sentiment TEXT CHECK (sentiment IN ('liked', 'skipped')),
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

  // Exclusions table (negative interests)
  await sql`
    CREATE TABLE IF NOT EXISTS exclusions (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      description TEXT,
      expanded_description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_exclusions_user ON exclusions(user_id)`;
  } catch { /* index may already exist */ }

  // Interest suggestions table (affinity mapping)
  await sql`
    CREATE TABLE IF NOT EXISTS interest_suggestions (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      description TEXT,
      related_interests JSONB DEFAULT '[]',
      reasoning TEXT,
      confidence REAL DEFAULT 0.5,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    )
  `;

  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_suggestions_user_status ON interest_suggestions(user_id, status)`;
  } catch { /* index may already exist */ }

  // Source trust factor cache
  await sql`
    CREATE TABLE IF NOT EXISTS source_trust (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      trust_factor REAL DEFAULT 1.0,
      sample_size INTEGER DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, source_id)
    )
  `;

  // Embeddings table — try pgvector first, fall back to JSONB
  await ensureEmbeddingsTable();

  // Migrate sentiment from three-way (liked/neutral/disliked) to two-way (liked/skipped)
  // Must drop constraint BEFORE updating data, since old constraint rejects 'skipped'
  try {
    await sql`ALTER TABLE user_articles DROP CONSTRAINT IF EXISTS user_articles_sentiment_check`;
    await sql`UPDATE user_articles SET sentiment = 'skipped' WHERE sentiment IN ('neutral', 'disliked')`;
    await sql`ALTER TABLE user_articles ADD CONSTRAINT user_articles_sentiment_check CHECK (sentiment IN ('liked', 'skipped'))`;
  } catch { /* constraint may already be updated */ }

  // Add embedding_score and digest_tier to user_articles if not exists
  try {
    await sql`ALTER TABLE user_articles ADD COLUMN IF NOT EXISTS embedding_score REAL`;
    await sql`ALTER TABLE user_articles ADD COLUMN IF NOT EXISTS digest_tier TEXT CHECK (digest_tier IN ('recommended', 'serendipity', 'bonus'))`;
  } catch { /* columns may already exist */ }

  // Add semantic dedup columns to articles
  try {
    await sql`ALTER TABLE articles ADD COLUMN IF NOT EXISTS is_semantic_duplicate BOOLEAN DEFAULT FALSE`;
    await sql`ALTER TABLE articles ADD COLUMN IF NOT EXISTS duplicate_of TEXT`;
  } catch { /* columns may already exist */ }

  // Add expanded_description to interests
  try {
    await sql`ALTER TABLE interests ADD COLUMN IF NOT EXISTS expanded_description TEXT`;
  } catch { /* column may already exist */ }

  // Add refreshed_at to sessions for rolling refresh
  try {
    await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS refreshed_at BIGINT`;
  } catch { /* column may already exist */ }

  // Add fetch error tracking and health columns to sources
  try {
    await sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_fetch_error TEXT`;
    await sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_fetched_at TIMESTAMPTZ`;
    await sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_fetch_status TEXT`;
    await sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_new_article_at TIMESTAMPTZ`;
    await sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS consecutive_errors INTEGER DEFAULT 0`;
    await sql`ALTER TABLE sources ADD COLUMN IF NOT EXISTS articles_14d INTEGER DEFAULT 0`;
  } catch { /* columns may already exist */ }
}

async function ensureEmbeddingsTable(): Promise<void> {
  let usePgvector = false;
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    usePgvector = true;
  } catch {
    // pgvector not available
  }

  // Create the table with whichever columns are appropriate
  await sql`
    CREATE TABLE IF NOT EXISTS embeddings (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      ref_type TEXT NOT NULL CHECK (ref_type IN ('article', 'interest', 'exclusion')),
      ref_id TEXT NOT NULL,
      embedding_text TEXT NOT NULL,
      embedding_json JSONB,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(ref_type, ref_id)
    )
  `;

  // If pgvector is available, ensure the VECTOR column exists
  // (handles case where table was created before pgvector was enabled)
  if (usePgvector) {
    try {
      const dims = config.embeddingDimensions;
      await sql.query(`ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS embedding VECTOR(${dims})`);
    } catch { /* column may already exist */ }
  }

  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_embeddings_ref ON embeddings(ref_type, ref_id)`;
  } catch { /* index may already exist */ }
}
