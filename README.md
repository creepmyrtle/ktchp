# ktchp

A personal, AI-curated daily digest app. Aggregates articles from RSS feeds, scores them for relevance using an LLM, and presents a daily digest tailored to your interests.

## How It Works

### The Pipeline

Every ingestion run (triggered by a daily Vercel cron job or manually via the UI) executes this pipeline:

1. **Fetch** — Loops over your enabled RSS sources, fetches new articles, deduplicates against existing articles by normalized URL.
2. **Prefilter** — Removes spam domains, very short titles, exact title duplicates, and stale articles (>7 days old).
3. **Score** — Sends articles to an LLM in batches. The LLM scores each article 0.0-1.0 for relevance against your interest profile, writes a 2-3 sentence summary, and flags rare serendipity picks.
4. **Digest** — Selects all articles above the relevance threshold (default 0.5), plus up to 2 serendipity items, and groups them into a digest.

### Scoring

The LLM receives your explicit interests (with weights), any learned preferences derived from your feedback history, and the article title + content snippet. It returns a structured JSON array with scores, summaries, and relevance reasons.

Articles scoring below the threshold are still stored — they just aren't assigned to a digest. Serendipity items are articles that don't match any stated interest but are flagged as genuinely valuable (major world events, cross-domain insights).

### Feedback Loop

Thumbs up/down, bookmark, and dismiss actions are recorded per article. These feed into a learned preferences system that extracts patterns from your feedback over time, which are then included in future scoring prompts.

## Architecture

```
src/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # Login page
│   ├── settings/page.tsx         # Settings (interests, sources, schedule, logs)
│   ├── digest/page.tsx           # Latest digest view
│   ├── digest/[id]/page.tsx      # Historical digest view
│   └── api/
│       ├── auth/                 # login, logout
│       ├── ingest/route.ts       # POST — runs full ingestion pipeline
│       ├── ingestion-logs/       # GET recent logs, GET log by ID
│       ├── digests/              # GET recent, GET by ID, GET latest, POST clear
│       ├── interests/            # CRUD for user interests
│       ├── sources/              # CRUD for RSS sources
│       ├── feedback/             # POST feedback actions
│       ├── preferences/          # GET/DELETE learned preferences
│       ├── manual-url/           # POST a URL for manual ingestion
│       └── settings/             # provider, schedule settings
│
├── components/
│   ├── ArticleCard.tsx           # Article display with feedback buttons
│   ├── DigestHeader.tsx          # Date/time header for a digest
│   ├── DigestSelector.tsx        # Horizontal date pill selector for navigating digests
│   ├── FeedbackButtons.tsx       # Thumbs up/down, bookmark, dismiss
│   ├── IngestButton.tsx          # "Ingest Now" + "Clear Provider" actions
│   ├── IngestionLogs.tsx         # Log viewer with expandable event timelines
│   ├── InterestManager.tsx       # Add/edit/delete interests with weight sliders
│   ├── ManualUrlInput.tsx        # Paste a URL for manual inclusion
│   ├── PreferenceViewer.tsx      # View/delete learned preferences
│   ├── ScheduleManager.tsx       # Cron schedule info
│   ├── SourceManager.tsx         # Add/edit/delete RSS sources
│   └── CaughtUpMessage.tsx       # "You're all caught up" footer
│
├── lib/
│   ├── config.ts                 # Environment config (API keys, thresholds, batch size)
│   ├── auth.ts                   # Session management, cron auth, cookie handling
│   ├── llm.ts                    # LLM client abstraction (Anthropic + OpenAI-compatible)
│   ├── db/
│   │   ├── index.ts              # DB connection + schema init
│   │   ├── schema.ts             # All CREATE TABLE statements
│   │   ├── seed.ts               # Default user, interests, and sources
│   │   ├── articles.ts           # Article CRUD + scoring updates
│   │   ├── digests.ts            # Digest CRUD
│   │   ├── sources.ts            # Source CRUD
│   │   ├── interests.ts          # Interest CRUD
│   │   ├── feedback.ts           # Feedback recording
│   │   ├── preferences.ts        # Learned preference queries
│   │   ├── settings.ts           # Key-value settings store
│   │   ├── users.ts              # User queries
│   │   └── ingestion-logs.ts     # Ingestion log CRUD
│   ├── ingestion/
│   │   ├── index.ts              # Main fetch loop over sources
│   │   ├── rss.ts                # RSS feed parser
│   │   ├── manual.ts             # Manual URL fetcher
│   │   ├── logger.ts             # IngestionLogger class
│   │   └── utils.ts              # URL normalization, hashing
│   └── relevance/
│       ├── index.ts              # Orchestrates prefilter → score → digest
│       ├── prefilter.ts          # Spam/dupe/stale removal with reason tracking
│       └── scorer.ts             # LLM prompt building, response parsing, batch scoring
│
└── types/index.ts                # Shared TypeScript interfaces
```

## Database

Vercel Postgres with these tables:

| Table | Purpose |
|-------|---------|
| `users` | Single-user auth (password hash) |
| `sessions` | Session tokens with expiry |
| `sources` | RSS feed URLs with enable/disable |
| `articles` | All ingested articles with scores, summaries, digest assignment |
| `digests` | Generated digests with timestamp and article count |
| `interests` | User interest categories with weights |
| `feedback` | Per-article user actions (thumbs up/down, bookmark, dismiss, click) |
| `learned_preferences` | AI-derived preference statements from feedback patterns |
| `settings` | Key-value store (e.g. LLM provider) |
| `ingestion_logs` | Full pipeline logs with events JSONB |

## Ingestion Logs

Every pipeline run is logged to the `ingestion_logs` table with comprehensive detail:

- **Setup**: trigger type, provider, model, config values
- **Fetch**: per-source timing, per-article new/duplicate decisions
- **Prefilter**: every removal with reason (short title, spam, stale, title dupe)
- **Scoring**: full LLM prompts, raw responses, parse method, per-article scores
- **Digest**: threshold, selected/rejected articles, serendipity candidates

Logs are viewable in Settings > Logs and exportable as JSON.

## Stack

- **Framework**: Next.js 16 (App Router, React 19)
- **Database**: Vercel Postgres
- **LLM**: Kimi K2.5 via OpenAI-compatible API (Anthropic infrastructure preserved but inactive)
- **Styling**: Tailwind CSS 4 with light/dark mode
- **Deployment**: Vercel with daily cron
- **Auth**: Password-based single-user with session cookies

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `POSTGRES_URL` | Vercel Postgres connection string |
| `SYNTHETIC_API_KEY` | API key for Kimi K2.5 (via synthetic.new) |
| `ANTHROPIC_API_KEY` | Anthropic API key (inactive, kept for future use) |
| `DIGEST_PASSWORD` | Login password (plain text or bcrypt hash) |
| `CRON_SECRET` | Secret for Vercel cron job auth |
| `MIN_RELEVANCE_SCORE` | Minimum score for digest inclusion (default 0.5) |
| `MAX_ARTICLES_PER_DIGEST` | Unused — no longer enforced |

## Development

```bash
npm install
npm run dev         # http://localhost:3000
npm run build       # Production build
```

## Deployment

Push to main. Vercel auto-deploys. The cron job runs daily at 11:00 UTC (5 AM CT) per `vercel.json`.

---

## Future Improvements

### Content & Scoring
- **Full-text extraction** — Fetch and parse full article content instead of relying on RSS snippets for richer scoring context
- **Per-interest score breakdown** — Show how much each interest contributed to an article's score
- **Adjustable relevance threshold** — Let the user tune the minimum score from the UI instead of an env var
- **Scoring calibration** — Track score distributions over time and auto-adjust to prevent score inflation/deflation
- **Multi-language support** — Detect article language and handle non-English feeds

### Sources
- **Source health monitoring** — Track fetch success rates per source, surface broken/stale feeds
- **OPML import/export** — Bulk import RSS feeds from other readers
- **Auto-discovery** — Given a website URL, auto-detect its RSS feed
- **Non-RSS sources** — Support Hacker News, Reddit, Twitter/X, newsletters, or arbitrary web pages

### Digest & Reading Experience
- **Digest scheduling flexibility** — Multiple digests per day, custom times, timezone-aware UI
- **Reading time estimates** — Estimate read time from content length
- **Article grouping** — Cluster related articles together by topic
- **Digest email delivery** — Send the daily digest via email instead of requiring a site visit
- **Offline/PWA support** — Cache digests for offline reading

### Feedback & Learning
- **Explicit preference tuning** — Let users write "I prefer technical deep-dives over news summaries"
- **Feedback-weighted re-scoring** — Re-score articles from sources you consistently thumbs-up higher
- **Source-level preferences** — Learn that you prefer long-form from Source A but skip listicles from Source B
- **Decay old preferences** — Reduce confidence on preferences derived from old feedback

### Infrastructure
- **Log retention policy** — Auto-delete verbose logs older than N days to manage Postgres storage
- **Background ingestion** — Move ingestion off the request path to a queue/worker for reliability
- **Rate limiting** — Protect the ingest endpoint from abuse
- **Multi-user support** — Separate interest profiles, sources, and digests per user
- **API key rotation** — Support multiple LLM providers with automatic failover

### UI/UX
- **Search** — Full-text search across all ingested articles
- **Bookmarks view** — Dedicated page for bookmarked articles
- **Keyboard shortcuts** — j/k navigation, quick feedback keys
- **Article preview** — Inline expand to read full content without leaving the digest
- **Mobile app** — React Native or PWA wrapper for a native feel
