# Goldline Week tab

Mobile presentation of a locked week. Day Line stays the home surface. Week is a place you visit.

This document does not define planning, locking, or growth candidates. Those belong to other projects. The brochure renders an agreement it did not create.

## What it answers

“What week did Claire and I agree to?”

It does not answer “What should I do instead today?” Daily Command, execution overrides, and unconfirmed drafts stay off this surface.

## Data

The render contract mirrors the locked `WeeklyIntentRecord` field for field:

- `id`, `tenantId`, `operatorId`, `weekStart`, `revision`
- `source` is exactly `operator_confirmed_proposal`
- `lockedAt` is the lock evidence
- `days[]`: `businessDate`, `weekday`, `disposition` (`primary` | `stand_down`)
- `primary`: `text`, `source` (`existing_work` | `operator_stated` | `claire_recommended`), `commitmentId` (`string | null`), or null
- `fixedConstraints[]`: `sourceRef`, `title`, `businessDate`, `scheduleLabel`
- `readinessRequirements[]`: `text`, `kind`, `neededForDate`, `completeByDate`, `status`

A locked agreement is `source === "operator_confirmed_proposal"` plus a non-empty `lockedAt`. There is no separate `source: "locked"` state.

`lockedWeeklyIntentToWeekArtifact` projects that record into a view model with the remaining horizon only (business dates on or after today). It copies `primary.text`, `commitmentId`, `disposition`, the full constraint record, and `readinessRequirements`. It does not assign primaries. A commitment id is not a mission route. Fiction fields are not part of the adapter.

`WeekPresentationOverlay` is a separate map keyed by business date: optional `fictionTitle`, `artVariant`, `chapterSkinId`. An empty overlay is a finished brochure. Real objective text is never replaced by a fiction title.

Production read is `readWeekVisit()`. Until a locked intent is supplied, it returns `UNPLANNED`. Replacing that function is the integration seam. It is not a second planner.

## Visit

Ordinary launch stays on the Day Line. Opening Week does not write business truth, fire a narrator beat, or mint gold. Start calls `onStartMission` without writing. Adjust calls `onAdjustWeek` until a planning route exists. Production `readWeekVisit()` stays `UNPLANNED` until a locked agreement is supplied.

## Presentation

Portrait phone. CSS perspective and `rotateY` folds, one dominant panel, at most one peeking wing per side. Readiness is drawn as loadout (jacket, packet, dossier, permit, map slip), not as checks. Light paper only.
