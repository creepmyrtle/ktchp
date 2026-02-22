# ktchp — Source Page UX & Health Indicators

## Overview

Three improvements to the sources page that help users understand how ktchp works and choose sources that produce good results:

1. **Explainer messaging** — Permanent header text with expandable tips for choosing sources
2. **Source health indicators** — Per-source status showing activity level, average output, and errors
3. **Add-source pre-check** — Validate a feed before saving and warn the user if it's unlikely to contribute to their digests

---

## 1. Source Page Explainer

### Top-of-Page Header

Add a brief, permanent explainer at the top of the source manager — same muted, non-dismissable treatment as the digest section headers:

```
📡 Sources

ktchp checks your sources daily and scores new articles against 
your interests. For best results, add sources that publish 
frequently — daily news sites, active blogs, and feeds with 
regular new content work best.
```

### Expandable Tips Section

Below the header, add a collapsible "Tips for choosing good sources" section. Collapsed by default — the header is visible, user clicks to expand.

```
💡 Tips for choosing good sources                              [▼]
```

When expanded, show the following content. Use clean typography and subtle formatting — this is reference material, not a marketing page. Short paragraphs, no bullet points longer than one sentence.

**Works great:**
- News sites that publish daily (e.g., NYT, Ars Technica, The Verge)
- Active blogs with 2+ posts per week
- Aggregators and link feeds (e.g., Hacker News, Slashdot)
- Subreddit RSS feeds for active communities

**Works okay but may produce few matches:**
- Niche blogs that post monthly — content will appear when it's published, but most digests won't have anything from these sources
- Broad news feeds (AP, Reuters) — high volume but most articles won't match your interests, which is normal

**Doesn't work well:**
- Blogs with deep archives in their RSS feed — ktchp only looks at articles from the last 14 days, so older content gets filtered out
- Feeds that rarely update (quarterly newsletters, annual reports)
- Paywalled content where the RSS feed only has a headline and no description — ktchp needs some content to assess relevance

**Important:** Do NOT mention internal concepts like embeddings, scoring thresholds, prefilters, or pipeline stages. Frame everything from the user's perspective — what they'll experience, not how the system works internally.

### Design

- Header: same style as digest section headers (`DigestSectionHeader` component if it exists, or match that pattern)
- Expandable section: simple chevron toggle, smooth expand/collapse animation, remember state per session (don't persist — default to collapsed on each visit)
- Tips content: muted text color, comfortable line height, compact but readable

---

## 2. Source Health Indicators

### Concept

Each source in the source list gets a small status indicator showing how it's performing — is it actively producing content, running slow, stale, or broken? This helps users understand which sources are contributing to their digests without needing to understand the internals.

### Status Levels

| Status | Icon | Label | Criteria |
|--------|------|-------|----------|
| **Active** | 🟢 | "Active" | Published at least 1 article within the last 3 days |
| **Slow** | 🟡 | "Slow" | Last new article was 4-14 days ago |
| **Stale** | ⚪ | "Inactive" | No new articles in 14+ days |
| **Error** | 🔴 | "Error" | Most recent fetch attempt failed (HTTP error, timeout, parse failure) |
| **New** | 🔵 | "New" | Source was added less than 24 hours ago and hasn't been fetched yet |

Use colored dots (or small colored badges) — not emoji in production, use styled `<span>` elements with the appropriate colors. The labels above are for reference; use actual Tailwind colors that match the app's design language.

### Data Display Per Source

Each source card/row should show:

```
Ars Technica                              ● Active · ~4 new/day
https://feeds.arstechnica.com/...         Last new article: 2 hours ago

After Babel                               ● Slow · <1 new/week
https://www.afterbabel.com/...            Last new article: 16 days ago

KeepTrack                                 ● Error · HTTP 403
https://keeptrack.space/...               Fetch has failed for 3 days

The Marginalian                           ● Inactive · no recent articles
https://www.themarginalian.org/...        Last new article: 22 days ago
```

Fields:
- **Status dot + label**: Colored indicator with the status text
- **Frequency**: Average new articles per day or per week, computed from the last 14 days of data. Show as "~N new/day" if ≥1/day, "~N new/week" if <1/day, or "no recent articles" if zero.
- **Last new article**: Relative time since the most recent article from this source entered the system. "2 hours ago", "3 days ago", "22 days ago", etc.
- **Error detail**: If status is Error, show the error type (HTTP status code, timeout, parse error) and how many consecutive days it's failed.

### Data Source

This data needs to be computed from existing tables. The approach:

**Article frequency and recency:** Query the `articles` table grouped by `source_id`:

```sql
SELECT
  source_id,
  COUNT(*) FILTER (WHERE ingested_at > NOW() - INTERVAL '14 days') AS articles_14d,
  MAX(published_at) AS last_published,
  MAX(ingested_at) AS last_ingested
FROM articles
GROUP BY source_id;
```

**Fetch errors:** Query the `ingestion_logs` table for recent fetch events per source. The fetch phase logs include per-source results with error information. Parse the JSONB events to extract the most recent fetch status per source.

Alternatively, add lightweight tracking directly to the sources table:

```sql
ALTER TABLE sources ADD COLUMN last_fetch_at TIMESTAMP;
ALTER TABLE sources ADD COLUMN last_fetch_status TEXT; -- 'ok', 'error_403', 'error_502', 'timeout', 'parse_error'
ALTER TABLE sources ADD COLUMN last_new_article_at TIMESTAMP;
ALTER TABLE sources ADD COLUMN consecutive_errors INTEGER DEFAULT 0;
ALTER TABLE sources ADD COLUMN articles_14d INTEGER DEFAULT 0;
```

Update these columns during each ingestion run as sources are fetched. This avoids expensive queries against ingestion logs on every page load.

**Recommendation:** Add the columns to the `sources` table and update them during ingestion. This is cleaner and faster than parsing JSONB logs.

### API Changes

Update `GET /api/sources` to include health data in the response:

```typescript
{
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  is_default: boolean;
  // New health fields:
  health_status: 'active' | 'slow' | 'stale' | 'error' | 'new';
  articles_14d: number;
  last_new_article_at: string | null;
  last_fetch_status: string | null;
  last_fetch_at: string | null;
  consecutive_errors: number;
}
```

The `health_status` can be computed in the API route based on the raw fields, or computed client-side from the raw data. Computing server-side is cleaner.

### Ingestion Pipeline Changes

During the fetch phase, after processing each source, update its health columns:

```typescript
// After fetching a source
await updateSourceHealth(sourceId, {
  last_fetch_at: new Date(),
  last_fetch_status: error ? `error_${statusCode}` : 'ok',
  consecutive_errors: error ? source.consecutive_errors + 1 : 0,
  last_new_article_at: newArticleCount > 0 ? new Date() : source.last_new_article_at,
  articles_14d: computeRecentArticleCount(sourceId, 14),
});
```

The `articles_14d` count can be computed with a quick query during ingestion, or approximated by incrementing/decrementing as articles are ingested and aged out.

### Frontend

Update the `SourceManager.tsx` component to display health indicators on each source card. The indicator should be compact — it shouldn't dominate the card. Place it to the right of the source name or below the URL, depending on the existing layout.

For sources with errors, consider showing a subtle warning style (muted red text) and a hint: "This source hasn't been reachable for 3 days. Check the URL or remove it."

For stale sources, show a hint: "No new articles in 22 days. This source may not update frequently."

---

## 3. Add-Source Pre-Check

### Concept

When a user enters a feed URL to add a new source, make a quick validation request before saving. Fetch the feed, analyze its content, and warn the user about potential issues. This sets expectations and prevents frustration.

### Flow

1. User pastes a URL and clicks "Add" (or presses Enter)
2. Show a brief loading state: "Checking feed..."
3. Fetch the feed server-side via a new API endpoint
4. Analyze the results and either save with a success message, or show a warning and let the user decide

### Pre-Check API

```
POST /api/sources/check
Body: { url: string }
```

Response:

```typescript
{
  valid: boolean;           // Could the feed be fetched and parsed?
  title: string | null;     // Auto-detected feed title
  article_count: number;    // Total articles in the feed
  recent_count: number;     // Articles from the last 14 days
  newest_article_age: string | null;  // "2 hours ago", "45 days ago", etc.
  oldest_article_age: string | null;
  error: string | null;     // Error message if fetch failed
  warnings: string[];       // List of warning messages (see below)
}
```

This endpoint does NOT save the source — it only validates. The user reviews the results and confirms to actually add it.

### Warning Conditions

| Condition | Warning Message |
|-----------|----------------|
| Feed fetched but has 0 articles | "This feed appears to be empty. It may not be a valid RSS feed." |
| Feed has articles but 0 within 14 days | "This feed's most recent article is from {age} ago. ktchp focuses on content from the last 14 days, so this source may not contribute to your daily digest." |
| Feed has articles but fewer than 3 within 14 days | "This feed only has {N} recent articles. It may not contribute to most of your daily digests." |
| Feed returns HTTP error | "Couldn't reach this feed ({status code}). The source might be behind a paywall or blocking automated access." |
| Feed URL doesn't parse as valid RSS/Atom | "This URL doesn't appear to be a valid RSS or Atom feed. Make sure you're using the feed URL, not the website URL." |
| Feed returns but all articles lack content/description | "This feed's articles don't include content snippets. ktchp may have difficulty assessing article relevance." |

### Frontend Flow

**Success (no warnings):**
```
✓ Found "Ars Technica" — 20 articles, 8 from the last 14 days
[Add Source]  [Cancel]
```

**Success with warnings:**
```
⚠ Found "After Babel" — 25 articles, but only 1 from the last 14 days

This feed only has 1 recent article. It may not contribute to 
most of your daily digests.

[Add Anyway]  [Cancel]
```

**Failure:**
```
✗ Couldn't reach this feed (HTTP 403). The source might be behind 
  a paywall or blocking automated access.

[Try Again]  [Cancel]
```

The user can always proceed with "Add Anyway" for warnings — the pre-check is advisory, not blocking. Only hard failures (invalid URL, unparseable response) should prevent adding.

### Auto-Detect Feed Title

If the feed has a `<title>` element, pre-fill the source name field with it. The user can edit it before saving. This saves a step and ensures source names are readable.

---

## 4. OPML Import — Batch Validation

### Concept

The single-source pre-check flow doesn't work for OPML imports — users can't confirm 30 feeds one by one. Instead, import all feeds immediately, run validation in parallel in the background, and tell the user to check back for health status results.

### Flow

1. User uploads an OPML file
2. Parse the file and extract all feed URLs and titles
3. Save all feeds as sources immediately (enabled, using the OPML title as the source name)
4. Show a summary: "Imported {N} sources. We're checking each feed now — check back in a few minutes to see their health status."
5. Kick off the pre-check for all imported feeds in parallel (server-side)
6. As each check completes, populate the health columns on the `sources` table (`last_fetch_status`, `last_fetch_at`, `articles_14d`, `last_new_article_at`, `consecutive_errors`)
7. The user revisits the sources page (or refreshes) and sees health indicators on all their new sources — active, slow, stale, or error

### Batch Validation Endpoint

```
POST /api/sources/import
Body: { sources: Array<{ url: string; name: string }> }
```

This endpoint:
1. Creates all source records in the database
2. Creates `user_source_settings` rows for the importing user
3. Kicks off parallel pre-checks using `Promise.allSettled()` — each feed is fetched and analyzed independently, failures don't block others
4. As each check resolves, updates the source's health columns
5. Returns immediately after saving sources (does NOT wait for all checks to complete)

Response:

```typescript
{
  imported: number;          // Sources successfully created
  skipped: number;           // Sources skipped (URL already exists)
  duplicates: string[];      // Names of skipped duplicate sources
  estimated_check_time: string;  // "2-3 minutes" based on count
}
```

### Timing Estimate

Feed checks typically take 1-5 seconds each. Running in parallel with reasonable concurrency (5-10 at a time to avoid overwhelming the server), 30 feeds would take roughly 30-60 seconds. Show the user a time estimate based on the count:

- 1-10 sources: "Check back in about a minute"
- 11-30 sources: "Check back in 2-3 minutes"
- 31+: "Check back in about 5 minutes"

### Frontend

After a successful OPML import, show:

```
✓ Imported 28 sources (2 skipped — already in your list)

We're validating each feed now. Check back in 2-3 minutes 
to see their health status.

[View Sources]
```

"View Sources" scrolls to or navigates to the source list. Newly imported sources that haven't been checked yet show the 🔵 "New" health status until their validation completes.

### OPML Parsing

OPML files are XML with `<outline>` elements. Each feed is:

```xml
<outline type="rss" text="Ars Technica" xmlUrl="https://feeds.arstechnica.com/..." />
```

Use `text` attribute for the source name, `xmlUrl` for the feed URL. Skip outlines without `xmlUrl`. Handle nested outlines (OPML supports folders/categories) by flattening — ignore the folder structure, just extract all feeds.

Use a lightweight XML parser (e.g., `fast-xml-parser` which may already be a dependency, or the built-in DOMParser if running client-side). Don't add a heavy dependency for this.

### Deduplication

Before importing, check each URL against the user's existing sources (both default and private). Skip sources with duplicate URLs and report them as skipped in the response.

---

## Files to Create

- `src/app/api/sources/check/route.ts` — Pre-check endpoint (fetch, parse, analyze feed)
- `src/app/api/sources/import/route.ts` — OPML batch import endpoint (save + parallel validation)
- `src/components/SourceHealthIndicator.tsx` — Status dot + label + stats for a single source
- `src/components/SourcePageHeader.tsx` — Explainer header + expandable tips
- `src/components/AddSourcePreCheck.tsx` — Pre-check UI with loading state, results, and warnings
- `src/components/OpmlImport.tsx` — OPML file upload UI with import summary and timing message

## Files to Modify

### Database:
- `src/lib/db/schema.ts` — Add health columns to `sources` table
- `src/lib/db/sources.ts` — Add `updateSourceHealth()` function, include health fields in source queries

### Ingestion:
- `src/lib/ingestion/index.ts` — Update source health columns after each source fetch
- `src/lib/ingestion/rss.ts` — Return error details (status code, error type) alongside fetch results

### API:
- `src/app/api/sources/route.ts` — Include health data in GET response, compute `health_status` from raw fields

### Frontend:
- `src/components/SourceManager.tsx` — Integrate health indicators on each source card, add the page header, replace the current "add source" flow with the pre-check flow
- `src/app/settings/page.tsx` — May need updates if the source manager layout changes significantly

---

## Implementation Priority

### Phase 1: Data Foundation
1. Add health columns to `sources` table
2. Update ingestion pipeline to populate health columns after each source fetch
3. Update source queries to include health data
4. Update `GET /api/sources` response with health fields

### Phase 2: Source Health Indicators
5. Build `SourceHealthIndicator` component
6. Integrate into `SourceManager` — show status, frequency, and recency per source
7. Add contextual hints for stale and erroring sources

### Phase 3: Page Messaging
8. Build the source page header with explainer text
9. Build the expandable tips section
10. Style to match existing section header patterns

### Phase 4: Add-Source Pre-Check
11. Build `POST /api/sources/check` endpoint
12. Build the pre-check UI (loading state, results display, warning messages)
13. Integrate into the add-source flow — pre-check runs before save
14. Auto-detect and pre-fill feed title

### Phase 5: OPML Import
15. Build OPML parser (extract feed URLs and titles from XML)
16. Build `POST /api/sources/import` endpoint with parallel validation
17. Build the OPML upload UI with import summary and timing message
18. Handle deduplication against existing sources

### Phase 6: Polish
19. Verify health indicators update correctly after each ingestion run
20. Test the pre-check against various feed types: active feeds, stale feeds, broken URLs, paywalled feeds, non-RSS URLs
21. Test OPML import with real OPML exports from other readers (Feedly, Inoreader, etc.)
22. Ensure the messaging reads naturally and doesn't use internal jargon
