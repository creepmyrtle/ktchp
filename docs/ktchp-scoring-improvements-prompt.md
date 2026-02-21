# ktchp — Scoring Pipeline Improvements

## Overview

Seven improvements to the scoring pipeline, ordered by implementation priority. These improve article-to-interest matching accuracy, reduce noise, and introduce intelligent content discovery — all while keeping costs minimal.

1. **Richer interest embeddings** — LLM-expanded interest descriptions for better semantic matching
2. **Weight-adjusted embedding scores** — Interest weights applied at the embedding layer
3. **Feed article content to the LLM** — Include raw_content in LLM scoring, not just title + URL
4. **Interest affinity mapping** — Discover and suggest related topics the user hasn't added
5. **Multi-interest blended scoring** — Boost articles matching multiple interests
6. **Smarter serendipity sampling** — Bias toward near-threshold and diverse picks
7. **Semantic deduplication** — Remove near-duplicate articles using embedding similarity
8. **Excluded topics** — Per-user negative interest signals at the embedding layer
9. **Feedback-weighted source scoring** — Source trust multiplier based on historical feedback

---

## 1. Richer Interest Embeddings

### Problem

Interest embedding text is often just a few words: `"Civic Tech / GovTech: Technology for government, municipal data"`. This gives the embedding model very little semantic surface area to match against full article text. Many relevant articles score low because the interest embedding doesn't contain the right vocabulary.

### Solution

When an interest is created or updated, make a one-time LLM call to expand the interest description into a rich, 150-200 word paragraph that captures the full semantic range — subtopics, related terminology, adjacent concepts, example entities, and typical article subjects.

### Implementation

Add a function in `lib/embeddings.ts` (or a new `lib/interest-expansion.ts`):

```typescript
async function expandInterestDescription(category: string, description: string): Promise<string> {
  // Call the LLM with this prompt:
  const prompt = `You are helping build a content recommendation system. Given this interest category and description, write a single dense paragraph (150-200 words) that captures the FULL semantic range of topics this person would want to read about.

Include: subtopics, related terminology, adjacent concepts, key entities (companies, organizations, technologies), typical article subjects, and the kinds of headlines someone with this interest would click on.

Do NOT use bullet points or lists. Write it as a flowing paragraph optimized for semantic similarity matching.

Interest: "${category}"
Description: "${description || 'No additional description provided.'}"

Expanded description:`;

  // Parse LLM response, return the expanded text
}
```

**When to run:**
- On interest creation (`POST /api/interests`)
- On interest update (`PUT /api/interests/[id]`) — only if category or description changed, not just weight
- One-time migration: expand all existing interests that don't have an expanded description

**Storage:**
Add a column to the `interests` table:

```sql
ALTER TABLE interests ADD COLUMN expanded_description TEXT;
```

Store the LLM-generated expansion here. Then update the embedding text formula:

```typescript
// Old: just category + description
function buildInterestEmbeddingText(category, description) {
  return description ? `${category}: ${description}` : category;
}

// New: use expanded description if available, fall back to old formula
function buildInterestEmbeddingText(category, description, expandedDescription) {
  if (expandedDescription) return expandedDescription;
  return description ? `${category}: ${description}` : category;
}
```

After generating the expanded description, regenerate the interest's embedding using the new text.

**Cost:** One LLM call per interest creation/edit. With ~6 interests per user and rare edits, this is negligible — maybe 1-2 calls per week across all users.

---

## 2. Weight-Adjusted Embedding Scores

### Problem

A weight-1.0 interest and a weight-0.2 interest contribute equally to the embedding score. An article matching a low-priority interest can score just as high as one matching the user's top interest, which distorts the ranking.

### Solution

Multiply the cosine similarity by the interest weight before taking the max.

### Implementation

In the embedding scoring step (where `MAX(cosineSimilarity(article, interest))` is computed), change to:

```typescript
// Old
let maxScore = 0;
for (const interest of userInterests) {
  const similarity = cosineSimilarity(articleEmbedding, interest.embedding);
  if (similarity > maxScore) {
    maxScore = similarity;
  }
}

// New
let maxWeightedScore = 0;
for (const interest of userInterests) {
  const similarity = cosineSimilarity(articleEmbedding, interest.embedding);
  const weightedScore = similarity * interest.weight;
  if (weightedScore > maxWeightedScore) {
    maxWeightedScore = weightedScore;
  }
}
```

**Important threshold consideration:** Weight adjustment lowers scores for low-weight interests. If a user has an interest at weight 0.5, an article that would have scored 0.40 now scores 0.20 — below the LLM threshold. This is the desired behavior (low-priority interests should be harder to qualify), but verify that high-weight interests (0.8-1.0) still produce scores in the expected range. The thresholds may need slight lowering after this change.

**Recommendation:** After implementing, log the score distributions with and without weight adjustment for a few runs and compare. Adjust thresholds if the distribution shifts significantly.

**Cost:** Zero — pure math change.

---

## 3. Feed Article Content to the LLM

### Problem

The LLM currently receives only article title + URL for scoring. Many titles are vague, clickbait, or ambiguous. The LLM is making judgments with minimal information.

### Solution

Include the first 500 characters of `raw_content` in the LLM scoring prompt alongside the title and URL.

### Implementation

In `lib/relevance/scorer.ts`, where articles are formatted for the LLM prompt, update the article payload:

```typescript
// Old
{ title: article.title, url: article.url }

// New
{
  title: article.title,
  url: article.url,
  content_snippet: article.raw_content
    ? article.raw_content.substring(0, 500)
    : '(no content available)'
}
```

Update the LLM prompt to reference the content:

```
For each article below, you are given the title, URL, and the first 500 characters of content. Use ALL of these to assess relevance — don't rely on the title alone, as titles can be misleading or vague.
```

**Cost impact:** This increases input tokens per LLM call. With 10 articles per batch and ~500 extra chars (~125 tokens) per article, that's ~1,250 additional input tokens per call. At current rates this is a minor increase (~10-15% more input tokens). The accuracy improvement should be significant since the LLM can now actually understand what the article is about.

---

## 4. Interest Affinity Mapping (Topic C Discovery)

### Problem

Users add interests they're aware of, but they don't know what they don't know. A user interested in "Civic Tech" and "Dallas/DFW News" might find articles about urban planning, zoning reform, or municipal broadband highly relevant — but they'd never think to add "Urban Planning" as an interest. These articles get scored low and filtered out.

### Solution

Run a weekly analysis that examines the user's feedback history to discover latent interests — topics the user consistently engages with that aren't captured by their stated interests. Surface these as suggestions the user can accept or dismiss.

### When to Run

Run during the ingestion pipeline, but **only on Sundays**. Add a day-of-week check:

```typescript
const today = new Date();
const isSunday = today.getUTCDay() === 0; // 0 = Sunday
if (isSunday) {
  await runAffinityAnalysis(user);
}
```

This is configurable via a global setting: `affinity_analysis_day` (default: `0` for Sunday, using JS day-of-week numbers 0-6). Store in `settings` table.

### LLM Prompt

```
You are analyzing a user's content engagement patterns to discover latent interests — topics they consistently engage with but haven't explicitly added to their interest profile.

## User's Current Interests
{list of interests with categories and descriptions}

## Recently Liked Articles (last 30 days)
{list of 30-50 most recent liked articles with titles and relevance reasons}

## Recently Bookmarked Articles
{list of bookmarked articles with titles}

## Instructions

Identify 3-5 topic areas that:
1. Are NOT already covered by the user's stated interests
2. Appear frequently in the user's liked/bookmarked articles
3. Have a clear, logical connection to one or more existing interests
4. Would meaningfully improve article recommendations if added

For each suggested topic, provide:
- **category**: A concise name (2-5 words) suitable as an interest category
- **description**: A 1-2 sentence description of what this topic covers
- **related_interests**: Which of the user's existing interests this is connected to
- **reasoning**: Why you believe the user would be interested (reference specific article patterns)
- **confidence**: 0.0-1.0 how confident you are in this suggestion

Only suggest topics where you see clear evidence in the engagement data. Do not pad the list — if you only see 1-2 genuine suggestions, return only those.

Respond in JSON format:
[
  {
    "category": "Urban Planning & Zoning",
    "description": "City planning, zoning reform, transit-oriented development, land use policy",
    "related_interests": ["Civic Tech / GovTech", "Dallas / DFW Local News"],
    "reasoning": "User liked 6 articles about Dallas zoning changes and 3 about transit development in the last month",
    "confidence": 0.78
  }
]
```

### Data Model

New table for storing suggestions:

```sql
CREATE TABLE interest_suggestions (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT,
  related_interests TEXT[], -- array of interest category names
  reasoning TEXT,
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
);

CREATE INDEX idx_suggestions_user_status ON interest_suggestions(user_id, status);
```

When a user **accepts** a suggestion:
- Create a new interest with the suggested category and description
- Set `status = 'accepted'` and `resolved_at = now()`
- Trigger the interest expansion (improvement #1) and embedding generation for the new interest

When a user **dismisses** a suggestion:
- Set `status = 'dismissed'` and `resolved_at = now()`
- Don't suggest the same category again (check against dismissed suggestions before running the LLM prompt — include dismissed categories in the prompt as "Previously dismissed — do not re-suggest")

### Frontend: Settings — Interest Manager

Add a collapsible section at the top of the interest manager (above the existing interest list):

```
┌──────────────────────────────────────────────────────────┐
│  💡 Suggested Interests (2)                         [▼]  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Urban Planning & Zoning                                 │
│  City planning, zoning reform, transit-oriented          │
│  development, land use policy                            │
│  Related to: Civic Tech, Dallas / DFW News               │
│  "You've liked 6 articles about Dallas zoning changes    │
│   and 3 about transit development recently."             │
│                                                          │
│  [Add to Interests]  [Dismiss]                           │
│                                                          │
│  ─────────────────────────────────────────────────────   │
│                                                          │
│  Developer Tools & DX                                    │
│  Developer experience, CLI tools, code editors,          │
│  build systems, developer productivity                   │
│  Related to: Web Development                             │
│  "You've bookmarked several articles about new           │
│   dev tools and CLI workflows."                          │
│                                                          │
│  [Add to Interests]  [Dismiss]                           │
│                                                          │
└──────────────────────────────────────────────────────────┘

Your Interests
──────────────────────────────────────
[existing interest list...]
```

The section header shows the count of pending suggestions. If no pending suggestions exist, hide the section entirely.

### Frontend: Digest — Subtle Hint

When a user has pending interest suggestions, show a subtle, non-intrusive banner at the top of the digest view (below the digest header, above the first article card):

```
┌──────────────────────────────────────────────────────────┐
│  💡 ktchp noticed you might be interested in 2 new       │
│     topics. Review suggestions in Settings → Interests.  │
│                                                     [✕]  │
└──────────────────────────────────────────────────────────┘
```

- Dismissing the banner (✕) hides it for the current session only — it reappears next session if suggestions are still pending
- Clicking the text links to the settings/interests page
- Style: muted, low-contrast, same treatment as the section headers from the content messaging feature — NOT an alert or notification banner
- Only show if there are pending suggestions (status = 'pending')

### API Routes

```
GET  /api/suggestions           — List pending suggestions for current user
POST /api/suggestions/[id]/accept  — Accept a suggestion (creates interest, triggers expansion + embedding)
POST /api/suggestions/[id]/dismiss — Dismiss a suggestion
```

### Cost

One LLM call per user per week. With 5 users, that's 5 additional LLM calls per week — negligible.

---

## 5. Multi-Interest Blended Scoring

### Problem

An article's embedding score is its single best interest match. An article that moderately matches three interests is probably more relevant than one that strongly matches only one, but the current system scores them equally.

### Solution

Compute a blended score that gives a bonus to articles matching multiple interests.

### Implementation

In the embedding scoring step:

```typescript
const interestScores = userInterests.map(interest => {
  const similarity = cosineSimilarity(articleEmbedding, interest.embedding);
  return similarity * interest.weight;  // weight-adjusted (from improvement #2)
});

// Sort descending
interestScores.sort((a, b) => b - a);

const primary = interestScores[0] || 0;

// Average of top 3 (or fewer if user has fewer interests)
const topN = interestScores.slice(0, Math.min(3, interestScores.length));
const secondary = topN.reduce((sum, s) => sum + s, 0) / topN.length;

// Blended: primary dominates, secondary provides a multi-interest bonus
const blended = (0.7 * primary) + (0.3 * secondary);
```

The blended score replaces the old max-only score as `embedding_score` on `user_articles`.

**Effect:** An article matching one interest at 0.40 scores: `0.7 × 0.40 + 0.3 × 0.40 = 0.40` (unchanged). An article matching three interests at 0.35, 0.30, 0.25 scores: `0.7 × 0.35 + 0.3 × 0.30 = 0.335` — slightly below an article at 0.35 alone (`0.7 × 0.35 + 0.3 × 0.35 = 0.35`). But an article at 0.35, 0.33, 0.30 scores: `0.7 × 0.35 + 0.3 × 0.327 = 0.343` — a meaningful boost that could push it above threshold.

The 0.7/0.3 split is a starting point. Store as settings (`blended_primary_weight` and `blended_secondary_weight`) so they can be tuned.

**Cost:** Zero — pure math.

---

## 6. Smarter Serendipity Sampling

### Problem

The serendipity pool is a random sample from the 0.20-0.35 score range. An article at 0.34 (likely a near-miss) and one at 0.21 (probably irrelevant) have equal probability of selection.

### Solution

Replace uniform random sampling with weighted sampling that biases toward better serendipity candidates.

### Implementation

Three biasing factors, combined into a selection weight:

**A. Score proximity to threshold (strongest signal):**
Articles closer to the LLM threshold are more likely to be near-misses worth evaluating.

```typescript
// Normalize score position within the serendipity range [min, max]
const range = serendipityMax - serendipityMin;
const position = (score - serendipityMin) / range;  // 0.0 at floor, 1.0 at threshold
const proximityWeight = Math.pow(position, 2);  // Quadratic bias toward threshold
```

**B. Interest diversity:**
Prefer articles whose best-matching interest is underrepresented in the current LLM candidate set.

```typescript
// Count how many LLM candidates already match each interest
const interestCoverage = new Map<string, number>();
for (const candidate of llmCandidates) {
  const bestInterest = getBestMatchingInterest(candidate);
  interestCoverage.set(bestInterest, (interestCoverage.get(bestInterest) || 0) + 1);
}

// Articles matching underrepresented interests get a boost
const bestInterest = getBestMatchingInterest(article);
const coverage = interestCoverage.get(bestInterest) || 0;
const diversityWeight = 1.0 / (1 + coverage);  // Less coverage = higher weight
```

**C. Source diversity:**
Prefer articles from sources that haven't contributed many candidates yet.

```typescript
const sourceCoverage = new Map<string, number>();
// ... same pattern as interest diversity
const sourceWeight = 1.0 / (1 + sourceCoverage.get(article.sourceId) || 0);
```

**Combined selection weight:**

```typescript
const selectionWeight = (0.5 * proximityWeight) + (0.3 * diversityWeight) + (0.2 * sourceWeight);
```

Use weighted random sampling (roulette wheel selection) to pick `serendipity_sample_size` articles from the pool using these weights.

**Cost:** Zero — pure math on data already computed.

---

## 7. Semantic Deduplication

### Problem

The same story from multiple sources (Ars Technica, The Verge, a tech blog) can all appear in a digest with different titles. Title-based dedup doesn't catch these.

### Solution

After embedding generation, compare article embeddings pairwise within each ingestion batch. If two articles have cosine similarity above a high threshold (0.85+), they're about the same topic — keep the one from the more relevant source and mark the other as a duplicate.

### Implementation

Add a dedup step after article embeddings are generated and before per-user scoring:

```typescript
async function semanticDedup(articles: ArticleWithEmbedding[], threshold: number = 0.85): Promise<{
  kept: ArticleWithEmbedding[];
  duplicates: Array<{ article: ArticleWithEmbedding; duplicateOf: string }>;
}> {
  const kept: ArticleWithEmbedding[] = [];
  const duplicates: Array<{ article: ArticleWithEmbedding; duplicateOf: string }> = [];

  for (const article of articles) {
    let isDuplicate = false;
    for (const existing of kept) {
      const similarity = cosineSimilarity(article.embedding, existing.embedding);
      if (similarity >= threshold) {
        duplicates.push({ article, duplicateOf: existing.id });
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      kept.push(article);
    }
  }

  return { kept, duplicates };
}
```

**Which duplicate to keep:** The first article encountered wins (which depends on ingestion order). A smarter approach: prefer articles with longer `raw_content` (more substance), or from sources with higher historical feedback scores. For v1, keeping the first encountered is fine.

**Scope:** Only compare articles within the same ingestion batch (not against all historical articles). This keeps the comparison set small and avoids false positives against old articles on similar but distinct topics.

**Threshold:** Default 0.85. Store as a setting: `semantic_dedup_threshold`. This should be conservative — 0.85 similarity with 512-dimension embeddings indicates very high topical overlap.

**Logging:** Log deduplicated articles in the ingestion log so the admin can verify it's working correctly:

```json
{
  "semantic_dedup": {
    "articles_compared": 156,
    "duplicates_found": 8,
    "pairs": [
      { "kept": "Article Title A (Ars Technica)", "removed": "Article Title B (The Verge)", "similarity": 0.91 }
    ]
  }
}
```

**Database:** Mark deduplicated articles so they don't get scored:

```sql
ALTER TABLE articles ADD COLUMN is_semantic_duplicate BOOLEAN DEFAULT FALSE;
ALTER TABLE articles ADD COLUMN duplicate_of TEXT REFERENCES articles(id);
```

Articles marked as semantic duplicates are skipped during per-user scoring.

**Cost:** Zero — uses existing embeddings, pure math. The O(n²) comparison is fine for batches of a few hundred articles. If batches ever grow to thousands, optimize with approximate nearest neighbor search, but that's not needed at current scale.

---

## 8. Excluded Topics (Negative Interests)

### Problem

Users have no way to tell the embedding layer "I don't want to see articles about X." Negative signals only exist at the LLM layer (via learned preferences), which means unwanted articles still consume LLM tokens before being filtered out.

### Solution

Allow users to define excluded topics with their own embeddings. During embedding scoring, if an article's similarity to any excluded topic exceeds a penalty threshold, reduce its score or skip it entirely.

### Data Model

```sql
CREATE TABLE exclusions (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT,
  expanded_description TEXT,  -- LLM-expanded, same as interests
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_exclusions_user ON exclusions(user_id);
```

Exclusions get embeddings stored in the existing `embeddings` table with `ref_type = 'exclusion'`.

When an exclusion is created/updated:
1. Run the same LLM expansion as interests (improvement #1) to generate `expanded_description`
2. Generate and store an embedding from the expanded description

### Scoring Integration

During the embedding scoring step, after computing the positive interest score, check against exclusions:

```typescript
// After computing blended interest score...
let penaltyMultiplier = 1.0;

for (const exclusion of userExclusions) {
  const similarity = cosineSimilarity(articleEmbedding, exclusion.embedding);
  if (similarity >= exclusionThreshold) {  // default 0.40
    // Apply penalty proportional to how strongly it matches the exclusion
    // similarity of 0.40 = mild penalty, 0.60+ = heavy penalty
    const penaltyStrength = (similarity - exclusionThreshold) / (1.0 - exclusionThreshold);
    penaltyMultiplier = Math.min(penaltyMultiplier, 1.0 - (penaltyStrength * 0.8));
    // At similarity 0.40: multiplier ~1.0 (no penalty)
    // At similarity 0.60: multiplier ~0.67
    // At similarity 0.80: multiplier ~0.33
  }
}

const finalEmbeddingScore = blendedScore * penaltyMultiplier;
```

This doesn't hard-block articles — it reduces their score so they're less likely to pass the LLM threshold. Strongly excluded articles will score too low to make it to the LLM, saving tokens. Mildly excluded articles might still pass if they also strongly match a positive interest, which is the right behavior (an article about "blockchain applications in civic government" might match both a "crypto" exclusion and a "civic tech" interest — the positive interest should win if strong enough).

### Settings

```
exclusion_penalty_threshold` (default 0.40) — stored in settings table
```

### Frontend: Settings — Exclusions

Add a section to the settings page, either as a tab or below the interest manager:

```
Excluded Topics
────────────────────────────────────────────
Topics you don't want to see in your digest.

Cryptocurrency / Blockchain
  "Crypto trading, NFTs, DeFi, Bitcoin price speculation"
  [Edit] [Delete]

Celebrity Entertainment
  "Celebrity gossip, entertainment news, pop culture drama"
  [Edit] [Delete]

[+ Add Exclusion]
```

The add/edit form is identical to adding an interest: category name + optional description. The LLM expansion and embedding generation happen on save.

### API Routes

```
GET    /api/exclusions         — List exclusions for current user
POST   /api/exclusions         — Create exclusion (triggers expansion + embedding)
PUT    /api/exclusions/[id]    — Update exclusion (re-expand + re-embed)
DELETE /api/exclusions/[id]    — Delete exclusion and its embedding
```

### Cost

Same as interests: one LLM call per exclusion creation/edit for expansion. Negligible.

---

## 9. Feedback-Weighted Source Scoring

### Problem

Some sources consistently produce content the user likes; others consistently produce content they dislike. The scoring system treats all sources equally.

### Solution

Compute a per-user source trust factor based on historical feedback, and apply it as a multiplier during embedding scoring.

### Implementation

Calculate the trust factor from the user's feedback history:

```typescript
async function computeSourceTrustFactor(userId: string, sourceId: string): Promise<number> {
  // Query: for this user, for articles from this source,
  // count liked, neutral, disliked over the last 60 days
  const stats = await getSourceFeedbackStats(userId, sourceId, 60);

  if (stats.total < 5) return 1.0;  // Not enough data, neutral

  // Compute a score from -1 (all disliked) to +1 (all liked)
  // liked = +1, neutral = 0, disliked = -1
  const sentimentScore = (stats.liked - stats.disliked) / stats.total;

  // Map to a trust multiplier range of 0.8 to 1.2
  // sentimentScore of -1 → 0.8 (20% penalty)
  // sentimentScore of 0  → 1.0 (neutral)
  // sentimentScore of +1 → 1.2 (20% boost)
  return 1.0 + (sentimentScore * 0.2);
}
```

Apply during embedding scoring:

```typescript
const sourceTrust = await getSourceTrustFactor(userId, article.sourceId);
const finalEmbeddingScore = blendedScore * penaltyMultiplier * sourceTrust;
```

### Caching

Don't compute trust factors on every scoring run. Cache them and recompute weekly (during the same Sunday analysis window as affinity mapping):

```sql
CREATE TABLE source_trust (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  trust_factor REAL DEFAULT 1.0,
  sample_size INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, source_id)
);
```

During scoring, read from the cache. On Sundays (alongside affinity analysis), recompute all trust factors.

### Trust Factor Visibility

Show source trust factors in the source manager UI as a subtle indicator:

```
Sources
────────────────────────────────────
Ars Technica           ●●●●○  (mostly liked)
r/LocalLLaMA           ●●●●●  (highly liked)
Dallas Morning News    ●●●○○  (mixed)
Some Blog              ●●○○○  (mostly disliked)
```

Use a simple 5-dot or 5-bar indicator based on the trust factor. This helps users see which sources are working for them and which aren't.

### Cost

Zero — computed from existing feedback data.

---

## Pipeline Integration Order

After all improvements, the scoring pipeline becomes:

```
1. Fetch articles (unchanged)
2. Prefilter — spam, short titles, stale, exact title dedup (unchanged)
3. Embed articles (unchanged)
4. Semantic deduplication (NEW — improvement #7)
5. Per-user scoring:
   a. Load interest embeddings (with expanded descriptions — improvement #1)
   b. Load exclusion embeddings (NEW — improvement #8)
   c. Load source trust factors (NEW — improvement #9)
   d. Compute weight-adjusted, multi-interest blended scores (improvements #2 + #5)
   e. Apply exclusion penalties (improvement #8)
   f. Apply source trust multiplier (improvement #9)
   g. Route by threshold (unchanged logic, updated scores)
   h. Smart serendipity sampling (improvement #6)
   i. LLM scoring with article content (improvement #3)
   j. Generate digest (unchanged)
6. If Sunday: run interest affinity analysis (improvement #4)
7. If Sunday: recompute source trust factors (improvement #9)
```

---

## Settings Summary

New settings to add to the `settings` table (global, admin-managed):

| Key | Default | Description |
|-----|---------|-------------|
| `blended_primary_weight` | `0.7` | Weight for best-match interest in blended score |
| `blended_secondary_weight` | `0.3` | Weight for multi-interest average in blended score |
| `semantic_dedup_threshold` | `0.85` | Cosine similarity threshold for deduplication |
| `exclusion_penalty_threshold` | `0.40` | Minimum similarity to an exclusion before penalty applies |
| `affinity_analysis_day` | `0` | Day of week (0=Sunday) to run affinity analysis |
| `source_trust_min` | `0.8` | Minimum trust factor (floor) |
| `source_trust_max` | `1.2` | Maximum trust factor (ceiling) |

Add these to the Scoring Pipeline section of the admin settings panel.

---

## Database Changes Summary

### New tables:
- `interest_suggestions` — Suggested interests from affinity analysis
- `exclusions` — Per-user excluded topics
- `source_trust` — Cached per-user source trust factors

### Modified tables:
- `interests` — Add `expanded_description` column
- `articles` — Add `is_semantic_duplicate` and `duplicate_of` columns

### Embeddings table:
- Now also stores embeddings for `ref_type = 'exclusion'` (no schema change, just new data)

---

## Files to Create

- `src/lib/interest-expansion.ts` — LLM-based interest description expansion
- `src/lib/affinity.ts` — Interest affinity analysis (LLM prompt, suggestion generation)
- `src/lib/source-trust.ts` — Source trust factor computation and caching
- `src/lib/db/exclusions.ts` — Exclusion CRUD
- `src/lib/db/suggestions.ts` — Interest suggestion CRUD
- `src/lib/db/source-trust.ts` — Source trust cache CRUD
- `src/app/api/exclusions/route.ts` — GET/POST exclusions
- `src/app/api/exclusions/[id]/route.ts` — PUT/DELETE exclusion
- `src/app/api/suggestions/route.ts` — GET pending suggestions
- `src/app/api/suggestions/[id]/accept/route.ts` — Accept suggestion
- `src/app/api/suggestions/[id]/dismiss/route.ts` — Dismiss suggestion
- `src/components/ExclusionManager.tsx` — Excluded topics UI
- `src/components/InterestSuggestions.tsx` — Suggested interests section in interest manager
- `src/components/SuggestionBanner.tsx` — Subtle digest banner for pending suggestions
- `src/components/SourceTrustIndicator.tsx` — Trust factor visualization in source manager

## Files to Modify

### Database:
- `src/lib/db/schema.ts` — New tables, new columns, migration
- `src/types/index.ts` — New types: Exclusion, InterestSuggestion, SourceTrust; updated Interest type

### Pipeline:
- `src/lib/embeddings.ts` — Update `buildInterestEmbeddingText()` to use expanded description
- `src/lib/relevance/index.ts` — Integrate all scoring improvements into the pipeline, add Sunday analysis trigger
- `src/lib/relevance/scorer.ts` — Include article content in LLM prompt
- `src/lib/relevance/prefilter.ts` — Add semantic dedup step (or as a separate step after embedding)
- `src/lib/ingestion/index.ts` — Add semantic dedup after embedding generation
- `src/lib/ingestion/logger.ts` — Log semantic dedup results, affinity analysis, source trust updates

### Interests:
- `src/app/api/interests/route.ts` — Trigger LLM expansion on create
- `src/app/api/interests/[id]/route.ts` — Trigger re-expansion on update

### Frontend:
- `src/app/settings/page.tsx` — Add exclusions section, scoring settings panel
- `src/components/InterestManager.tsx` — Add suggested interests section at top
- `src/components/SourceManager.tsx` — Add trust factor indicators
- `src/app/digest/page.tsx` — Add suggestion banner
- `src/app/digest/[id]/page.tsx` — Add suggestion banner

---

## Implementation Priority

### Phase 1: Core Scoring Improvements (no new UI needed)
1. Weight-adjusted embedding scores (improvement #2) — trivial math change
2. Multi-interest blended scoring (improvement #5) — math change
3. Feed article content to LLM (improvement #3) — prompt update
4. Semantic deduplication (improvement #7) — new step in pipeline
5. Log score distribution changes and verify thresholds still work

### ⏸ STOP AFTER PHASE 1 — TESTING GATE

**Do not proceed to Phase 2 until the user has tested Phase 1.** The user has a script for previewing fetches and scoring without writing to the database. After implementing Phase 1:

1. Confirm all changes are complete and the build passes
2. Summarize what changed and how it affects scoring behavior
3. Tell the user: "Phase 1 is ready for testing. Run your preview script to compare score distributions before and after these changes. Once you're satisfied the weight adjustment, blended scoring, content inclusion, and semantic dedup are behaving correctly, let me know and I'll continue with Phase 2."
4. **Wait for the user to confirm before continuing.** Do not start Phase 2 proactively.

The reason for this gate: Phase 1 changes the fundamental score values that everything else depends on. The blended scoring and weight adjustments will shift the score distribution, which may require threshold tuning before stacking additional changes on top. It's much easier to diagnose scoring issues with only the math changes in play than after all nine improvements are live simultaneously.

### Phase 2: Richer Embeddings
6. Interest expansion LLM function
7. Add `expanded_description` column to interests
8. Update embedding text builder to use expanded descriptions
9. Migration script: expand all existing interests and regenerate their embeddings
10. Trigger expansion on interest create/update

### Phase 3: Excluded Topics
11. Create `exclusions` table and CRUD
12. Exclusion expansion + embedding generation
13. Integrate exclusion penalties into scoring pipeline
14. Exclusion manager UI in settings
15. Exclusion API routes

### Phase 4: Interest Affinity Mapping
16. Create `interest_suggestions` table
17. Build affinity analysis LLM prompt and runner
18. Sunday trigger in ingestion pipeline
19. Suggestion API routes
20. Suggested interests UI in interest manager
21. Suggestion banner in digest view

### Phase 5: Source Trust
22. Create `source_trust` table
23. Trust factor computation from feedback data
24. Sunday recomputation trigger
25. Integrate trust multiplier into scoring pipeline
26. Trust factor indicators in source manager UI

### Phase 6: Tuning & Settings
27. Add all new settings to admin panel
28. Run several ingestion cycles and compare score distributions before vs. after
29. Tune thresholds based on feedback patterns and analytics dashboard
