# Ketchup — Embedding Scoring System Overview

## High-Level Architecture

Ketchup uses a **two-stage scoring pipeline** to determine article relevance for each user:

1. **Embedding pre-filter** (cheap, fast) — cosine similarity between article and interest embeddings
2. **LLM scoring** (expensive, accurate) — only for articles that pass the embedding threshold

This means embeddings act as a gate to control cost: most articles are filtered out before the LLM ever sees them.

---

## Embedding Model & Parameters

- **Model**: OpenAI `text-embedding-3-small`
- **Dimensions**: 512 (reduced from default 1536)
- **Batch size**: Up to 2048 texts per API call
- **Storage**: pgvector (native `vector` type) with JSONB fallback
- **Similarity**: Application-level cosine similarity (dot product / magnitude product)

---

## What Gets Embedded

### Articles
- **When**: During ingestion, immediately after an article is stored in the DB
- **Text formula**: `"{title}. {raw_content first 500 chars}"` (or just title if no content)
- **Lifecycle**: Embeddings are pruned after 7 days to save storage. This means scoring must happen within 7 days of ingestion.
- **Source**: `buildArticleEmbeddingText(title, rawContent)` in `embeddings.ts:199`

### Interests
- **When**: On-demand during scoring — if an interest doesn't have an embedding yet, one is generated
- **Text formula**: `"{category}: {description}"` (or just category if no description)
- **Lifecycle**: Kept permanently (never pruned)
- **Source**: `buildInterestEmbeddingText(category, description)` in `embeddings.ts:193`

### What is NOT embedded
- **User preferences** (learned behavioral patterns like "prefers long-form content") — these go to the LLM only
- **Interest weights** (0.0–1.0 user-assigned priority) — these go to the LLM only
- **Article URLs** — not in the embedding text
- **Article summaries** — not used (summaries don't exist at embedding time)

---

## Scoring Flow (per user)

### Step 0: Identify unscored articles
Query `user_articles` for articles from the user's enabled sources that haven't been scored yet.

### Step 1: Prefilter (non-embedding)
Before any embedding work, articles are filtered by `prefilterArticles()`:
- Remove titles < 4 characters (genuinely broken data)
- Remove known spam domains (exact domain match — `bit.ly`, `t.co`, `tinyurl.com`)
- Remove invalid URLs
- Exact title deduplication (case-insensitive)
- Remove articles older than 14 days (for new users <14 days old, the window extends to 14 days before their account creation date)

### Step 2: Ensure interest embeddings exist
Load all interest embeddings from DB. For any interest without one, generate and store it on the fly.

### Step 3: Compute embedding scores
For each article that survived prefiltering:

```
weightedSimilarity = cosineSimilarity(articleEmbedding, interestEmbedding) × interest.weight
blendedScore = 0.7 × primary (top match) + 0.3 × secondary (avg of top 3)
finalScore = blendedScore × exclusionPenalty × sourceTrustMultiplier
```

Key behaviors:
- Each article gets a **blended** score across multiple matching interests (configurable primary/secondary weights)
- Interest weights **are used** — similarity is multiplied by the interest's weight (0.0–1.0). Zero-weight interests are skipped
- Exclusion penalties reduce scores for articles matching excluded topics (graduated, up to 80% reduction)
- Source trust multipliers adjust scores based on per-source feedback history (0.8–1.2 range)
- Articles **without embeddings** (e.g., embedding generation failed) get score `1.0` (always sent to LLM)
- Scores are persisted to `user_articles.embedding_score`

### Step 4: Route articles by score

| Score Range | Route | Count Cap |
|---|---|---|
| `≥ LLM threshold` | Sent to LLM for full scoring | Top N by score |
| `serendipity min – max` | Weighted sample sent to LLM | Sample size (weighted roulette) |
| `< serendipity min` | Skipped entirely | — |

All thresholds are configurable via the admin scoring settings panel (Settings → Admin → Scoring):
- `embedding_llm_threshold` — minimum blended score to send to LLM
- `embedding_serendipity_min` — floor for serendipity pool
- `embedding_serendipity_max` — ceiling for serendipity pool
- `serendipity_sample_size` — how many serendipity candidates to sample
- `max_llm_candidates` — max articles sent to LLM per user

### Step 5: LLM scoring (Stage 2)
Articles routed to the LLM receive the full scoring treatment:
- **Input to LLM**: article title, content snippet (first 500 chars of `raw_content`), and URL
- **Context given to LLM**: user interests (with weights and expanded descriptions), learned preferences, recent feedback patterns
- **Output from LLM**: relevance_score (0.0–1.0), relevance_reason, is_serendipity flag
- **Batch size**: 10 articles per LLM call
- **LLM**: Kimi K2.5 via Synthetic API (OpenAI-compatible)

### Step 6: Fallback scoring for non-LLM articles
Articles that were NOT sent to the LLM (scored below the LLM threshold and not selected for serendipity) still get a relevance score:
- Their **blended embedding score** (weight-adjusted, multi-interest blended) becomes their relevance score
- Reason is set to `"Embedding score (not sent to LLM)"`
- `is_serendipity = false`

This means every article ends up with a relevance score, regardless of whether it went through the LLM.

---

## Digest Generation

After all articles are scored, a digest is assembled:

| Tier | Criteria | Cap |
|---|---|---|
| **Recommended** | `relevance_score ≥ 0.5` (configurable `MIN_RELEVANCE_SCORE`) AND not serendipity | No cap |
| **Serendipity** | `is_serendipity = true` AND `relevance_score ≥ 0.4` | Max 2 |
| **Bonus** | `relevance_score ≥ 0.15` AND below main threshold | Max 50 |

---

## Score Distribution Logging

The system logs a histogram of embedding scores per run:
```
{ "0.0-0.1": N, "0.1-0.2": N, "0.2-0.3": N, "0.3-0.4": N, "0.4-0.5": N, "0.5-0.6": N, "0.6+": N }
```

---

## Current Limitations & Design Choices

1. ~~**No interest weighting in embeddings**~~ — **Resolved.** Embedding scores are now weight-adjusted (`similarity × interest.weight`).

2. ~~**Max-only similarity**~~ — **Resolved.** Blended scoring combines the top match (70%) with the average of the top 3 matches (30%).

3. **Fixed embedding text**: Article embedding text is `title + first 500 chars of content`. There's no adaptive windowing, no extraction of key sentences, no consideration of article structure.

4. ~~**Interest embedding text is minimal**~~ — **Partially resolved.** Interest descriptions are now auto-expanded via LLM to 150–200 words covering related concepts and terminology.

5. **Binary routing**: An article either goes to the LLM or it doesn't (aside from serendipity sampling). There's no "medium confidence" path.

6. ~~**No negative signals**~~ — **Partially resolved.** Excluded topics are embedded and applied as graduated penalties at the embedding stage. Learned preferences still only exist at the LLM layer.

7. ~~**No cross-article deduplication by embedding**~~ — **Resolved.** Semantic deduplication flags near-identical articles (cosine similarity > 0.85) during ingestion.

8. ~~**Serendipity is random**~~ — **Resolved.** Serendipity uses weighted sampling: proximity to interests (50%), interest diversity (30%), source diversity (20%).

---

The key tension is **cost vs. accuracy** — embeddings are ~100x cheaper than LLM calls, so any improvements that keep more intelligence in the embedding layer save real money.
