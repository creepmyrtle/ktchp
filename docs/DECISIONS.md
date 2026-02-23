# ketchup — Decisions & Conventions

A running log of key technical and design decisions. Reference this to avoid re-litigating settled questions and to maintain consistency across the codebase.

---

## Architecture decisions

**Ingestion runs via GitHub Actions, not Vercel serverless functions.**
The ingestion pipeline (fetch → prefilter → embed → score → digest) is long-running and scales linearly with user count. Vercel Hobby tier has a 10-second function timeout. GitHub Actions has a 6-hour limit and is free for public repos. The pipeline is triggered by a daily cron at 11:00 UTC (5 AM CT) and can also be run manually via the Actions tab or locally via `npx tsx scripts/ingest.ts`.

**Two-stage scoring to minimize LLM costs.**
Stage 1 (embedding cosine similarity) filters out 60-80% of obviously irrelevant articles before Stage 2 (LLM refinement). This is the primary cost control mechanism. Articles are embedded once and shared across all users; scoring is per-user.

**Neon free tier (256 MB) with active storage management.**
Embedding pruning: article embeddings older than 7 days are deleted after scoring (they've served their purpose). A retention system cleans up old ingestion logs (30 days), feedback events (90 days), uninteracted user_articles (60 days), old digests (90 days), and dismissed suggestions (30 days). A configurable embedding dimensions parameter allows dropping from 512 to 256 dimensions if storage pressure requires it.

**Session signing and cron auth use separate secrets.**
`SESSION_SECRET` signs session cookies. `CRON_SECRET` authenticates the ingestion API endpoint. They were previously the same env var; now separated so that sharing cron config with collaborators doesn't compromise session security. `SESSION_SECRET` falls back to `CRON_SECRET` for backward compatibility.

## Sentiment and feedback model

**Two-way sentiment: liked / skipped (not three-way).**
Previously used liked/neutral/disliked. Replaced with liked/skipped because: (a) simplifies the mobile swipe UX to two directions, (b) "skipped" = "not for me right now" which produces cleaner signal than forcing a like/dislike binary, (c) eliminates the ambiguous "neutral" category that generated no useful training signal.

**Asymmetric signal weighting.**
A "liked" is a strong positive signal. A "skipped" is a weak negative signal — significantly weaker than the old "disliked." This prevents casual skipping from poisoning preference learning or unfairly penalizing sources. Source trust factors apply the same asymmetry: likes boost trust (up to 1.2×), skips apply a smaller penalty (less aggressive than the old dislike penalty).

**Archive no longer requires sentiment.**
Previously, sentiment had to be set before archiving. Now, swiping combines feedback + archive in one gesture on mobile. On desktop, users can archive without rating (equivalent to the old neutral — generates no feedback event).

## Mobile UX

**Directional swipes combine feedback and archive.**
On mobile (touch devices only, detected via touch events not screen width): swipe right = like + archive, swipe left = skip + archive. No separate archive step needed.

**Swipe direction is reversible.**
Default: right = like, left = skip. Users can toggle "reverse swipe directions" in settings to swap the mapping. This accommodates left-handed users or personal preference. The visual feedback layer, first-time hint, and desktop button order all respect the reversal.

**Swipe physics: threshold OR velocity.**
Two ways to commit a swipe: drag past 35% of card width, or flick with sufficient velocity (~0.5px/ms). This makes both deliberate drags and quick flicks work naturally. Direction is locked after the first ~10px of movement (horizontal vs vertical) to prevent conflicts with page scrolling.

**Desktop keeps buttons.**
Desktop interaction is unchanged: like/skip buttons + archive button. The swipe gestures only activate on touch devices.

## Scaling and resource limits

**Soft resource limits per user.**
Configurable via admin global settings: max interests (default 20), max exclusions (default 15), max private sources (default 25). Enforced in the CRUD APIs. UI disables the add button at limit.

**Per-user cost tracking.**
LLM costs are tracked per user so the admin can identify heavy consumers. Shared operations (article embedding) are logged separately.

**Session refresh at midpoint.**
Sessions are 7-day expiry with automatic refresh when a session is older than 3.5 days. Active users never get unexpectedly logged out.

## Code conventions

- TypeScript throughout, proper types, no unnecessary `any`.
- Tailwind CSS 4, dark theme, DM Sans body font, JetBrains Mono for code/monospace.
- Next.js App Router patterns. API routes in `src/app/api/`. Admin routes check auth using shared admin middleware.
- Database queries via `@vercel/postgres` (or whatever client is in use), parameterized queries, patterns match `src/lib/db/`.
- No external animation/gesture libraries. Swipe physics are hand-rolled with CSS transitions + touch event handlers.
- Settings stored in a key-value `settings` table (per-user with `user_id`, or global with `user_id = 'global'`).
- Feedback events are append-only in the `feedback` table. Canonical engagement state lives on `user_articles`.

## Things explicitly NOT doing (for now)

- Multi-LLM batching across users (considered, deferred — adds prompt complexity for uncertain quality tradeoff).
- Paid hosting tier (staying on Vercel Hobby + Neon free as long as possible).
- Email digest delivery (future improvement, not prioritized).
- Non-RSS sources like Reddit or Hacker News (future improvement).
- Full-text article extraction (future improvement, infrastructure partially exists).
