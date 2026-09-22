# WEEKLY GROWTH CANDIDATES

Project B. Claire's strategic pre-read: a capped, read-only, provenance-backed menu of growth motions the business already supports.

This document is the B contract. Project A's weekly planning law stays in `docs/goldline/GOLDLINE_WEEKLY_MISSION_READINESS.md` when that document is on the branch. This file does not restate it.

Allocator is not originator. Claire is not a free-form CMO. B answers which real growth motions Goldline and the current business state already support. It does not answer the best tactic anywhere in the market.

## What this is not

B does not schedule the week, assign weekdays, lock WeeklyIntent, create Day Director work, create Mission Director plans, build the week brochure, or build an external Growth Intelligence Scout.

A candidate is not a primary. B does not output `businessDate` or `recommendedBusinessDate`.

No projected dollars, likely customer counts, or conversion probability. Historical order count, average paid order value, the existing churn score, and days since the last paid order may appear only as labeled observed signals.

## Canonical type

One shared contract: `shared/weeklyGrowthCandidates.ts`.

Server assembly: `server/weeklyGrowthCandidates/`.

Do not publish a second candidate type under `server/claire`, `server/missionDirector`, or weekly mission.

Public port:

```ts
loadWeeklyGrowthCandidates({
  tenantId,
  operatorUserId,
  dayDirectorActorId,
  remainingDates,
  now,
  timeZone,
}) => WeeklyGrowthCandidateFeed
```

Project A imports this function and `WeeklyGrowthCandidate`. It does not need churn, board, campaign, or follow-up internals.

`remainingDates` is used only to judge whether prep can fit the horizon. It does not assign a day.

## Pipeline

READ → NORMALIZE → DEDUPE → RANK → CAP → RETURN.

Zero business mutations. Looking at a future day must not create that day.

The loader does not call `ensureAdamBoard`, Mission Director `planForDate`, Daily Command `projectRecurrenceForDate`, strategy snapshot construction, the mission sequencer, campaign mutation, churn-intervention creation, follow-up writers, spend reservation, or messaging APIs.

## Sources

| Source | Reader | Eligible | Cap |
|---|---|---|---|
| Unfinished growth | open day-director rows, `listCommercialMissions`, `listOpsTasks`, `listOperatorRuns` | Explicit growth tag, sales, campaign link, commercial acquisition, or proactive recovery. Operational classes excluded. | All that pass, subject to the total |
| Commercial follow-up | `commercial_follow_ups` select | `open` only. Completed and cancelled excluded. | Shared follow-up cap 5 |
| Proactive obligation | `loadObligations` | `sales_follow_up` and `dormant_recovery` in `scheduled`, `draft_prepared`, or `awaiting_result`. `data_health`, completed, cancelled, superseded, and fixtures excluded. | Shared follow-up cap 5 |
| Customer recovery | `getLatestChurnScan` plus `isDealable` / `rankCandidates` | The existing lever only. Active orders and below-threshold customers stay out. | 3 |
| Campaign library | `listCampaigns` | Enabled templates. Disabled excluded. | 8 |
| Macro goal | `getActiveMacroGoal` | Ranking context only. Cannot mint a row. | none |

Total hard cap: 15.

Source reports distinguish unavailable from observed empty, and shown from existed: `observedCount`, `eligibleCount`, `rankedCount`, `shownCount`. A failed recovery read is `unavailable` plus a reason. It is not “0 dormant opportunities.”

WeeklyIntent-versus-Daily-Command execution history is out of V1. No authoritative reader for it is on this branch.

`server/strategy/snapshotBuilder.ts` is not an input. Its hard-coded opportunities, campaigns, capacity, and outcomes cannot enter the feed.

`server/strategy/missionSequencer.ts` placeholders are not an input. No placeholder managers, default geography, generic unit counts, or synthetic opportunities.

## Growth versus operations

Eligible unfinished work must already be grounded as growth, sales, campaign-linked, commercial acquisition or follow-up, proactive customer recovery, or an explicit growth tag.

Never emit pickups, drop-offs, route stops, laundry processing, JETRO or procurement, plant work, housekeeping, cargo-only, maintenance, or generic admin. Ambiguous rows are excluded. The exclusion list does not promote ordinary work into growth.

Continuity means continue meaningful growth already underway. An enabled template has `alreadyInFlight: false` unless an authoritative record (an active campaign run, or other stable id link) says that motion is underway. A follow-up already on the day line is `alreadyInFlight: true`.

An active campaign run has no title of its own. Its title and objective come from the Campaign Library row for that campaign id, including a disabled row, when that source is available and the row has a human-readable title. If the library is unavailable, the template is absent, or the row has no title, the run is not emitted. The feed does not invent a title from the campaign id, and it does not report the run as unread. Every emitted candidate has a non-empty title and objective.

## Dedupe

Same underlying motion across Day Director, a proactive obligation, and a commercial follow-up becomes one candidate. The link is a stable id (`followUpId`, obligation id, `sales:{missionId}:{utcDue}`, campaign id, customer key for recovery). Similar titles stay distinct.

The winner is the most specific in-flight authority. Supporting `sourceRefs` are kept.

## Ranking

Deterministic. No LLM, randomness, array-order accident, or novelty bonus.

Across classes:

1. Unfinished meaningful growth
2. Due or open commercial follow-up
3. Active proactive obligation
4. Eligible scored recovery
5. Enabled campaign template

Within a class the ordered tuple is: already in flight, follow-up due or overdue, the existing lever order for recovery (warm rank from `rankCandidates`, same pool as big swing), prep feasible, macro-goal alignment, stable id.

Recovery does not invent a score. Warm rank is the menu order. Big-swing rank is preserved as an observed lever position. Churn score, history count, days since last paid order, and average order value are labeled observed history. Estimated monthly impact is not copied onto the candidate.

Macro alignment raises account acquisition, territory, relationship, commercial follow-up, recovery, and retention for `new_paying_customers`, `active_customers`, `paid_orders_per_period`, and `net_sales_per_period`. It does not raise reputation, digital presence, or alliance. `continue_existing` without a specific motion is not treated as aligned.

Rank reason codes, and only these codes:

`CONTINUE_EXISTING_WORK`, `FOLLOW_UP_DUE`, `FOLLOW_UP_OVERDUE`, `PROACTIVE_OBLIGATION_ACTIVE`, `HIGH_CHURN_PRIORITY`, `STRONG_CUSTOMER_HISTORY`, `MACRO_GOAL_ALIGNED`, `CAMPAIGN_ENABLED`, `PREP_REQUIRED`, `INSUFFICIENT_PREP`, `LOW_CONFIDENCE_ASSUMPTION`.

## Prep

Prep-infeasible candidates are emitted. `prep.feasibleWithinHorizon` is false and the reason codes include `INSUFFICIENT_PREP` and, when the template recorded lead time or a condition, `PREP_REQUIRED`. Work already in flight stays feasible: the lead time has already been spent. B still does not pick a business date.

`fit` carries `pocketKind` and `minimumMinutes` when the campaign template recorded them. Missing fit stays null.

## Observed signals and assumptions

Observed signals and assumptions are separate fields. Campaign timing assumptions keep their text, source, and `recordedAt`. Confidence and evidence class stay null when the source did not record them. Informal guidance is not upgraded into a fact.

## Identity, tenants, fingerprint

Candidate ids are `wgc:{tenantId}:{stable source identity}`. No random ids.

Tenant A's follow-ups, work, and customers do not appear for tenant B. Operator-assigned work does not appear for another operator. Recovery scans and campaign templates are tenant-scoped because those readers are tenant-scoped. The same template id may exist for two tenants; that is not evidence either operator has started it.

The fingerprint is SHA-256 of canonical JSON. It changes when candidate content or order changes. It does not change for object key order, `generatedAt`, or provenance `observedAt`. Nothing is persisted in order to fingerprint.

## Later scout

No external scout in V1: no Instagram, Reddit, TikTok, blogs, web, research agent, or trend brief.

A later path, not built here: external signal → Claire proposes an experiment → operator approves → temporary Campaign Library experiment → `growthCandidates`. Raw signals will not bypass the Campaign Library.
