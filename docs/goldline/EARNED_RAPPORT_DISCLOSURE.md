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
| Sources | confirmed, persisted field-visit outcome (debrief) | paid-order truth (`cleancloud_paid_orders`), won mission outcome |
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

## Entitlements

`refreshProgression` mints at most one entitlement per qualifying business-progress evidence row (unique on
`evidenceId`), only when the operator's rung is >= 1, stamped with the recognition time (never backdated).
A new reveal: **reserve** (after the answer clears validation) -> **commit** at the delivery boundary (fragment
disclosed, entitlement consumed). On a phone call the boundary is the *next* turn arriving
(`commitPendingDisclosures` in `runClaireTurn`). An uncommitted reservation returns to `unused` after
`entitlementReservationTtlMs`. Generation failure, validation failure, provider failure and reservation failure
all leave the fragment undisclosed and the entitlement unused, and route to an approved decline.

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
