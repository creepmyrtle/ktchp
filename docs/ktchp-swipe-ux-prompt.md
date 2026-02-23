# ketchup — Mobile Swipe UX Overhaul

## Context

ketchup is a multi-user, AI-curated daily digest app built with Next.js 16 (App Router, React 19), Tailwind CSS 4 (dark theme, DM Sans + JetBrains Mono), deployed on Vercel. The app presents articles in a vertical feed of cards. Users give feedback (like/neutral/dislike), then archive each card.

Currently, the mobile experience has two separate steps: tap small sentiment buttons (like/neutral/dislike), then swipe to archive. This feels clunky. We're replacing this with a single-gesture system on mobile where swiping a card both logs feedback AND archives it in one motion.

We're also replacing the three-way sentiment model (liked/neutral/disliked) with a two-way model (liked/skipped) everywhere in the app. "Skipped" replaces both "neutral" and "disliked" — it means "not for me" rather than "this was bad." This changes the data model, the preference learning signals, and the UI globally (mobile and desktop).

Read the full codebase before starting. Understand the existing swipe hook (`src/hooks/useSwipeToArchive.ts`), the card components (`ArticleCard.tsx`, `FeedbackButtons.tsx`), the feedback API (`src/app/api/feedback/`), the engagement model on `user_articles`, the preference learning system (`src/lib/relevance/learner.ts`), and the source trust computation (`src/lib/source-trust.ts`).

---

## Part 1: Replace three-way sentiment with two-way (liked / skipped)

This is a data model and logic change that affects the entire app, both mobile and desktop.

### 1a: Database and types

- In `src/types/index.ts`, update the sentiment type from `'liked' | 'neutral' | 'disliked'` (or however it's currently defined) to `'liked' | 'skipped'`.
- The `user_articles` table stores sentiment. Existing rows with `'neutral'` or `'disliked'` values need to be handled. Add a migration step: update all existing `'neutral'` and `'disliked'` values to `'skipped'`. This can be a SQL statement in the schema init or a standalone migration script. Either way, it must be backwards-compatible — the app should not crash if it encounters old values during the transition.

### 1b: Feedback API

- In the feedback API route (`src/app/api/feedback/`), update validation to accept only `'liked'` and `'skipped'` as sentiment values. Reject `'neutral'` and `'disliked'` with a 400 error.

### 1c: Preference learning — asymmetric signal weighting

- In `src/lib/relevance/learner.ts`, update the preference learning logic so that:
  - A `'liked'` rating is a **strong positive signal** (same weight as the current "liked").
  - A `'skipped'` rating is a **weak negative signal** — significantly weaker than the current "disliked." The idea is that skipping an article means "not relevant to me right now," not "this was bad content." When constructing the prompt for the LLM that generates preference statements, frame skipped articles as "articles the user passed on" rather than "articles the user disliked."
- Update any prompt text that references "disliked" or "neutral" to use the new terminology.

### 1d: Source trust — asymmetric weighting

- In `src/lib/source-trust.ts`, update the trust factor computation:
  - `'liked'` continues to boost trust (same as before).
  - `'skipped'` applies a **smaller penalty than the current "disliked"** — roughly half the negative weight. A user skipping articles from a source doesn't mean the source is bad; it might just mean those particular articles weren't relevant. The trust factor should still trend downward for sources that are consistently skipped, but much more slowly than the current dislike-driven penalty.
- Look at the current formula and adjust the weights proportionally. Document the old and new weights in a code comment.

### 1e: Desktop UI — FeedbackButtons.tsx

- Replace the three sentiment buttons (like/neutral/dislike) with two: **Like** (thumbs up or heart — match whatever icon the current "liked" button uses) and **Skip** (a forward arrow, "→", or similar icon that conveys "move past" rather than "reject"). Do NOT use a thumbs-down icon for skip — that implies dislike.
- The skip button should feel low-stakes visually: muted/subtle styling compared to the like button. Like gets the existing green/positive treatment. Skip gets a neutral gray.
- Keep the existing archive button on desktop — the sentiment buttons log feedback, and the archive button still archives. Desktop flow remains: rate → archive (two steps). Only mobile combines them.
- Remove any references to "neutral" or "dislike" from the UI. Tooltips, aria labels, etc.

### 1f: Scoring prompt updates

- In `src/lib/relevance/scorer.ts`, if the LLM scoring prompt references user feedback history or mentions "disliked"/"neutral" terminology, update it to use "liked"/"skipped" language.

### 1g: Admin and analytics

- In `AnalyticsDashboard.tsx`, `CostDashboard.tsx`, or any admin views that show feedback breakdowns, update labels from the three-way model to two-way. If there are charts or counters showing liked/neutral/disliked, consolidate to liked/skipped.

---

## Part 2: Mobile swipe gestures — like and skip in one motion

This replaces the current swipe-to-archive behavior on mobile with directional swipes that log feedback AND archive simultaneously.

### 2a: Rewrite `src/hooks/useSwipeToArchive.ts`

Rename this file to `src/hooks/useSwipeGesture.ts` (update all imports). Rewrite the hook to support the new gesture model. The hook should be generic enough to be used by `ArticleCard.tsx`.

**Gesture behavior:**

- **Swipe right** → liked + archive. Card animates off the right edge of the screen.
- **Swipe left** → skipped + archive. Card animates off the left edge of the screen.

**Two ways to trigger a committed swipe:**

1. **Drag past threshold:** If the user drags the card past 35% of the card's width in either direction and releases, commit the swipe. The card animates the rest of the way off screen.
2. **Velocity flick:** Track touch velocity over the last ~100ms of the gesture. If the velocity exceeds a threshold (experiment to find what feels right, but start around 0.5px/ms), commit the swipe in that direction regardless of how far the card has been dragged. This is what makes quick flicks work — the user can do a fast short swipe and the card flies off screen with momentum.

**If neither threshold is met on release**, the card springs back to its original position with an ease-out animation.

**Direction locking:**

- Use the first ~10px of touch movement to determine intent: horizontal or vertical.
- If horizontal, lock into swipe mode and prevent page scrolling for this touch.
- If vertical, abandon the swipe gesture entirely and let normal page scrolling happen.
- Do NOT allow diagonal swipes. Once locked, the card only moves along the horizontal axis.

**Animation physics:**

- During drag: the card follows the finger with 1:1 tracking (no dampening). Apply a slight rotation proportional to drag distance (subtle, ~5° max at full threshold) to give it a natural "tilt" feel. The rotation direction should match the swipe direction.
- On commit (either threshold or velocity trigger): animate the card off screen in the swipe direction with an ease-out curve. The exit velocity should feel like a continuation of the gesture momentum, not a sudden snap. Duration should be ~200-300ms.
- On cancel (spring back): animate back to center with a spring/ease-out curve, ~200ms.
- On card removal: after the exit animation completes, collapse the card's height with a smooth animation (~200ms) so the cards below slide up naturally. Preserve scroll position (the existing code already handles this — make sure it still works).

**Touch-only activation:**

- The swipe gestures should ONLY activate on touch devices. Use touch events (`touchstart`, `touchmove`, `touchend`), not pointer events or mouse events.
- Do NOT use screen width to detect mobile. A desktop user with a narrow browser window should still get the button UI, not swipe gestures.

**Return value from the hook:**

The hook should return:
- Transform/style values for the card (translateX, rotation, opacity) to be applied during drag.
- A callback for when the swipe commits, including the direction (left/right) so the parent can determine the appropriate feedback action.
- Whether a swipe is currently in progress (for conditional rendering of visual indicators).
- The current swipe direction during drag (for showing the appropriate background indicator).

### 2b: Visual feedback layer behind the card

During a swipe, show a colored background that's revealed as the card moves:

- **Swiping right:** Green background with a "liked" icon (thumbs up, heart, or whatever the existing like icon is). The icon and color should fade in proportionally to drag distance — barely visible at the start, fully opaque at the commit threshold.
- **Swiping left:** Muted gray background with a subtle forward arrow or "skip" icon. This should feel low-stakes and neutral, NOT red or punishing.

Build this as part of the `ArticleCard.tsx` layout — a background layer that sits behind the card content and is revealed by the card's translateX offset.

### 2c: Update `ArticleCard.tsx`

- Integrate the new `useSwipeGesture` hook.
- On mobile (touch devices): hide the like/skip/archive buttons. Only show bookmark and share buttons. The card's entire interaction model is swipe-based.
- On desktop (non-touch): keep the existing button layout with the updated two-button sentiment (like/skip) + archive button.
- When a swipe commits:
  1. Immediately call the feedback API with the appropriate sentiment (`'liked'` for right, `'skipped'` for left).
  2. Simultaneously trigger the archive action.
  3. These should be fire-and-forget (don't block the animation on the API response). Handle errors gracefully — if the API call fails, show a toast but don't try to undo the swipe animation.

### 2d: Repurpose swipe direction setting as a reversal toggle

The current app has a `SwipeSettings.tsx` component that lets users configure swipe direction. Repurpose this into a toggle that lets users reverse the swipe mapping:

- **Default (off):** Swipe right = like, swipe left = skip.
- **Reversed (on):** Swipe left = like, swipe right = skip.

Some users are left-handed or simply prefer the opposite mapping. This is a lightweight way to accommodate that.

**Changes to `SwipeSettings.tsx`:**
- Replace the current swipe direction control with a simple toggle (switch or checkbox) labeled something like "Reverse swipe directions" with a description: "Default: swipe right to like, left to skip. Enable to swap."
- Save to the existing per-user settings key-value store. Use a setting key like `swipe_reversed` (boolean). Default is `false`.

**Changes to `useSwipeGesture.ts`:**
- The hook should accept a `reversed` boolean parameter.
- When `reversed` is true, swap the sentiment mapping: right = skipped, left = liked.
- The visual feedback layer (Part 2b) should also respect this — green/like indicator appears on whichever side is mapped to "like," gray/skip indicator on the other.

**Changes to `ArticleCard.tsx` / `DigestContent.tsx`:**
- Fetch the user's `swipe_reversed` setting (this is likely already being fetched since the current code reads swipe direction — just adapt the existing fetch).
- Pass it into the swipe hook.

**Changes to the first-time hint (Part 2e):**
- The hint text should respect the reversal. If reversed, show "Like ← · Skip →" instead of "← Skip · Like →".

**Desktop FeedbackButtons.tsx:**
- The button order for like/skip should also respect the reversal setting, matching the current behavior where button order follows the configured swipe direction.

### 2e: First-time swipe hint

For users who haven't swiped before, show a one-time onboarding hint on the first card of their first digest:

- A subtle overlay or tooltip on the first article card showing: "← Skip · Like →" with small arrow indicators.
- After the user completes their first swipe in any direction, dismiss the hint permanently. Store a `swipe_hint_dismissed` flag in the user's settings (using the existing per-user settings key-value store).
- The hint should be unobtrusive — semi-transparent, positioned over or just below the card, and should not block interaction. The user can swipe right through it.
- Only show on touch devices.

---

## Part 3: Remove the archive-requires-sentiment gate

Currently, the engagement model requires sentiment to be set before a card can be archived. With the new swipe model, sentiment and archive happen simultaneously, so this gate is no longer needed.

- Remove any validation in the archive flow (API or client-side) that checks whether sentiment has been set.
- On desktop, this means users can now archive without rating if they want to. That's fine — it's equivalent to the old "neutral" behavior and will simply not generate a feedback event for that article.

---

## General instructions

- **Read before writing.** Read every file you're modifying fully before making changes. Match existing code style, naming conventions, import patterns, and error handling.
- **TypeScript.** Proper types everywhere. Update `src/types/index.ts` for any type changes.
- **CSS/Tailwind.** The app uses Tailwind CSS 4 with a dark theme. Match existing color palette and spacing. For the swipe animations, use CSS transforms and transitions where possible, falling back to requestAnimationFrame for the drag tracking. Do NOT use a physics/animation library — keep it lightweight with CSS transitions and manual touch tracking.
- **Performance.** The swipe gesture runs on every touch frame. Keep the touch handlers lean — no allocations, no DOM reads during touchmove. Use `will-change: transform` on the card during active swipes. Use passive touch listeners where appropriate (but note: `touchmove` may need `preventDefault` to block scrolling during horizontal swipes, which requires non-passive).
- **Accessibility.** The swipe gestures are a mobile enhancement. Screen readers and keyboard users should still be able to interact via the button UI (which remains on desktop and is accessible). Add appropriate `aria-label` updates for the renamed buttons.
- **No new dependencies.** The existing project has everything needed. Do not add Framer Motion, react-spring, Hammer.js, or any gesture/animation library.
- **Testing.** After implementation, verify: `npm run build` passes. Test the swipe behavior mentally by tracing through the touch event handlers — make sure direction locking works, velocity calculation is correct, and the animation states don't get stuck. Verify that the feedback API receives the correct sentiment values. Verify that old `'neutral'` and `'disliked'` values in the database are migrated.

## Implementation order

1. Part 1 (two-way sentiment model) — data model first, this affects everything downstream
2. Part 3 (remove archive-requires-sentiment gate) — small cleanup, do it while you're in the feedback code
3. Part 2a (rewrite swipe hook) — the core gesture engine
4. Part 2b + 2c (visual feedback layer + ArticleCard integration) — wire it together
5. Part 2d (remove swipe direction setting) — cleanup
6. Part 2e (first-time hint) — polish

Verify the build after each part.

## Post-implementation reminders

After all changes are complete and the build passes, print the following reminders for the user:

> ⚠️ REMINDER: The database migration from three-way sentiment (liked/neutral/disliked) to two-way (liked/skipped) will update existing rows. Before deploying:
> 1. Back up your Neon database (Neon dashboard → Branches → create a branch as a backup).
> 2. After deploying, verify the migration ran by checking that no rows in `user_articles` still have `'neutral'` or `'disliked'` as sentiment values.
> 3. The preference learning system and source trust calculations will now use the new asymmetric weighting. Existing learned preferences were generated from the old three-way model — consider running a manual preference re-learn (`npx tsx scripts/learn-prefs.ts`) for each user after deploying so their preferences are regenerated with the new signal model.

> ℹ️ NOTE: The swipe direction setting has been repurposed. Previously it controlled which direction swiped to archive. Now it's a "reverse swipe directions" toggle that swaps the like/skip mapping. Users who had a custom swipe direction set may want to revisit Settings → Gestures to confirm the new toggle matches their preference.
