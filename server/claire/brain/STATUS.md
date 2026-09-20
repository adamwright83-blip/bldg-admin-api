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
Shadow Mode: WIRED on BOTH surfaces, one-way, DEFAULT OFF (CLAIRE_BRAIN_V2_SHADOW)
Production Cutover: PROHIBITED

Tests: 148 passed, 0 todo (brain). Full suite 7060 passed, 0 failed. `tsc --noEmit` green.

Authority stage: **B — shadow observation** (see `docs/claire-brain-v2.md` §19a).

```
BRAIN V2 MAY OBSERVE A COMPLETED V1 TURN.
BRAIN V2 MAY NEVER AFFECT THAT TURN.
```

`claireTwilio.ts` and `claireRouter.ts` each emit ONE fire-and-forget observation
after V1's authoritative result exists. No return path. V2 receives a frozen state
copy, never the live object.

**The flag stays OFF.** `CLAIRE_BRAIN_V2_SHADOW=1` enables observation; unset or
malformed disables it. Turning it on is a separate, explicit authorization.

Current next step:
Nothing is wired-but-unfinished. Remaining model work before any cutover discussion:
`correctionTarget`, `personalProbe` and `narrativeProbe` are still stubbed in
Perception, so no turn yet opens a personal lane in practice.

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
