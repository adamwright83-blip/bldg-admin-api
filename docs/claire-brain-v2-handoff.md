> **LEGACY DAYFORGE COMPATIBILITY:** Historical literals remain compatibility/history only. Canonical product is JOYSTICK / Goldline.

# Claire Brain V2 Handoff

## Current state

Brain V2 entered **Stage C guarded production cutover** after Adam's explicit authorization on 2026-09-25.

Current cutover PR: #256, branch `chatgpt/claire-brain-v2-live-cutover`. Base was main after the Sep-25 Day Line hotfix (#255).

Older #193 / #221 instructions saying "do not merge" or "shadow only" describe earlier construction phases and are not current authority.

## Live architecture

```
operator turn
    ↓
Brain V2 Executive Function
    ↓
branded authority grant
    ↓
Action Gateway
    ↓
existing proven production organ / adapter
    ↓
receipt-backed business state
```

For lanes V2 does not yet own, production deliberately falls back to the existing V1 path. This is a strangler cutover, not a rewrite and not a claim that every V1 organ is already retired.

The guarded live entrypoint is `server/claire/brain/live/runClaireBrainV2LiveTurn.ts`.

Activation:

- `CLAIRE_BRAIN_V2_LIVE=1` — guarded live V2 for authorized production operator.
- `CLAIRE_BRAIN_V2_SHADOW=1` — old one-way observer. Do not run it for the same authorized operator once live mode is enabled.
- no live flag — V1 remains the fail-open production fallback.

Authorization remains restricted by `isAuthorizedProductionOperator` (`default` + `adam-admin` / `adam`).

## What V2 owns live in this cutover

1. Day Line work proposal authority.
2. Pending Day Line / briefing confirmation authority.
3. Call-control authority.

A live V2 action grant has `mutationAllowed: true, shadowOnly: false` and executes only through the Action Gateway. A shadow grant has the inverse flags and remains inert.

The V1 adapter may still perform the underlying briefing / Day Director write and provide established character or receipt behavior. That is implementation reuse, not independent authority for the live lane.

## What is intentionally not claimed yet

- V1 is not retired.
- V2 does not yet own every business-fact / prior-claim spoken response.
- V2 does not yet own every pending revision/cancel path.
- V2 does not yet own the full character/disclosure organ.
- V2 does not yet own canonical speech-to-mission mutation.
- voice completeness / provider-fragment handling is still shared with existing transport and adapter code.
- the `UNKNOWN_LEGACY` provenance compatibility shim remains.

## Sep-25 field failure that motivated cutover

The production call showed why post-hoc shadow was insufficient: V1 could mutate pending state before V2 observed it. Claire heard a long day schedule but persisted only two items. PR #255 fixed the V1 defects (held-bundle clearing, "drop off" being misread as removal, and same-account task collapse). The V2 cutover additionally moves authority in front of the adapter so V2 sees pre-mutation pending state.

## Required release gate

- `pnpm check`
- Brain V2 tests including `brain/tests/liveCutover.test.ts`
- full Claire / legacy compatibility contracts
- clean MySQL migration path
- production build
- Goldline fast browser smoke
- nomenclature hygiene

Do not weaken shadow isolation. Stage C supersedes only the old rule that production could never import a V2 live entrypoint; the one-way shadow invariant remains permanent.

## Next Stage C expansion

Move one production lane at a time: post-mutation receipt to V2 success speech; full business fact / prior-claim output; pending revise/cancel adapters; full character/disclosure adapter; voice completeness ownership; canonical mission action if authored. Then retire V1 control-plane decisions.

A future Brain V3 may become the experimental shadow brain; do not create V3 merely to avoid completing V2's remaining production adapters.

## Security

Do not log credentials, tokens, phone numbers, provider identifiers, or env values. Do not place synthetic calls to the real operator phone.
