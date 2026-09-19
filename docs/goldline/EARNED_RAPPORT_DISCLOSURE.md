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
| Live sources (policy `2026-09-19.2`) | debrief-confirmed persisted field-visit outcome; completed `commercial_follow_ups` (status completed + completedAt + completedBy) | canonical customer/order truth (`geography/customerOrderTruth` + `customerIdentity`: native + CleanCloud, duplicates merged, canonical identity groups) → `new_paying_customer`, `dormant_customer_reorder`; debrief-confirmed won mission → `target_account_won` |
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
- **Unsupported kinds are rejected, not implied.** No persisted proof exists for calls, outreach, door hangers, return-after-no,
  first paid order in a target building (commercial missions/accounts carry no building mapping), attributable revenue, meetings,
  approvals or deal stages, so validation rejects them in this policy version. Each order emits at most one evidence row.
- **recognizedAt is the authoritative observation time** carried on the canonical order record (native: its creation;
  CleanCloud: the EARLIEST import row across both report types). An order with unknown observation time is skipped, never guessed.
- **Epoch, not a recognition-lag cutoff.** `policy.progressEpoch` marks the operator's pre-existing baseline. Results
  that OCCURRED before it are baseline (canonical orders remain the record) and never count as progress; results that
  occurred after it always count, however late they were imported. Delayed imports never rewrite reality.

## Entitlements (no-backlog, atomic, durable)

- **Mint.** While below Rung 1 nothing mints. The first time an operator is eligible, AT MOST ONE prior qualifying
  progress event funds the initial entitlement (the most recently recognized). After that, each newly recognized
  qualifying event mints at most one. The cursor is `(recognizedAt, evidenceId)` and only advances past an event whose
  entitlement was created or already exists, so a failed insert or an equal timestamp can never hide an event. No warehouse of retroactive reveals.
- **Reserve** after the answer clears validation; the reservation durably stores conversation, fragment, topic, rung and
  rapport band, so any replica or a restarted process can commit it.
- **Commit** is ONE transaction: conditional reserved->consumed AND the `disclosed` ledger row, all or nothing. It runs at
  the top of the next verified Twilio webhook for the call (before empty-transcript, close-phrase or ordinary routing), so
  "reveal, then goodbye" still records it. No in-process pending state exists.
- **Lapse.** A reservation that is never committed returns to `unused` after `entitlementReservationTtlMs`.
- Generation, validation, entailment, provider and reservation failures all leave the fragment undisclosed and the
  entitlement unused, and route to an approved decline.

## Personal routing and claim validation

- With the flag ON, any Claire-directed personal or life-history question (`isPersonalQuestionAboutClaire`, incl. "have you ever", "what happened to you", "your first job") routes to the guarded controller. A known topic
  maps to canon fragments; an unknown personal topic is an approved decline. It never falls through to unrestricted generation.
- **General-answer biography boundary (semantic, fail-closed, no gate).** Outside the guarded controller the model may never
  establish Claire biography. Natural-language autobiography cannot be enumerated structurally (object pronouns, implicit
  subjects, present-tense settings), so there is NO candidate-detection heuristic deciding whether to check: with the flag ON,
  EVERY model-generated general answer about to be spoken goes to a bounded one-word verifier (`generalBiographyBoundary.ts`).
  The verifier receives the authorized facts and the answer as UNTRUSTED QUOTED DATA (a JSON string in the user message, never
  in the instructions) and must reply exactly `CLEAN`; BIOGRAPHY, garbage, error, or a 4s timeout all reject. Zero-latency
  deterministic rejects run first: obvious legacy patterns, and any answer that addresses the verifier (prompt injection). A
  rejection is replaced by the existing conservative fallback and never regenerated. Cost: one bounded call (8 tokens, temp 0)
  per generated answer while ON. `CLAIRE_BIOGRAPHY_VERIFIER_MODEL` selects the verifier model; production uses `claude-haiku-4-5-20251001` (see live results below).
  Applied at every speech-producing site: follow-up, opening brief, post-stop opening, outcome confirmation, encyclopedia
  rewrite. Flag OFF: none of it runs.
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
turn path. Evidence recording is additive and always on, and it is NOT inert: a confirmed visit also syncs canonical order truth and refreshes the
grant, so rapport band, rung, cursor, entitlements and ledger rows accumulate DORMANT while the flag is OFF. They cannot change
Claire's behavior until enabled, but the new tables are not empty at activation. `scripts/claire-progression-continuity-report.ts`
reports them.

**Continuity decision table** — legacy relationship state exists AND the new tables may already hold dormant progression:

| Legacy state | On enable | Notes |
|---|---|---|
| `claire_relationship_state.disclosureTier` | not carried over; rung starts at 0 | run `scripts/claire-progression-continuity-report.ts` first |
| facts possibly told under the old system | not recorded as disclosed | no old ledger exists; only an upper bound is inferable from `claire_generation_logs` (personal mode) |
| `claire_relationship_events` (incl. attested disclosures) | untouched, still feed disclosure safety | |
| rapport | recomputed from verified field-visit evidence going forward | |

The report (read-only) enumerates every operator found in ANY legacy source (relationship state, generation logs, relationship events) or new table, shows both states per operator, and classifies each as `pristine`, `persisted_state_not_behavioral` (e.g. a cursor or grant row: real continuity state that does not change behavior by itself) or `dormant_active_on_enable`. It chooses none of
the three options: **preserve** the accumulated new progression, **reset** it, or **migrate/reconcile** deliberately. Any reset or
carry-over is a deliberate production data write with its own review; nothing here performs one.

## Live verification (2026-09-19, real models + real production MySQL, isolated tenant)

- **MySQL:** `scripts/claire-progression-mysql-verify.ts` — 20/20 (evidence idempotency, monotonic grant, no-backlog cursor,
  reserve/commit atomicity, InnoDB rollback, release, continuity read); rows removed.
- **Continuity:** `scripts/claire-progression-continuity-report.ts` against production: tenant `default`, operators `adam-admin`
  and `driver-primary`, both legacy tier 0 / no personal generations / no attested disclosures, new state pristine.
- **Live exam:** `scripts/claire-progression-live-exam.ts` (no phone call): business, first-person business language, no-access
  decline, authorized reveal (reserved then committed), unknown personal topic, adversarial verifier suite (12 invented / 6
  business), verifier error and timeout, band-2 register, failure day, brief / post-stop / outcome paths.
- **Defects the live models exposed (all fixed, all regression-tested):** ordinary idiom ("I'll leave it there", "something",
  "missing") mistaken for biography by the deterministic layer; a sentence-initial ordinary word ("Complicated") mistaken for a
  place; a reveal-side verifier that accepted embellishment ("gave lectures", "respectable"); a general verifier prompt too weak
  for a small model and too strict about task narration; a 2.5s timeout inside the default model's latency tail.
- **Verifier latency:** small model ~0.96s median (max ~1.9s); Claire's default model ~1.3–1.5s median with a tail up to ~8s
  before the prompt/timeout changes. Both pass the adversarial suite (0/12 invented passed, 0/6 business blocked). Production
  uses the small model. This adds roughly one second to a generated answer while the mechanic is ON.
- **Not exercised live:** the encyclopedia rewrite (needs production business data; unit-tested), and how Claire SOUNDS on a
  phone call (Slice 0 is a human listening gate).

## Enabling (all mechanical gates green; human Slice 0 pending)

Railway variables on `bldg-admin-api`: `CLAIRE_BIOGRAPHY_VERIFIER_MODEL=claude-haiku-4-5-20251001`,
`CLAIRE_PROGRESSION_CONTINUITY_REVIEWED=1`, `CLAIRE_PROGRESSION=default` (tenant scope only, never `*`). Rollback: unset
`CLAIRE_PROGRESSION` (behavior returns to exactly the legacy path; accumulated rows are inert).

## What is deliberately NOT built (human-only)

- **Slice 0 phone acceptance.** Automated tests cannot pass it; the pass criterion is Adam saying Claire feels like
  someone he wants to keep talking to. No outbound call has been placed.
- **Authored dialogue: done (2026-09-19).** Rapport-tiered declines, thread closers, business pivots and call exits are authored in
  the locked Claire voice (British, dry, no biography, no counters). `recovery_after_failed_generation` intentionally has no lines, so a
  lost reveal is indistinguishable from a refusal; `boundary_reinforcement` is unused. Call hangup is live once the mechanic is
  enabled, and only after the personal thread closes AND business is complete.
- Live-model voice review of reveals. `scripts/claire-progression-exam.ts` uses a deterministic stand-in for the
  model, so it verifies server behavior, not language quality.

## Extension seams for a future Narrative OS

`claire_personal_ledger` is append-only, keyed by operator, and records topic, fragment id, entitlement id, and the
rung/band at the time. Build story state on top of it; do not add a second relationship architecture.
