/**
 * Multi-user migration script
 *
 * Converts ktchp from single-user to multi-user:
 *  1. Adds columns to users (is_admin, display_name, is_active)
 *  2. Adds columns to sources (is_default, created_by, max_items)
 *  3. Creates user_source_settings table
 *  4. Creates invite_codes table
 *  5. Creates user_articles table
 *  6. Copies existing article state into user_articles
 *  7. Migrates provider settings to global
 *  8. Drops per-user columns from articles
 *  9. Marks migration complete
 *
 * Usage:
 *   npx tsx scripts/migrate-multiuser.ts            # real migration
 *   npx tsx scripts/migrate-multiuser.ts --dry-run   # preview only (rolls back)
 */

import { existsSync } from 'fs';
import { resolve } from 'path';

// Load .env.local if it exists (local dev); in production, env vars come from the platform
const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

import { sql } from '@vercel/postgres';

const DRY_RUN = process.argv.includes('--dry-run');

function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const { rows } = await sql.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}

async function tableExists(table: string): Promise<boolean> {
  const { rows } = await sql.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
    [table]
  );
  return rows.length > 0;
}

async function indexExists(name: string): Promise<boolean> {
  const { rows } = await sql.query(
    `SELECT 1 FROM pg_indexes WHERE indexname = $1`,
    [name]
  );
  return rows.length > 0;
}

async function rowCount(table: string): Promise<number> {
  const { rows } = await sql.query(`SELECT COUNT(*) AS c FROM ${table}`);
  return parseInt(rows[0].c, 10);
}

async function run() {
  // Pre-flight checks
  log('preflight', 'Checking database connection...');
  try {
    await sql`SELECT 1`;
  } catch (e) {
    console.error('Cannot reach database:', e);
    process.exit(1);
  }

  for (const t of ['users', 'sources', 'articles', 'digests', 'settings', 'sessions']) {
    if (!(await tableExists(t))) {
      console.error(`Expected table "${t}" not found. Run the app first to create the schema.`);
      process.exit(1);
    }
  }

  // Check if already migrated
  try {
    const { rows } = await sql`
      SELECT value FROM settings WHERE user_id = 'system' AND key = 'migration_multiuser'
    `;
    if (rows.length > 0 && rows[0].value === 'complete') {
      log('preflight', 'Migration already complete. Exiting.');
      process.exit(0);
    }
  } catch {
    // settings table might not have that row yet
  }

  log('start', DRY_RUN ? 'DRY RUN — will ROLLBACK at the end' : 'REAL RUN — will COMMIT');

  await sql`BEGIN`;

  try {
    // ---------------------------------------------------------------
    // Step 1: Add columns to users
    // ---------------------------------------------------------------
    log('step-1', 'Adding columns to users table...');

    if (!(await columnExists('users', 'is_admin'))) {
      await sql.query(`ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE`);
      log('step-1', '  added is_admin');
    }
    if (!(await columnExists('users', 'display_name'))) {
      await sql.query(`ALTER TABLE users ADD COLUMN display_name TEXT`);
      log('step-1', '  added display_name');
    }
    if (!(await columnExists('users', 'is_active'))) {
      await sql.query(`ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE`);
      log('step-1', '  added is_active');
    }

    // Set existing user(s) to admin
    const { rowCount: adminCount } = await sql`
      UPDATE users SET is_admin = TRUE, is_active = TRUE, display_name = COALESCE(display_name, username)
      WHERE is_admin = FALSE OR is_admin IS NULL
    `;
    log('step-1', `  marked ${adminCount ?? 0} existing user(s) as admin`);

    // ---------------------------------------------------------------
    // Step 2: Add columns to sources
    // ---------------------------------------------------------------
    log('step-2', 'Adding columns to sources table...');

    if (!(await columnExists('sources', 'is_default'))) {
      await sql.query(`ALTER TABLE sources ADD COLUMN is_default BOOLEAN DEFAULT FALSE`);
      log('step-2', '  added is_default');
    }
    if (!(await columnExists('sources', 'created_by'))) {
      await sql.query(`ALTER TABLE sources ADD COLUMN created_by TEXT`);
      log('step-2', '  added created_by');
    }
    if (!(await columnExists('sources', 'max_items'))) {
      await sql.query(`ALTER TABLE sources ADD COLUMN max_items INTEGER DEFAULT 25`);
      log('step-2', '  added max_items');
    }

    // Mark existing sources as default
    const { rowCount: defaultSourceCount } = await sql`
      UPDATE sources SET is_default = TRUE, created_by = user_id
      WHERE is_default = FALSE OR is_default IS NULL
    `;
    log('step-2', `  marked ${defaultSourceCount ?? 0} existing source(s) as default`);

    // ---------------------------------------------------------------
    // Step 3: Create user_source_settings
    // ---------------------------------------------------------------
    log('step-3', 'Creating user_source_settings table...');

    if (!(await tableExists('user_source_settings'))) {
      await sql`
        CREATE TABLE user_source_settings (
          user_id TEXT NOT NULL REFERENCES users(id),
          source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
          enabled BOOLEAN DEFAULT TRUE,
          UNIQUE(user_id, source_id)
        )
      `;
      log('step-3', '  created table');
    } else {
      log('step-3', '  table already exists');
    }

    // ---------------------------------------------------------------
    // Step 4: Create invite_codes
    // ---------------------------------------------------------------
    log('step-4', 'Creating invite_codes table...');

    if (!(await tableExists('invite_codes'))) {
      await sql`
        CREATE TABLE invite_codes (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          code TEXT UNIQUE NOT NULL,
          created_by TEXT NOT NULL REFERENCES users(id),
          used_by TEXT REFERENCES users(id),
          used_at TIMESTAMPTZ,
          expires_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      log('step-4', '  created table');
    } else {
      log('step-4', '  table already exists');
    }

    // ---------------------------------------------------------------
    // Step 5: Create user_articles
    // ---------------------------------------------------------------
    log('step-5', 'Creating user_articles table...');

    if (!(await tableExists('user_articles'))) {
      await sql`
        CREATE TABLE user_articles (
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
      log('step-5', '  created table');

      // Create indexes
      await sql`CREATE INDEX idx_user_articles_user_digest ON user_articles(user_id, digest_id)`;
      await sql`CREATE INDEX idx_user_articles_user_archived ON user_articles(user_id, is_archived)`;
      await sql`CREATE INDEX idx_user_articles_user_bookmarked ON user_articles(user_id, is_bookmarked) WHERE is_bookmarked = true`;
      log('step-5', '  created indexes');
    } else {
      log('step-5', '  table already exists');
    }

    // ---------------------------------------------------------------
    // Step 6: Copy existing article state into user_articles
    // ---------------------------------------------------------------
    log('step-6', 'Copying article state into user_articles...');

    // Get the admin user
    const { rows: adminRows } = await sql`
      SELECT id FROM users WHERE is_admin = TRUE ORDER BY created_at ASC LIMIT 1
    `;
    if (adminRows.length === 0) {
      throw new Error('No admin user found');
    }
    const adminId = adminRows[0].id;

    // Only copy if user_articles is empty (idempotent)
    const uaCount = await rowCount('user_articles');
    if (uaCount === 0) {
      // Check if the articles table has the columns we need to copy
      const hasRelevanceScore = await columnExists('articles', 'relevance_score');
      const hasDigestId = await columnExists('articles', 'digest_id');

      if (hasRelevanceScore && hasDigestId) {
        const { rowCount: copiedCount } = await sql.query(`
          INSERT INTO user_articles (user_id, article_id, digest_id, relevance_score, relevance_reason, is_serendipity, sentiment, is_read, is_bookmarked, is_archived, archived_at, scored_at)
          SELECT $1, id, digest_id, relevance_score, relevance_reason, COALESCE(is_serendipity, FALSE), sentiment, COALESCE(is_read, FALSE), COALESCE(is_bookmarked, FALSE), COALESCE(is_archived, FALSE), archived_at,
            CASE WHEN relevance_score IS NOT NULL THEN ingested_at ELSE NULL END
          FROM articles
        `, [adminId]);
        log('step-6', `  copied ${copiedCount ?? 0} article(s) into user_articles for admin`);
      } else {
        log('step-6', '  articles table missing expected columns, skipping copy');
      }
    } else {
      log('step-6', `  user_articles already has ${uaCount} rows, skipping copy`);
    }

    // ---------------------------------------------------------------
    // Step 7: Migrate settings (provider → global)
    // ---------------------------------------------------------------
    log('step-7', 'Migrating settings...');

    // Move llm_provider to global
    const { rows: providerRows } = await sql`
      SELECT user_id, value FROM settings WHERE key = 'llm_provider' AND user_id != 'global' AND user_id != 'system'
    `;
    if (providerRows.length > 0) {
      const providerValue = providerRows[0].value;
      await sql`
        INSERT INTO settings (user_id, key, value) VALUES ('global', 'llm_provider', ${providerValue})
        ON CONFLICT (user_id, key) DO UPDATE SET value = ${providerValue}
      `;
      // Remove old user-specific provider settings
      await sql`DELETE FROM settings WHERE key = 'llm_provider' AND user_id != 'global' AND user_id != 'system'`;
      log('step-7', `  migrated llm_provider to global (value: ${providerValue})`);
    } else {
      log('step-7', '  no user-specific llm_provider to migrate');
    }

    // ---------------------------------------------------------------
    // Step 8: Drop per-user columns from articles
    // ---------------------------------------------------------------
    log('step-8', 'Dropping per-user columns from articles...');

    const columnsToDrop = [
      'relevance_score', 'relevance_reason', 'is_serendipity',
      'sentiment', 'is_read', 'is_bookmarked', 'is_archived', 'archived_at',
      'digest_id',
    ];
    for (const col of columnsToDrop) {
      if (await columnExists('articles', col)) {
        await sql.query(`ALTER TABLE articles DROP COLUMN ${col}`);
        log('step-8', `  dropped ${col}`);
      }
    }

    // Drop old indexes that reference removed columns
    if (await indexExists('idx_articles_digest_archived')) {
      await sql`DROP INDEX idx_articles_digest_archived`;
      log('step-8', '  dropped idx_articles_digest_archived');
    }
    if (await indexExists('idx_articles_bookmarked')) {
      await sql`DROP INDEX idx_articles_bookmarked`;
      log('step-8', '  dropped idx_articles_bookmarked');
    }

    // ---------------------------------------------------------------
    // Step 9: Mark migration complete
    // ---------------------------------------------------------------
    log('step-9', 'Marking migration complete...');
    await sql`
      INSERT INTO settings (user_id, key, value) VALUES ('system', 'migration_multiuser', 'complete')
      ON CONFLICT (user_id, key) DO UPDATE SET value = 'complete'
    `;

    // Summary
    log('summary', `users: ${await rowCount('users')}`);
    log('summary', `sources: ${await rowCount('sources')}`);
    log('summary', `articles: ${await rowCount('articles')}`);
    log('summary', `user_articles: ${await rowCount('user_articles')}`);
    log('summary', `user_source_settings: ${await rowCount('user_source_settings')}`);
    log('summary', `invite_codes: ${await rowCount('invite_codes')}`);

    if (DRY_RUN) {
      await sql`ROLLBACK`;
      log('done', 'DRY RUN complete — all changes rolled back');
    } else {
      await sql`COMMIT`;
      log('done', 'Migration committed successfully');
    }
  } catch (error) {
    await sql`ROLLBACK`;
    console.error('Migration failed, rolled back:', error);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
