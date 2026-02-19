# ketchup

A multi-user, AI-curated daily digest app. Aggregates articles from RSS feeds, scores them for relevance using a two-stage embedding + LLM pipeline, and presents personalized digests tailored to each user's interests.

## How It Works

### The Pipeline

Every ingestion run (triggered by a daily GitHub Actions cron or manually) executes this pipeline:

1. **Fetch** — Fetches new articles from all enabled RSS sources across all active users, deduplicates against existing articles.
2. **Prefilter** — Removes spam domains, very short titles, exact title duplicates, and stale articles (>7 days old).
3. **Embed** — Generates vector embeddings for all new articles using OpenAI's `text-embedding-3-small` model. Each article is embedded once and shared across all users.
4. **Score (per user)** — Two-stage scoring for each active user:
   - **Stage 1 — Embedding pre-filter**: Computes cosine similarity between article embeddings and user interest embeddings. Filters out ~60-80% of obviously irrelevant articles.
   - **Stage 2 — LLM refinement**: Sends only the top embedding-matched candidates (plus a small serendipity pool) to the LLM for nuanced scoring, reason tagging, and serendipity detection.
5. **Digest** — Selects all articles above the relevance threshold (default 0.5), plus up to 2 serendipity items, and groups them into a digest. Articles below the threshold are included as bonus articles.

### Scoring

The two-stage pipeline cuts LLM API costs by 60-80% while maintaining digest quality.

**Stage 1 (Embeddings):** Each article's embedding is compared against all of the user's interest embeddings via cosine similarity. The highest similarity score across all interests determines the article's embedding score. Articles above the LLM threshold (default 0.35) are candidates for LLM scoring. A small random sample from the "maybe relevant" range (0.20-0.35) is also included as serendipity candidates.

**Stage 2 (LLM):** The LLM receives the user's explicit interests (with weights), learned preferences from feedback history, and article titles + URLs. It returns structured JSON with relevance scores, reason tags, and serendipity flags. Serendipity candidates get a special prompt note asking the LLM to evaluate them for unexpected cross-domain value.

Articles scoring below the threshold are still stored — they just appear as bonus articles rather than in the main digest.

### Preference Learning

The system learns user preferences over time from feedback. After every 50 new feedback events (likes, dislikes, neutrals, reads), an LLM analyzes recent patterns and generates natural language preference statements (e.g., "User strongly prefers technical deep-dives over news summaries"). These preferences are injected into the scoring prompt for more personalized results.

### Engagement Model

Each article in a digest supports a multi-step engagement flow:

- **Sentiment** — Three-way rating (liked / neutral / disliked), toggleable. Required before archiving. Button order matches the configured swipe direction.
- **Read** — Automatically tracked when the user clicks the article link.
- **Bookmark** — Save articles for later, viewable on the dedicated bookmarks page.
- **Share** — Copy the article URL to clipboard.
- **Archive** — Remove the article from the active feed. On desktop, click the archive button. On mobile, swipe to archive (direction configurable in settings). Scroll position is preserved during card collapse animation.

Engagement events are logged to an append-only feedback table for preference learning, while the canonical state lives on the `user_articles` row.

## Multi-User

ketchup supports multiple users, each with their own personalized digest experience:

- **Invite-based registration** — Admin generates invite codes; new users register with a code.
- **Independent interests** — Each user has their own interest categories with configurable weights (discrete 0.0–1.0 buttons).
- **Independent sources** — Default sources (managed by admin) are shared and protected from deletion. Users can toggle them off and add private sources. OPML import supported.
- **Independent digests** — Articles are fetched once but scored per-user against each user's interest profile.
- **Independent engagement** — Likes, bookmarks, archives are all scoped to the user.
- **Admin panel** — Admin can manage users (activate/deactivate/delete), generate invite codes (with claimed-by tracking), configure scoring settings, and view analytics.
- **Role-based UI** — Non-admin users only see relevant settings tabs (Interests, Sources, Gestures, Preferences, Account). Admin-only tabs (Schedule, Logs, Admin) are hidden.

### Architecture

```
src/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # Login page
│   ├── register/page.tsx         # Invite-based registration
│   ├── settings/page.tsx         # Settings (role-gated tabs)
│   ├── digest/page.tsx           # Latest digest view
│   ├── digest/[id]/page.tsx      # Historical digest view
│   ├── digest/bookmarks/page.tsx # Bookmarked articles
│   └── api/
│       ├── auth/                 # login, logout (redirects to login), register
│       ├── account/              # profile updates (display name, password)
│       ├── admin/                # user management, invite codes, analytics (admin only)
│       ├── ingest/route.ts       # POST — runs full ingestion pipeline
│       ├── ingestion-logs/       # GET recent logs, GET log by ID
│       ├── digests/              # GET recent, GET by ID, GET latest, POST clear
│       ├── interests/            # CRUD for user interests (+ embedding generation)
│       ├── sources/              # CRUD for RSS sources
│       ├── feedback/             # POST engagement actions (sentiment, read, bookmark, archive)
│       ├── preferences/          # GET/DELETE learned preferences
│       └── settings/             # provider, schedule, swipe direction, scoring thresholds
│
├── components/
│   ├── ArticleCard.tsx           # Article display with swipe-to-archive, scroll-preserving collapse
│   ├── BookmarkCard.tsx          # Simplified card for bookmarks page
│   ├── DigestContent.tsx         # Client wrapper: tracks archive count, fetches swipe direction
│   ├── DigestHeader.tsx          # Date/time header with live progress bar (recommended vs bonus)
│   ├── DigestSelector.tsx        # Dropdown selector with completion badges
│   ├── FeedbackButtons.tsx       # Action bar: sentiment (order follows swipe direction), bookmark, share, archive
│   ├── IngestionLogs.tsx         # Log viewer with expandable event timelines
│   ├── InterestManager.tsx       # Add/edit/delete interests with discrete weight buttons
│   ├── PreferenceViewer.tsx      # View/delete learned preferences
│   ├── ScheduleManager.tsx       # GitHub Actions schedule info
│   ├── SourceManager.tsx         # Add/edit/delete RSS sources, OPML import, default source protection
│   ├── SwipeSettings.tsx         # Configure swipe-to-archive direction
│   ├── ScoringSettings.tsx       # Embedding/LLM threshold tuning (admin)
│   ├── AdminPanel.tsx            # Admin tabs: users, invite codes, scoring, analytics
│   ├── UserManager.tsx           # Activate/deactivate/delete users (admin)
│   ├── InviteCodeManager.tsx     # Generate/revoke invite codes, shows claimed-by username (admin)
│   ├── AnalyticsDashboard.tsx    # Usage analytics (admin)
│   ├── CostDashboard.tsx         # LLM cost tracking (admin)
│   ├── AccountSettings.tsx       # Change password, display name
│   ├── Toast.tsx                 # Toast notification system
│   └── CaughtUpMessage.tsx       # Completion stats when digest is fully archived
│
├── hooks/
│   └── useSwipeToArchive.ts      # Touch gesture hook with velocity detection
│
├── lib/
│   ├── config.ts                 # Environment config (API keys, thresholds, batch size)
│   ├── auth.ts                   # Session management, cron auth, cookie handling
│   ├── llm.ts                    # LLM client abstraction (Anthropic + Synthetic/Kimi)
│   ├── embeddings.ts             # OpenAI embedding client, pgvector/JSONB storage, similarity
│   ├── db/
│   │   ├── index.ts              # DB connection + schema init
│   │   ├── schema.ts             # Table definitions (pgvector detection, migration helpers)
│   │   ├── seed.ts               # Default admin user, interests, and sources
│   │   ├── articles.ts           # Shared article CRUD (content only, no per-user state)
│   │   ├── user-articles.ts      # Per-user article state (scores, engagement, digest assignment)
│   │   ├── digests.ts            # Digest CRUD
│   │   ├── sources.ts            # Source CRUD (default + private, per-user settings)
│   │   ├── interests.ts          # Interest CRUD
│   │   ├── feedback.ts           # Append-only event log, bookmarked articles query
│   │   ├── preferences.ts        # Learned preference queries
│   │   ├── settings.ts           # Key-value settings store (per-user + global)
│   │   ├── users.ts              # User CRUD, full cascading delete, active user queries
│   │   ├── invite-codes.ts       # Invite code CRUD with username join
│   │   └── ingestion-logs.ts     # Ingestion log CRUD
│   ├── ingestion/
│   │   ├── index.ts              # Fetch loop + article embedding generation
│   │   ├── rss.ts                # RSS feed parser
│   │   ├── manual.ts             # Manual URL fetcher
│   │   ├── logger.ts             # IngestionLogger class
│   │   └── utils.ts              # URL normalization, hashing
│   └── relevance/
│       ├── index.ts              # Two-stage pipeline: embed score → LLM score → digest
│       ├── prefilter.ts          # Spam/dupe/stale removal with reason tracking
│       ├── scorer.ts             # LLM prompt building, response parsing, batch scoring
│       └── learner.ts            # Feedback-driven preference learning
│
└── types/index.ts                # Shared TypeScript interfaces
```

## Database

Vercel Postgres (Neon) with pgvector extension.

| Table | Purpose |
|-------|---------|
| `users` | Multi-user auth (username, bcrypt password hash, admin flag, active flag) |
| `sessions` | Session tokens with expiry |
| `sources` | RSS feed URLs with enable/disable, default flag, per-source max items |
| `user_source_settings` | Per-user enable/disable toggle for default sources |
| `articles` | Ingested articles (shared content only — title, URL, raw content, provider) |
| `user_articles` | Per-user article state: relevance score, embedding score, reason, serendipity flag, sentiment, read, bookmark, archive, digest assignment |
| `embeddings` | Vector embeddings for articles and interests (pgvector VECTOR(512) + JSONB fallback) |
| `digests` | Generated digests with timestamp and article count, scoped per user |
| `interests` | User interest categories with descriptions and weights |
| `feedback` | Append-only event log of all user engagement actions |
| `learned_preferences` | AI-derived preference statements from feedback patterns |
| `settings` | Key-value store (per-user settings + global settings with user_id = 'global') |
| `invite_codes` | Invite codes for user registration (tracks claimed-by user) |
| `ingestion_logs` | Full pipeline logs with events JSONB |

### Storage Notes

**Embedding storage**: Each 512-dimension vector uses ~2 KB. At ~200 articles/day, this would grow to ~190 MB/year if left unchecked. To manage this on the free tier (256 MB):

- **Automatic pruning**: Article embeddings older than 7 days are automatically deleted after each scoring run. Once all users have been scored, the embedding has served its purpose.
- **Interest embeddings** are never pruned (just a handful of rows).
- **Potential optimization**: The `embedding_text` column stores the input text used for embedding generation (~0.5 KB/row). If storage becomes tight, this column can be dropped since the source data already exists in the `articles` table. This would save ~15% of embedding storage.

## Scripts

Standalone scripts run via `npx tsx scripts/<name>.ts`. All load `.env.local` automatically.

| Script | Purpose |
|--------|---------|
| `scripts/ingest.ts` | Run the full ingestion + scoring pipeline (used by GitHub Actions cron) |
| `scripts/migrate-multiuser.ts` | One-time migration from single-user to multi-user schema. Supports `--dry-run` |
| `scripts/backfill-embeddings.ts` | Generate embeddings for existing interests and articles. Use `--articles` to include articles |
| `scripts/reset-password.ts` | Reset a user's password: `npx tsx scripts/reset-password.ts <password> [username]` |
| `scripts/reset-embedding-scores.ts` | Clear embedding scores to force re-scoring on next ingestion |
| `scripts/make-digest.ts` | Create a digest from scored, unassigned articles for the admin user |
| `scripts/delete-digests.ts` | Delete N recent digests and clear article scores for re-scoring |
| `scripts/learn-prefs.ts` | Force-run preference learning for the admin user |
| `scripts/test-scoring.ts` | Test the LLM scoring prompt with real data at different token limits |
| `scripts/test-llm.ts` | Test LLM API connectivity |

## Stack

- **Framework**: Next.js 16 (App Router, React 19, Turbopack)
- **Database**: Vercel Postgres (Neon) with pgvector
- **Embeddings**: OpenAI `text-embedding-3-small` (512 dimensions)
- **LLM**: Kimi K2.5 via Synthetic API (OpenAI-compatible). Anthropic Claude infrastructure preserved but inactive.
- **Styling**: Tailwind CSS 4, dark theme (DM Sans + JetBrains Mono)
- **Deployment**: Vercel (hosting) + GitHub Actions (daily cron at 5 AM CT)
- **Auth**: Invite-based multi-user with bcrypt + session cookies (httpOnly, HMAC-SHA256, 7-day expiry)

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `POSTGRES_URL` | Yes | Vercel Postgres connection string |
| `CRON_SECRET` | Yes | Secret for session signing and cron API auth |
| `SYNTHETIC_API_KEY` | Yes | API key for Kimi K2.5 (via synthetic.new) for LLM scoring |
| `OPENAI_API_KEY` | Yes | API key for OpenAI embeddings (`text-embedding-3-small`) |
| `ANTHROPIC_API_KEY` | No | Anthropic API key (inactive, kept for future use) |
| `MIN_RELEVANCE_SCORE` | No | Minimum LLM score for digest inclusion (default: 0.5) |

## Development

```bash
npm install
npm run dev         # http://localhost:3000
npm run build       # Production build
```

### First-Time Setup

1. Set up a Vercel Postgres database and add `POSTGRES_URL` to `.env.local`
2. Add API keys: `SYNTHETIC_API_KEY`, `OPENAI_API_KEY`, `CRON_SECRET`
3. Run `npm run dev` — the schema is auto-created and the default admin user is seeded (username: `admin`, password: `changeme`)
4. Log in and change the admin password in Settings > Account
5. Add RSS sources in Settings > Sources
6. Run `npx tsx scripts/ingest.ts` to trigger the first ingestion

### Adding Users

1. Go to Settings > Admin > Invite Codes
2. Generate an invite code
3. Share the registration URL with the new user
4. New users get a generic starter interest set — they can customize in Settings > Interests

## Deployment

Push to main. Vercel auto-deploys the app. The daily ingestion cron runs via GitHub Actions at 11:00 UTC (5 AM CT) per `.github/workflows/ingest.yml`.

### Required GitHub Secrets

- `POSTGRES_URL`
- `SYNTHETIC_API_KEY`
- `OPENAI_API_KEY`

---

## Future Improvements

### Content & Scoring
- **AI summaries** — Generate 2-3 sentence summaries during scoring (infrastructure exists, currently disabled)
- **Full-text extraction** — Fetch and parse full article content for richer embedding + scoring context
- **Per-interest score breakdown** — Show how much each interest contributed to an article's score
- **Scoring calibration** — Track score distributions over time and auto-adjust thresholds
- **New user digest seeding** — Trigger scoring for new users at registration using already-ingested articles (pipeline supports this, not yet wired up)

### Sources
- **Source health monitoring** — Track fetch success rates per source, surface broken/stale feeds
- **Auto-discovery** — Given a website URL, auto-detect its RSS feed
- **Non-RSS sources** — Support Hacker News, Reddit, newsletters, or arbitrary web pages

### Digest & Reading Experience
- **Multiple digests per day** — Custom scheduled times, timezone-aware UI
- **Reading time estimates** — Estimate read time from content length
- **Article grouping** — Cluster related articles together by topic
- **Digest email delivery** — Send the daily digest via email
- **Offline/PWA support** — Cache digests for offline reading

### Feedback & Learning
- **Explicit preference tuning** — Let users write preference statements directly
- **Source-level preferences** — Learn that you prefer long-form from Source A but skip listicles from Source B
- **Decay old preferences** — Reduce confidence on preferences derived from old feedback

### Infrastructure
- **Log retention policy** — Auto-delete verbose logs older than N days to manage storage
- **Background ingestion** — Move ingestion to a queue/worker for reliability
- **API key rotation** — Support multiple LLM providers with automatic failover
- **Search** — Full-text search across all ingested articles
