# Daily Digest — Claude Code Project Prompt

## Overview

Build a **Daily Digest** web application — a tool designed to help the user break the habit of compulsively checking news and other websites throughout the day. Instead of visiting dozens of sources, the app collects articles, posts, and content from configured sources, uses AI to score relevance against the user's interest profile, summarizes the top items, and presents them as a clean card-based digest on a website the user visits once or twice a day.

The app should feel calm and intentional. It is explicitly **anti-addictive** by design.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | **Next.js 14+** (App Router) with TypeScript |
| Styling | **Tailwind CSS** |
| Database | **SQLite** via `better-sqlite3` (with a clean DB abstraction layer for future migration to Postgres) |
| AI | **Anthropic Claude API** (claude-sonnet-4-20250514) for relevance scoring and summarization |
| Deployment | **Vercel** (use Vercel Cron for scheduled ingestion) |
| Auth | Simple token/password-based auth for now (single env var `DIGEST_PASSWORD`), but design user model to support multi-user later |

---

## Core Architecture

### Three-Layer System

```
1. CONTENT INGESTION (scheduled, runs 2x/day)
   ├── RSS Feed Parser
   ├── Hacker News API Client
   ├── Reddit API Client
   └── Manual URL Queue

2. RELEVANCE ENGINE (runs after ingestion)
   ├── Pre-filter (keyword/embedding dedup + basic relevance check)
   ├── Claude API Scoring & Summarization
   ├── Serendipity Scoring
   └── Interest Profile (explicit + learned)

3. PRESENTATION LAYER (Next.js frontend)
   ├── Card-based digest view
   ├── Feedback interactions (👍 👎 🔖 dismiss)
   ├── Interest management UI
   └── Source management UI
```

---

## Data Model

Design all database access through a `db.ts` abstraction layer so the underlying database can be swapped later (e.g., from SQLite to PostgreSQL) without changing application code. Use a repository pattern.

### Tables

```sql
-- Users (design for multi-user even though single-user for now)
CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Content Sources
CREATE TABLE sources (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('rss', 'hackernews', 'reddit', 'manual_url')),
  config JSON NOT NULL, -- URL, subreddit name, feed URL, etc.
  enabled BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Ingested Articles
CREATE TABLE articles (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  source_id TEXT NOT NULL REFERENCES sources(id),
  external_id TEXT, -- dedup key (URL hash, HN id, etc.)
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  raw_content TEXT, -- original content/description
  summary TEXT, -- AI-generated summary
  relevance_score REAL, -- 0.0 to 1.0
  relevance_reason TEXT, -- why it was surfaced (e.g., "Matches: AI/LLMs" or "Serendipity: adjacent to civic tech")
  is_serendipity BOOLEAN DEFAULT FALSE, -- true if surfaced outside stated interests
  digest_id TEXT REFERENCES digests(id),
  published_at DATETIME,
  ingested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_id, external_id)
);

-- Digests (a batch of articles presented together)
CREATE TABLE digests (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id),
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  article_count INTEGER DEFAULT 0
);

-- User Interests (explicit, user-managed)
CREATE TABLE interests (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id),
  category TEXT NOT NULL,
  description TEXT, -- optional longer description
  weight REAL DEFAULT 1.0, -- user can boost/reduce
  active BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Feedback / Interactions (drives learned preferences)
CREATE TABLE feedback (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id),
  article_id TEXT NOT NULL REFERENCES articles(id),
  action TEXT NOT NULL CHECK (action IN ('thumbs_up', 'thumbs_down', 'bookmark', 'dismiss', 'click')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, article_id, action)
);

-- Learned Preferences (AI-generated summary of patterns from feedback)
CREATE TABLE learned_preferences (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id),
  preference_text TEXT NOT NULL, -- natural language: "User consistently engages with articles about..."
  derived_from_count INTEGER DEFAULT 0, -- how many feedback items contributed
  confidence REAL DEFAULT 0.5, -- 0.0 to 1.0
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## Content Ingestion Layer

### API Route: `/api/ingest` (POST, protected by API key)

This endpoint is triggered by Vercel Cron (or manually). It:

1. **Fetches content from all enabled sources** for the user
2. **Deduplicates** against existing articles (by URL hash / external_id)
3. **Stores raw articles** in the database
4. **Triggers the relevance engine** to score and summarize

### Source Implementations

#### RSS Feeds
- Use a library like `rss-parser` to fetch and parse RSS/Atom feeds
- Extract: title, link, description/content, published date
- Dedup by URL

#### Hacker News
- Use the official Firebase API: `https://hacker-news.firebaseio.com/v0/`
- Fetch top stories and best stories (top 50 of each)
- For each story, get title, URL, score, comment count
- Dedup by HN item ID
- Filter: minimum score threshold (configurable, default 10)

#### Reddit
- Use Reddit's public JSON API: `https://www.reddit.com/r/{subreddit}/hot.json`
- No OAuth needed for public subreddits
- Fetch from user-configured subreddits (e.g., r/localllama, r/webdev, r/civictech, r/dallas)
- Dedup by Reddit post ID

#### Manual URLs
- User can paste URLs into the app
- These get queued and processed in the next ingestion run
- Fetch page title and meta description, or use Claude to summarize the page content

### Vercel Cron Configuration

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/ingest",
      "schedule": "0 7,17 * * *"  // 7 AM and 5 PM CT
    }
  ]
}
```

---

## Relevance Engine

### Scoring Flow

For each batch of new articles:

1. **Pre-filter**: Remove obvious noise (very short titles, known spam domains, exact duplicates)
2. **Batch articles** into groups of ~20 for efficient API usage
3. **Send to Claude API** with the user's interest profile for scoring and summarization

### Claude API Scoring Prompt

```
You are a content curator for a daily digest app. Your job is to score and summarize articles based on the user's interest profile.

## User's Explicit Interests
{list of interest categories with descriptions and weights}

## User's Learned Preferences
{list of learned preference statements with confidence scores}

## Recent Feedback Patterns
{summary of recent thumbs up/down patterns}

## Instructions

For each article below, provide:
1. **relevance_score** (0.0 to 1.0): How relevant this is to the user
2. **summary** (2-3 sentences): A concise, informative summary
3. **relevance_reason** (short tag): e.g., "Matches: AI/LLMs" or "Matches: Web Dev"
4. **is_serendipity** (boolean): True if this doesn't match stated interests but is still valuable

### Serendipity Criteria
In addition to scoring against stated interests, identify articles that would be valuable due to:
- Cross-domain connections (e.g., an urban planning article relevant to someone interested in civic tech)
- Emerging trends the user should know about based on their professional/personal profile
- Topics adjacent to their interests that broaden their perspective
- Important news that affects the user's domain even if not a direct match

Serendipity items should still score 0.4+ to be included. Don't force serendipity — only surface it when genuinely valuable.

### Scoring Guidelines
- 0.8-1.0: Directly matches primary interests, high-quality content
- 0.6-0.8: Good match, relevant and worth reading
- 0.4-0.6: Tangentially relevant or good serendipity candidate
- 0.0-0.4: Not relevant enough to include in digest

## Articles to Score
{array of articles with title, URL, raw_content/description, source}

Respond in JSON format:
[
  {
    "article_id": "...",
    "relevance_score": 0.85,
    "summary": "...",
    "relevance_reason": "Matches: AI/LLMs",
    "is_serendipity": false
  }
]
```

### Cost Management
- Only send articles through Claude that pass the pre-filter
- Batch articles (20 per API call) to reduce overhead
- Use `claude-sonnet-4-20250514` (good balance of quality and cost)
- Cache results — never re-score the same article
- Target: process ~200 articles/day for ~$1-3/month

### Digest Generation

After scoring, select the top articles for the digest:
- Take all articles scoring 0.6+ (aim for 15-25 per digest)
- Ensure at least 1-2 serendipity items if available
- Cap at 30 articles max per digest
- Create a new `digest` record and associate selected articles

---

## Feedback Loop & Learning

### Interaction Tracking

Every card has four interaction buttons:
- 👍 **Thumbs up**: "More like this"
- 👎 **Thumbs down**: "Less like this"
- 🔖 **Bookmark**: Save for later (also a positive signal)
- ✕ **Dismiss**: Remove from view (weak negative signal)

Clicking an article title/link to read it = `click` action (positive signal).

### Preference Learning

After every ~50 feedback actions (or weekly, whichever comes first), run a **preference learning job**:

1. Gather all recent feedback with the associated article metadata
2. Send to Claude API with this prompt:

```
Analyze this user's content feedback to identify patterns and preferences.

## Recent Feedback (last 50 interactions)
{list of articles with their feedback action, category, and topic}

## Current Learned Preferences
{existing preference statements}

## Instructions
Based on the feedback patterns, generate or update preference statements. Each should be:
- A clear, natural language statement about what the user likes/dislikes
- Include a confidence score (0.0-1.0) based on how consistent the signal is

Examples:
- "User strongly prefers technical deep-dives over news summaries" (confidence: 0.8)
- "User consistently dismisses cryptocurrency/blockchain content" (confidence: 0.9)
- "User engages more with local Dallas governance stories than national politics" (confidence: 0.6)

Return updated preference list as JSON.
```

3. Store/update the `learned_preferences` table

---

## Frontend Design

### Anti-Compulsion UX Principles

**This is critical to the app's purpose.** The UI must:

- **No infinite scroll**: Fixed number of cards per digest, all visible
- **No pull-to-refresh**: Digest updates on schedule, not on demand
- **No real-time updates**: No websockets, no polling, no "new items available" banners
- **"You're all caught up"**: Show a clear, satisfying end state when all cards are viewed
- **No engagement metrics**: No streak counters, no "time spent reading" stats
- **Calm aesthetic**: Muted colors, generous whitespace, readable typography

### Pages & Routes

#### `/` — Login
Simple password input. Sets a session cookie/token.

#### `/digest` — Main Digest View (default after login)
- Shows the most recent digest
- Header: date/time of digest, article count
- Grid/list of article cards
- At the bottom: "You're all caught up ✓" message with next digest time
- Link to previous digests

#### `/digest/[id]` — Specific Digest
- Same card layout for a specific past digest
- "Back to latest" link

#### `/settings` — Settings Page
Tabs or sections for:
- **Interests**: Add/edit/remove/reorder interest categories. Each has a name, optional description, and weight slider.
- **Sources**: Add/edit/remove content sources. Show source type, config, enable/disable toggle.
- **Manual URL**: Text input to paste a URL for the next digest.
- **Preferences**: Read-only view of learned preferences with ability to delete ones the user disagrees with.
- **Schedule**: Configure digest times (stored as cron expression or simple time picker).
- **Account**: Change password.

### Card Component Design

Each article card should display:

```
┌──────────────────────────────────────────────────┐
│ [Source icon/name]              [Relevance tag]   │
│                                                   │
│ Article Title (clickable link)                    │
│                                                   │
│ 2-3 sentence AI summary in a readable font...    │
│                                                   │
│ Published: 2 hours ago   │  👍  👎  🔖  ✕        │
└──────────────────────────────────────────────────┘
```

- **Relevance tag**: Shows why it was included (e.g., "AI/LLMs", "Serendipity: adjacent to civic tech"). Use a subtle colored pill/badge.
- **Serendipity items**: Give these a slightly different visual treatment — maybe a subtle sparkle icon ✨ or a different border color — to distinguish "this is outside your usual interests but we think you'll find it valuable."
- **Interaction buttons**: Appear on hover (desktop) or always visible (mobile). State changes immediately (optimistic UI), syncs to DB via API.
- **Card states**: Default → Interacted (subtle visual change) → Dismissed (fades out or collapses)

### Responsive Design

- **Desktop**: 2-column card grid
- **Tablet**: 2-column card grid
- **Mobile**: Single column stack
- Cards should be comfortable to read and interact with on a phone screen

### Visual Design Direction

- Clean, minimal, almost "reader mode" aesthetic
- Color palette: Warm neutrals with one accent color (maybe a calm blue or sage green)
- Typography: System font stack or a clean sans-serif (Inter, etc.)
- No animations beyond subtle transitions on card interactions
- Dark mode support (respect `prefers-color-scheme`)

---

## API Routes

### Authentication
- `POST /api/auth/login` — Validate password, return session token
- `POST /api/auth/logout` — Clear session
- Middleware: Check session token on all protected routes

### Ingestion
- `POST /api/ingest` — Trigger content ingestion (protected by `CRON_SECRET` env var for Vercel Cron, or session token for manual trigger)
- `POST /api/sources` — Add a new source
- `PUT /api/sources/[id]` — Update source
- `DELETE /api/sources/[id]` — Remove source
- `POST /api/manual-url` — Queue a URL for next digest

### Digest
- `GET /api/digests` — List recent digests
- `GET /api/digests/latest` — Get latest digest with articles
- `GET /api/digests/[id]` — Get specific digest with articles

### Feedback
- `POST /api/feedback` — Record interaction `{ articleId, action }`

### Interests
- `GET /api/interests` — List all interests
- `POST /api/interests` — Add interest
- `PUT /api/interests/[id]` — Update interest
- `DELETE /api/interests/[id]` — Remove interest

### Preferences
- `GET /api/preferences` — List learned preferences
- `DELETE /api/preferences/[id]` — Remove a learned preference

---

## Environment Variables

```env
# Required
ANTHROPIC_API_KEY=sk-ant-...       # Claude API key
DIGEST_PASSWORD=your-password       # Login password
CRON_SECRET=your-cron-secret       # Vercel Cron auth

# Optional
DIGEST_TIMES=07:00,17:00           # When to generate digests (CT)
MAX_ARTICLES_PER_DIGEST=30         # Cap per digest
MIN_RELEVANCE_SCORE=0.5            # Minimum score to include
DATABASE_PATH=./data/digest.db     # SQLite path
```

---

## Seed Data

On first run (or via a setup script), create the default user and seed these interests:

```json
[
  { "category": "AI / LLMs / Local Models", "description": "Artificial intelligence, large language models, running models locally, GPU hardware for inference, tools like Ollama and LM Studio", "weight": 1.0 },
  { "category": "Civic Tech / GovTech", "description": "Technology for government, municipal data, public service delivery, open data, civic engagement tools", "weight": 1.0 },
  { "category": "Web Development", "description": "JavaScript, TypeScript, React, Next.js, Node.js, CSS, web frameworks, frontend and backend development", "weight": 1.0 },
  { "category": "Dallas / DFW Local News", "description": "News and events in Dallas, Fort Worth, and the DFW metroplex area. Local politics, development, community events", "weight": 0.8 },
  { "category": "General Tech Industry", "description": "Major tech company news, product launches, industry trends, startup ecosystem", "weight": 0.7 },
  { "category": "Gaming / PC Hardware", "description": "PC gaming, GPU news, monitor tech, gaming hardware reviews and deals", "weight": 0.6 }
]
```

And seed these default sources:

```json
[
  { "name": "Hacker News", "type": "hackernews", "config": { "minScore": 10, "maxItems": 50 } },
  { "name": "r/LocalLLaMA", "type": "reddit", "config": { "subreddit": "LocalLLaMA", "sort": "hot", "limit": 25 } },
  { "name": "r/webdev", "type": "reddit", "config": { "subreddit": "webdev", "sort": "hot", "limit": 25 } },
  { "name": "r/dallas", "type": "reddit", "config": { "subreddit": "dallas", "sort": "hot", "limit": 25 } },
  { "name": "r/nextjs", "type": "reddit", "config": { "subreddit": "nextjs", "sort": "hot", "limit": 15 } },
  { "name": "r/civictech", "type": "reddit", "config": { "subreddit": "civictech", "sort": "hot", "limit": 15 } },
  { "name": "Ars Technica", "type": "rss", "config": { "url": "https://feeds.arstechnica.com/arstechnica/index" } },
  { "name": "The Verge", "type": "rss", "config": { "url": "https://www.theverge.com/rss/index.xml" } },
  { "name": "Anthropic Blog", "type": "rss", "config": { "url": "https://www.anthropic.com/rss.xml" } },
  { "name": "Simon Willison's Blog", "type": "rss", "config": { "url": "https://simonwillison.net/atom/everything/" } },
  { "name": "CSS Tricks", "type": "rss", "config": { "url": "https://css-tricks.com/feed/" } },
  { "name": "Dallas Morning News", "type": "rss", "config": { "url": "https://www.dallasnews.com/arc/outboundfeeds/rss/" } }
]
```

---

## Project Structure

```
daily-digest/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout with theme, fonts
│   │   ├── page.tsx                # Login page
│   │   ├── digest/
│   │   │   ├── page.tsx            # Latest digest view
│   │   │   └── [id]/page.tsx       # Specific digest view
│   │   ├── settings/
│   │   │   └── page.tsx            # Settings (interests, sources, prefs)
│   │   └── api/
│   │       ├── auth/
│   │       │   ├── login/route.ts
│   │       │   └── logout/route.ts
│   │       ├── ingest/route.ts
│   │       ├── digests/
│   │       │   ├── route.ts
│   │       │   ├── latest/route.ts
│   │       │   └── [id]/route.ts
│   │       ├── feedback/route.ts
│   │       ├── interests/
│   │       │   ├── route.ts
│   │       │   └── [id]/route.ts
│   │       ├── preferences/
│   │       │   ├── route.ts
│   │       │   └── [id]/route.ts
│   │       ├── sources/
│   │       │   ├── route.ts
│   │       │   └── [id]/route.ts
│   │       └── manual-url/route.ts
│   ├── components/
│   │   ├── ArticleCard.tsx
│   │   ├── DigestHeader.tsx
│   │   ├── CaughtUpMessage.tsx
│   │   ├── FeedbackButtons.tsx
│   │   ├── InterestManager.tsx
│   │   ├── SourceManager.tsx
│   │   ├── ManualUrlInput.tsx
│   │   └── PreferenceViewer.tsx
│   ├── lib/
│   │   ├── db/
│   │   │   ├── index.ts            # DB abstraction layer
│   │   │   ├── schema.ts           # Table definitions & migrations
│   │   │   ├── articles.ts         # Article repository
│   │   │   ├── digests.ts          # Digest repository
│   │   │   ├── feedback.ts         # Feedback repository
│   │   │   ├── interests.ts        # Interest repository
│   │   │   ├── preferences.ts      # Learned preferences repository
│   │   │   ├── sources.ts          # Source repository
│   │   │   └── users.ts            # User repository
│   │   ├── ingestion/
│   │   │   ├── index.ts            # Orchestrator
│   │   │   ├── rss.ts              # RSS feed fetcher
│   │   │   ├── hackernews.ts       # HN API client
│   │   │   ├── reddit.ts           # Reddit API client
│   │   │   └── manual.ts           # Manual URL processor
│   │   ├── relevance/
│   │   │   ├── index.ts            # Scoring orchestrator
│   │   │   ├── prefilter.ts        # Keyword/dedup pre-filter
│   │   │   ├── scorer.ts           # Claude API scoring
│   │   │   └── learner.ts          # Preference learning job
│   │   ├── auth.ts                 # Auth utilities
│   │   └── config.ts               # App configuration
│   └── types/
│       └── index.ts                # TypeScript type definitions
├── data/                           # SQLite database location (gitignored)
├── vercel.json                     # Cron configuration
├── .env.local                      # Environment variables
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

---

## Implementation Priority

Build in this order:

### Phase 1: Foundation
1. Next.js project setup with TypeScript and Tailwind
2. SQLite database layer with schema and migrations
3. Simple auth (password from env var, session cookie)
4. Seed data script (default user, interests, sources)

### Phase 2: Ingestion
5. RSS feed parser
6. Hacker News API client
7. Reddit API client
8. Ingestion orchestrator and API route
9. Manual URL queue

### Phase 3: Relevance Engine
10. Pre-filter logic
11. Claude API integration for scoring and summarization
12. Digest generation (select top articles, create digest record)

### Phase 4: Frontend
13. Login page
14. Digest view with article cards
15. Card interaction buttons (feedback)
16. "You're all caught up" end state
17. Previous digests list/navigation

### Phase 5: Settings & Learning
18. Interest management UI
19. Source management UI
20. Manual URL input
21. Preference viewer
22. Feedback-to-learning pipeline

### Phase 6: Polish
23. Dark mode
24. Mobile responsiveness pass
25. Vercel Cron configuration
26. Error handling and loading states
27. README with setup instructions

---

## Key Implementation Notes

1. **SQLite on Vercel**: Vercel's serverless functions have an ephemeral filesystem. For production, you'll need to either use Turso (SQLite-compatible, edge-friendly) or switch to a hosted database. For initial development, local SQLite is fine. Add a note in the README about this.

2. **Rate limiting Reddit**: Reddit's public JSON API has rate limits. Add a `User-Agent` header identifying the app, and don't hit it more than once per minute per subreddit. Cache responses.

3. **Claude API batching**: Send articles in batches of ~20 to keep context manageable and responses accurate. Parse the JSON response carefully with error handling for malformed responses.

4. **Optimistic UI for feedback**: When the user clicks thumbs up/down, update the UI immediately and fire the API call in the background. Don't block on the response.

5. **Deduplication**: Use URL normalization (strip tracking params like `utm_*`, normalize trailing slashes) before hashing for dedup. Also do title-similarity dedup for the same story from multiple sources.

6. **Content freshness**: Only show articles from the last 48 hours in a digest. Don't surface old content that was recently fetched.

7. **Graceful degradation**: If the Claude API is down or rate-limited, still show articles with their raw titles/descriptions — just skip the AI summary and use a default relevance score based on source.

8. **Database migrations**: Include a simple migration system (even just a version number in the DB and a switch statement of migration scripts) so the schema can evolve.
