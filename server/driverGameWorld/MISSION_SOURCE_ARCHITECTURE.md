# Mission Source Architecture

How Goldline missions get produced today, and how a future mission-source
family could plug into the same world without rewriting traversal,
encounters, Armory, mutation, or mission projection.

This document does **not** implement any new source. Shopify, Meta Ads,
Alibaba, investor/VC pipelines, and similar are explicitly out of scope —
see the exclusions list in the Slice 29-36 run this document was written
for. What follows is architecture only, so that decision is easy to make
later without a rewrite.

## The four sources that exist today

| Source | Where | Real output shape |
|---|---|---|
| FIELD | `server/field/getFieldMoves.ts` | `FieldMoveCandidate` / `FieldMovesResult` |
| Cold Call | `server/driverGameWorld/coldCallBurstService.ts` | `ColdCallBatch` / `ColdCallTarget` (`shared/coldCallBurst.ts`) |
| Recovery / Rekindle | `server/driverGameWorld/driverGameWorldService.ts` | `DriverGameWorldNode` (`shared/driverGameWorld.ts`) |
| Expansion Scout | `server/driverGameWorld/expansionScoutService.ts` | `ScoutDiscovery` → a real `commercialMissions` row |

These are four independently-shaped services, not four implementations of a
shared runtime interface — and this run does not force them into one. What
they do share, and what any future source must also produce, is described
by `shared/missionSource.ts`'s `MissionSourceAdapter<TCandidate, TMission>`
type: a documentation-grade contract (`discover`, `normalize`,
`evaluateEligibility`, `buildMission`, `provenance`, `dedupeIdentity`), plus
one real, reusable function, `dedupeByEntityIdentity`, wired into
`client/src/game/state/WorldProjection.ts` so a business discovered by two
sources still produces exactly one mission (see `MISSION_SOURCE_PRIORITY`
for the tie-break order).

## What every mission must answer

Regardless of source, per `MissionSourceProvenance`:

- **Why does this exist?** — `eligibilityReason`, grounded in real evidence.
- **Where did it come from?** — `sourceType` + `sourceReference`.
- **What real entity/event supports it?** — the `dedupeIdentity` key.
- **Why is it actionable now?** — the same eligibility check, never a
  fabricated urgency score.
- **What makes it unique?** — the entity identity itself; two sources
  producing the same identity collapse to one mission.

## How a future source would plug in

A future `CommerceSourceAdapter`, `SupplierSourceAdapter`,
`RetailBuyerSourceAdapter`, or `InvestorSourceAdapter` (examples only —
none implemented) would:

1. Implement `discover(context)` against its own real system — an API, a
   feed, an evidence table. Never synthesize candidates.
2. Implement `evaluateEligibility(candidate, context)` using real
   evidence — service radius, contact permission, whatever the source's
   domain requires. This is where "no fake urgency score" gets enforced.
3. Implement `dedupeIdentity(candidate)` returning a stable real-world key
   (a provider account id, a business registration number, whatever
   uniquely identifies the entity in that source's system) so
   `dedupeByEntityIdentity` can collapse it against FIELD/Recovery/Scout
   candidates for the same entity.
4. Implement `normalize`/`buildMission` to produce the same
   `CommercialMission`/`DriverGameWorldNode` shapes the existing four
   sources already produce — this is the part that lets the new source
   skip touching traversal, encounters, Armory, mutation, or mission
   projection entirely. Those systems only ever consume the normalized
   shape, never a source-specific one.
5. Attach `provenance()` so the mission can always answer the five
   questions above.

No adapter class for any of these four future sources exists in this
codebase. Building one is a separate, later product decision.
