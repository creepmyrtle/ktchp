# ktchp — Hybrid Embedding + LLM Scoring Pipeline

## Overview

Replace the current "score every article with the LLM" pipeline with a two-stage hybrid approach:

1. **Stage 1 — Embedding Pre-Filter (cheap, fast)**: Generate vector embeddings for articles and user interests. Compute cosine similarity to quickly identify which articles are potentially relevant to each user. This filters out the ~60-80% of articles that are obviously irrelevant.

2. **Stage 2 — LLM Refinement (expensive, nuanced)**: Send only the top embedding-matched candidates to the LLM for final scoring, serendipity detection, relevance reason tags, and summaries (when enabled).

The goal is to cut LLM API costs by 60-80% while maintaining (or improving) digest quality. The LLM still does the high-value work — nuanced judgment, serendipity, explainability — but stops wasting tokens on articles that a simple semantic check can reject.

---

## New Dependency: OpenAI Embeddings API

Use OpenAI's `text-embedding-3-small` model for generating embeddings. It's the best balance of cost, quality, and simplicity.

- **Cost**: ~$0.02 per 1M tokens. At ~200 articles/day with title + snippet, that's roughly 50-80K tokens per ingestion run → ~$0.002 per run → ~$2/year.
- **Dimensions**: 1536 by default. Can be reduced to 512 or 256 for storage savings with minor quality loss. **Use 512 dimensions** — it's a good balance for this use case.
- **Rate limits**: Generous on even the free tier. Not a concern at this scale.

### Environment Variable

```
OPENAI_API_KEY=sk-...    # For embeddings only (scoring still uses Kimi/synthetic)
```

Add this to the env vars table in the README.

### Client Setup

Create a lightweight OpenAI embedding client. Do NOT use the full OpenAI SDK — just make a fetch call to keep dependencies minimal:

```typescript
// lib/embeddings.ts
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: texts,
      dimensions: 512,
    }),
  });
  const data = await response.json();
  return data.data.map((item: any) => item.embedding);
}
```

The API accepts batches of up to 2048 texts per call. Batch aggressively — send all articles in one or two calls rather than one per article.

---

## Database Changes

### New Table: `embeddings`

Store embeddings for articles and user interests. Use a single table with a `type` discriminator.

```sql
CREATE TABLE embeddings (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  ref_type TEXT NOT NULL CHECK (ref_type IN ('article', 'interest')),
  ref_id TEXT NOT NULL,          -- article.id or interest.id
  embedding_text TEXT NOT NULL,   -- the input text that was embedded (for debugging/recomputation)
  embedding VECTOR(512),          -- the embedding vector (if using pgvector)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ref_type, ref_id)
);

CREATE INDEX idx_embeddings_ref ON embeddings(ref_type, ref_id);
```

#### pgvector vs. JSON Storage — IMPORTANT: Try pgvector First

**You MUST attempt to use pgvector before falling back to JSON storage.** Neon (which powers Vercel Postgres) supports pgvector natively. pgvector is the strongly preferred approach because it enables cosine similarity to be computed in SQL, which is faster, cleaner, and sets the project up for future scaling.

**Step 1: Try enabling pgvector.**

During schema initialization, attempt to enable the extension:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

If this succeeds, use the `vector(512)` column type for embeddings and compute cosine similarity in SQL:

```sql
-- Cosine similarity via pgvector (lower distance = more similar)
-- The <=> operator returns cosine distance, so similarity = 1 - distance
SELECT 1 - (a.embedding <=> b.embedding) AS similarity
FROM embeddings a, embeddings b
WHERE a.ref_type = 'article' AND b.ref_type = 'interest';
```

Log a message confirming pgvector is active: `"pgvector extension enabled — using native vector storage"`.

**Step 2: Only if pgvector fails, fall back to JSONB storage.**

If `CREATE EXTENSION vector` fails (e.g., permission denied, extension not available), catch the error and fall back:

```sql
-- Fallback: store as JSONB array
embedding_json JSONB NOT NULL  -- instead of VECTOR column
```

```typescript
// Application-level cosine similarity (fallback only)
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

Log a warning: `"pgvector not available — falling back to JSONB storage with application-level similarity"`.

**Step 3: Abstract the storage layer.**

The rest of the application should not know which storage backend is in use. Create a helper module (`lib/embeddings.ts`) that exposes functions like `storeEmbedding()`, `getEmbedding()`, and `computeSimilarity()` that work with either backend. Detect which backend is active once at startup (check if the `vector` extension exists) and route accordingly.

At 512 dimensions and a few hundred articles, the JSONB fallback is fast enough (< 50ms for all comparisons). But pgvector is the better path and should be the default.

### New Column on `user_articles`

Add a column to store the embedding similarity score alongside the existing LLM relevance score:

```sql
ALTER TABLE user_articles ADD COLUMN embedding_score REAL;
```

This lets you see both scores in logs and potentially in the UI, and it's useful for tuning thresholds.

---

## Interest Embedding Generation

Each user's interests need embeddings. Generate them:

1. **On interest creation/update**: When a user adds or edits an interest, generate an embedding for it and store/update in the `embeddings` table.
2. **Input text**: Concatenate the interest category name and description: `"AI / LLMs / Local Models: Artificial intelligence, large language models, running models locally, GPU hardware for inference, tools like Ollama and LM Studio"`
3. **Batch on change**: If a user updates multiple interests at once, batch the embedding calls.

### API Route Updates

Update `POST /api/interests` and `PUT /api/interests/[id]` to generate and store embeddings after creating/updating the interest. This can happen asynchronously (fire and forget) since embeddings aren't needed until the next ingestion run.

Delete the embedding row when an interest is deleted.

---

## Updated Ingestion Pipeline

The pipeline changes from:

```
Fetch → Prefilter → LLM Score (all articles, per user) → Generate Digest
```

To:

```
Fetch → Prefilter → Embed Articles → Embedding Score (per user) → LLM Score (top candidates only, per user) → Generate Digest
```

### Step-by-step:

#### 1. Fetch (unchanged)
Fetch all sources, deduplicate, store raw articles.

#### 2. Prefilter (unchanged)
Remove spam, short titles, stale articles, duplicates.

#### 3. Embed Articles (NEW)
For all new articles that passed the prefilter and don't already have an embedding:

- Construct the embedding input text for each article: `"{title}. {raw_content or first 500 chars of description}"`. Include both title and content for better semantic representation.
- Batch all articles into one or two OpenAI embedding API calls.
- Store the embeddings in the `embeddings` table.
- **This only happens once per article** — the embedding is shared across all users.

#### 4. Embedding Score — Per User (NEW)
For each active user:

1. Get the user's interest embeddings from the `embeddings` table.
2. Get the article embeddings for all new articles from sources the user subscribes to.
3. For each article, compute cosine similarity against every user interest embedding.
4. The article's embedding score = **maximum similarity across all interests** (the best-matching interest determines relevance).
5. Store the embedding score on the `user_articles` row.

```typescript
for (const article of newArticles) {
  let maxSimilarity = 0;
  let bestMatchInterest = null;

  for (const interest of userInterests) {
    const similarity = cosineSimilarity(article.embedding, interest.embedding);
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      bestMatchInterest = interest;
    }
  }

  // Store embedding_score on user_articles
  await setEmbeddingScore(userId, article.id, maxSimilarity);
}
```

#### 5. Select LLM Candidates (NEW)
From the embedding-scored articles, select which ones to send to the LLM:

- **Above LLM threshold**: Articles with embedding_score >= `EMBEDDING_LLM_THRESHOLD` (default: 0.35). These are the candidates worth the LLM's attention.
- **Cap per user**: Maximum `MAX_LLM_CANDIDATES` articles per user (default: 40). If more articles pass the threshold, take the top N by embedding score.
- **Serendipity pool**: Additionally, take a small random sample (3-5) of articles that scored *below* the threshold but above a minimum floor (e.g., 0.20-0.35 range). These are the serendipity candidates — articles the embeddings say aren't relevant but might be. The LLM gets final say on whether they're actually serendipitous.

This is how serendipity survives the embedding pre-filter: we explicitly send a few "maybe not relevant" articles to the LLM and ask it to evaluate them for unexpected value.

#### 6. LLM Score — Top Candidates Only (modified)
Send only the selected candidates to the LLM, using the existing scoring prompt and batch logic. The prompt and response format stay the same. The only change is that the input set is smaller.

Include a note in the prompt for the serendipity pool articles:

```
The following articles did not score highly on topic similarity but are included 
as serendipity candidates. Evaluate whether they would be unexpectedly valuable 
to this user due to cross-domain connections, emerging trends, or adjacent relevance. 
Score them honestly — most will score low, but flag any genuine discoveries.
```

#### 7. Generate Digest (slightly modified)
Same as before, but now articles have both an `embedding_score` and a `relevance_score` (from LLM). The digest selection uses `relevance_score` as the primary sort (since the LLM has already filtered down to quality candidates).

Articles that passed the embedding threshold but weren't sent to the LLM (if any remain due to the cap) can optionally be included in the digest using their embedding_score as a fallback relevance score — but this should be rare if the cap is set reasonably.

---

## Threshold Tuning

The embedding similarity threshold is the most important tunable parameter. Too high and you miss relevant articles; too low and you defeat the purpose of the pre-filter.

### Recommended Starting Values

| Setting | Default | Description |
|---------|---------|-------------|
| `EMBEDDING_LLM_THRESHOLD` | 0.35 | Minimum embedding score to send to LLM |
| `EMBEDDING_SERENDIPITY_MIN` | 0.20 | Floor for serendipity candidate pool |
| `EMBEDDING_SERENDIPITY_MAX` | 0.35 | Ceiling for serendipity pool (= LLM threshold) |
| `SERENDIPITY_SAMPLE_SIZE` | 5 | Number of random serendipity candidates per user |
| `MAX_LLM_CANDIDATES` | 40 | Max articles sent to LLM per user |

Store these in the `settings` table as global settings (user_id = NULL) so they can be tuned from the admin panel without redeploying.

### Calibration Logging

During the embedding scoring step, log the distribution of embedding scores:

```json
{
  "embedding_scoring": {
    "user_joe": {
      "total_articles": 180,
      "score_distribution": {
        "0.0-0.1": 45,
        "0.1-0.2": 52,
        "0.2-0.3": 38,
        "0.3-0.4": 22,
        "0.4-0.5": 12,
        "0.5-0.6": 7,
        "0.6+": 4
      },
      "above_llm_threshold": 45,
      "sent_to_llm": 40,
      "serendipity_candidates": 5
    }
  }
}
```

This helps you tune the threshold over time. If 80% of articles are above threshold, it's too low. If only 5% are above, it's too high.

### Admin UI

Add a section to the admin panel for embedding/scoring settings:

```
Scoring Pipeline
─────────────────────────────────────────
Embedding → LLM threshold:      [0.35]
Serendipity pool range:         [0.20] to [0.35]
Serendipity sample size:        [5]
Max LLM candidates per user:    [40]
─────────────────────────────────────────
```

---

## Ingestion Logs Updates

The ingestion log structure should reflect the new two-stage pipeline. Update the per-user scoring section:

```json
{
  "fetch": { "...": "unchanged" },
  "prefilter": { "...": "unchanged" },
  "embedding": {
    "articles_embedded": 156,
    "embedding_api_calls": 1,
    "embedding_tokens": 62000,
    "embedding_time_ms": 1200
  },
  "scoring": {
    "user_joe": {
      "articles_from_sources": 156,
      "embedding_scored": 156,
      "above_embedding_threshold": 38,
      "serendipity_candidates": 5,
      "sent_to_llm": 40,
      "llm_calls": 2,
      "llm_input_tokens": 15000,
      "llm_output_tokens": 3800,
      "digest_created": true,
      "digest_article_count": 18
    },
    "user_friend1": {
      "...": "same structure"
    }
  }
}
```

---

## Files to Create

- `src/lib/embeddings.ts` — OpenAI embedding client (batch generation, single generation), cosine similarity function, embedding storage/retrieval helpers

## Files to Modify

### Database:
- `src/lib/db/schema.ts` — Add `embeddings` table, add `embedding_score` column to `user_articles`, add pgvector extension if available
- `src/types/index.ts` — Add Embedding type, update UserArticle type with embedding_score

### Pipeline:
- `src/lib/relevance/index.ts` — Add embedding scoring stage between prefilter and LLM scoring, implement candidate selection logic
- `src/lib/relevance/scorer.ts` — Modify to accept a pre-filtered candidate list instead of all articles, add serendipity pool note to prompt
- `src/lib/relevance/prefilter.ts` — No changes needed (runs before embeddings)
- `src/lib/ingestion/index.ts` — Add article embedding generation after prefilter, before per-user scoring
- `src/lib/ingestion/logger.ts` — Add embedding stage logging

### Interests:
- `src/app/api/interests/route.ts` — Generate embedding on interest creation
- `src/app/api/interests/[id]/route.ts` — Regenerate embedding on interest update, delete on interest deletion
- `src/lib/db/interests.ts` — Add helpers for embedding lifecycle tied to interest CRUD

### Settings:
- `src/app/api/settings/route.ts` — Support new threshold settings
- `src/app/settings/page.tsx` — Add scoring pipeline section to admin panel (threshold controls)

### Config:
- `src/lib/config.ts` — Add OPENAI_API_KEY, default threshold values

---

## Implementation Priority

### Phase 1: Embedding Infrastructure
1. Create `lib/embeddings.ts` with OpenAI client, batch generation, cosine similarity, and storage helpers
2. Add `embeddings` table to schema (try pgvector first, fall back to JSONB)
3. Add `embedding_score` to `user_articles`
4. Update types

### Phase 2: Interest Embeddings
5. Generate embeddings on interest create/update/delete
6. Write a one-time script or migration to generate embeddings for all existing interests

### Phase 3: Pipeline Integration
7. Add article embedding generation to ingestion (after prefilter, before per-user scoring)
8. Implement per-user embedding scoring (cosine similarity against interest embeddings)
9. Implement candidate selection (threshold + serendipity pool)
10. Wire selected candidates into existing LLM scoring (modify scorer to accept pre-filtered list)

### Phase 4: Logging & Tuning
11. Update ingestion logs with embedding stage details and score distributions
12. Add threshold settings to admin panel
13. Seed default threshold values in settings table

### Phase 5: Verification
14. Run a full ingestion with the new pipeline and compare results against a pure-LLM run
15. Verify embedding scores correlate reasonably with LLM scores for the articles that go through both stages
16. Tune thresholds based on the score distribution logs

---

## Implementation Notes

1. **Article embedding is shared, not per-user.** Each article gets embedded once and that embedding is reused for all users. Only the similarity computation (article embedding vs. user interest embeddings) is per-user, and that's just math — no API calls.

2. **Embedding text matters.** Use `"{title}. {raw_content_first_500_chars}"` as the input. Title alone is too sparse; full content is wasteful. The first 500 characters of content usually contain the lede and key topics.

3. **Don't re-embed existing articles.** On each ingestion run, only embed articles that don't already have an embedding. Check the `embeddings` table before calling the API.

4. **Interest embedding invalidation.** When a user edits an interest's name or description, the old embedding is stale. Delete and regenerate. When weight changes but text doesn't change, no re-embedding needed — weight is applied during scoring, not embedding.

5. **Graceful fallback.** If the OpenAI embedding API is down or returns an error, fall back to sending all articles to the LLM (the old behavior). Log a warning. Don't let an embedding failure block digest generation.

6. **Cosine similarity range.** For `text-embedding-3-small`, similarity scores between unrelated texts typically fall in the 0.1-0.3 range, and related texts score 0.3-0.6+. Very high scores (0.7+) indicate near-identical topics. This is why the default LLM threshold is 0.35 — it's roughly the boundary between "unrelated" and "possibly related."
