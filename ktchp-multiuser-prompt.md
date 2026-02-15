# ktchp — Multi-User Support

## Overview

Convert ktchp from a single-user application to a multi-user system where a small number of invited users each get their own personalized digest experience. The core architectural change is separating **shared content** (articles fetched from sources) from **per-user state** (relevance scores, engagement, digests, interests, learned preferences).

Guiding principle: **fetch once, score per-user, isolate everything else.**

---

## Architecture Summary

### What is shared (global):
- **Articles** — raw article data fetched from all sources, stored once in a shared pool
- **Default sources** — the admin-seeded RSS feeds that all users start with

### What is per-user (isolated):
- **User-added sources** — private to the user who created them, invisible to others
- **Source subscriptions** — each user can enable/disable default sources for themselves
- **Relevance scores** — each article is scored independently against each user's interest profile
- **Digests** — generated per-user from their individually scored articles
- **Engagement state** — sentiment, read, bookmark, archive are all per-user per-article
- **Interests** — each user manages their own interest categories and weights
- **Learned preferences** — derived from each user's individual feedback history
- **Settings** — swipe direction and other preferences are per-user

### What is admin-only:
- **User management** — create accounts, generate invite codes, deactivate users
- **Default source management** — add/edit/delete the shared default sources
- **Global settings** — LLM provider, ingestion schedule

---

## Data Model Changes

This is the most significant part of the change. The current schema has `user_id` foreign keys on many tables but the application logic assumes a single user. The key structural change is introducing a `user_articles` join table that holds all per-user state for each article.

### New Table: `user_articles`

This table is the heart of the multi-user model. It associates each user with each article and holds all user-specific state.

```sql
CREATE TABLE user_articles (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  digest_id TEXT REFERENCES digests(id),

  -- Relevance scoring (from per-user LLM scoring)
  relevance_score REAL,
  relevance_reason TEXT,
  is_serendipity BOOLEAN DEFAULT FALSE,

  -- Engagement state (moved from articles table)
  sentiment TEXT CHECK (sentiment IN ('liked', 'neutral', 'disliked')),
  is_read BOOLEAN DEFAULT FALSE,
  is_bookmarked BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  archived_at TIMESTAMP,

  scored_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(user_id, article_id)
);

CREATE INDEX idx_user_articles_user_digest ON user_articles(user_id, digest_id);
CREATE INDEX idx_user_articles_user_archived ON user_articles(user_id, is_archived);
CREATE INDEX idx_user_articles_user_bookmarked ON user_articles(user_id, is_bookmarked) WHERE is_bookmarked = true;
CREATE INDEX idx_user_articles_user_unscored ON user_articles(user_id, relevance_score) WHERE relevance_score IS NULL;
```

### Modified Table: `articles`

The articles table becomes a **shared content pool**. Remove all per-user state columns and scoring columns. Keep only the raw article data.

```sql
-- articles table (shared, cleaned up)
-- REMOVE these columns: relevance_score, relevance_reason, is_serendipity,
--   sentiment, is_read, is_bookmarked, is_archived, archived_at, digest_id, summary
-- KEEP: id, source_id, external_id, title, url, raw_content, published_at, ingested_at
```

The `digest_id` column moves to `user_articles` (since digests are per-user). The `summary` column can stay on `articles` for now as a shared field (summaries are currently disabled and will be shared when re-enabled).

### Modified Table: `sources`

Add a distinction between default (admin) sources and user-added private sources:

```sql
ALTER TABLE sources ADD COLUMN is_default BOOLEAN DEFAULT FALSE;
ALTER TABLE sources ADD COLUMN created_by TEXT REFERENCES users(id);
-- is_default = true: visible to all users, managed by admin
-- is_default = false: private to created_by user
```

### New Table: `user_source_settings`

Tracks per-user enable/disable for default sources. User-added sources are always enabled for their creator (they can delete them if they don't want them).

```sql
CREATE TABLE user_source_settings (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT TRUE,
  UNIQUE(user_id, source_id)
);
```

If no row exists for a user+default source pair, the source is considered enabled (opt-out model).

### Modified Table: `users`

Add admin flag and display name:

```sql
ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
```

The existing admin user (you) should be marked `is_admin = true` during migration. Deactivated users (`is_active = false`) cannot log in and their sources are excluded from ingestion.

### New Table: `invite_codes`

```sql
CREATE TABLE invite_codes (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  code TEXT UNIQUE NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  used_by TEXT REFERENCES users(id),
  used_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Invite codes are single-use. Once used, `used_by` and `used_at` are populated. Optionally expire after a configurable period (default: 7 days).

### Modified Table: `feedback`

The feedback table stays as an append-only event log. Ensure all entries include `user_id` (they should already). No structural changes needed beyond verifying the user_id column is populated and indexed.

```sql
CREATE INDEX idx_feedback_user ON feedback(user_id, created_at);
```

### Modified Table: `settings`

Settings need to become per-user. Add a `user_id` column:

```sql
ALTER TABLE settings ADD COLUMN user_id TEXT REFERENCES users(id);
-- user_id = NULL: global setting (LLM provider, etc.)
-- user_id = <id>: per-user setting (swipe direction, etc.)
```

Update the settings queries to scope by user_id where appropriate.

### Modified Table: `digests`

No structural changes — digests already have `user_id`. Just ensure all queries scope by user.

### Modified Table: `interests`

No structural changes — interests already have `user_id`. Just ensure all queries scope by user.

### Modified Table: `learned_preferences`

No structural changes — already has `user_id`. Scope all queries by user.

---

## Migration Strategy

This migration must handle the existing single-user data carefully. **The migration must be implemented as a standalone script** (`scripts/migrate-multiuser.ts`) that is run manually — NOT as part of the schema init or auto-run on deploy. This allows testing against a database dump before running on production.

### The Migration Script

Create `scripts/migrate-multiuser.ts` with the following properties:

- **Standalone executable**: Runnable via `npx tsx scripts/migrate-multiuser.ts` with the `POSTGRES_URL` env var
- **Idempotent**: Safe to re-run. Every step checks whether it has already been completed before executing (e.g., check if column exists before adding, check if table exists before creating, check if rows were already migrated before copying). Use a `settings` row like `migration_multiuser = 'complete'` as a final flag.
- **Transactional**: Wrap the entire migration in a single database transaction. If any step fails, roll back everything and exit with a clear error message indicating which step failed and why.
- **Verbose logging**: Print each step as it runs with counts (e.g., "Migrating 342 articles to user_articles... done (342 rows created)"). This gives confidence that the migration completed correctly.
- **Dry-run mode**: Accept a `--dry-run` flag that runs the full migration inside a transaction and then rolls back instead of committing. This lets you verify the migration against production data without making changes.
- **Pre-flight checks**: Before starting, verify:
  - Database is reachable
  - Expected tables exist (users, articles, sources, feedback, settings)
  - At least one user exists (the current single user)
  - No `user_articles` table exists yet (or if it does, it's empty — for idempotency)

### Migration Steps (in order, inside one transaction):

1. **Add new columns to `users`**: `is_admin`, `display_name`, `is_active`. Set existing user to `is_admin = true`, `is_active = true`.

2. **Add new columns to `sources`**: `is_default`, `created_by`. Set all existing sources to `is_default = true`, `created_by = <existing_user_id>`.

3. **Create `user_source_settings` table.**

4. **Create `invite_codes` table.**

5. **Create `user_articles` table.**

6. **Migrate existing article state to `user_articles`**: For every article that has engagement state (sentiment, is_read, is_bookmarked, is_archived) or scoring data (relevance_score, relevance_reason, is_serendipity) or a digest_id, create a `user_articles` row for the existing user with all that data copied over.

7. **Add `user_id` to `settings` table.** Migrate existing settings: LLM provider settings become global (`user_id = NULL`), swipe direction becomes per-user (set `user_id` to existing user).

8. **Clean up `articles` table**: After verifying the migration, remove the per-user columns from `articles` (sentiment, is_read, is_bookmarked, is_archived, archived_at, relevance_score, relevance_reason, is_serendipity, digest_id). Keep summary on articles for now.

9. **Write final flag**: Set `migration_multiuser = 'complete'` in the settings table.

### Running the Migration

```bash
# 1. Back up the production database first (Vercel Postgres supports snapshots)

# 2. Test against production data without making changes
POSTGRES_URL="your-connection-string" npx tsx scripts/migrate-multiuser.ts --dry-run

# 3. Review the dry-run output, verify row counts and step completion

# 4. Run for real
POSTGRES_URL="your-connection-string" npx tsx scripts/migrate-multiuser.ts

# 5. Verify by querying user_articles count, spot-check a few rows
```

Add these instructions to the script's `--help` output and to the project README.

---

## Ingestion Pipeline Changes

### Fetch Phase (shared)

The fetch phase runs once across ALL sources — both default sources and all user-added private sources (where the owning user is active). This is unchanged in concept, but the source query expands:

```sql
-- Get all sources to fetch:
-- 1. Default sources that are enabled by at least one active user
-- 2. User-added sources where the owning user is active
SELECT DISTINCT s.* FROM sources s
LEFT JOIN user_source_settings uss ON s.id = uss.source_id
LEFT JOIN users u ON s.created_by = u.id
WHERE
  (s.is_default = true)  -- always fetch defaults
  OR (s.is_default = false AND u.is_active = true)  -- fetch user sources if user is active
```

Articles are stored in the shared `articles` table as before, deduped by URL.

### Scoring Phase (per-user)

After fetching, scoring runs **once per active user**:

1. Get all articles ingested in this run that don't yet have a `user_articles` row for this user.
2. Get this user's enabled sources (defaults they haven't disabled + their own sources).
3. Filter articles to only those from sources this user subscribes to.
4. Run the prefilter.
5. Score the remaining articles against this user's interest profile + learned preferences via the LLM.
6. Create `user_articles` rows with scores.
7. Generate a digest for this user from articles scoring above their threshold.

```
for each active user:
  unscored_articles = articles from this ingestion run
    WHERE source_id IN (user's enabled sources)
    AND no user_articles row exists for this user+article
  prefiltered = prefilter(unscored_articles)
  scored = score_with_llm(prefiltered, user.interests, user.preferences)
  create user_articles rows with scores
  generate_digest(user, scored_articles_above_threshold)
```

### Cost Implications

With N users, the LLM scoring cost multiplies by N. For 3-5 users this is manageable ($5-15/month). To keep costs reasonable:

- **Batch efficiently**: Score each user's articles in as few LLM calls as possible (batches of ~20).
- **Skip low-signal articles**: If an article was already prefiltered out for one user, check if it would also be filtered for others before scoring.
- **Log per-user scoring costs**: Track token usage per user in ingestion logs so you can monitor.

### Ingestion Logs

Update ingestion logs to include per-user scoring details. The fetch phase logs once (shared), then each user's scoring phase is logged as a sub-section:

```json
{
  "fetch": { ... },
  "scoring": {
    "user_joe": { "articles_scored": 45, "tokens_used": 12000, "digest_created": true },
    "user_friend1": { "articles_scored": 38, "tokens_used": 9500, "digest_created": true }
  }
}
```

---

## Auth Changes

### Login

The login page stays the same visually but now accepts a username + password instead of just a password. Update the login form to have two fields:

```
Username: [__________]
Password: [__________]
[Log In]

Don't have an account? [Register with invite code]
```

### Registration

New page at `/register`:

```
Invite Code: [__________]
Username:    [__________]
Display Name:[__________]
Password:    [__________]
Confirm:     [__________]
[Create Account]
```

Validation:
- Invite code must exist, be unused, and not expired
- Username must be unique, 3-30 chars, alphanumeric + underscores
- Password minimum 8 characters
- On success: mark invite code as used, create user, auto-subscribe to all default sources, seed with default interests, log in and redirect to `/digest`

### Session Management

Sessions already have `user_id`. Ensure all API routes extract the user from the session and scope all queries accordingly. This is the most critical security requirement — **every database query that returns user-specific data must filter by the authenticated user's ID.**

### New API Routes

```
POST /api/auth/register    — Register with invite code
```

---

## API Changes

### Scoping — CRITICAL

**Every existing API route that touches user-specific data must be updated to scope by the authenticated user's ID.** This includes:

- `/api/digests/*` — filter digests and user_articles by user_id
- `/api/feedback` — record feedback with user_id, validate article belongs to user's digest
- `/api/interests/*` — CRUD scoped to user_id
- `/api/preferences/*` — scoped to user_id
- `/api/settings/*` — per-user settings scoped to user_id, global settings readable by all
- `/api/sources/*` — return default sources + user's own sources only
- `/api/manual-url` — associate with user_id

### Source Routes Updates

`GET /api/sources` should return:
- All default sources (with the user's enabled/disabled state from `user_source_settings`)
- All sources where `created_by = current_user`
- Do NOT return other users' private sources

`POST /api/sources` — creates a new source with `is_default = false`, `created_by = current_user`

`PUT /api/sources/[id]` — user can only edit sources they created. For default sources, they can only toggle enabled/disabled (which writes to `user_source_settings`).

`DELETE /api/sources/[id]` — user can only delete sources they created. Default sources cannot be deleted by non-admin users.

### Digest Routes Updates

`GET /api/digests/latest` and `GET /api/digests/[id]`:
- Scope to current user's digests
- Join through `user_articles` instead of directly to `articles`
- Include completion stats (total, archived, remaining) from `user_articles`

`GET /api/digests/bookmarks`:
- Query `user_articles` where `user_id = current_user AND is_bookmarked = true`

### Feedback Route Updates

`POST /api/feedback`:
- All actions now operate on `user_articles` rows instead of `articles` directly
- Validate that the `user_articles` row belongs to the authenticated user
- Continue logging to the append-only `feedback` table with `user_id`

### Settings Route Updates

`GET /api/settings`:
- Return merged settings: global settings (user_id IS NULL) + per-user settings (user_id = current_user)
- Per-user settings override global settings for the same key

`PUT /api/settings`:
- Per-user keys (swipe_archive_direction, etc.) write with user_id
- Global keys (llm_provider, etc.) only writable by admin

### New Admin Routes

```
GET    /api/admin/users           — List all users (admin only)
POST   /api/admin/users           — Create a user directly (admin only)
PUT    /api/admin/users/[id]      — Update user (toggle active, toggle admin)
POST   /api/admin/invite-codes    — Generate an invite code
GET    /api/admin/invite-codes    — List all invite codes (with used/unused status)
DELETE /api/admin/invite-codes/[id] — Revoke an unused invite code
```

All admin routes must verify `is_admin = true` on the authenticated user. Return 403 for non-admins.

---

## Frontend Changes

### Login Page (`/page.tsx`)

Update from single password field to username + password. Add a link to the registration page.

### New Registration Page (`/register/page.tsx`)

Simple form: invite code, username, display name, password, confirm password. Validates invite code on submit. On success, redirects to `/digest`.

### Settings Page (`/settings/page.tsx`)

Add an **Admin** tab/section that only renders for admin users. Contains:

#### User Management Section
```
Users
──────────────────────────────────────────────
| Username     | Display Name | Status   | Admin | Actions        |
|-------------|-------------|----------|-------|----------------|
| joe         | Joe          | Active   | ✓     |                |
| friend1     | Alex         | Active   |       | [Deactivate]   |
| friend2     | Sam          | Inactive |       | [Activate]     |
──────────────────────────────────────────────
[+ Create User]
```

- **Create User**: Inline form or modal with username, display name, temporary password. The user should change their password on first login (or just tell them the password and they can change it in settings — simpler for v1).
- **Deactivate/Activate**: Toggle `is_active`. Deactivated users can't log in and their private sources are excluded from ingestion.
- Admin cannot deactivate themselves.

#### Invite Codes Section
```
Invite Codes
──────────────────────────────────────────────
| Code          | Created    | Status              | Actions    |
|--------------|-----------|---------------------|------------|
| ABC123       | Feb 15    | Used by Alex (Feb 15)|            |
| XYZ789       | Feb 15    | Unused (expires Feb 22)| [Revoke] |
──────────────────────────────────────────────
[+ Generate Invite Code]
```

- **Generate**: Creates a code, displays it prominently for the admin to copy/share. Include a copy button.
- **Revoke**: Delete unused codes.

#### Default Sources Section

The existing source manager should differentiate between default sources (admin-managed, visible to all) and the user's own sources. For admin users, show a separate section or tab for managing default sources.

For non-admin users, the source manager should:
- Show default sources with an enable/disable toggle (not edit/delete)
- Show their own private sources with full edit/delete capability
- Show an "Add Source" button that creates private sources

### Digest Pages

The digest view, digest selector, and bookmarks page should work exactly as before — the per-user scoping is handled entirely in the API layer. The only frontend change is that the API calls now implicitly return data for the logged-in user.

### Navigation / Header

Add the current user's display name or username to the header/nav area, with a small dropdown or link for:
- Settings
- Log out

This helps confirm which account is active, especially if you're testing with multiple accounts.

### Account Settings

Add a section to the settings page (visible to all users, not just admin) for:
- **Change password**
- **Display name** (editable)

---

## New User Onboarding

When a new user registers (or is created by admin):

1. **Auto-subscribe to all default sources**: Create `user_source_settings` rows for all default sources, all set to `enabled = true`.
2. **Seed default interests**: Copy the default interest set (the same ones from `seed.ts`) into the user's `interests` table. The user can then customize from settings.
3. **No digest yet**: The user's first digest will be generated on the next ingestion run. Show a friendly empty state on `/digest`: "Your first digest is on its way! It'll be ready by ~5:00 AM CT tomorrow. In the meantime, customize your interests and sources in Settings."

---

## Cost Controls

LLM API costs scale with users × articles × batch calls. These controls prevent runaway costs as users add sources.

### Per-User Source Limit

Limit the number of private (non-default) sources each user can add. This is the most effective cost control because it caps the input side.

- Store the limit as a global setting: `max_user_sources` (default: 20)
- Enforce in `POST /api/sources` — if the user already has `max_user_sources` private sources, return 400 with a clear message
- Display in the source manager UI: "12 of 20 custom sources used" with a subtle progress indicator
- Admin can adjust the limit in the admin panel
- Admin's own sources are subject to the same limit (admin manages defaults separately)

### Source-Level Article Limit

High-volume feeds (news wires, aggregators) can dump hundreds of items per fetch. Cap how many items are taken from each source per ingestion run.

- Add a `max_items` column to the `sources` table (default: 25)
- When fetching an RSS feed, only take the N most recent items
- Configurable per-source in the source manager UI (both for default sources via admin and for user-added sources)
- Reasonable range: 5-50 items per source
- This is already partially present in the RSS parser — formalize it as a stored, editable setting per source

```sql
ALTER TABLE sources ADD COLUMN max_items INTEGER DEFAULT 25;
```

### Token Usage Tracking

Track LLM token consumption per user per ingestion run so the admin can monitor costs and identify outliers.

- During the per-user scoring loop, track input tokens and output tokens (most OpenAI-compatible APIs return usage in the response)
- Store per-user usage in the ingestion log events:

```json
{
  "scoring": {
    "user_joe": {
      "articles_scored": 45,
      "llm_calls": 3,
      "input_tokens": 18500,
      "output_tokens": 4200,
      "total_tokens": 22700
    }
  }
}
```

- Surface in the admin panel as a simple table or summary:

```
Token Usage (Last 7 Days)
──────────────────────────────────────────
| User     | Avg Tokens/Day | Total     |
|----------|---------------|-----------|
| joe      | 22,000        | 154,000   |
| friend1  | 15,000        | 105,000   |
| friend2  | 31,000        | 217,000   |
──────────────────────────────────────────
```

- This is read-only / informational for now. No automatic throttling — just visibility so the admin can spot if someone's usage is unexpectedly high and take manual action (reduce their source count, adjust max_items, etc.)

### Admin Settings for Cost Controls

Add these to the admin panel:

```
Cost Controls
─────────────────────────────────
Max custom sources per user:  [20]
Default max items per source: [25]
─────────────────────────────────
```

These are global settings stored in the `settings` table with `user_id = NULL`.

---

## Implementation Priority

### Phase 1: Data Model Migration
1. Add new columns to `users`, `sources`, `settings`
2. Create `user_articles`, `user_source_settings`, `invite_codes` tables
3. Write and test the migration script (migrate existing single-user data)
4. Update TypeScript types in `types/index.ts`

### Phase 2: Core Multi-User Plumbing
5. Update `auth.ts` to handle username + password login
6. Update all existing API routes to scope by authenticated user_id — **go route by route, this is the most important step for correctness**
7. Update `db/articles.ts` to work with `user_articles` for all engagement and scoring state
8. Update `db/feedback.ts` to write to `user_articles` + append to feedback log
9. Update `db/sources.ts` to handle default vs. private sources and user_source_settings
10. Update `db/settings.ts` to handle per-user vs. global settings

### Phase 3: Ingestion Pipeline
11. Update fetch phase to query all sources (defaults + active users' private sources)
12. Implement per-user scoring loop
13. Update digest generation to create per-user digests
14. Update ingestion logs to capture per-user scoring detail

### Phase 4: Auth & Registration
15. Update login page (username + password)
16. Build registration page with invite code validation
17. Implement new user onboarding (auto-subscribe sources, seed interests)

### Phase 5: Admin UI & Cost Controls
18. Admin routes (user CRUD, invite code management)
19. Admin section in settings (user table, invite codes, default source management)
20. Differentiate default vs. private sources in the source manager UI
21. Per-user source limit enforcement (API + UI counter)
22. Source-level max_items setting (column, UI control, fetch enforcement)
23. Token usage tracking in scoring loop + admin panel display

### Phase 6: Polish
24. User display name in nav/header
25. Account settings (change password, display name)
26. Empty state for new users with no digest yet
27. Test multi-user isolation thoroughly (create a second test user, verify no data leaks)

---

## Security Checklist

Multi-user introduces real security surface. Verify each of these:

- [ ] **Data isolation**: Every API route that returns user-specific data filters by `user_id` from the session. No route returns another user's digests, articles, interests, preferences, or feedback.
- [ ] **Source privacy**: `GET /api/sources` never returns another user's private sources.
- [ ] **Admin protection**: All `/api/admin/*` routes verify `is_admin = true`. Non-admin users get 403.
- [ ] **Invite code validation**: Codes must be unused and not expired. Used codes cannot be reused. Race conditions on code redemption should be handled (e.g., use a database transaction with a uniqueness check on `used_by`).
- [ ] **Session isolation**: A session token is bound to exactly one user. Verify this on every request.
- [ ] **Password hashing**: All passwords are bcrypt-hashed. Never store plaintext.
- [ ] **Deactivated users**: Cannot log in, existing sessions are invalidated (or checked on each request), private sources excluded from ingestion.

---

## Files to Modify

### Database layer (heaviest changes):
- `src/lib/db/schema.ts` — New tables, new columns, migration logic
- `src/lib/db/articles.ts` — All engagement/scoring reads and writes now go through `user_articles`
- `src/lib/db/feedback.ts` — Write to `user_articles` + append log, scoped by user
- `src/lib/db/sources.ts` — Default vs. private sources, user_source_settings queries
- `src/lib/db/digests.ts` — Scope by user, completion stats from user_articles
- `src/lib/db/settings.ts` — Per-user vs. global settings
- `src/lib/db/users.ts` — Admin queries, invite code queries, registration
- `src/lib/db/seed.ts` — Update seeding to mark sources as default, mark user as admin
- `src/types/index.ts` — New types for UserArticle, InviteCode, updated Source/User types

### Ingestion pipeline:
- `src/lib/ingestion/index.ts` — Fetch all sources (default + private)
- `src/lib/relevance/index.ts` — Per-user scoring loop
- `src/lib/relevance/scorer.ts` — Accept user context (interests, preferences) as parameter
- `src/lib/ingestion/logger.ts` — Per-user scoring sections in logs

### Auth:
- `src/lib/auth.ts` — Username + password login, registration logic, admin check helper

### API routes (scope everything by user):
- `src/app/api/auth/login/route.ts` — Accept username + password
- `src/app/api/digests/latest/route.ts` — Query user_articles
- `src/app/api/digests/[id]/route.ts` — Query user_articles
- `src/app/api/digests/bookmarks/route.ts` — Query user_articles
- `src/app/api/feedback/route.ts` — Operate on user_articles
- `src/app/api/interests/route.ts` — Scope by user
- `src/app/api/interests/[id]/route.ts` — Scope by user
- `src/app/api/preferences/route.ts` — Scope by user
- `src/app/api/preferences/[id]/route.ts` — Scope by user
- `src/app/api/sources/route.ts` — Default + private source logic
- `src/app/api/sources/[id]/route.ts` — Ownership checks
- `src/app/api/settings/route.ts` — Per-user vs. global
- `src/app/api/manual-url/route.ts` — Associate with user
- `src/app/api/ingest/route.ts` — Per-user scoring loop

### New API routes:
- `src/app/api/auth/register/route.ts`
- `src/app/api/admin/users/route.ts`
- `src/app/api/admin/users/[id]/route.ts`
- `src/app/api/admin/invite-codes/route.ts`
- `src/app/api/admin/invite-codes/[id]/route.ts`

### Frontend:
- `src/app/page.tsx` — Username + password login form
- `src/app/register/page.tsx` — New registration page
- `src/app/settings/page.tsx` — Admin section, account settings, source manager updates
- `src/components/SourceManager.tsx` — Differentiate default (toggle only) vs. private (full CRUD)
- `src/components/DigestHeader.tsx` — No changes needed (scoping is in API)
- `src/components/ArticleCard.tsx` — No changes needed (scoping is in API)

### New frontend files:
- `src/app/register/page.tsx` — Registration page
- `src/components/AdminPanel.tsx` — User management + invite codes + cost controls UI
- `src/components/InviteCodeManager.tsx` — Generate/list/revoke invite codes
- `src/components/UserManager.tsx` — List/create/activate/deactivate users
- `src/components/AccountSettings.tsx` — Change password, display name
- `src/components/TokenUsageTable.tsx` — Admin view of per-user token consumption

### New scripts:
- `scripts/migrate-multiuser.ts` — Standalone migration script (idempotent, transactional, dry-run support)

---

## Implementation Notes

1. **Migration is the riskiest step.** Back up the production database before running the migration. Write the migration as an idempotent script that can be re-run safely (check for column/table existence before creating).

2. **Test with two users.** After implementing, create a second test user and verify: they see their own digests only, their own sources only, their feedback doesn't affect your scores, their interests are independent, admin UI is hidden from them.

3. **The per-user scoring loop should be resilient.** If scoring fails for one user (e.g., LLM error), it should log the error and continue to the next user. Don't let one user's failure block everyone else's digest.

4. **Consider ingestion timeout.** With N users to score, the ingestion endpoint will take longer. Vercel has a 60-second timeout on Hobby plans (300s on Pro) for serverless functions. For 3-5 users you should be fine, but monitor it. If it gets tight, the GitHub Actions approach (which doesn't have the same timeout) is the right call for triggering ingestion.

5. **Invite code UX.** When the admin generates a code, make it dead simple to share — show the full registration URL with the code pre-filled: `https://your-app.vercel.app/register?code=ABC123`. Include a copy button.
