# ketchup

A multi-user, AI-curated daily digest app. Aggregates articles from RSS feeds, scores them for relevance using a two-stage embedding + LLM pipeline, and presents personalized digests tailored to each user's interests.

## How It Works

### The Pipeline

Every ingestion run (triggered by a daily GitHub Actions cron or manually) executes this pipeline:

1. **Fetch** — Fetches new articles from all enabled RSS sources across all active users, deduplicates against existing articles.
2. **Prefilter** — Removes spam domains, very short titles, exact title duplicates, and stale articles (>7 days old).
3. **Embed** — Generates vector embeddings for all new articles using OpenAI's `text-embedding-3-small` model. Each article is embedded once and shared across all users. Near-duplicate articles are detected via semantic deduplication (cosine similarity > 0.85) and flagged so scoring can skip them.
4. **Score (per user)** — Two-stage scoring for each active user:
   - **Stage 1 — Embedding pre-filter**: Computes weight-adjusted cosine similarity between article embeddings and user interest embeddings, blended across multiple matching interests. Applies exclusion penalties for articles matching excluded topics, and source trust multipliers from per-source feedback history. Filters out ~60-80% of obviously irrelevant articles.
   - **Stage 2 — LLM refinement**: Sends only the top embedding-matched candidates (plus a weighted serendipity pool) to the LLM with article titles, content snippets, and URLs for nuanced scoring, reason tagging, and serendipity detection.
5. **Digest** — Selects all articles above the relevance threshold (default 0.5), plus up to 2 serendipity items, and groups them into a digest. Articles below the threshold are included as bonus articles.

### Scoring

The two-stage pipeline cuts LLM API costs by 60-80% while maintaining digest quality.

**Stage 1 (Embeddings):** Each article's embedding is compared against all of the user's interest embeddings via cosine similarity. Similarities are weight-adjusted (`similarity × interest.weight`), then blended across multiple matching interests (configurable primary/secondary weights, default 70/30). The blended score is further modified by exclusion penalties (articles matching excluded topics get up to 80% reduction) and source trust multipliers (0.8–1.2 range based on per-source feedback history). Articles above the LLM threshold (default 0.28) are candidates for LLM scoring. A weighted sample from the "maybe relevant" range (0.20–0.35) is included as serendipity candidates, prioritizing proximity to interests and source diversity over pure randomness.

**Stage 2 (LLM):** The LLM receives the user's explicit interests (with weights), learned preferences from feedback history, and article titles + content snippets + URLs. It returns structured JSON with relevance scores, reason tags, and serendipity flags. Serendipity candidates get a special prompt note asking the LLM to evaluate them for unexpected cross-domain value.

Articles scoring below the threshold are still stored — they just appear as bonus articles rather than in the main digest.

### Interest Expansion

When you create or update an interest, an LLM automatically generates a rich 150–200 word description covering related concepts, terminology, and adjacent topics. This expanded description is used for embedding generation, improving match quality without requiring you to write detailed descriptions manually.

### Excluded Topics

You can define topics you don't want to see (Settings → Exclusions). These are embedded and compared against articles during scoring — matching articles receive a graduated penalty that reduces their score. Strong matches to your positive interests can still come through, but borderline articles matching exclusions are filtered out.

### Interest Discovery

Once a week (configurable day, default Sunday), ketchup analyzes your liked and bookmarked articles to discover interest patterns you haven't explicitly added. If it finds potential new interests, they appear as suggestions in Settings → Interests. You can accept (auto-creates the interest) or dismiss each suggestion.

### Source Trust

Source trust factors are computed weekly from your feedback history per source. Sources you consistently like get a small scoring boost (up to 1.2×); sources you consistently dislike get a penalty (down to 0.8×). Trust indicators appear as dot ratings next to source names in Settings → Sources once you've rated 5+ articles from a source.

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
- **Role-based UI** — Non-admin users only see relevant settings tabs (Interests, Sources, Exclusions, Gestures, Preferences, Account). Admin-only tabs (Schedule, Logs, Admin) are hidden.

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
│       ├── exclusions/           # CRUD for excluded topics (+ embedding generation)
│       ├── suggestions/          # Interest suggestions (accept/dismiss)
│       ├── sources/              # CRUD for RSS sources + trust indicators
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
│   ├── InterestSuggestions.tsx   # Weekly AI-discovered interest suggestions (accept/dismiss)
│   ├── ExclusionManager.tsx      # Add/delete excluded topics
│   ├── SuggestionBanner.tsx      # Digest banner linking to pending suggestions
│   ├── SourceTrustIndicator.tsx  # 5-dot trust indicator for sources
│   ├── PreferenceViewer.tsx      # View/delete learned preferences
│   ├── ScheduleManager.tsx       # GitHub Actions schedule info
│   ├── SourceManager.tsx         # Add/edit/delete RSS sources, OPML import, trust indicators
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
│   ├── affinity.ts               # Weekly LLM-based interest discovery from feedback patterns
│   ├── interest-expansion.ts     # LLM expansion of interest descriptions for richer embeddings
│   ├── source-trust.ts           # Source trust factor computation from sentiment data
│   ├── db/
│   │   ├── index.ts              # DB connection + schema init
│   │   ├── schema.ts             # Table definitions (pgvector detection, migration helpers)
│   │   ├── seed.ts               # Default admin user, interests, and sources
│   │   ├── articles.ts           # Shared article CRUD (content only, no per-user state)
│   │   ├── user-articles.ts      # Per-user article state (scores, engagement, digest assignment)
│   │   ├── digests.ts            # Digest CRUD
│   │   ├── sources.ts            # Source CRUD (default + private, per-user settings)
│   │   ├── interests.ts          # Interest CRUD
│   │   ├── exclusions.ts         # Excluded topic CRUD
│   │   ├── suggestions.ts        # Interest suggestion CRUD (from affinity analysis)
│   │   ├── source-trust.ts       # Per-user, per-source trust factor storage
│   │   ├── feedback.ts           # Append-only event log, bookmarked articles query
│   │   ├── preferences.ts        # Learned preference queries
│   │   ├── settings.ts           # Key-value settings store (per-user + global)
│   │   ├── users.ts              # User CRUD, full cascading delete, active user queries
│   │   ├── invite-codes.ts       # Invite code CRUD with username join
│   │   └── ingestion-logs.ts     # Ingestion log CRUD
│   ├── ingestion/
│   │   ├── index.ts              # Fetch loop + article embedding generation + semantic dedup
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
| `articles` | Ingested articles (shared content only — title, URL, raw content, provider, semantic duplicate flag) |
| `user_articles` | Per-user article state: relevance score, embedding score, reason, serendipity flag, sentiment, read, bookmark, archive, digest assignment |
| `embeddings` | Vector embeddings for articles, interests, and exclusions (pgvector VECTOR(512) + JSONB fallback) |
| `digests` | Generated digests with timestamp and article count, scoped per user |
| `interests` | User interest categories with descriptions, expanded descriptions, and weights |
| `exclusions` | User-defined excluded topics with category, description, and expanded description |
| `interest_suggestions` | AI-discovered interest suggestions from affinity analysis (pending/accepted/dismissed) |
| `source_trust` | Per-user, per-source trust factors computed from sentiment feedback history |
| `feedback` | Append-only event log of all user engagement actions |
| `learned_preferences` | AI-derived preference statements from feedback patterns |
| `settings` | Key-value store (per-user settings + global settings with user_id = 'global') |
| `invite_codes` | Invite codes for user registration (tracks claimed-by user) |
| `ingestion_logs` | Full pipeline logs with events JSONB |

### Storage Notes

**Embedding storage**: Each 512-dimension vector uses ~2 KB. At ~200 articles/day, this would grow to ~190 MB/year if left unchecked. To manage this on the free tier (256 MB):

- **Automatic pruning**: Article embeddings older than 7 days are automatically deleted after each scoring run. Once all users have been scored, the embedding has served its purpose.
- **Interest and exclusion embeddings** are never pruned (just a handful of rows each).
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
| `scripts/fetch-preview.ts` | Preview scoring pipeline: shows raw/weighted/blended scores, semantic dedup, before/after comparison |

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

## Quick Start — Deploy Your Own Instance

You can have ketchup running in about 10 minutes. You'll need:

- A [GitHub](https://github.com) account
- A [Vercel](https://vercel.com) account (free tier works)
- An [OpenAI](https://platform.openai.com) API key (for article embeddings)
- A [Synthetic](https://synthetic.new) API key (for LLM scoring — free tier available)

### Step 1: Fork and Deploy to Vercel

1. Fork this repository on GitHub.
2. Go to [vercel.com/new](https://vercel.com/new) and click **Import** next to your forked repo.
3. Vercel will detect it's a Next.js project. Leave the default settings and click **Deploy**.
4. The first deploy will fail (no database yet). That's expected — continue to Step 2.

### Step 2: Create a Free Postgres Database

1. In your Vercel project dashboard, go to the **Storage** tab.
2. Click **Create Database** and select **Neon Serverless Postgres**.
3. Choose the **Free** plan (256 MB, more than enough to start).
4. Pick a region close to you and click **Create**.
5. Vercel automatically adds the `POSTGRES_URL` environment variable to your project.

### Step 3: Add API Keys

In your Vercel project, go to **Settings > Environment Variables** and add:

| Variable | Value | Where to get it |
|----------|-------|-----------------|
| `CRON_SECRET` | Any random string (e.g., run `openssl rand -hex 32`) | You generate this yourself |
| `OPENAI_API_KEY` | `sk-...` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `SYNTHETIC_API_KEY` | Your API key | [synthetic.new](https://synthetic.new) |

Make sure all three are added for **Production**, **Preview**, and **Development** environments.

### Step 4: Redeploy

1. Go to the **Deployments** tab in your Vercel project.
2. Find the latest deployment, click the **...** menu, and select **Redeploy**.
3. The app will create all database tables and seed a default admin user automatically.

### Step 5: Log In and Configure

1. Open your deployed app (the `.vercel.app` URL from your dashboard).
2. Log in with username `admin` and password `changeme`.
3. **Change your password** immediately in Settings > Account.
4. Go to Settings > Sources and add some RSS feeds (or import an OPML file).
5. Go to Settings > Interests and set up your interest categories with weights.

### Step 6: Run Your First Ingestion

You have two options:

**Option A — From the Vercel dashboard (no code required):**
1. In your Vercel project, go to the **Functions** tab (or open your app's URL).
2. Make a POST request to `https://your-app.vercel.app/api/ingest` with the header `Authorization: Bearer <your CRON_SECRET>`.

**Option B — From your local machine:**
1. Clone your fork and create a `.env.local` file with your environment variables:
   ```
   POSTGRES_URL=<from Vercel dashboard, Settings > Environment Variables>
   CRON_SECRET=<your secret>
   OPENAI_API_KEY=<your key>
   SYNTHETIC_API_KEY=<your key>
   ```
2. Run:
   ```bash
   npm install
   npx tsx scripts/ingest.ts
   ```

After ingestion completes, refresh your app — your first digest should be ready.

### Step 7: Set Up Daily Ingestion (Optional)

To get a fresh digest every morning, set up the GitHub Actions cron:

1. In your forked repo on GitHub, go to **Settings > Secrets and variables > Actions**.
2. Add these repository secrets:
   - `POSTGRES_URL` — your database connection string
   - `OPENAI_API_KEY` — your OpenAI key
   - `SYNTHETIC_API_KEY` — your Synthetic key
3. Go to the **Actions** tab and enable workflows if prompted.

The cron runs daily at 11:00 UTC (5 AM Central). You can adjust the schedule in `.github/workflows/ingest.yml` or trigger it manually from the Actions tab.

### Adding More Users

1. Go to Settings > Admin > Invite Codes and generate a code.
2. Share the registration URL with the new user.
3. New users get a starter interest set — they can customize in Settings > Interests.

## Local Development

```bash
npm install
npm run dev         # http://localhost:3000
npm run build       # Production build
```

Create a `.env.local` with the variables from Step 3 above, plus `POSTGRES_URL` from your Vercel database (found in Settings > Environment Variables). The schema auto-creates on first run.

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
- **Decay old preferences** — Reduce confidence on preferences derived from old feedback

### Infrastructure
- **Log retention policy** — Auto-delete verbose logs older than N days to manage storage
- **Background ingestion** — Move ingestion to a queue/worker for reliability
- **API key rotation** — Support multiple LLM providers with automatic failover
- **Search** — Full-text search across all ingested articles
