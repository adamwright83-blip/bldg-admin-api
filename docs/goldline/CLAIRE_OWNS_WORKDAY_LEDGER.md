# Claire Owns the Workday — slice ledger

This document constrains the Claire-owns-the-workday program. Do not rebuild Claire V1.
Do not invent a second task database, a second Claire, Sage, or a second field-evidence store.

Starting SHA: current `origin/main` after Claire V1 (PR #142).

## Slice 0 audit (current main)

### KEEP

- Claire V1 contracts in `shared/claireRuntime.ts`
- Voice commitment loop, runtime view, context assembler, relationship/canon
- Day Director + `metadataJson` (`detailState`, `hiddenFromDayPlan` snapshots)
- MissionSalesBrief evidence watermark / v1 → v2
- Driver hologram (`callBeforeDrive`) and `previewClairePreDrive`
- `goldlineDayPlanModel` / `GoldlineDayPlan` (yellow = NEEDS_DETAILS presentation only)
- Night Shift authored days as presentation, not a second task DB
- Mission Director (do not replace)
- `externalOrders` screenshot extract → review → `confirmImport`
- `driverSalesJournals` persistence (retire required UI, keep evidence)
- Campaign runtime hosts in `shared/goldlineCampaignRuntime.ts`
- Corridor packs, transition controller, Trailblazer, checkpoint (positional only)

### REUSE

- `extractConversationalFieldOutcome` + hearsay vs attested
- `updateDayDirectorCommitment` for same-item clarification
- Hidden Day Director rows for confirmed evening-plan snapshots (no migration)
- Existing gameplay hosts as approach destinations
- `previewClairePreDrive` as the lightweight reviewer harness

### RETIRE (as primary UX; keep fallback/history)

| Surface | Classification | Replacement |
|---|---|---|
| BRIEF THE LINE textarea | OBSOLETE primary | PLAN TOMORROW WITH CLAIRE |
| TURN THIS INTO A DRAFT MISSION | OBSOLETE primary | Claire confirmation of existing identities |
| Required Field Notes / SalesJournal after visit | FALLBACK/REVIEW | FIELD_DEBRIEF conversation |
| PLAY THIS AS THE ASSIGNED ACTION | OBSOLETE CTA | Intent CTAs (START / CONTINUE / START MISSION / REVIEW WITH CLAIRE) |
| NO ACTIVE MISSION / NO ACTIVE OBJECTIVE as dead end | OBSOLETE copy | Calm no-required-work state |
| THE LINE ENDS HERE — BEYOND IS UNWRITTEN | OBSOLETE player copy | Arrive at destination, or calm dead-air |
| SAFE/INTEL/UPPER LINE player labels | REWRITE if no live branch mechanic | Drop fossil vocabulary |

### REPLACE

- Empty-day briefing form → evening Claire planning with preloaded truth
- Forced Field Journal after visit → conversational debrief, journal remains fallback
- Blind corridor_01 → corridor_02 at progress % → approach sequence only when a destination exists

### DEFER

- Full corridor rewrite into Overworld
- XP / unlock kingdom gates
- Conversation Intelligence / Relay
- Pricing, UA/BDA, Domain Compiler, generalized Goldline Runtime

## Manual re-entry inventory (Slice 1)

| Surface | Class |
|---|---|
| BRIEF THE LINE / OpenChannel transcript | OBSOLETE |
| Field Journal / SalesJournalSheet required after visit | FALLBACK/REVIEW |
| Day briefing textarea | OBSOLETE primary |
| CleanCloud screenshot upload | REQUIRED INPUT |
| CleanCloud row review/edit | REQUIRED INPUT (correction only) |
| Manual Add CleanCloud job | FALLBACK |
| Day Director "add commitment" when Claire is available | FALLBACK |
| Log Signal structured capture on sourced target | REQUIRED INPUT (canonical visit writer for that run) |
| Draft mission textarea | OBSOLETE primary |

## Persistence (no migration)

Confirmed evening plans store as a Day Director commitment:

- `idempotencyKey = claire-workday-plan:${businessDate}`
- `metadataJson.hiddenFromDayPlan = true`
- `metadataJson.snapshot = ConfirmedWorkdayPlan`

`getDayDirectorState` filters these rows out of the Driver dayline.

## Laws this program does not reopen

Game never creates business truth. Model prose never mutates. No fake success.
Night plan is provisional; morning is a deterministic delta. Hearsay stays hearsay.
Completed history is immutable. Command / Play are experience modes, not commercial tiers.
