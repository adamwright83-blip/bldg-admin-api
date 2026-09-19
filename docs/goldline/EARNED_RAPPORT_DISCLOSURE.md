# Earned Rapport + Guarded Disclosure — implementation reference

This document constrains future Claire relationship/story work. It records what was built for the
2026-09-18 binding brief and where the human-only pieces remain.

## Product laws (do not soften)

- Effort earns rapport. Verified business progress creates the *possibility* of new biography. Claire never
  volunteers biography; the operator has to ask.
- A safe failure never burns an earned reveal.
- Canon is source truth, never read-aloud dialogue.
- Bad business luck never costs Claire's regard. Nothing here can lower a grant.
- No amount of chatting substitutes for real-world work. `call_completed`, chat turns, mission acceptance,
  path choice and opening the app are *not representable* as evidence (`progression/evidence.ts`).
- The operator never sees the machinery. Everything below is admin/debug only.
- Claire is a hidden discovery game. Prior questions, refusals, disclosures and closed threads are durable
  state (`claire_personal_ledger`). Do not generalize this mechanic to other characters.

## Two currencies (never one score)

| | Growth action (effort) | Business progress |
|---|---|---|
| Drives | rapport band | rung eligibility + entitlements |
| Sources | confirmed, persisted field-visit outcome (debrief) | the CANONICAL customer/order truth (`geography/customerOrderTruth` + `customerAssets/customerIdentity`: native Laundry Butler + CleanCloud, report duplicates already merged, canonical identity groups), and a won mission outcome |
| Counts a loss? | yes (a real visit) | never; no negative evidence exists |
| Timestamps | `occurredAt` (chronology), `recognizedAt` (may it count yet) | same |

Modules (`server/claire/progression/`): `policy.ts` (the ONE versioned policy), `evidence.ts`,
`evaluate.ts` (pure, shared with the simulator), `service.ts`, `store.ts` / `drizzleStore.ts`,
`paidOrderProgress.ts`, `evidenceSources.ts`, `personalController.ts`, `personalReveal.ts`,
`personalFollowUp.ts`, `pendingReceipts.ts`, `dialogueRegistry.ts`, `authoredDialogue.ts`,
`declineTelemetry.ts`, `toneLint.ts`, `simulator.ts`.

## Policy and versioning

All thresholds live in `policy.ts` and are provisional tuning values. Grants store the highest rapport band and
rung reached **and the policy version that granted each**. Grants are monotonic in three places: the evaluator,
the in-memory store, and the database upsert (`GREATEST`). Stricter thresholds never demote; easier ones advance.

## Business-progress identity and epoch

- **One business event = one evidence identity.** Unique on (operator, category, sourceType, sourceId); `kind` is
  deliberately not part of the key, so re-mapping a classification can never mint a second event or entitlement.
- **Canonical identity only.** Customers are the canonical identity groups. A customer name is never identity
  evidence: rows the canonical layer could not identify are orphans and cannot assert "new customer" or "dormant return".
- **One first-building milestone.** `first_paid_order_target_building` is the earliest paid order in a target building
  (one per building). Later genuinely-new residents there are separate `new_paying_customer` progress. Each order emits
  at most one evidence row (its strongest kind).
- **Epoch, not a recognition-lag cutoff.** `policy.progressEpoch` marks the operator's pre-existing baseline. Results
  that OCCURRED before it are baseline (canonical orders remain the record) and never count as progress; results that
  occurred after it always count, however late they were imported. Delayed imports never rewrite reality.

## Entitlements (no-backlog, atomic, durable)

- **Mint.** While below Rung 1 nothing mints. The first time an operator is eligible, AT MOST ONE prior qualifying
  progress event funds the initial entitlement (the most recently recognized). After that, each newly recognized
  qualifying event (recognized after the per-operator watermark) mints at most one. No warehouse of retroactive reveals.
- **Reserve** after the answer clears validation; the reservation durably stores conversation, fragment, topic, rung and
  rapport band, so any replica or a restarted process can commit it.
- **Commit** is ONE transaction: conditional reserved->consumed AND the `disclosed` ledger row, all or nothing. It runs at
  the top of the next verified Twilio webhook for the call (before empty-transcript, close-phrase or ordinary routing), so
  "reveal, then goodbye" still records it. No in-process pending state exists.
- **Lapse.** A reservation that is never committed returns to `unused` after `entitlementReservationTtlMs`.
- Generation, validation, entailment, provider and reservation failures all leave the fragment undisclosed and the
  entitlement unused, and route to an approved decline.

## Personal routing and claim validation

- Any Claire-directed personal question (`isPersonalQuestionAboutClaire`) routes to the guarded controller. A known topic
  maps to canon fragments; an unknown personal topic is an approved decline. It never falls through to unrestricted generation.
- Defense in depth: on every non-personal answer, first-person biography that is not an authorized core fact is replaced
  by an approved decline.
- **Entailment.** Every biographical proposition in a reveal must be supported by the authorized fragment or facts already
  disclosed to this operator. Layer 1 (deterministic) rejects claim-family words (family, emotion, personality, chronology,
  causality, frequency, events) absent from the authorized facts and any single distinctive word borrowed from another
  canon fragment. Layer 2 is a model verifier on the live path that can only REJECT further; error, timeout or anything but
  a clear ENTAILED is a rejection.

## Live language and call control

- The failure-day lint (`toneLint.ts`) runs on every live non-personal answer while the mechanic is on; a violating line
  is never spoken (the deterministic fallback is used) and the reason is recorded. Operational follow-through passes.
- `PersonalTurnResult.endCall` is threaded through `runClaireTurn` to the Twilio handler, which hangs up. It stays dormant
  while no authored `call_exit` line exists.

## Enabling in production (default OFF)

`CLAIRE_PROGRESSION="tenantA,tenantB"` (or `*`) turns the mechanic on per tenant. In production it ALSO requires
`CLAIRE_PROGRESSION_CONTINUITY_REVIEWED=1`. Outside production it defaults ON so tests/local exercise it. While OFF,
Claire behaves exactly as before: tier-based canon, the previous personal-answer recovery, no progression hooks in the
turn path. (Evidence recording is passive and additive; it is always on and changes no behavior.)

**Continuity decision table** — the new tables start empty while legacy relationship state already exists:

| Legacy state | On enable | Notes |
|---|---|---|
| `claire_relationship_state.disclosureTier` | not carried over; rung starts at 0 | run `scripts/claire-progression-continuity-report.ts` first |
| facts possibly told under the old system | not recorded as disclosed | no old ledger exists; only an upper bound is inferable from `claire_generation_logs` (personal mode) |
| `claire_relationship_events` (incl. attested disclosures) | untouched, still feed disclosure safety | |
| rapport | recomputed from verified field-visit evidence going forward | |

Default is an **intentional reset**. Do not backfill by guessing; if a human wants specific operators carried over,
that is a deliberate production data write with its own review (none is performed by this PR).

## What is deliberately NOT built (human-only)

- **Slice 0 phone acceptance.** Automated tests cannot pass it; the pass criterion is Adam saying Claire feels like
  someone he wants to keep talking to. No outbound call has been placed.
- **Authored dialogue.** `authoredDialogue.ts` seeds only the five approved generic declines. Thread closers,
  business pivots, call exits, boundary reinforcement and recovery lines are empty categories. Consequences:
  closers/recovery fall back to the approved decline floor; business pivots and **actual call hangup stay dormant**
  until lines are authored (fail closed by design).
- Live-model voice review of reveals. `scripts/claire-progression-exam.ts` uses a deterministic stand-in for the
  model, so it verifies server behavior, not language quality.

## Extension seams for a future Narrative OS

`claire_personal_ledger` is append-only, keyed by operator, and records topic, fragment id, entitlement id, and the
rung/band at the time. Build story state on top of it; do not add a second relationship architecture.
