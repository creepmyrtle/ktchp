# ktchp — Digest Engagement & Article Workflow Enhancements

## Overview

Enhance ktchp's article interaction model to encourage users to **actively process every article** in a digest rather than passively scrolling. The goal is to make "clearing a digest" the primary user action — every article gets a sentiment rating, gets marked as read/visited, and then gets archived out of the view. This creates a satisfying completion loop while generating rich feedback data that improves the relevance engine over time.

This is a significant refactor of the existing feedback system. The current thumbs up/down + bookmark + dismiss system is being **replaced** with a new multi-step engagement model.

---

## New Article Interaction Model

### Actions (in typical user flow order)

| Action | Type | Required to Archive? | Description |
|--------|------|---------------------|-------------|
| **Sentiment** | `liked` / `neutral` / `disliked` | **Yes** | How the user feels about this article's relevance and quality. Replaces the old thumbs up/down system. |
| **Read/Visited** | `read` | No | User clicked through to read the full article. Tracked automatically when they click the article link, or can be toggled manually. |
| **Bookmark** | `bookmark` | No | Save for later reference. Bookmarked articles remain accessible on the bookmarks page even after archiving. Toggleable. |
| **Share** | (no DB state) | No | Copies the article URL to clipboard. No server-side tracking needed. |
| **Archive** | `archived` | — | Removes the article from the active digest view. **Requires a sentiment rating first.** |

### Key Rules

1. **Sentiment is required before archiving.** If a user tries to archive without setting liked/neutral/disliked, show a brief prompt or highlight the sentiment buttons. This ensures every archived article contributes to the learning engine.
2. **Sentiment is a three-way toggle.** Clicking the active sentiment again deselects it (returns to unrated). Only one sentiment can be active at a time.
3. **Read is auto-tracked.** When the user clicks the article title/URL to open it, automatically record a `read` action. Also allow manual toggle (user might have read it elsewhere).
4. **Bookmark is toggleable.** Click to bookmark, click again to unbookmark. Bookmarked articles persist on `/digest/bookmarks` regardless of archive status.
5. **Share copies to clipboard.** Show a brief toast/tooltip confirmation ("Link copied!"). No server round-trip needed.
6. **Archive is permanent from the UI perspective.** Archived articles vanish from the digest view (with a smooth exit animation). They remain in the database with all their feedback data. They are NOT accessible from the digest view or any archive view — only bookmarked articles remain accessible via the bookmarks page.

---

## Database Changes

### Migrate the `feedback` table

The current feedback table stores actions as `('thumbs_up', 'thumbs_down', 'bookmark', 'dismiss', 'click')`. This needs to change to support the new model.

**Option A (recommended): Add new columns to `articles` table directly.**

Since sentiment and archive status are per-article properties (not a log of events), it's cleaner to store them on the article itself rather than in a separate feedback table:

```sql
-- Add to articles table
ALTER TABLE articles ADD COLUMN sentiment TEXT CHECK (sentiment IN ('liked', 'neutral', 'disliked'));
ALTER TABLE articles ADD COLUMN is_read BOOLEAN DEFAULT FALSE;
ALTER TABLE articles ADD COLUMN is_bookmarked BOOLEAN DEFAULT FALSE;
ALTER TABLE articles ADD COLUMN is_archived BOOLEAN DEFAULT FALSE;
ALTER TABLE articles ADD COLUMN archived_at TIMESTAMP;
```

**Keep the existing `feedback` table as an append-only event log** for the learning engine. Every state change still gets logged there so the preference learner can analyze patterns over time:

```sql
-- Update the CHECK constraint to support new action types
-- New valid actions: 'liked', 'neutral', 'disliked', 'read', 'bookmark', 'unbookmark', 'archived'
-- Remove the UNIQUE constraint on (user_id, article_id, action) since actions can be toggled
-- The feedback table becomes a pure event log — every action is a new row
```

This gives you fast reads (query article columns directly) and rich history (feedback log for learning).

### Migration Strategy

1. Create the new columns on `articles`
2. Migrate existing feedback data:
   - `thumbs_up` → `sentiment = 'liked'`
   - `thumbs_down` → `sentiment = 'disliked'`
   - `bookmark` → `is_bookmarked = true`
   - `dismiss` → `is_archived = true`
   - `click` → `is_read = true`
3. Update the feedback table constraint to accept new action types
4. Remove the UNIQUE constraint on feedback (it's now an append-only log)

---

## API Changes

### Update: `POST /api/feedback`

The feedback endpoint should handle all the new actions. Request body:

```typescript
{
  articleId: string;
  action: 'liked' | 'neutral' | 'disliked' | 'read' | 'bookmark' | 'unbookmark' | 'archived';
}
```

Behavior per action:

- **`liked` / `neutral` / `disliked`**: Set `articles.sentiment` to this value. If the article already has this sentiment, clear it (set to null). Log to feedback table.
- **`read`**: Set `articles.is_read = true`. If already true and manually toggled, set to false. Log to feedback table.
- **`bookmark`**: Set `articles.is_bookmarked = true`. Log to feedback table.
- **`unbookmark`**: Set `articles.is_bookmarked = false`. Log to feedback table.
- **`archived`**: **Reject if `articles.sentiment` is null** (return 400 with message "Sentiment required before archiving"). Otherwise set `articles.is_archived = true` and `articles.archived_at = now()`. Log to feedback table.

Response should return the updated article state:

```typescript
{
  articleId: string;
  sentiment: 'liked' | 'neutral' | 'disliked' | null;
  is_read: boolean;
  is_bookmarked: boolean;
  is_archived: boolean;
}
```

### Update: `GET /api/digests/latest` and `GET /api/digests/[id]`

- **Default behavior**: Return only non-archived articles (`WHERE is_archived = false`).
- Add query param `?include_archived=true` to return all articles (for potential future use).
- Include the new article state fields in the response.

### Update: `GET /api/digests/latest` — Digest Completion Status

The digest response should include a completion summary:

```typescript
{
  id: string;
  generated_at: string;
  articles: Article[];
  // New fields:
  total_article_count: number;    // Total articles originally in this digest
  archived_count: number;         // How many have been archived
  remaining_count: number;        // How many are still unarchived
  is_complete: boolean;           // true when remaining_count === 0
}
```

### Bookmarks Endpoint

Update the existing bookmarks query (used by `/digest/bookmarks`) to pull from `articles.is_bookmarked` instead of the old feedback-based approach.

```
GET /api/digests/bookmarks
```

Returns all articles where `is_bookmarked = true`, regardless of archive status, ordered by most recently bookmarked. Include full article data (summary, source, sentiment, etc.).

---

## Frontend Changes

### ArticleCard.tsx — Complete Redesign

The article card is the core interaction surface. Redesign it with the new action model:

```
┌──────────────────────────────────────────────────────┐
│  [Source name]                    [Relevance tag]     │
│                                                       │
│  Article Title (clickable → opens link + marks read)  │
│                                                       │
│  2-3 sentence AI summary...                           │
│                                                       │
│  Published: 2 hours ago                               │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │  😊  😐  😞  │  ☑ Read  │  🔖  │  🔗  │  📥  │  │
│  │  sentiment     │  toggle  │ bkmk │share │archive│  │
│  └─────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

#### Action Bar Design

The action bar at the bottom of each card should have these elements, left to right:

1. **Sentiment group** — Three buttons in a segmented control style:
   - 👍 Liked (or a thumbs-up / heart icon)
   - ➖ Neutral (or a "meh" / dash icon)  
   - 👎 Disliked (or a thumbs-down icon)
   - Active state: filled/highlighted. Only one can be active. Clicking the active one deselects it.
   - Use distinct colors: liked = green/positive, neutral = gray/muted, disliked = red/negative. Keep it subtle — tinted backgrounds or borders, not loud fills.

2. **Read indicator** — A small checkbox or eye icon. Auto-checks when the user clicks the article link. Can be manually toggled. Muted styling — this is informational, not a primary action.

3. **Bookmark** — Standard bookmark icon. Toggleable. Filled when active.

4. **Share** — Link/chain icon. On click, copy the article URL to clipboard and show a brief "Copied!" toast or tooltip that auto-dismisses after 1.5 seconds.

5. **Archive** — A checkmark-in-box or archive/inbox icon. This is the "I'm done with this article" action.
   - If sentiment is set → archive the article (smooth exit animation — fade out and collapse, ~300ms).
   - If sentiment is NOT set → briefly highlight/pulse the sentiment buttons and show a subtle tooltip: "Rate this article first". Do NOT archive.

#### Card States

- **Default**: Full card, no actions taken.
- **Partially engaged**: Sentiment set and/or read — show the active states on the relevant buttons. Optionally add a very subtle visual change to the card (slightly different left border color, very subtle background shift) to distinguish "touched" from "untouched" cards.
- **Archiving animation**: When archived, the card should fade out and the space should collapse smoothly. Don't just `display: none` — animate it. A good pattern is: fade opacity to 0 over ~200ms, then collapse height over ~200ms.

#### Mobile Considerations

On mobile screens, the action bar should be comfortable to tap. Ensure touch targets are at least 44px. The sentiment group might need slightly more spacing between buttons. The full action bar should work in a single row even on narrow screens — if it's too tight, the Read indicator can be hidden on mobile (since it auto-tracks from link clicks anyway).

### Swipe-to-Archive (Mobile)

On mobile (touch devices), users can **swipe right to archive** an article. This is the primary mobile interaction for clearing a digest quickly.

#### Behavior

- **Swipe right** (default): Archive the article, subject to the same sentiment gate as the archive button.
  - If sentiment is set → archive with the same fade/collapse animation.
  - If sentiment is NOT set → the card should **snap back** to its original position with a brief shake/bounce animation, and the sentiment buttons should highlight/pulse to draw attention. Optionally show a small inline message below the action bar: "Rate first to archive."
- **Swipe direction is configurable**: Add a setting (in Settings page, under a "Preferences" or "Gestures" section) to swap the swipe direction to left. Store this in the `settings` key-value table as `swipe_archive_direction` with values `'right'` (default) or `'left'`. Expose via `GET /api/settings` and `PUT /api/settings`.

#### Implementation Notes

- Use touch event handlers (`touchstart`, `touchmove`, `touchend`) — no need for a gesture library. Track the horizontal delta and apply a CSS transform to translate the card as the user drags.
- **Swipe threshold**: Require at least 100px of horizontal movement (or ~30% of card width, whichever is smaller) to trigger the archive. Below threshold, snap back.
- **Visual feedback during swipe**: As the card moves, reveal a colored background behind it:
  - If sentiment is set: green/positive background with a checkmark icon — signals "ready to archive."
  - If sentiment is NOT set: amber/warning background with an exclamation icon — signals "not ready."
  This gives the user immediate feedback *during* the swipe, before they even release.
- **Resistance curve**: Apply increasing resistance as the swipe distance grows (e.g., translate = delta * 0.6 after threshold). This prevents the card from flying off screen and feels more natural.
- **Velocity detection**: If the user swipes fast (velocity > threshold), trigger archive even if distance is below the normal threshold. This makes the interaction feel responsive for quick, confident swipes.
- **Vertical scroll lock**: Once a horizontal swipe is detected (horizontal delta > 10px and greater than vertical delta), prevent vertical scrolling for that touch sequence. This avoids accidental archives while scrolling.
- **Desktop**: Swipe is disabled on non-touch devices. The archive button in the action bar remains the desktop interaction.

#### Settings UI Addition

Add a small section to the Settings page:

```
Gestures
─────────────────────────
Swipe to archive direction:  [Right →]  [← Left]
```

Two toggle buttons, one active at a time. Default is right.

### FeedbackButtons.tsx — Rewrite

This component is being completely replaced. The new component should:

- Accept the current article state as props (`sentiment`, `is_read`, `is_bookmarked`)
- Handle all five action types
- Use optimistic UI updates — change state immediately, fire API call in background
- On API error, revert the optimistic update and show a brief error toast
- Handle the archive gate (check sentiment before allowing archive)

### Digest View — Completion State

When all articles in a digest are archived (`remaining_count === 0`), replace the article list with a subtle completion message:

```
┌──────────────────────────────────────────────────────┐
│                                                       │
│              ✓ Digest complete                        │
│                                                       │
│    You processed all {total} articles.                │
│    {liked} liked · {neutral} neutral · {disliked}     │
│    disliked · {bookmarked} bookmarked                 │
│                                                       │
│    Next digest: ~5:00 AM CT                           │
│                                                       │
└──────────────────────────────────────────────────────┘
```

This replaces the current "You're all caught up" message but only shows when the user has actively archived everything (not just because the digest is empty).

If the digest still has unarchived articles, show the existing "You're all caught up" / `CaughtUpMessage` at the bottom of the remaining cards.

### Digest Header — Progress Indicator

Update `DigestHeader.tsx` to show progress:

```
Daily Digest — Feb 15, 2026                    12 of 18 cleared
```

Or as a subtle progress bar beneath the header. Keep it understated — a thin line or small text, not a giant progress ring. The point is gentle motivation, not gamification pressure.

### DigestSelector — Completion Badges

In the digest selector dropdown, show a subtle indicator for completed vs. incomplete digests:

- ✓ next to completed digests (all articles archived)
- A count like "3 remaining" for incomplete ones

This lets the user see at a glance if they have unfinished digests.

### Bookmarks Page Updates

Update `/digest/bookmarks` to work with the new data model:

- Query articles where `is_bookmarked = true` regardless of `is_archived`
- Show the full article card but with a simplified action bar (just unbookmark and share — no need for sentiment/archive since these are saved references)
- Sort by most recently bookmarked

---

## Preference Learning Updates

The learned preferences system should be updated to leverage the richer feedback signals:

### Scoring Weights for Learning

When the preference learner analyzes feedback, weight the signals:

| Signal | Weight | Rationale |
|--------|--------|-----------|
| `liked` | +2.0 | Strong positive signal |
| `neutral` + `read` | +0.5 | Read it but wasn't excited — mild positive |
| `neutral` + not read | 0.0 | Didn't care enough to read — neutral |
| `disliked` | -1.5 | Negative signal |
| `bookmarked` | +2.5 | Strongest positive — worth saving |
| `disliked` + `read` | -1.0 | Read it but didn't like it — less negative than blind dislike |

### Updated Learner Prompt

Update the preference learning prompt (in `scorer.ts` or `learner.ts`) to reference these new signals:

```
Analyze this user's content feedback patterns. The user rates every article with a sentiment (liked/neutral/disliked), and optionally bookmarks articles for later reference.

Signal interpretation:
- "liked" = user found this relevant and valuable
- "neutral" = user acknowledged it but wasn't particularly engaged
- "disliked" = user found this irrelevant or low quality
- "bookmarked" = user found this valuable enough to save — strongest positive signal
- "read" = user clicked through to the full article — indicates genuine interest

Look for patterns in:
- Which topics/sources consistently get "liked" vs "disliked"
- What distinguishes "liked" from "neutral" for this user
- What gets bookmarked — these represent the user's ideal content
- Sources or topics that consistently get "disliked" — these should be deprioritized
```

---

## Implementation Notes

### Archive vs. Delete

Archiving is NOT deletion. The article row stays in the database with all its metadata, scores, and feedback. Archiving just means `is_archived = true` — it's a UI concept, not a data concept. This is important because:
- The feedback data feeds the learning engine
- The user might want to find an old article via search (future feature)
- Digest completion stats need the full article count

### Backward Compatibility

After migration, old digests that were created before this change will have articles with no sentiment set and `is_archived = false`. These should display normally with the new UI — the user can engage with them using the new workflow if they want, or just ignore old digests.

### Performance

The digest query should remain fast. The new columns on `articles` are simple scalar values. Add an index:

```sql
CREATE INDEX idx_articles_digest_archived ON articles(digest_id, is_archived);
CREATE INDEX idx_articles_bookmarked ON articles(is_bookmarked) WHERE is_bookmarked = true;
```

### Animation Library

For the archive exit animation, CSS transitions should be sufficient — no need for Framer Motion or similar. Use a pattern like:

```css
.card-archiving {
  opacity: 0;
  max-height: 0;
  margin: 0;
  padding: 0;
  overflow: hidden;
  transition: opacity 200ms ease, max-height 300ms ease 100ms, margin 300ms ease 100ms, padding 300ms ease 100ms;
}
```

Set `max-height` to the card's actual height before starting the animation, then transition to 0.

### Toast Notifications

For the "Link copied!" and error toasts, implement a lightweight toast system if one doesn't already exist. Requirements:
- Auto-dismiss after 1.5-2 seconds
- Stack if multiple fire at once
- Position: bottom-center on mobile, bottom-right on desktop
- Keep it minimal — no library needed, just a simple React context + portal

---

## Files to Modify

### Definitely changing:
- `src/components/ArticleCard.tsx` — Major redesign with new action bar
- `src/components/FeedbackButtons.tsx` — Complete rewrite (or replace with new component)
- `src/components/CaughtUpMessage.tsx` — Update for digest completion state
- `src/components/DigestHeader.tsx` — Add progress indicator
- `src/components/DigestSelector.tsx` — Add completion badges
- `src/app/digest/page.tsx` — Handle archive filtering and completion state
- `src/app/digest/[id]/page.tsx` — Same updates as digest page
- `src/app/digest/bookmarks/page.tsx` — Update to use new data model
- `src/app/api/feedback/route.ts` — Rewrite for new action types
- `src/app/api/digests/latest/route.ts` — Add completion stats, filter archived
- `src/app/api/digests/[id]/route.ts` — Same updates
- `src/lib/db/feedback.ts` — Update for new action types and event logging
- `src/lib/db/articles.ts` — Add methods for sentiment/read/bookmark/archive updates
- `src/lib/db/schema.ts` — Add new columns and migration
- `src/types/index.ts` — Update Article and Feedback types

### Possibly changing:
- `src/lib/relevance/scorer.ts` — Update learner prompt for richer signals
- `src/lib/db/digests.ts` — Add completion stats queries
- `src/lib/db/settings.ts` — Ensure it supports the `swipe_archive_direction` key
- `src/app/api/settings/route.ts` — Ensure GET/PUT for swipe direction setting
- `src/app/settings/page.tsx` — Add Gestures section for swipe direction toggle
- `src/app/api/digests/bookmarks/route.ts` — Update query approach (if endpoint exists, otherwise create)

### New files (if needed):
- `src/components/Toast.tsx` — Lightweight toast notification system
- `src/components/SentimentButtons.tsx` — Extracted sentiment toggle group (optional, could stay in ArticleCard)
- `src/hooks/useSwipeToArchive.ts` — Custom hook encapsulating touch event handling, swipe detection, velocity calculation, and scroll locking logic (keeps ArticleCard clean)
