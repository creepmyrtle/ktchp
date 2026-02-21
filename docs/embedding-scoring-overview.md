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
- Remove titles < 10 characters
- Remove known spam domains
- Remove invalid URLs
- Exact title deduplication (case-insensitive)
- Remove articles older than 14 days

### Step 2: Ensure interest embeddings exist
Load all interest embeddings from DB. For any interest without one, generate and store it on the fly.

### Step 3: Compute embedding scores
For each article that survived prefiltering:

```
score = MAX(cosineSimilarity(articleEmbedding, interestEmbedding))
        across ALL user interests
```

Key behaviors:
- Each article gets a single score = its **best match** against any interest
- Interest weights are **not used** — all interests are treated equally
- Articles **without embeddings** (e.g., embedding generation failed) get score `1.0` (always sent to LLM)
- Scores are persisted to `user_articles.embedding_score`

### Step 4: Route articles by score

| Score Range | Route | Count Cap |
|---|---|---|
| `≥ 0.35` (LLM threshold) | Sent to LLM for full scoring | Top 40 by score |
| `0.20 – 0.35` (serendipity range) | Random sample sent to LLM | 5 random (Fisher-Yates shuffle) |
| `< 0.20` (floor) | Skipped entirely | — |

All thresholds are configurable via the `settings` table:
- `embedding_llm_threshold` (default 0.35)
- `embedding_serendipity_min` (default 0.20)
- `embedding_serendipity_max` (default 0.35)
- `serendipity_sample_size` (default 5)
- `max_llm_candidates` (default 40)

### Step 5: LLM scoring (Stage 2)
Articles routed to the LLM receive the full scoring treatment:
- **Input to LLM**: article title + URL only (no raw_content, no embedding text)
- **Context given to LLM**: user interests (with weights and descriptions), learned preferences, recent feedback patterns
- **Output from LLM**: relevance_score (0.0–1.0), relevance_reason, is_serendipity flag
- **Batch size**: 10 articles per LLM call
- **LLM**: Kimi K2.5 via Synthetic API (OpenAI-compatible)

### Step 6: Fallback scoring for non-LLM articles
Articles that were NOT sent to the LLM (scored below 0.35 and not randomly selected for serendipity) still get a relevance score:
- Their **embedding similarity** (max across interests) becomes their relevance score
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

1. **No interest weighting in embeddings**: A weight-1.0 interest and a weight-0.2 interest contribute equally to an article's embedding score. Weights only matter at the LLM stage.

2. **Max-only similarity**: An article's score is its best single-interest match. There's no consideration of how many interests it matches, or average similarity.

3. **Fixed embedding text**: Article embedding text is `title + first 500 chars of content`. There's no adaptive windowing, no extraction of key sentences, no consideration of article structure.

4. **Interest embedding text is minimal**: Just `"category: description"` — often a few words total. This gives the embedding limited semantic range to match against.

5. **Binary routing**: An article either goes to the LLM or it doesn't (aside from serendipity sampling). There's no "medium confidence" path.

6. **No negative signals**: There's no way to embed "things the user doesn't want" — learned preferences like "Skip opinion pieces" only exist at the LLM layer.

7. **No cross-article deduplication by embedding**: Title dedup is exact-match only. Semantically similar articles from different sources can both make it through.

8. **Serendipity is random**: The serendipity pool is a random sample, not intelligently selected. An article at 0.34 (just below threshold) and one at 0.21 (near floor) have equal chance.

---

The key tension is **cost vs. accuracy** — embeddings are ~100x cheaper than LLM calls, so any improvements that keep more intelligence in the embedding layer save real money.
