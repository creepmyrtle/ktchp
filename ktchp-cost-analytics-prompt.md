# ktchp — Cost Analytics Dashboard

## Overview

Add a **Cost** section to the Analytics tab on the admin settings page. This dashboard gives the admin visibility into API costs — overall and broken down by user, source, and pipeline stage — so they can understand what behaviors are driving spend and make informed decisions about limits and thresholds.

---

## Cost Model

ktchp incurs API costs from two services:

| Service | Used For | Charged By | Scales With |
|---------|----------|------------|-------------|
| **OpenAI Embeddings** (`text-embedding-3-small`) | Article + interest embeddings | Input tokens | Article volume (shared, not per-user) |
| **LLM Scoring** (Kimi K2.5 via synthetic.new) | Relevance scoring, serendipity detection | Input + output tokens | Users × articles per user |

The LLM scoring cost is the dominant expense and is the primary focus of this dashboard.

### Cost Estimation

Since the APIs report token usage but not dollar amounts directly, compute estimated costs using stored rates:

| Service | Rate | Setting Key |
|---------|------|-------------|
| OpenAI Embeddings | $0.02 / 1M input tokens | `cost_rate_embedding` |
| LLM Scoring Input | Varies by provider — store the rate | `cost_rate_llm_input` |
| LLM Scoring Output | Varies by provider — store the rate | `cost_rate_llm_output` |

Store these rates in the `settings` table as global settings. The admin can update them if pricing changes or the LLM provider switches. Default values should be set during seeding based on current Kimi K2.5 pricing via synthetic.new.

```sql
-- Example settings
INSERT INTO settings (key, value, user_id) VALUES
  ('cost_rate_embedding', '0.02', NULL),       -- $ per 1M tokens
  ('cost_rate_llm_input', '0.50', NULL),       -- $ per 1M tokens (adjust to actual Kimi rate)
  ('cost_rate_llm_output', '1.50', NULL);      -- $ per 1M tokens (adjust to actual Kimi rate)
```

**Important**: Look up the actual current token pricing for Kimi K2.5 via synthetic.new and set accurate defaults. If the pricing isn't readily available, use placeholder values and add a note in the admin UI prompting the admin to set accurate rates.

---

## Data Collection

### What to Track

Token usage data should already be partially captured in ingestion logs. Formalize this by ensuring every ingestion run records:

**Per ingestion run (shared costs):**
- Embedding API calls count
- Embedding input tokens
- Embedding time (ms)
- Articles embedded (count)

**Per user per ingestion run (user-attributable costs):**
- LLM scoring API calls count
- LLM input tokens
- LLM output tokens
- Articles scored (count)
- Articles sent to LLM (post-embedding filter count)
- Articles from user's private sources vs. default sources

### Storage

The ingestion logs already store per-user scoring data as JSONB. Ensure the token counts are reliably captured from API responses. The cost dashboard will query the `ingestion_logs` table and compute aggregates.

**Do NOT create a separate cost tracking table.** The ingestion logs already contain all the raw data. The dashboard computes metrics on the fly from the logs, same pattern as the scoring analytics.

Additionally, for the source and user profile data (source counts, article counts), query the existing `sources`, `user_source_settings`, `user_articles`, and `articles` tables directly.

---

## Dashboard Sections

The cost section of the analytics tab should contain these panels, stacked vertically like the scoring analytics panels. Include the same time window toggle (7 days / 30 days / all time) at the top.

### Panel 1: Cost Summary

A high-level overview of total estimated spend.

```
Cost Summary (Last 30 Days)
─────────────────────────────────────────────────────
                    │ Tokens         │ Est. Cost
────────────────────┼────────────────┼──────────────
Embeddings (shared) │ 1,240,000 in   │ $0.02
LLM Scoring (input) │ 3,850,000 in   │ $1.93
LLM Scoring (output)│ 890,000 out    │ $1.34
────────────────────┼────────────────┼──────────────
Total               │                │ $3.29
─────────────────────────────────────────────────────
Avg. cost per day:     $0.11
Avg. cost per digest:  $0.07
Projected monthly:     $3.29
─────────────────────────────────────────────────────
```

Include a simple trend indicator: up/down/flat compared to the previous period of the same length.

### Panel 2: Cost by User

The most important panel — shows which users are driving costs and why.

```
Cost by User (Last 30 Days)
────────────────────────────────────────────────────────────────────────────────
User      │ Sources │ Articles │ Sent to │ LLM Tokens │ Est. Cost │ Cost/Day
          │ (total) │ Ingested │ LLM     │ (in + out) │           │
──────────┼─────────┼──────────┼─────────┼────────────┼───────────┼──────────
joe       │ 18      │ 2,840    │ 1,120   │ 1,980,000  │ $1.42     │ $0.047
friend1   │ 12      │ 1,920    │ 680     │ 1,240,000  │ $0.89     │ $0.030
friend2   │ 31      │ 4,100    │ 1,640   │ 2,520,000  │ $1.81     │ $0.060
────────────────────────────────────────────────────────────────────────────────
```

Column explanations:
- **Sources**: Total enabled sources for this user (default + private)
- **Articles Ingested**: Articles from this user's sources that were fetched and stored
- **Sent to LLM**: Articles that passed the embedding pre-filter and were scored by the LLM — this is the direct cost driver
- **LLM Tokens**: Combined input + output tokens used for this user's scoring
- **Est. Cost**: Estimated dollar cost based on configured rates
- **Cost/Day**: Average daily cost for this user

Sort by Est. Cost descending (highest cost user at top).

If any user's cost is disproportionately high relative to others, show a subtle advisory note below the table:

```
💡 friend2's cost is 2x the average, driven by 31 sources (19 private). 
   Consider reviewing their source list or adjusting the per-user source limit.
```

The logic for this: flag any user whose cost is more than 1.5x the average across all users.

### Panel 3: Cost by Source

Shows which sources are most expensive — either because they produce a lot of articles or because their articles consistently pass the embedding filter and get scored by the LLM.

```
Top Sources by Cost Impact (Last 30 Days)
──────────────────────────────────────────────────────────────────────────
Source                │ Type    │ Users │ Articles │ → LLM │ Est. Token
                      │         │       │ Fetched  │       │ Contribution
──────────────────────┼─────────┼───────┼──────────┼───────┼─────────────
Ars Technica          │ Default │ 3     │ 420      │ 380   │ 312,000
r/LocalLLaMA          │ Default │ 3     │ 310      │ 290   │ 248,000
friend2's Custom Feed │ Private │ 1     │ 680      │ 410   │ 340,000
Dallas Morning News   │ Default │ 2     │ 290      │ 85    │ 64,000
Simon Willison's Blog │ Default │ 3     │ 45       │ 44    │ 38,000
──────────────────────────────────────────────────────────────────────────
```

Column explanations:
- **Type**: Default (shared) or Private (user-added)
- **Users**: How many users subscribe to this source
- **Articles Fetched**: Total articles pulled from this source in the period
- **→ LLM**: How many of those articles passed embedding filtering and were sent to the LLM (summed across all users who received them)
- **Est. Token Contribution**: Estimated tokens consumed scoring articles from this source

Sort by Est. Token Contribution descending. Show top 15 sources.

Key insight this provides: a source that fetches 680 articles but only 85 pass the embedding filter is working as designed (cheap to fetch, embeddings filter effectively). A source that fetches 420 and sends 380 to the LLM is expensive — nearly everything passes the filter, which means either the source is highly relevant or the embedding threshold is too low for that topic area.

### Panel 4: Pipeline Efficiency

Shows how well the embedding pre-filter is reducing LLM costs.

```
Pipeline Efficiency (Last 30 Days)
────────────────────────────────────────────────────────
Articles fetched:                    8,860
After prefilter:                     7,240  (82%)
Unique articles embedded:           7,240
Embedding cost:                      $0.02

Per-user scoring:
  Total user×article pairs:         18,400
  Passed embedding filter:           4,440  (24%)
  Sent to LLM (incl. serendipity):  3,960
  
Embedding filter savings:            76%
Est. cost without embeddings:        ~$13.70
Est. cost with embeddings:           $3.29
Savings:                             ~$10.41 (76%)
────────────────────────────────────────────────────────
```

The "savings" calculation estimates what the LLM cost would have been if every article had been sent to the LLM (the old approach) vs. the actual cost with embedding pre-filtering. This justifies the hybrid architecture and helps the admin understand the value of the embedding layer.

**Embedding filter rate by user** is also useful — show a mini breakdown:

```
Embedding Filter Rate by User
──────────────────────────────────
joe:      78% filtered (efficient)
friend1:  81% filtered (efficient)
friend2:  68% filtered (check sources)
──────────────────────────────────
```

A lower filter rate means more articles are passing through to the LLM. This could mean the user has very broad interests (legitimate) or too many sources in a single topic area (wasteful).

---

## Cost Rate Configuration

Add a small settings section to the admin panel for configuring API rates:

```
API Cost Rates
────────────────────────────────────────
Embedding (per 1M tokens):     [$0.02 ]
LLM Input (per 1M tokens):     [$0.50 ]
LLM Output (per 1M tokens):    [$1.50 ]
────────────────────────────────────────
Last updated: Feb 16, 2026
```

These are editable fields that write to the `settings` table. Include a note: "Update these if you change LLM providers or pricing changes."

---

## API Route

```
GET /api/admin/analytics/costs?window=30
```

Returns all cost metrics computed over the specified window. Admin-only.

Response structure:

```typescript
{
  window_days: number;
  
  summary: {
    embedding_tokens: number;
    embedding_cost: number;
    llm_input_tokens: number;
    llm_output_tokens: number;
    llm_cost: number;
    total_cost: number;
    avg_cost_per_day: number;
    avg_cost_per_digest: number;
    projected_monthly: number;
    trend: 'up' | 'down' | 'flat';  // vs. previous period
  };
  
  by_user: Array<{
    user_id: string;
    username: string;
    display_name: string;
    source_count: number;
    private_source_count: number;
    articles_ingested: number;
    articles_sent_to_llm: number;
    llm_tokens: number;
    estimated_cost: number;
    cost_per_day: number;
    is_outlier: boolean;  // cost > 1.5x average
  }>;
  
  by_source: Array<{
    source_id: string;
    source_name: string;
    is_default: boolean;
    owner_username: string | null;  // null for default sources
    subscriber_count: number;
    articles_fetched: number;
    articles_sent_to_llm: number;
    estimated_token_contribution: number;
  }>;
  
  pipeline: {
    articles_fetched: number;
    after_prefilter: number;
    articles_embedded: number;
    embedding_cost: number;
    total_user_article_pairs: number;
    passed_embedding_filter: number;
    sent_to_llm: number;
    filter_savings_percent: number;
    estimated_cost_without_embeddings: number;
    estimated_cost_with_embeddings: number;
    estimated_savings: number;
    filter_rate_by_user: Array<{
      username: string;
      filter_rate: number;
    }>;
  };

  rates: {
    embedding_per_million: number;
    llm_input_per_million: number;
    llm_output_per_million: number;
  };
}
```

---

## Data Requirements

For accurate cost tracking, ensure the ingestion pipeline reliably captures token usage from API responses:

### Embedding API Response
The OpenAI embeddings endpoint returns a `usage` field:
```json
{ "usage": { "prompt_tokens": 1234, "total_tokens": 1234 } }
```
Capture `total_tokens` and log it in the ingestion log under the `embedding` section.

### LLM Scoring API Response
Most OpenAI-compatible APIs (including Kimi via synthetic.new) return usage:
```json
{ "usage": { "prompt_tokens": 5000, "completion_tokens": 1200, "total_tokens": 6200 } }
```
Capture `prompt_tokens` (input) and `completion_tokens` (output) separately per user. Log in the ingestion log under each user's scoring section.

**If the API does not return usage data**, estimate based on input/output text length using the approximation of ~4 characters per token. Log a warning that costs are estimated rather than actual.

---

## Files to Create

- `src/lib/db/cost-analytics.ts` — Query functions for all cost metrics (aggregates from ingestion_logs + source/user tables)
- `src/app/api/admin/analytics/costs/route.ts` — Cost analytics endpoint (admin-only)
- `src/components/CostDashboard.tsx` — Container for all cost panels
- `src/components/CostSummaryPanel.tsx` — High-level cost overview with trend
- `src/components/CostByUserPanel.tsx` — Per-user cost breakdown table with outlier flagging
- `src/components/CostBySourcePanel.tsx` — Per-source cost impact table
- `src/components/PipelineEfficiencyPanel.tsx` — Embedding filter savings visualization
- `src/components/CostRateSettings.tsx` — Editable API rate configuration

## Files to Modify

- `src/app/settings/page.tsx` — Add Cost section to the Analytics tab, add cost rate settings to admin config
- `src/lib/ingestion/logger.ts` — Ensure token counts are consistently captured for both embedding and LLM calls
- `src/lib/relevance/scorer.ts` — Ensure LLM response usage data is extracted and passed to logger
- `src/lib/embeddings.ts` — Ensure embedding response usage data is extracted and passed to logger
- `src/lib/db/settings.ts` — Seed default cost rate settings
- `src/lib/db/seed.ts` — Add default cost rate values

---

## Implementation Priority

### Phase 1: Data Verification
1. Audit ingestion logs to confirm token usage data is being captured for both embedding and LLM calls
2. If any gaps exist, update `scorer.ts`, `embeddings.ts`, and `logger.ts` to capture usage from API responses
3. Add cost rate settings to seed data

### Phase 2: API & Query Layer
4. Create `lib/db/cost-analytics.ts` with all query/aggregation functions
5. Create `GET /api/admin/analytics/costs` endpoint
6. Test with real ingestion log data

### Phase 3: Dashboard UI
7. Cost summary panel (totals, averages, trend, projection)
8. Cost by user panel (table with outlier detection)
9. Cost by source panel (top sources by token contribution)
10. Pipeline efficiency panel (filter savings calculation)

### Phase 4: Settings
11. Cost rate configuration UI
12. Wire rate changes to settings table
