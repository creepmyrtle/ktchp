# ketchup — Scaling Fixes for Multi-User Growth

## Context

ketchup is a multi-user, AI-curated daily digest app built with Next.js 16 (App Router, React 19), Vercel Postgres (Neon) with pgvector, Tailwind CSS 4 (dark theme, DM Sans + JetBrains Mono fonts), and deployed on Vercel's free Hobby tier. Ingestion runs via GitHub Actions cron. The app currently has 2 users and is about to scale to 10-20.

This prompt covers 6 changes to prepare the app for more users. Read the full codebase before starting — understand the existing patterns, component styles, database query patterns, and auth flow before making any changes. Every change should match the existing code style and conventions exactly.

---

## Change 1: Split CRON_SECRET into two environment variables

**Goal:** Separate session signing from cron API authentication so sharing the cron secret (e.g., in GitHub Actions config visible to collaborators) doesn't compromise session security.

**New env var:** `SESSION_SECRET` — used exclusively for session cookie signing (HMAC-SHA256).

**Files to modify:**

- `src/lib/config.ts` — Add `SESSION_SECRET` to the config object. It should read `process.env.SESSION_SECRET`, falling back to `process.env.CRON_SECRET` for backward compatibility so existing deployments don't break.
- `src/lib/auth.ts` — Update all session signing and verification logic to use the new `SESSION_SECRET` config value instead of `CRON_SECRET`. The cron authentication check (used by `POST /api/ingest`) should continue using `CRON_SECRET` only.
- `README.md` — Update the Environment Variables table: change `CRON_SECRET`'s purpose to "Secret for authenticating the ingestion cron endpoint". Add `SESSION_SECRET` as a new row: Required = No (falls back to CRON_SECRET), Purpose = "Secret for signing session cookies. If not set, falls back to CRON_SECRET." Update Step 3 (Add API Keys) to mention `SESSION_SECRET` as recommended but optional.

**Important:** Do NOT break existing deployments. If `SESSION_SECRET` is not set, the code must silently fall back to `CRON_SECRET` for session signing. Log a warning at startup (or on first session operation) if `SESSION_SECRET` is not configured, suggesting it be set for better security.

---

## Change 2: Database storage retention system

**Goal:** Prevent the 256 MB Neon free tier database from filling up as users and data accumulate. Build a retention/cleanup system that runs automatically.

### 2a: Create `src/lib/db/retention.ts`

Create a new module with a `runRetention()` function that performs these cleanup operations in order. Each operation should return a count of rows deleted for logging. All retention windows should be defined as constants at the top of the file so they're easy to tune later.

**Retention rules:**

1. **Ingestion logs** — Delete rows from `ingestion_logs` where the log timestamp is older than 30 days.
2. **Feedback events** — Delete rows from `feedback` older than 90 days. The preference learning system (`src/lib/relevance/learner.ts`) derives preferences from feedback, and once derived, the raw events aren't needed long-term. Before deleting, check that the user has had at least one preference learning run more recent than the oldest feedback being deleted (to avoid deleting feedback that hasn't been processed yet). If you can't easily verify this, just use the 90-day window — it's conservative enough.
3. **Old user_articles rows** — For articles associated with digests older than 60 days: if the user never interacted with the article (no sentiment set, not bookmarked, not read), delete the `user_articles` row entirely. For articles the user did interact with, keep the row but NULL out the scoring metadata columns (embedding_score, reason, serendipity flag — whatever scoring-specific columns exist) to reclaim space while preserving engagement history.
4. **Old digests** — Delete digest records older than 90 days. The cascade from step 3 should have already cleaned up the associated user_articles. Make sure orphaned articles in the shared `articles` table that have zero remaining `user_articles` references AND are older than 90 days are also cleaned up.
5. **Dismissed interest suggestions** — Delete rows from `interest_suggestions` with status "dismissed" that are older than 30 days.

### 2b: Integrate retention into the ingestion pipeline

- In `src/lib/ingestion/index.ts` (or wherever the main pipeline orchestration lives), call `runRetention()` at the END of each ingestion run, after all scoring and digest creation is complete. Wrap it in a try/catch so retention failures never break the ingestion pipeline.
- Log the results (rows deleted per table) to the ingestion log using the existing `IngestionLogger` patterns.

### 2c: Create a storage stats API endpoint

- Create `src/app/api/admin/storage/route.ts` — GET endpoint, admin-only (use the existing admin auth pattern from other `/api/admin/` routes).
- Query the database for: row counts and estimated sizes for each major table (`articles`, `user_articles`, `embeddings`, `feedback`, `ingestion_logs`, `digests`, `learned_preferences`). Use `pg_total_relation_size()` for accurate sizes. Also query the total database size.
- Return JSON with table-level breakdown and total usage, plus the Neon free tier limit (256 MB) for easy comparison.

### 2d: Admin UI — storage stats display

This is part of Change 6 (System Health panel), described below. Don't build a standalone storage UI here — just make sure the API is ready.

---

## Change 3: Per-user cost tracking

**Goal:** Extend the existing cost tracking so the admin can see LLM costs broken down by user, and set soft limits on user resource usage.

### 3a: Add user_id to cost tracking

- Examine the existing `CostDashboard.tsx` and its backing data to understand how costs are currently tracked. The cost data likely comes from the ingestion/scoring pipeline.
- Wherever LLM calls are made during scoring (`src/lib/relevance/scorer.ts`), interest expansion (`src/lib/interest-expansion.ts`), preference learning (`src/lib/relevance/learner.ts`), and affinity/interest discovery (`src/lib/affinity.ts`), ensure the cost logging includes the `user_id` for whom the call was made. If the existing cost tracking doesn't have a user_id field, add one.
- For shared operations (like embedding generation in `src/lib/ingestion/index.ts` which is done once per article, not per user), log costs with `user_id = null` or a sentinel value like `'shared'`.

### 3b: Per-user cost breakdown API

- Create or extend the admin analytics API to return per-user cost summaries (total cost, cost this month, cost per ingestion run averaged over the last 7 days).
- The endpoint should also return per-user resource counts: number of interests, number of exclusions, number of private sources.

### 3c: Soft resource limits

- Add configurable limits to the settings system (using the existing `settings` key-value store with `user_id = 'global'`):
  - `max_interests_per_user` — default 20
  - `max_exclusions_per_user` — default 15
  - `max_private_sources_per_user` — default 25
- Enforce these limits in the respective CRUD API routes (`/api/interests`, `/api/exclusions`, `/api/sources`). When a user hits the limit, return a 400 with a clear error message.
- In the UI components (`InterestManager.tsx`, `ExclusionManager.tsx`, `SourceManager.tsx`), disable the "add" button and show a message when the user has reached their limit. Match the existing component styling.

### 3d: Update CostDashboard UI

- Add a per-user breakdown table to the existing `CostDashboard.tsx` showing: username, total cost (all time), cost (last 30 days), interest count, source count, and average cost per ingestion.
- Add the current soft limits with the ability for admin to edit them inline (saves to the global settings store).
- Match the existing dashboard styling and patterns. The dashboard already exists — extend it, don't rebuild it.

---

## Change 4: Session refresh on activity

**Goal:** Prevent active users from being unexpectedly logged out after 7 days by refreshing sessions mid-window.

**Files to modify:**

- `src/lib/auth.ts` — In the session validation function (whatever function checks/verifies the session cookie on each authenticated request):
  - After successfully validating a session, check the session's creation or last-refresh timestamp.
  - If the session is more than halfway through its 7-day expiry window (i.e., older than 3.5 days), issue a new session token with a fresh 7-day expiry. Update the session row in the `sessions` table and set the new cookie.
  - If the session is less than 3.5 days old, do nothing — just let the request proceed normally.
- The `sessions` table may need a `created_at` or `refreshed_at` column if it doesn't already have one. Check the schema first. If you need to add a column, make it backwards-compatible (nullable with a default, so existing sessions aren't broken).

**Important:** The refresh should happen transparently — the user should never notice. The new cookie should have the same flags (httpOnly, secure, same path, etc.) as the original.

---

## Change 5: Storage-aware embedding strategy

**Goal:** Reduce embedding storage footprint as user count grows.

### Option evaluation

Look at how embeddings are currently stored and queried in `src/lib/embeddings.ts` and `src/lib/db/schema.ts`. The app uses pgvector VECTOR(512) with JSONB fallback.

### Implementation: Add configurable embedding dimensions

- In `src/lib/config.ts`, add an `EMBEDDING_DIMENSIONS` config value that reads from `process.env.EMBEDDING_DIMENSIONS`, defaulting to `512` (current behavior).
- In `src/lib/embeddings.ts`, pass the `dimensions` parameter to the OpenAI embedding API call. The `text-embedding-3-small` model supports this natively — you just add `dimensions: 256` (or whatever value) to the API request.
- Update the schema in `src/lib/db/schema.ts` to use the configured dimension for the pgvector column. This will only affect new tables — existing embeddings at 512 dimensions will need to coexist or be backfilled.

### Migration path

- Add a script `scripts/resize-embeddings.ts` that:
  1. Reads the target dimension from config (or a CLI arg).
  2. Re-generates all interest, exclusion, and article embeddings at the new dimension size.
  3. Updates the pgvector column definition if needed.
  4. Reports before/after storage usage.
- This should be a manual migration, NOT automatic. The admin runs it when they're ready to switch.
- Add a note in the README under a new "Scaling" section explaining that reducing embedding dimensions from 512 to 256 saves ~50% of embedding storage with modest quality impact, and how to run the migration.

**Do NOT change the default from 512.** Just make it configurable so it can be reduced later when storage pressure requires it.

---

## Change 6: Admin system health panel

**Goal:** Give the admin a single consolidated view of system health, storage, and per-user resource usage.

### Create `src/components/SystemHealth.tsx`

Build a new admin-only component that consolidates system observability into one panel. It will be added as a new tab in the admin settings (alongside the existing Users, Invite Codes, Scoring, Analytics tabs in `AdminPanel.tsx`).

**Sections:**

1. **Database storage** — Fetches from the storage stats API (Change 2c). Shows:
   - Total database usage as a progress bar against the 256 MB limit.
   - Color-coded: green below 50%, yellow at 50-75%, orange at 75-90%, red above 90%.
   - Per-table breakdown: table name, row count, estimated size. Sorted by size descending.
   - Last retention run timestamp and rows cleaned per table (if available from the most recent ingestion log).

2. **User overview table** — Fetches from the per-user cost API (Change 3b). Shows:
   - Username, role (admin/user), status (active/inactive), last active date.
   - Interest count, exclusion count, private source count — each showing count / limit (e.g., "12 / 20").
   - LLM cost (last 30 days).
   - Sortable by any column.

3. **Resource limits** — Shows the current global soft limits (max interests, max exclusions, max private sources) with inline edit capability. Saves to the global settings store.

4. **Alerts** — A simple alert banner at the top of the panel that shows warnings when:
   - Database usage exceeds 75% of the 256 MB limit.
   - Any user is within 2 of their interest or source limit.
   - `SESSION_SECRET` is not configured (falling back to `CRON_SECRET`).

**Styling:** Match the existing admin panel patterns exactly. Look at `AnalyticsDashboard.tsx` and `CostDashboard.tsx` for reference — use the same card styles, table styles, colors, spacing, and responsive patterns. The app uses Tailwind CSS 4 with a dark theme.

### Integrate into AdminPanel.tsx

- Add "System Health" (or just "Health") as a new tab in the admin panel tab bar.
- It should appear as the last tab.

---

## General instructions

- **Read before writing.** Before modifying any file, read it fully to understand the existing patterns, imports, error handling style, and naming conventions. Match them exactly.
- **TypeScript.** All code is TypeScript. Use proper types — no `any` unless the existing code uses it in that context.
- **Database queries.** Follow the existing patterns in `src/lib/db/`. The app uses `@vercel/postgres` (or whatever client you find). Use parameterized queries. Check how transactions are handled if you need one.
- **API routes.** Follow the existing App Router patterns in `src/app/api/`. Check how admin auth is enforced (likely a shared helper) and use the same pattern.
- **Error handling.** Match the existing approach — look at how other API routes and pipeline functions handle errors, what they log, and what they return to the client.
- **No new dependencies** unless absolutely necessary. The project already has everything needed for these changes.
- **README.** Update the README to reflect all changes: new env vars, new scripts, the new admin tab, retention behavior, soft limits. Update the Environment Variables table, the Scripts table, the Architecture tree, and the Database table descriptions as needed.
- **Testing.** After implementing each change, verify it compiles (`npm run build`). For the retention system and session refresh, trace through the logic carefully — data deletion bugs are hard to undo.

## Implementation order

Implement in this order, verifying the build passes after each:

1. Change 1 (split CRON_SECRET) — smallest, zero risk
2. Change 4 (session refresh) — small, contained to auth.ts
3. Change 2 (retention system) — medium, new module + API
4. Change 5 (configurable embedding dimensions) — medium, touches embeddings
5. Change 3 (per-user cost tracking) — larger, extends existing systems
6. Change 6 (system health panel) — largest, depends on 2 and 3 being done

## Post-implementation reminders

After all changes are complete and the build passes, print the following reminders clearly for the user:

**After deploying Change 1:**
> ⚠️ REMINDER: You need to generate a new `SESSION_SECRET` value and add it as an environment variable in TWO places:
> 1. Your Vercel project (Settings → Environment Variables) — add for Production, Preview, and Development
> 2. Your local `.env.local` file
>
> Generate it the same way as CRON_SECRET: `openssl rand -hex 32`
>
> The app will work without it (falls back to CRON_SECRET), but the whole point of this change is to separate the two secrets. Do this before inviting new users.

**After deploying Change 2:**
> ⚠️ REMINDER: Before relying on the retention system in the daily cron, run one manual ingestion first and check the retention results in the ingestion log. Verify the row counts deleted per table look reasonable. Data deletion bugs are hard to undo — confirm the retention is cleaning up what you expect and nothing more. You can also hit the storage stats API endpoint (`GET /api/admin/storage`) before and after to see the impact.
