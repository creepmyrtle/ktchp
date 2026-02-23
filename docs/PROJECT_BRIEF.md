# ketchup — Project Brief

## What it is

ketchup (ktchp) is a multi-user, AI-curated daily news digest app. It aggregates articles from RSS feeds, scores them for relevance using a two-stage embedding + LLM pipeline, and delivers personalized digests tailored to each user's interests. The core value proposition is anti-addictive design: instead of an infinite feed optimized for engagement, ketchup gives you a finite daily digest of what actually matters to you, then gets out of the way.

## Who it's for

Currently 2 users (Joe + one friend), scaling to 10-20 invite-only users. This is a personal/community tool, not a commercial product — there's no monetization. Users are people who want to stay informed on topics they care about without doomscrolling RSS readers or social media. The audience is moderately technical (comfortable with RSS, willing to configure interests) but the UX should feel polished and intuitive, not like a developer tool.

## Product principles

- **Anti-addictive by design.** Finite digests, not infinite feeds. The app should encourage "catch up and move on," not endless browsing.
- **Signal over noise.** The two-stage scoring pipeline exists to aggressively filter out irrelevant content. A smaller, high-quality digest beats a large, noisy one.
- **Learn from behavior, not just configuration.** Users set up interests and sources explicitly, but the system also learns from engagement feedback, discovers new interests, and adjusts source trust over time.
- **Mobile-first interaction.** The primary consumption experience is on a phone. Card-based digest, swipe gestures for feedback + archiving, minimal tap targets. Desktop is supported but secondary.
- **Transparent and controllable.** Users can see why articles were recommended (reason tags), tune their interest weights, manage exclusions, and delete learned preferences. No black box.
- **Cost-conscious.** The app runs on free tiers (Vercel Hobby, Neon free Postgres) with paid API usage kept minimal through the embedding pre-filter that cuts LLM calls by 60-80%.

## Current priorities

1. **Scaling to 10-20 users** — Database retention, per-user cost tracking, session management, storage monitoring, and soft resource limits. (Prompt written, implementation in progress.)
2. **Mobile swipe UX overhaul** — Replacing clunky button-based sentiment + swipe-to-archive with directional swipes that combine feedback and archiving in one gesture. Migrating from three-way sentiment (liked/neutral/disliked) to two-way (liked/skipped) with asymmetric signal weighting. (Prompt written, implementation in progress.)
3. **Stability and observability** — Admin system health panel, storage stats, per-user cost breakdown, alerting when approaching free tier limits.

## Stack

- **Framework**: Next.js 16 (App Router, React 19, Turbopack)
- **Database**: Vercel Postgres (Neon) with pgvector, 256 MB free tier
- **Embeddings**: OpenAI text-embedding-3-small (512 dimensions, configurable)
- **LLM**: Kimi K2.5 via Synthetic API (OpenAI-compatible)
- **Styling**: Tailwind CSS 4, dark theme (DM Sans + JetBrains Mono)
- **Deployment**: Vercel Hobby tier (hosting) + GitHub Actions (daily ingestion cron at 5 AM CT)
- **Auth**: Invite-based multi-user with bcrypt + session cookies (httpOnly, HMAC-SHA256)

## Owner

Joe — sole developer. Intermediate self-taught developer building with AI tools (Claude Code primarily). Comfortable with TypeScript, Next.js, and Vercel. Prefers comprehensive, production-ready solutions over quick demos. Values clear documentation, systematic problem-solving, and clean code.
