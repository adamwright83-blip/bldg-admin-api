# `server/claire/brain/`

Claire Brain V2 — the **cognitive control plane**. Claire's existing organs (business truth, provenance, persistence, character, transport, Day Director) are reused through adapters.

```
EVERYTHING MAY INFORM.
ONLY EXECUTIVE FUNCTION MAY DECIDE.
```

Brain V2 is now in **Stage C guarded cutover**. The live path is explicit, operator-scoped, and flag-gated by `CLAIRE_BRAIN_V2_LIVE`.

Current live authority is intentionally narrow: Day Line work lifecycle and call control. Existing V1 services remain underneath as action / character adapters and as fallback for unsupported lanes until retirement. Shadow mode remains a separate one-way observer path and is still non-authoritative.

| Doc | Role |
|---|---|
| `docs/claire-brain-v2.md` | Canonical architecture |
| `docs/claire-brain-v2-handoff.md` | Current implementation handoff |
| `STATUS.md` | One-screen phase board |

Layout:

- `contracts/` — authority types
- `perception/` — what was said; completeness
- `workingMemory/` — current thread, pending, ordered query
- `businessMemory/` — authoritative business readers
- `episodicMemory/` — history, not current truth
- `selfMemory/` — canon, rapport, disclosure entitlements
- `goals/` — recommendations only
- `executive/` — the only V2 grant-minting / decision authority
- `actions/` — executes branded grants; does not interpret
- `response/` — renderer consumes ResponsePlan
- `live/` — guarded production cutover orchestrator
- `shadow/` — one-way observer / comparison runner
- `telemetry/` — safe comparison records
- `tests/` — brain-level and cutover regressions

Do not create another decision kernel. Expand Stage C by moving proven organs behind V2 grants, then retire the old control plane.
