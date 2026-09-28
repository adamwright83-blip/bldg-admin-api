# Claire Brain V2

Authority stage: **C — guarded operator cutover**.

Adam explicitly authorized the guarded V2 production cutover on 2026-09-25.

## Current production contract

- Brain V2 is the cognitive control plane.
- `CLAIRE_BRAIN_V2_LIVE=1` enables the guarded live path only for `isAuthorizedProductionOperator` (`default` + `adam-admin` / `adam`).
- Live V2 currently owns **Day Line work lifecycle authority** and **call-control authority**.
- Existing V1 code remains underneath as a proven action / character adapter where V2 does not yet own a production organ. It is not retired.
- Unsupported V2 lanes fail open to the existing production path rather than pretending V2 owns them.
- Live action grants are branded and must have `mutationAllowed: true, shadowOnly: false`; they execute only through the Action Gateway.
- Shadow decisions remain `productionAuthority: false, mutationAllowed: false, shadowOnly: true`.
- `CLAIRE_BRAIN_V2_SHADOW` remains the one-way observer mode. It is not used for the authorized operator while guarded live mode is active.

## Current guarded scope

V2 owns:

1. first-person / explicit Day Line work proposal authority;
2. confirmation of a V2-recognized pending Day Line / briefing lifecycle;
3. executive call-end decisions.

The existing production adapter still performs underlying Day Director / briefing writes and supplies established character/receipt behavior. The adapter does not mint V2 authority.

## Remaining Stage C expansion

These are not reasons to put V2 back into shadow. They are the work required before V1 can be retired completely:

- full character renderer / disclosure adapter;
- full V2 ownership of live voice completeness / fragment assembly;
- business-fact and prior-claim speech from post-mutation V2 state;
- pending revise/cancel and other unsupported action adapters;
- canonical speech-to-mission authority if/when authored;
- removal of the `UNKNOWN_LEGACY` provenance compatibility shim.

## Invariants

```
EVERYTHING MAY INFORM.
ONLY EXECUTIVE FUNCTION MAY DECIDE.
```

No mutation without a branded live ExecutiveActionGrant on a lane V2 owns.
Shadow observation remains one-way and can never affect a live turn.
Synthetic evidence may not enter authorized operator evidence.
Narrative / personal state may not manufacture business truth.
Do not initiate synthetic calls to the real operator phone.

Canonical design: `docs/claire-brain-v2.md`
Current handoff: `docs/claire-brain-v2-handoff.md`
