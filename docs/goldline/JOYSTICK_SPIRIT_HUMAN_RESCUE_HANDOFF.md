**This document constrains future JOYSTICK / Goldline work. Current production/main outranks prose.**

# JOYSTICK SPIRIT HUMAN RESCUE — HANDOFF

**Status:** implemented on `cursor/joystick-spirit-human-rescue`, **not merged**. Do not merge until reviewed.
**Base:** `main` @ `9ce811ce65bc92c26e228fa79c6f6e854c418f2d` (BIO CONTAINMENT PR #162)
**Independent of:** Claire Intelligence PR #161, xAI/ZDR branch, BIO CONTAINMENT image rewiring (already shipped)

## Reality contract

REALITY determines what happened. THE GAME may invent why it happened.

| Event | Real meaning | Fantasy meaning | Mission |
|---|---|---|---|
| Draft / preview / local CTA | Nothing was sent | Threat may freeze | Not complete |
| Explicit operator approve+send + Twilio create accepted (SID) | We contacted the customer | Spirit Human link reached; villager rescued | `completed` |
| Send failed | Customer was not contacted | Villager still caged | `problem`, retry allowed |
| Later reply | Reply observed | Optional later world beat | Does not rewrite send |
| Later paid order | Reactivation/business result | Stronger later world beat | Does not rewrite send |
| No response | Still no response | Cage already opened if send succeeded | Valid |

Evidence name for success: **`provider_accepted`**. Not delivered. Not read.

## Fantasy contract

The captive is a recurring JOYSTICK villager (`shared/spiritHumanRescue.ts` roster). The dormant customer is that villager's Spirit Human. Villager selection is hashed from `missionId`, never from customer name/gender/race/biography. Do not render a customer likeness as a prisoner.

No guilt, shame, Claire disappointment, or diagnosis. Impact is a game reset.

## Dormant eligibility source

`server/strategy/snapshotDormantCustomers.ts` — paid order, 30-day inactivity, hashed `cust_…` ids, no phone on the snapshot.

## Outbound authority

- **Not** `sendCustomerReminderTool` (JSON stub, no Twilio)
- **Not** `executeOffensiveAction` (admin_action_log only)
- **Is** `sendSMSWithReceipt` in `server/_core/sms.ts` via `server/spiritHumanRescue/outboundSendAdapter.ts`
- tRPC `system.spiritHumanRescue.approveAndSend` requires `operatorAuthorizedSend: true` and uses the signed-in operator as `approvedByUserId`
- Contact phone is resolved only inside `approveAndSendRescue`
- `GOLDLINE_PROOF_MODE=1` uses a fake adapter so CI never texts a customer
- Resident-app tools were not renamed, reshaped, or allowlisted for send

## Mission state machine

Lifecycle: `locked | available | active | completed | problem | skipped | superseded` (`shared/spiritHumanRescue.ts`).

Send: `draft_ready | awaiting_approval | sending | sent | send_failed | cancelled`.

Pressure (Level 4 donor, not `/level4` product): `calm → descent → holding → unstable → impact → resetting`, plus `rescue`. Freeze while drafting, sending, driving, or backgrounded.

## Behavioral selector

`spirit-human-rescue-v1` is in `FICTION_ELIGIBILITY_CATALOG` for FOLLOW_UP_PERSON. It is **not** in the production Fiction Director hash registry, so ordinary follow-up chapters are not forced into the cage. STANDARD_PRESENTATION remains. `GOLDLINE_BEHAVIORAL_MRT` stays off unless Adam enables it. `operator_avoidance` is not generated. DEFERRED is only written from explicit Not now/cancel (mission skipped); we do not infer it from silence.

The real action (`rescueActionGrammar` → send approved outreach to frozen customer X) does not change when presentation changes.

## Art slots

Provisional Level 4 mechanical art (`client/src/assets/l4/`) occupies environment / threat / captive / player slots. Labeled in the HUD. Replace later without changing send truth.

## Persistence / migration

No new migration. Mission rows live in an in-memory store for tests and local-without-DB; instantiate best-effort-mirrors a `stale_customer` ops_task when DB is up. Server restart without DB drops in-memory missions — same class of limitation as other Goldline local fallbacks. Frozen target is server-side for the life of the process; client refresh does not swap the customer.

## Regression harness

- `shared/spiritHumanRescue.test.ts`
- `shared/spiritHumanPressure.test.ts`
- `server/spiritHumanRescue/rescueMissionService.test.ts`
- `client/src/game/fiction/SpiritHumanRescueMission.test.ts`
- Visual QA: `scripts/capture-spirit-human-rescue.mjs` → `artifacts/spirit-human-rescue-qa/`

## Known limitations

- No authorized live customer send has been performed. Do not mark live-send proof done.
- Later reply/order recording is `recordRescueConsequence`; it is not yet hooked into every production inbound-SMS / paid-order writer.
- Final JOYSTICK rescue artwork does not exist; plates are provisional.
- Full overworld mission-map composer is still backlog; this mission is a Day Line + game overlay node using the shared lifecycle vocabulary.
- Local environment has no production MySQL.

## Rollback

Revert the PR/branch. No schema migration to undo. Resident-app contracts unchanged.

## Live test (stop before send)

Do not send a real dormant customer message until Adam authorizes that exact test. Fake-adapter path is the default in `GOLDLINE_PROOF_MODE`.
