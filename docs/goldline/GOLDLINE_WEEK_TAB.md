# Goldline Week tab

Mobile presentation of a locked week. Day Line stays the home surface. Week is a place you visit.

This document does not define planning, locking, or growth candidates. Those belong to other projects. The brochure renders an agreement it did not create.

## What it answers

“What week did Claire and I agree to?”

It does not answer “What should I do instead today?” Daily Command, execution overrides, and unconfirmed drafts stay off this surface.

## Data

The render contract mirrors a locked `WeeklyIntent`:

- `weekStart`, `revision`, `source`, `lockedAt`
- `days[]`: `businessDate`, `primary` (`title`, `ref`, `posture`), `fixedConstraints[]`, `readiness[]`
- readiness: `text`, `kind`, `neededForDate`, `completeByDate`, `status`

`lockedWeeklyIntentToWeekArtifact` projects that record into a view model with the remaining horizon only (business dates on or after today). It copies primaries. It does not assign them. Fiction fields are not part of the adapter.

`WeekPresentationOverlay` is a separate map keyed by business date: optional `fictionTitle`, `artVariant`, `chapterSkinId`. An empty overlay is a finished brochure. Real objective text is never replaced by a fiction title.

Production read is `readWeekVisit()`. Until a locked intent is supplied, it returns `UNPLANNED`. Replacing that function is the integration seam. It is not a second planner.

## Visit

Ordinary launch stays on the Day Line. Opening Week does not write business truth, fire a narrator beat, or mint gold. Start navigates to an existing `/driver/sales-mission/:id` route or calls `onStartMission` without writing. Adjust calls `onAdjustWeek` until a planning route exists.

## Presentation

Portrait phone. CSS perspective and `rotateY` folds, one dominant panel, at most one peeking wing per side. Readiness is drawn as loadout (jacket, packet, dossier, permit, map slip), not as checks. Light paper only.
