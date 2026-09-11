# Slice 4 — Mission Director v1

**Status:** specification. Not started. Blocked on Slice 1.
**Supersedes:** the "Mission Director v1" paragraph in the original five-slice brief.

This document replaces a scheduler shell with a named architecture, a data contract,
an enumerated failure taxonomy, a stated intelligence boundary, and a falsifiable
proof of usefulness. Everything below is written against code that exists on `main`
today. Where the code cannot yet support a requirement, that is said out loud rather
than assumed away.

---

## 0. Read before writing any code

Protected continuity contracts. Current production behavior outranks all prose,
including this file.

- `docs/goldline/REALITY_BRIDGE.md` — especially §2 (what the game may know) and §13.
- `docs/goldline/IMPLEMENTATION_CONSTITUTION.md`
- `docs/goldline/RUNTIME_INVENTORY.md` — the "Do not duplicate" list.
- `docs/goldline/campaigns/GREYSTAR_COLOSSEUM_SNAPSHOT.md`

---

## 1. What already exists, and why Slice 4 is not any of it

Three systems already sit near this problem. Slice 4 is a fourth, distinct thing.
Do not rebuild, rename, or absorb the other three.

| System | Path | What it actually does | Relationship to Slice 4 |
|---|---|---|---|
| Day Director | `server/dayDirector/dayDirectorService.ts` | **Capture.** Adam types a sentence, Anthropic normalizes it into a titled commitment (`growth`/`prep`/`operations`), it is stored per business date and can fulfil a `towerWarsPromises` row. It never reads the route and never selects anything. | Upstream input. Its commitments are prep evidence and occupy time. Do not extend it into a planner. |
| Night Shift | `server/nightShift/authoredDayService.ts` | **Presentation.** After the LA business-date roll it gathers real evidence, builds allowlisted candidate lines, lets Anthropic choose ordering and emphasis only, validates the plan against the allowlist, falls back deterministically, and persists an `authoredDays` row. | Sibling, and the architectural template. Slice 4 copies its allowlist/fallback/provenance pattern verbatim. Night Shift says how the day *feels*; Mission Director says what the day *is for*. |
| Field Moves | `server/field/fieldOpportunityService.ts` — `rankFieldMoves` | **In-the-moment ranking.** Pure function, now-relative, single pocket (`now` → `nextCommitmentAt`), pressure-ranked, with a closed refusal taxonomy. | Sibling, and the template for Slice 4's ranker and refusal codes. It answers "what next, right now"; Mission Director answers "what is tomorrow for". |

Slice 4 is **selection under constraints for a future business date**. Name it the
Mission Director, put it at `server/missionDirector/`, and register it at
`server/_core/systemRouter.ts` as `system.missionDirector`.

---

## 2. Blocking prerequisite — Slice 1's campaign library

The campaign library does not exist. There is no `campaign_library`,
`growth_campaign`, or equivalent anywhere in `server`, `shared`, `drizzle`, or
`client`. `goldlineCampaignInstances` and `goldlineCampaignRevisions`
(`drizzle/0063_goldline_campaigns.sql`) are **fictional** campaign state and are not
this.

**Do not start Slice 4 until Slice 1 lands.** A planner seeded with hardcoded
campaign constants is the exact failure this slice exists to prevent.

Slice 4 consumes these fields and no others. Slice 1 must emit all of them; if a
field is missing, that campaign is ineligible for automatic selection and the
planner must say so by name.

```
campaignId            stable slug, never renumbered
enabled               boolean, editable by Adam without a deploy
objective             the real business outcome, one sentence
completionCondition   the concrete thing that counts as done
prepLeadDays          integer >= 0. 0 means no advance prep.
prepCondition         what must exist before the mission is eligible
pocketKind            the shape of time it needs (see §4)
pocketMinutesMin      integer, the floor below which it is not attemptable
fallbackVariant       null, or a low-effort version with its own minutes floor
autoVerifiable        closed enum of what Goldline can prove by itself
selfReported          what Adam must confirm himself
missionCategory       the fictional category it maps to
companionAbilityId    null, or a companion capability that helps execute it
timingAssumptions     editable, evidence-informed, never "proven"
```

`timingAssumptions` is editable data, never a constant in the planner. The planner
reads it; it does not embed it.

---

## 3. The tomorrow problem — fix it properly, do not work around it

`server/field/fieldTodayService.ts` `getFieldToday` is **today-only**. It derives
`date` from `now` and queries `orders.pickupDate = date OR orders.deliveryDate = date`.
There is no future-day projection anywhere in the repo.

Night Shift already works around this by synthesising a fake `now`
(`targetStart + 1 hour`) and passing it in. That workaround is quietly wrong and
must not be copied: `now` also drives urgency classification and the
`nextFixedCommitment` filter (`Date.parse(scheduledAt) >= now.getTime()`), so a
synthetic `now` produces plausible-looking but incorrect urgency and next-commitment
values for a future date.

**Required:**

1. Add an explicit optional `businessDate` parameter to `getFieldToday`. When
   present it selects the day; `now` continues to mean the real present and keeps
   driving urgency and `nextFixedCommitment` honestly.
2. When `businessDate` is in the future, `nextFixedCommitment` is the first
   scheduled item of that day, not the first item after `now`.
3. Migrate `gatherNightShiftInputs` onto the new parameter and delete the synthetic
   `now`. Night Shift's existing tests must still pass unchanged.
4. Do not add a second projection. One timeline source, parameterised.

---

## 4. Time pockets — what is actually computable, and what is not

`getFieldToday` reports its own limits in `dataQuality.warnings`:

- laundry order addresses carry no verified coordinates;
- travel duration is unavailable until live routing is configured.

Both are still true. `distanceMiles` in `server/territory/territoryDiscovery.ts` is
straight-line only. `server/geography/googleGeocoder.ts` exists but orders are not
reliably geocoded. **Therefore the planner may not compute travel time, and may not
pretend to.**

Define a pocket as derived from scheduled windows only:

```
TimePocket = {
  startsAt, endsAt            ISO, from scheduled windows only
  minutes                     integer, wall-clock span
  kind                        "between_stops" | "open_ended" | "pre_route" | "post_route"
  boundedBy                   { before: stopId | null, after: stopId | null }
  travelReserveMinutes        from configurable assumptions, NOT an estimate
  usableMinutes               minutes - travelReserveMinutes, floored at 0
  confidence                  "high" | "low"
  warnings                    string[], carried from dataQuality
}
```

Rules:

- `travelReserveMinutes` is a single named, editable assumption. It is a deliberate
  safety margin, not a distance calculation, and every surface that shows a pocket
  must be able to say so.
- `confidence` is `"high"` only when both bounding stops carry real scheduled times.
  A pocket bounded by a `scheduledAt: null` item is `"low"` and may only carry a
  fallback mission.
- An `open_ended` pocket (no later fixed commitment) never claims a minute count.
- Never emit a pocket whose feasibility depends on a travel estimate the system does
  not have. Omit it and record the omission.

Reuse the two existing gap calculators' semantics; do not contradict them. The
90-minute threshold in `detectOpenChannelGap`
(`client/src/pages/driver/goldlineDriverModel.ts:106`) becomes a configurable
assumption shared by both, not a second hardcoded number.

When routing or geocoding later lands, `travelReserveMinutes` is the single seam
that gets replaced. Nothing else in the planner should need to change.

---

## 5. The intelligence boundary — stated, enforced, and tested

"Add an AI layer only where it materially helps" is not a specification. This is.

**Deterministic, always. The model may never touch these:**

- which campaigns are eligible;
- prep lead-time satisfaction;
- pocket detection and pocket/campaign fit;
- ranking and the final selection of primary and fallback;
- the refusal reason when there is no mission.

**Anthropic may do exactly two things:**

1. **Explain** an already-chosen mission in plain language, selecting only from an
   allowlist of facts the deterministic layer assembled.
2. **Draft assets** for a chosen campaign (door-hanger copy, a pitch email), which
   land as drafts requiring Adam's approval and are never sent by the planner.

**Enforcement:**

- Follow `composeAuthoredDayFromBundle` exactly: structured output over an
  allowlist of IDs, parse strictly, validate against the allowlist, fall back
  deterministically on any malformed output, and log rather than throw.
- Every persisted plan carries `intelligence: "deterministic" | "anthropic" | "deterministic_fallback"`,
  matching the `authoredDays.intelligence` convention.
- Use `ENV.anthropicModelMissionPlanner` (`ANTHROPIC_MODEL_MISSION_PLANNER`, already
  defined in `server/_core/env.ts`, falls back to `ANTHROPIC_MODEL`). Do not add a
  new environment variable. Spend is already tracked through
  `assertAiSpendAvailable` / `trackModelUsage` in `server/_core/llm.ts`.
- An empty `ANTHROPIC_API_KEY` is a fully supported production state, not a degraded
  one. The plan is identical; only the prose is plainer.

**The invariant test, which is the point of this whole section:**

> Run the planner over a frozen input bundle twice, once with `ANTHROPIC_API_KEY`
> set and once unset. The selected primary `campaignId`, the selected fallback
> `campaignId`, the chosen pocket, and the refusal reason must be identical.
> Only `explanation` and `intelligence` may differ.

If that test cannot be made to pass, core scheduling logic has leaked into the
model call and the slice is not done.

---

## 6. Failure behavior — a closed taxonomy, never silence

Model this on `FieldMovesResult["reason"]`. The planner always returns a result.
"No mission" is not a result; it is a bug.

```
MissionPlanOutcome =
  | { status: "planned"; primary; fallback; pocket; explanation; intelligence }
  | { status: "fallback_only"; fallback; reason: FallbackOnlyReason; explanation }
  | { status: "no_plan"; reason: NoPlanReason; remedy }
```

`FallbackOnlyReason`:
`NO_QUALIFYING_POCKET` · `PREP_NOT_READY` · `POCKET_CONFIDENCE_LOW` ·
`SCHEDULE_DISRUPTED` · `ROUTE_TOO_TIGHT`

`NoPlanReason`:
`CAMPAIGN_LIBRARY_EMPTY` · `ALL_CAMPAIGNS_DISABLED` · `NO_PREPARED_FALLBACK` ·
`DAY_FULLY_COMMITTED` · `SCHEDULE_DATA_INSUFFICIENT`

Every `no_plan` carries a `remedy`: the one concrete thing Adam could do to make
tomorrow plannable. `NO_PREPARED_FALLBACK` is the most important of these, because
it is the honest way the system says *you have nothing prepped, and that is the
actual problem*. It must never be disguised as a mission.

`PREP_NOT_READY` must name the campaign it rejected and the date by which prep
needed to happen. A door-hanger mission that cannot run tomorrow because printing
did not happen is a real, useful message.

---

## 7. Re-planning and disruption

Plans are append-only revisions, never overwritten. Follow the `authoredDays`
pattern: a `stableKey` per business date, an `inputFingerprint` over the inputs that
produced the plan, and duplicate-key-tolerant insertion via
`isMysqlDuplicateKeyError`.

- Recompute when the fingerprint changes (an unplanned pickup, a cancelled delivery,
  a new commitment, a completed prep step).
- Write a new revision recording the fingerprint delta and the reason. The previous
  revision remains readable, so it is provable what the plan said before the day
  changed.
- On disruption, prefer the fallback rather than degrading the primary. Say that the
  day changed, in one sentence, with what changed.
- Concurrency: reuse the in-flight promise map pattern from
  `runNightShiftForBusinessDate` so simultaneous callers share one run.

---

## 8. Persistence and deployment reality

`scripts/migrate.mjs` is a hand-written idempotent script run by `npm start`. **It
does not execute `drizzle/*.sql`.** A table that exists only as a `.sql` file and a
`drizzle/schema.ts` entry will not exist in production. This is precisely why
`0067` and `0068` are sitting in the Blocked section of `docs/GOLDLINE-TASKS.md`.

Any new Mission Director table therefore needs all three:

1. the `drizzle/NNNN_*.sql` migration;
2. the `drizzle/schema.ts` table definition;
3. a matching idempotent block in `scripts/migrate.mjs`.

The service must also survive `getDb()` returning null, as every neighbouring
service already does.

---

## 9. Surfacing in Driver

The decision moves to the server. The client stops deciding and starts rendering.

`buildDayPlanProjection` in `client/src/pages/driver/goldlineDayPlanModel.ts`
currently derives `growthCoverage` in the browser from a heuristic over stop kinds.
Replace that with the server's plan. `DayPlanProjection` gains the mission plan
alongside `authoredDay`, which it already carries.

- The plan appears before Adam asks for it, the way `authoredDay` already does.
- Primary and fallback are both visible. The fallback is never hidden behind a tap.
- The explanation states the real objective and what completion looks like.
- A `no_plan` result renders its `remedy`, not an empty state.
- The vehicle/facility drawer is untouched. It stays a real operations tool.

---

## 10. Proof — what "done" means

Passing tests are not proof that Goldline works. All five of these are required.

1. **Replay harness.** Freeze real production input bundles for at least five
   business dates into fixtures. Run the planner over each and assert the selected
   primary, fallback, pocket, and refusal code. This is what makes future changes to
   ranking reviewable instead of vibes.
2. **The determinism invariant** from §5, with and without an API key.
3. **Disruption test.** Take a planned day, inject an unplanned same-day pickup,
   re-plan, and assert a new revision exists whose status is `fallback_only` with
   reason `SCHEDULE_DISRUPTED`, and that the prior revision is still readable.
4. **Prep lead-time test.** A campaign with `prepLeadDays: 2` and no prep recorded
   must be rejected tomorrow with `PREP_NOT_READY` naming the missed prep date, and
   must become eligible once prep exists.
5. **Browser verification.** Run `npm run dev`, open Driver, and confirm the plan
   renders unprompted with both missions and the explanation. Then open Admin and
   confirm nothing regressed. Capture it.

### The usefulness measure the original slice ducked

A plan that is credible is not the same as a plan that is useful, and no test can
tell the difference. So record it:

- Each plan revision gets a one-tap outcome from Adam: **used it / ignored it /
  wrong mission for that day**.
- Store the outcome against the plan revision and the campaign, in the place Slice 1
  created for recording Adam's own results.
- After two weeks this is the only honest evidence about whether the Mission
  Director is worth keeping, and it is also the training data for the campaign
  library's timing assumptions.

Ship this in Slice 4. It is small, and without it the next slice has no ground truth.

---

## 11. Success condition

Goldline produces, for tomorrow, a primary growth mission and an already-prepared
fallback mission, both selected deterministically from Adam's own enabled campaign
library against his real schedule; explains the choice in plain language; re-plans
into a recorded new revision when the day changes; refuses with a named reason and a
concrete remedy when it cannot plan; and records whether Adam actually used it.

## 12. Out of scope

No new companions. No combat, art, or desktop mini-games. No changes to the
vehicle/facility drawer. No writes to business truth from any fictional surface —
the planner reads the world and proposes; it never records an outcome Adam did not
take.
