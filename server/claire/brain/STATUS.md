# Claire Brain V2

Architecture: COMPLETE
Contracts: COMPLETE
Adapters: Business Memory LIVE (read-only, injected); episodic / self / goals still stubs
Perception: COMPLETE (interpretTurn wrap; entity shape classified; fragment-hold not migrated)
Working Memory: COMPLETE (ordered query ported — resolved ≠ presented)
Executive Attention: COMPLETE
Executive Retrieval: COMPLETE (typed requests; honours doNotRetrieve)
Executive Integration: COMPLETE (evidenced facts, judgments, continuation, inhibition)
Executive Governor: COMPLETE (deterministic; mixed-lane firewall ENFORCED)
Response Plan: COMPLETE (typed segments upstream of prose)
Character Renderer: IN PROGRESS (concatenation; Claire's voice not wired — Phase G)
Action Gateway: COMPLETE (refuses live mutations)
Shadow Mode: IN PROGRESS (runClaireBrainTurn exists; not wired to production — Phase I)
Production Cutover: PROHIBITED

Tests: 100 passed, 0 todo (brain). Full suite 7012 passed, 0 failed. `tsc --noEmit` green.

Current next step:
Phase G — replace the concatenation renderer with Claire's character renderer, fed
ONLY by ResponsePlan. Then Phase I shadow wiring (read-only observation of real
completed turns, comparison telemetry only).

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
