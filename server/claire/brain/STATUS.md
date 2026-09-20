# Claire Brain V2

Architecture: COMPLETE
Contracts: COMPLETE
Adapters: ALL LIVE (read-only, readers injected) — business, episodic, self/social, goals
Perception: COMPLETE (interpretTurn wrap; entity shape classified; fragment-hold not migrated)
Working Memory: COMPLETE (ordered query ported — resolved ≠ presented)
Executive Attention: COMPLETE
Executive Retrieval: COMPLETE (typed requests; honours doNotRetrieve)
Executive Integration: COMPLETE (evidenced facts, judgments, continuation, inhibition)
Executive Governor: COMPLETE (deterministic; mixed-lane firewall ENFORCED)
Response Plan: COMPLETE (typed segments upstream of prose)
Character Renderer: COMPLETE (fed only by ResponsePlan; assertRenderedFromPlan lints it)
Action Gateway: COMPLETE (refuses live mutations)
Shadow Mode: MECHANISM COMPLETE, NOT WIRED (default off; transport import awaits Adam)
Production Cutover: PROHIBITED

Tests: 130 passed, 0 todo (brain). Full suite 7042 passed, 0 failed. `tsc --noEmit` green.

Current next step:
The ONE remaining Phase I step is a decision, not code: whether to import
`observeShadowTurnDetached` into `claireTwilio.ts` / `claireRouter.ts`. The mechanism
is built, default off, cannot throw and cannot delay — but that import is the only
line that touches a live production path, and the binding handoff forbids it in this
phase. Adam authorizes it, not an agent.

Shadow mode flag: `CLAIRE_BRAIN_V2_SHADOW=1`. Unset or malformed disables observation.

Retrieval safety note:
`decideTurn` retrieves NOTHING by default. Live reads require a caller to pass
`liveReadOnlyRetrieval` explicitly, so no code path reaches the database merely by
calling the brain.

Canonical design:
`docs/claire-brain-v2.md`

Detailed handoff:
`docs/claire-brain-v2-handoff.md`

Draft PR (do not merge):
https://github.com/adamwright83-blip/bldg-admin-api/pull/193
