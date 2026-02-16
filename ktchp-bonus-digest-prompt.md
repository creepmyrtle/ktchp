# ktchp — Bonus Digest & Content Messaging

## Overview

Two enhancements:

1. **Bonus Digest**: After a user archives all articles in their recommended digest, reveal a secondary "bonus" section containing articles that scored below the relevance threshold. These give users more to browse and — critically — generate additional feedback signals that improve the recommendation engine over time.

2. **Content Messaging**: Add contextual messaging throughout the digest experience so users (especially new ones) understand what they're looking at — what recommended articles are, what serendipity picks are, and what the bonus digest is.

---

## Bonus Digest

### Concept

Currently, articles that score below the relevance threshold during ingestion are stored in the database but never shown to the user. This is wasted signal — if a user sees a below-threshold article and likes it, that's extremely valuable feedback (it means the scoring model was wrong and needs to adjust).

The bonus digest surfaces these articles **only after the user completes their recommended digest**. This preserves the core anti-compulsion design: the primary experience is still a finite, curated set of articles. The bonus content is optional, clearly secondary, and framed as exploration rather than obligation.

### Which Articles to Include

From the current ingestion run, select articles that:

- Were scored for this user (have a `user_articles` row)
- Have a `relevance_score` below the digest inclusion threshold (currently `MIN_RELEVANCE_SCORE`, default 0.5)
- Have a `relevance_score` above a minimum floor (default 0.15) — don't show articles that scored near-zero, they're genuinely irrelevant noise
- Were NOT included in the recommended digest
- Are not already archived by this user

Store these as part of the same digest but with a flag distinguishing them from recommended articles.

### Data Model Changes

Add a column to `user_articles` to distinguish article tiers within a digest:

```sql
ALTER TABLE user_articles ADD COLUMN digest_tier TEXT CHECK (digest_tier IN ('recommended', 'serendipity', 'bonus')) DEFAULT 'recommended';
```

During digest generation:
- Articles above the relevance threshold → `digest_tier = 'recommended'`
- Serendipity picks → `digest_tier = 'serendipity'` (these were already flagged, just formalize it)
- Below-threshold articles (above floor) → `digest_tier = 'bonus'`

All three tiers belong to the same `digest_id`. The frontend uses `digest_tier` to control display.

### Bonus Digest Settings

Add configurable settings (global, admin-managed):

| Setting | Default | Description |
|---------|---------|-------------|
| `bonus_digest_enabled` | `true` | Enable/disable bonus digest globally |
| `bonus_min_score` | `0.15` | Minimum score floor for bonus articles |
| `bonus_max_articles` | `20` | Maximum bonus articles per user per digest |

Store in the `settings` table with `user_id = NULL`.

---

## Frontend: Bonus Digest Display

### Visibility Logic

The bonus digest section is **hidden by default** and only appears when:

1. The user has completed (archived all articles in) their recommended + serendipity digest, OR
2. The user explicitly expands/reveals the bonus section via a toggle

This means the initial digest view looks exactly the same as it does today. The bonus content only appears after the user has finished their curated experience.

### Layout

After the existing completion message ("Digest complete — You processed all X articles..."), add the bonus section:

```
┌──────────────────────────────────────────────────────┐
│                                                       │
│  ✓ Digest complete                                    │
│  You processed all 18 articles.                       │
│  12 liked · 4 neutral · 2 disliked · 3 bookmarked    │
│                                                       │
│  Next digest: ~5:00 AM CT                             │
│                                                       │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│                                                       │
│  📂 Bonus: 14 more articles                           │
│                                                       │
│  These didn't make your main digest but browsing      │
│  them helps ktchp learn what you like. Your           │
│  feedback here directly improves future               │
│  recommendations.                                     │
│                                                       │
│  [Browse bonus articles ↓]                            │
│                                                       │
└──────────────────────────────────────────────────────┘
```

When the user clicks "Browse bonus articles," the bonus cards expand below with a smooth reveal animation.

The bonus section should also be accessible before completing the recommended digest — add a subtle collapsed indicator at the bottom of the digest (below all recommended cards but above the "caught up" message):

```
── 14 bonus articles available after you finish your digest ──
```

This is informational only (not clickable) until the recommended digest is complete. It lets the user know more content exists without distracting from the primary task.

### Bonus Article Cards

Bonus articles use the **same `ArticleCard` component** but with visual distinction:

#### Color: Muted Blue / Slate

Use a cool-toned muted blue for bonus articles. This should feel clearly secondary to the red (recommended) and amber (serendipity) cards.

- **Left border or accent**: `#64748B` (Tailwind `slate-500`) or `#6B7280` (Tailwind `gray-500`) — a cool, understated steel blue/gray
- **Relevance tag pill**: Same muted blue background with light text
- **Tag text**: Show the embedding score or LLM score as context, e.g., "Score: 0.38" or just "Below threshold"

The specific implementation:
- Recommended cards: red accent (existing)
- Serendipity cards: amber/yellow accent (existing)
- Bonus cards: slate/steel blue accent (`slate-500` or similar)

#### Interaction

Bonus cards have the **exact same interaction model** as recommended cards — sentiment (liked/neutral/disliked), read tracking, bookmark, share, archive, and swipe-to-archive on mobile. The sentiment gate still applies (must rate before archiving).

This is important because the whole point of the bonus digest is to collect feedback. Every interaction on a bonus article is a signal that the scoring model can learn from.

#### Bonus Completion

When all bonus articles are archived, show a brief secondary completion message:

```
✓ Bonus complete — You reviewed all 14 additional articles.
```

No stats breakdown needed for the bonus — keep it simple.

---

## Content Messaging / Onboarding

### Problem

A new user arriving at ktchp for the first time sees a list of article cards with colored accents and relevance tags but no explanation of what any of it means. The experience should be self-explanatory.

### Approach

Add **contextual section headers** with brief explanatory text. These are always visible (not just for new users) but are concise enough that experienced users can ignore them. Don't implement a tutorial, walkthrough, or dismissible onboarding flow — that's over-engineered for this. Just add clear, permanent labels.

### Digest Section Headers

At the top of the digest, before the first recommended article:

```
┌──────────────────────────────────────────────────────┐
│  📋 Your Daily Digest                                 │
│  Articles picked for you based on your interests.     │
│  Rate each one to help ktchp learn your preferences.  │
└──────────────────────────────────────────────────────┘
```

If serendipity articles are present, add a small section divider before them (within the main digest, not as a separate section):

```
── ✨ Serendipity picks ─────────────────────────────────
   Interesting finds outside your usual interests.
```

And the bonus section header as described above.

### Design Guidelines for Section Headers

- **Keep them short.** One line of title, one line of description, max.
- **Use muted text.** These should not compete with the article cards for attention. Use `text-gray-500` / `text-slate-400` (dark mode) styling.
- **No close/dismiss button.** These are permanent contextual labels, not notifications.
- **Responsive.** On mobile, they should still fit comfortably without wrapping excessively.

### Relevance Tag Clarification

The existing relevance tags on cards (e.g., "Matches: AI/LLMs") are already helpful. For bonus articles, the tag should indicate why it scored low or simply show the tier:

- Recommended: `"Matches: AI/LLMs"` or `"Matches: Web Dev"` (existing behavior)
- Serendipity: `"Serendipity: adjacent to civic tech"` (existing behavior)
- Bonus: `"Below threshold"` or show the score like `"Score: 0.38"` — keep it factual and non-judgmental

---

## API Changes

### `GET /api/digests/latest` and `GET /api/digests/[id]`

Update the response to include bonus articles separately:

```typescript
{
  id: string;
  generated_at: string;

  // Recommended + serendipity (the main digest)
  articles: Article[];

  // Bonus articles (below threshold)
  bonus_articles: Article[];

  // Completion stats (recommended only)
  total_article_count: number;
  archived_count: number;
  remaining_count: number;
  is_complete: boolean;

  // Bonus stats
  bonus_total_count: number;
  bonus_archived_count: number;
  bonus_remaining_count: number;
  bonus_is_complete: boolean;
}
```

The `articles` array contains `recommended` and `serendipity` tier articles (as before). The `bonus_articles` array contains `bonus` tier articles. This keeps the existing frontend contract intact — `articles` still means "the main digest" — while adding the bonus data alongside.

### Digest Generation (ingestion pipeline)

During digest generation, after selecting recommended and serendipity articles:

1. Query remaining scored articles for this user that fell below the threshold but above `bonus_min_score`
2. Cap at `bonus_max_articles`
3. Assign them to the same `digest_id` with `digest_tier = 'bonus'`

---

## Digest Header Progress Updates

The progress indicator in `DigestHeader` should track recommended articles only (not bonus). The bonus section has its own lightweight completion state. This keeps the primary progress bar focused on the core task.

```
Daily Digest — Feb 16, 2026                    12 of 18 cleared
```

The "12 of 18" counts recommended + serendipity only. Bonus articles are tracked separately in the bonus section header:

```
📂 Bonus: 8 of 14 reviewed
```

---

## Scoring Analytics & Threshold Monitoring

### Overview

Build an analytics system that tracks how well the scoring pipeline is performing by comparing relevance scores and digest tiers against actual user feedback. Surface insights both in ingestion logs (for debugging) and in an admin dashboard (for ongoing monitoring).

This serves two purposes: it tells the admin when scoring thresholds or interest profiles need adjustment, and it provides the data foundation for future automatic calibration.

### Metric 1: Feedback Rate by Tier

Track the sentiment breakdown (liked / neutral / disliked) for each digest tier (recommended, serendipity, bonus) across a rolling time window.

**What to compute:**

```
For each tier over the last 7 / 30 days:
  - Total articles shown
  - Total articles with feedback (sentiment set)
  - Count and percentage: liked, neutral, disliked
  - Engagement rate: % of articles that received any feedback
  - Bookmark rate: % of articles bookmarked
```

**What it tells you:**

- If recommended articles have a high dislike rate, the scoring model is overvaluing certain content
- If bonus articles have a like rate approaching recommended articles, the relevance threshold is too high — good content is being filtered out
- If serendipity articles consistently get disliked, the serendipity logic needs tuning
- Engagement rate by tier shows whether users bother interacting with bonus content at all

**Dashboard display:**

A simple table, one row per tier, with sparkline or bar visualization for the sentiment split:

```
Feedback by Tier (Last 30 Days)
──────────────────────────────────────────────────────────────────
Tier          │ Articles │ Rated │ 👍 Liked │ ➖ Neutral │ 👎 Disliked │ 🔖 Bookmarked
──────────────┼──────────┼───────┼──────────┼───────────┼────────────┼──────────────
Recommended   │ 312      │ 287   │ 58%      │ 31%       │ 11%        │ 14%
Serendipity   │ 41       │ 34    │ 35%      │ 41%       │ 24%        │ 6%
Bonus         │ 189      │ 72    │ 42%      │ 38%       │ 20%        │ 8%
──────────────────────────────────────────────────────────────────
```

Include a toggle for time window: 7 days / 30 days / all time.

### Metric 2: Threshold Recommendation

Analyze whether the current relevance threshold is well-calibrated by looking at feedback patterns near the threshold boundary.

**What to compute:**

```
For articles scored in the last 30 days:
  - Group articles into score bands (0.0-0.1, 0.1-0.2, ..., 0.9-1.0)
  - For each band: count of articles, like rate, dislike rate
  - Identify the "crossover point" where like rate drops below a threshold (e.g., 30%)
  - Compare the crossover point to the current relevance threshold
```

**Threshold recommendation logic:**

```typescript
// If bonus articles (below threshold) have a like rate > 35%,
// the threshold is probably too high
if (bonusLikeRate > 0.35) {
  recommendation = `Your threshold (${currentThreshold}) may be too high. ` +
    `${bonusLikeRate}% of below-threshold articles are being liked. ` +
    `Consider lowering to ${suggestedThreshold}.`;
}

// If recommended articles have a dislike rate > 30%,
// the threshold is probably too low
if (recommendedDislikeRate > 0.30) {
  recommendation = `Your threshold (${currentThreshold}) may be too low. ` +
    `${recommendedDislikeRate}% of recommended articles are being disliked. ` +
    `Consider raising to ${suggestedThreshold}.`;
}

// Suggest a threshold at the score band where like rate crosses ~40%
```

**Dashboard display:**

A score distribution chart showing article count per score band as a bar chart, with the like rate overlaid as a line. The current threshold is shown as a vertical line. If a recommendation exists, show it as an advisory banner:

```
⚠️ Threshold may be too high
42% of bonus articles are being liked — consider lowering from 0.50 to 0.40.
Suggested threshold based on your feedback patterns: 0.40
[Adjust Threshold]  [Dismiss]
```

The "Adjust Threshold" button updates the `MIN_RELEVANCE_SCORE` setting directly. The "Dismiss" button hides the banner until the next time the recommendation changes.

**Important**: This is advisory, not automatic. The admin reviews the recommendation and decides whether to act on it. Don't auto-adjust thresholds.

### Metric 3: Per-Interest Accuracy

Track how well each interest category is performing by looking at feedback on articles matched to that interest.

**What to compute:**

```
For each user interest, over the last 30 days:
  - Articles where relevance_reason matches this interest (e.g., "Matches: AI/LLMs")
  - Sentiment breakdown: liked / neutral / disliked counts and percentages
  - "Accuracy": liked / (liked + disliked), ignoring neutral
  - Trend: is accuracy improving or declining over the last 4 weeks?
```

**What it tells you:**

- An interest with high accuracy (>70% liked vs. disliked) is well-calibrated — the embedding and scoring are correctly identifying content the user cares about
- An interest with low accuracy (<40%) suggests the interest description isn't capturing what the user actually wants, or the sources producing content for that interest are low quality
- Declining trends suggest an interest is getting stale or the user's actual preferences are shifting

**Dashboard display:**

A table per user (admin can select user), sorted by accuracy:

```
Interest Accuracy — joe (Last 30 Days)
──────────────────────────────────────────────────────────────
Interest              │ Articles │ 👍 Liked │ 👎 Disliked │ Accuracy │ Trend
──────────────────────┼──────────┼──────────┼────────────┼──────────┼──────
AI / LLMs             │ 84       │ 62       │ 8          │ 89%      │  →
Web Development       │ 56       │ 34       │ 12         │ 74%      │  ↑
Dallas / DFW News     │ 28       │ 14       │ 9          │ 61%      │  ↓
Gaming / PC Hardware  │ 19       │ 6        │ 8          │ 43%      │  ↓
──────────────────────────────────────────────────────────────
```

For interests with low or declining accuracy, show a subtle suggestion:

```
💡 "Gaming / PC Hardware" has low accuracy (43%). Consider refining the 
   interest description or adjusting its weight.
```

### Metric 4: Score vs. Feedback Correlation

Measure whether higher relevance scores actually predict positive feedback. This is the most fundamental health check of the entire scoring system.

**What to compute:**

```
For all rated articles in the last 30 days:
  - Convert sentiment to numeric: liked = 1, neutral = 0, disliked = -1
  - Compute Pearson correlation between relevance_score and sentiment_numeric
  - Also compute for embedding_score vs. sentiment (to compare embedding vs. LLM performance)
  - Break down by score bands to show where the correlation holds or breaks down
```

**What it tells you:**

- A positive correlation (0.3+) means the scoring system is working — higher scores genuinely predict user satisfaction
- Near-zero correlation means scores are essentially random relative to user preferences — something is fundamentally wrong
- If embedding_score correlates better than relevance_score, the LLM refinement step might be hurting rather than helping (unlikely but worth checking)

**Dashboard display:**

A simple summary with the correlation values:

```
Score ↔ Feedback Correlation (Last 30 Days)
──────────────────────────────────────────────
LLM relevance score:    r = 0.42  (moderate positive ✓)
Embedding score:        r = 0.31  (weak positive)
──────────────────────────────────────────────
```

With a brief interpretation:
- r > 0.4: "Strong — scoring is well-calibrated ✓"
- r 0.2-0.4: "Moderate — scoring is directionally correct but has room to improve"
- r < 0.2: "Weak — scoring may not be reflecting your actual preferences"

Below the summary, a scatter-style breakdown by score band:

```
Score Band │ Articles │ Avg Sentiment │ Like Rate
───────────┼──────────┼───────────────┼──────────
0.8 - 1.0  │ 24       │ +0.71         │ 83%
0.6 - 0.8  │ 89       │ +0.44         │ 64%
0.4 - 0.6  │ 112      │ +0.18         │ 45%
0.2 - 0.4  │ 78       │ -0.05         │ 32%
0.0 - 0.2  │ 34       │ -0.29         │ 18%
```

This table should show a clear downward trend in sentiment/like rate as scores decrease. If it doesn't, the scoring model is miscalibrated.

### Data Logging

In addition to the dashboard, log analytics data during each ingestion run. Add a section to the ingestion log:

```json
{
  "analytics_snapshot": {
    "threshold": 0.50,
    "last_7_days": {
      "recommended": { "total": 98, "rated": 87, "liked": 52, "neutral": 26, "disliked": 9 },
      "serendipity": { "total": 12, "rated": 10, "liked": 4, "neutral": 4, "disliked": 2 },
      "bonus": { "total": 64, "rated": 28, "liked": 12, "neutral": 10, "disliked": 6 }
    },
    "bonus_like_rate": 0.43,
    "threshold_recommendation": "Consider lowering threshold to 0.40",
    "score_feedback_correlation": 0.42
  }
}
```

This creates a historical record of system health that can be reviewed even without the dashboard.

### Admin Dashboard Page

Add a new **Analytics** tab to the admin section of the settings page. This tab contains all four metric panels described above. Only visible to admin users.

Layout: Stack the four panels vertically. Each panel has a header, the data table/chart, and any advisory messages. Include the time window toggle (7d / 30d / all) at the top — it applies to all panels.

### API Route

```
GET /api/admin/analytics?window=30
```

Returns all four metrics computed over the specified window (in days). Admin-only.

This should be a computed endpoint (queries the database and calculates metrics on the fly) rather than pre-computed/cached. At the scale of a few hundred articles and a handful of users, the queries will be fast enough.

---

## Files to Modify

### Database:
- `src/lib/db/schema.ts` — Add `digest_tier` column to `user_articles`
- `src/lib/db/articles.ts` — Update queries to include/exclude bonus tier as needed
- `src/lib/db/digests.ts` — Update digest stats queries to separate recommended vs. bonus counts
- `src/types/index.ts` — Add `digest_tier` to UserArticle type, update Digest response type

### Pipeline:
- `src/lib/relevance/index.ts` — After digest generation, select and assign bonus articles

### API:
- `src/app/api/digests/latest/route.ts` — Return bonus_articles separately with bonus stats
- `src/app/api/digests/[id]/route.ts` — Same updates
- `src/app/api/settings/route.ts` — Support bonus digest settings

### Frontend:
- `src/app/digest/page.tsx` — Render bonus section after completion state
- `src/app/digest/[id]/page.tsx` — Same updates
- `src/components/DigestContent.tsx` — Track bonus archive state separately, handle bonus reveal logic
- `src/components/CaughtUpMessage.tsx` — Update to show bonus section teaser/reveal after completion
- `src/components/ArticleCard.tsx` — Support bonus tier styling (muted blue accent)
- `src/components/DigestHeader.tsx` — Ensure progress only counts recommended + serendipity

### New components (optional — could be inline):
- `src/components/DigestSectionHeader.tsx` — Reusable section header with icon, title, and description text
- `src/components/BonusDigestSection.tsx` — Wrapper for the bonus reveal/expand logic and bonus article list

### Analytics (new):
- `src/app/api/admin/analytics/route.ts` — Computed analytics endpoint (admin-only)
- `src/lib/db/analytics.ts` — Query functions for all four metrics (feedback by tier, threshold recommendation, per-interest accuracy, score-feedback correlation)
- `src/components/AnalyticsDashboard.tsx` — Admin dashboard with four metric panels
- `src/components/FeedbackByTierPanel.tsx` — Tier breakdown table with time window toggle
- `src/components/ThresholdRecommendationPanel.tsx` — Score distribution + recommendation banner
- `src/components/InterestAccuracyPanel.tsx` — Per-interest accuracy table with trends
- `src/components/ScoreCorrelationPanel.tsx` — Correlation summary and score band breakdown

### Settings:
- `src/app/settings/page.tsx` — Add bonus digest settings to admin panel (enable/disable, min score, max articles)

---

## Implementation Priority

### Phase 1: Data Model
1. Add `digest_tier` column to `user_articles`
2. Update digest generation to assign tiers (recommended, serendipity, bonus)
3. Update types

### Phase 2: API
4. Update digest API responses to separate recommended from bonus articles
5. Add bonus stats to digest response
6. Add bonus settings to settings table

### Phase 3: Frontend — Bonus Display
7. Bonus section with reveal/expand after digest completion
8. Bonus article cards with muted blue styling
9. Bonus completion message
10. Pre-completion teaser ("14 bonus articles available after you finish")

### Phase 4: Frontend — Content Messaging
11. Digest section header ("Your Daily Digest — articles picked for you...")
12. Serendipity divider with label
13. Bonus section header with explanatory text

### Phase 5: Analytics — Data Layer
14. Create `lib/db/analytics.ts` with query functions for all four metrics
15. Add analytics snapshot to ingestion logs
16. Create `GET /api/admin/analytics` endpoint

### Phase 6: Analytics — Dashboard
17. Build the analytics dashboard page/tab in admin settings
18. Feedback by tier panel with time window toggle
19. Threshold recommendation panel with score distribution and advisory banner
20. Per-interest accuracy panel with trends and suggestions
21. Score-feedback correlation panel with interpretation

### Phase 7: Polish
22. Bonus settings in admin panel (enable/disable, min score, max articles)
23. Ensure bonus articles don't affect main digest progress bar
24. Test the full flow: complete recommended → see bonus teaser → expand → browse → complete bonus
25. Test analytics with sufficient feedback data — verify correlation calculation and threshold recommendations make sense
