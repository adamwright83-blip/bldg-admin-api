**This document constrains future JOYSTICK / Goldline work. Current production/main outranks prose.**

# JOYSTICK SPIRIT HUMAN RESCUE — HANDOFF

**Status:** corrective pass on PR #163 (`cursor/joystick-spirit-human-rescue`), **not merged**. Do not merge until reviewed.
**Base:** `main` @ `9ce811ce65bc92c26e228fa79c6f6e854c418f2d` (BIO CONTAINMENT PR #162)
**Independent of:** Claire Intelligence PR #161, xAI/ZDR branch, Kingdom 3, desktop rescue art, new game architecture

## Reality contract

REALITY determines what happened. THE GAME may invent why it happened.

| Event | Real meaning | Fantasy meaning | Mission |
|---|---|---|---|
| Draft / preview / local CTA | Nothing was sent | Threat may freeze | Not complete |
| Explicit operator approve+send + Twilio create accepted (SID) | We requested an outbound SMS and the provider accepted that request | Spirit Human link reached; villager rescued | `completed` |
| Provider rejected / unconfigured / permission / unresolved contact | Customer was not contacted | Villager still caged | `problem`; retry only when the failure is actually retryable |
| Persisted `sending` after restart | **Unknown / ambiguous outcome** — the process died around a provider call | Villager still caged; do not pretend rescue | `send_outcome_unknown`; **no automatic retry** |
| Customer no longer dormant at send | Outreach is unnecessary; they were a valid target when instantiated | Encounter closes without rescue | `superseded` |
| NOT NOW | Operator deferred this encounter | Threat stops for now | Durable `deferredAt`; mission can resurface |
| CANCEL | Operator closed this mission | Encounter skipped | `skipped` / `cancelled` |
| Later reply | Reply observed (when wired) | Optional later world beat | Does not rewrite send |
| Later paid order | Reactivation/business result (when wired) | Stronger later world beat | Does not rewrite send |

**Provider acceptance proves only this:** Twilio accepted the create request and returned a Message SID (`evidenceName: provider_accepted`). It does not prove delivery, read, reply, or reorder.

**An ambiguous send means:** a send attempt was claimed (`sending`) and then the process was lost before a receipt could be persisted. The customer may or may not have been texted. The system fails closed: it will not send again, and it will not mark the mission rescued.

Permanent rule: **provider accepted send ≠ replied ≠ reordered.**

## What is now durable

Production defaults to `DrizzleRescueMissionStore` on `spirit_human_rescue_missions` (migration `0088`, applied by `scripts/migrate.mjs`). Memory store is test-only. There is no silent fallback from a configured/unavailable database to memory; persistence failures fail closed.

Survives restart / second store instance / second process:

- mission id
- frozen `snapshotCustomerId`
- villager assignment
- draft
- send attempt / receipt / completion
- consequence rows that were saved
- NOT NOW vs CANCEL
- tenant + operator scoping

`sendStatus` is a first-class column so a send attempt is claimed with compare-and-set.

## How duplicate send is prevented

1. Same-process in-flight coalescing (one Promise per mission).
2. Durable CAS: only `awaiting_approval | draft_ready | send_failed` **and** lifecycle `available | active | problem` can become `sending`. `superseded` / `skipped` / `completed` cannot win a send claim even if `sendStatus` is still claimable.
3. `sent` + `provider_accepted` + SID is immutable success; later sends return that record and make **zero** provider calls.
4. Persisted `sending` loaded with no live in-flight request becomes `send_outcome_unknown`. Zero provider calls. Manual reconciliation, not automatic retry.
5. After the durable `sending` claim, an ambiguous Twilio transport/result (timeout, disconnect, 5xx, 429, 408, missing SID) becomes `send_outcome_unknown`, never `send_failed` / `provider_rejected`.
6. Draft / NOT NOW / CANCEL / enter / supersede mutations CAS against the observed send+lifecycle snapshot. A stale pre-send write loses rather than restoring a claimable state over `sending` / unknown / sent.
7. Twilio `Idempotency-Key` is passed on the provider request as belt-and-suspenders. Exactly-once delivery still cannot be proven if the provider accepted and the process died before receipt persistence.

## How stale dormancy is handled

Instantiate freezes the Strategy snapshot facts (name / building / recency). Phone is not resolved and not persisted.

At the authorized send boundary the system re-checks current aggregates. If the frozen target is no longer dormant: **do not text**, do not complete rescue, mark the mission `superseded`. History is not rewritten — they were a valid target when the mission was created.

## Proof / demo mode

`GOLDLINE_PROOF_MODE=1` **disables** `approveAndSend`. It does not mint a fake `provider_accepted` SID. Automated tests inject fake adapters into the service. No fake SID may authorize production mission completion.

## Failure evidence

`provider_rejected` means a provider request was actually made and **authoritatively refused** (HTTP 4xx except 408/429). Timeouts, dropped connections, 5xx, and other transport ambiguity are `send_outcome_unknown`.

Other honest names: `permission_denied`, `contact_unresolved`, `provider_unconfigured`, `send_outcome_unknown`, `no_longer_dormant`.

`acceptedAt` is stamped after the provider returns, not before permission/contact work.

Once authoritative send success is durably recorded, outreach ledger / ops-task mirror failures are logged and must not turn the API response into send-failed.

## Draft copy

The draft is a deterministic template (`composeReactivationDraft`), not Claire. UI label: "Draft outreach." No "Reply YES" keyword CTA.

## Consequences — scaffold, not wired

`recordRescueConsequence()` and `mission.consequences` exist as a durable place to hang later evidence. **Inbound SMS and paid-order writers are not connected yet.** Do not fabricate `no_response`. Rescue completion does not imply reply or reorder.

## Fantasy / game (preserved)

The captive is a recurring JOYSTICK villager. The dormant customer is that villager's Spirit Human. Villager selection is hashed from `missionId`.

Pressure (Level 4 donor, not `/level4` product): `calm → descent → holding → unstable → impact → resetting`, plus `rescue`. Freeze while drafting, sending, driving, or backgrounded. Reducer `restore` / `mission_changed` actually installs restored state. 3s / 27s / 7s / 3s timings are **provisional tuning constants**, not a behavioral-science claim.

Art is provisional Level 4 mechanical plates.

## Behavioral selector

`spirit-human-rescue-v1` is in `FICTION_ELIGIBILITY_CATALOG` for FOLLOW_UP_PERSON. It is **not** in the production Fiction Director hash registry. STANDARD_PRESENTATION remains. `GOLDLINE_BEHAVIORAL_MRT` stays off unless Adam enables it. `operator_avoidance` is not generated.

DEFERRED is written only from explicit NOT NOW (and only mirrored to the ops-task ledger when an ops task exists). CANCEL does not write DEFERRED. Silence does not infer DEFERRED.

## Persistence / migration

- `drizzle/0088_spirit_human_rescue.sql` (documentation; not executed directly)
- `scripts/migrate.mjs` `CREATE TABLE spirit_human_rescue_missions` (what production runs)
- `drizzle/schema.ts` `spiritHumanRescueMissions`

Rollback of the feature requires dropping that table if it was applied. Resident-app contracts unchanged.

## Regression harness

- `shared/spiritHumanRescue.test.ts`
- `shared/spiritHumanPressure.test.ts`
- `server/spiritHumanRescue/rescueMissionService.test.ts`
- `server/spiritHumanRescue/rescueMissionStore.mysql.integration.test.ts`
- `client/src/game/fiction/SpiritHumanRescueMission.test.ts`
- Visual QA: `scripts/capture-spirit-human-rescue.mjs` → `artifacts/spirit-human-rescue-qa/`

## Known limitations / remaining truth gaps

- No authorized live customer send has been performed. **No live customer was contacted.**
- Reply/order consequence wiring is scaffold only.
- Pressure timings are provisional.
- Final JOYSTICK rescue artwork does not exist.
- Full overworld mission-map composer is still backlog.
- Local environment has no production MySQL; without `DATABASE_URL` the production router fails closed rather than storing missions in memory.

## Live test (stop before send)

Do not send a real dormant customer message until Adam authorizes that exact test. Proof mode refuses the send endpoint.
