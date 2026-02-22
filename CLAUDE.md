# ketchup — Project Guide

## Quick Reference

- **Build**: `npm run build` (Next.js 16, Turbopack)
- **Dev**: `npm run dev` (http://localhost:3000)
- **Ingest**: `npx tsx scripts/ingest.ts` (full pipeline)
- **Deploy**: Push to main → Vercel auto-deploys

## Tech Stack

- Next.js 16 (App Router, React 19, Turbopack)
- Vercel Postgres (Neon) with pgvector
- OpenAI `text-embedding-3-small` (512d) for embeddings
- Kimi K2.5 via Synthetic API for LLM scoring (OpenAI-compatible client)
- Tailwind CSS 4, dark theme only
- Fonts: DM Sans (body) + JetBrains Mono (mono)
- Auth: bcrypt + httpOnly session cookies (HMAC-SHA256, 7-day expiry)

## Architecture Patterns

### Data Flow
- **Articles are shared**, stored once in `articles` table regardless of user count
- **Per-user state** lives in `user_articles` (scores, sentiment, bookmarks, archive, digest assignment)
- **Ingestion and scoring are decoupled** — RSS fetching is global, relevance scoring is per-user
- **Embeddings are ephemeral** — article embeddings pruned after 7 days, interest embeddings kept permanently

### API Routes
- All admin routes use `requireAdmin()` server-side check
- Auth check pattern: `const userId = await getSessionFromCookies(); if (!userId) return 401;`
- Logout uses 303 redirect (not 307) to convert POST → GET
- Settings stored in key-value `settings` table with `user_id` scope (or `'global'`)

### Components
- Server components for pages (data fetching), client components for interactivity
- `'use client'` directive on all interactive components
- Toast notifications via `useToast()` from `Toast.tsx` context provider
- Swipe gestures via `useSwipeToArchive` hook with velocity detection

### Database
- Schema auto-created on first run via `initializeDatabase()` in `lib/db/index.ts`
- pgvector with JSONB fallback (auto-detected)
- User deletion cascades manually through all 10+ referencing tables (see `deleteUser` in `users.ts`)
- Invite codes track `used_by_username` via LEFT JOIN (not denormalized)

### Styling Conventions
- All colors use CSS custom properties (defined in globals.css): `text-foreground`, `text-muted`, `bg-card`, `border-card-border`, `text-accent`, `bg-accent-light`, `text-danger`, etc.
- Pill buttons: `px-3 py-1.5 text-sm rounded-full border` with active/inactive states
- Cards: `p-4 rounded-lg bg-card border border-card-border`
- Animations: `card-archiving` class for opacity fade-out only (300ms), manual height collapse via JS with `requestAnimationFrame` batching

### UI Patterns
- Settings tabs are role-gated: non-admin users see only user-facing tabs
- Default sources show "Default" label instead of delete button
- Interest weights use discrete pill buttons (0, 0.2, 0.4, 0.6, 0.8, 1.0) — not sliders
- Feedback button order reverses based on swipe direction setting
- Card archive animation: opacity fade (300ms) → height collapse (300ms) → display:none, with scroll position preservation. CSS handles opacity only; JS handles all spatial collapse via `requestAnimationFrame`

### Scoring Pipeline
- Two-stage: embedding prefilter → LLM refinement
- **Prefilter**: removes spam domains (exact domain match), short titles (<4 chars), exact title dupes, stale articles (>14 days). New users (<14 days old) get an extended window back to 14 days before account creation
- **Embedding scores**: weight-adjusted (`similarity * interest.weight`) and blended across multiple interests (configurable primary/secondary weights)
- **Exclusion penalties**: reduce scores for articles matching excluded topics (graduated, up to 80% reduction)
- **Source trust multipliers**: boost/penalize based on per-source sentiment history (0.8–1.2 range)
- **Semantic dedup**: removes near-identical articles during ingestion (cosine similarity > 0.85)
- **LLM scoring**: receives article titles + content snippets (first 500 chars) for nuanced relevance assessment
- **Interest expansion**: descriptions auto-expanded via LLM for richer embeddings
- **Serendipity**: weighted sampling (proximity 50%, interest diversity 30%, source diversity 20%)
- **Affinity analysis**: weekly (configurable day) LLM-based interest discovery from feedback patterns
- **All thresholds** are configurable via admin panel (Settings → Admin → Scoring). Code defaults serve as fallbacks; DB values are the single source of truth

## File Organization

- `src/app/` — Pages and API routes (Next.js App Router)
- `src/components/` — Client components (one per file, default export)
- `src/hooks/` — Custom React hooks
- `src/lib/` — Server-side logic (no React)
  - `lib/db/` — Database queries (one file per table/domain)
  - `lib/ingestion/` — RSS fetching and article storage
  - `lib/relevance/` — Scoring pipeline (prefilter → embed → LLM → digest)
  - `lib/affinity.ts` — Weekly LLM-based interest discovery from feedback
  - `lib/interest-expansion.ts` — LLM expansion of interest descriptions for embedding
  - `lib/source-trust.ts` — Source trust factor computation from sentiment data
- `src/types/` — Shared TypeScript interfaces
- `scripts/` — Standalone CLI scripts (run via `npx tsx`)
  - `scripts/prefilter-debug.ts` — Dry-run prefilter analysis per user (read-only, no DB changes)

## Environment

- Production: Vercel (app) + GitHub Actions (daily cron at 5 AM CT)
- Database: Vercel Postgres (Neon) — free tier, 256 MB limit
- Required env vars: `POSTGRES_URL`, `CRON_SECRET`, `SYNTHETIC_API_KEY`, `OPENAI_API_KEY`
