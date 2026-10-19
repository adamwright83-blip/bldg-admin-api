# `server/claire/brain/`

Claire Brain V2 — the **cognitive control plane**. Claire's existing organs (business truth, provenance, persistence, character, transport, Day Director) are reused through adapters.

```
EVERYTHING MAY INFORM.
ONLY EXECUTIVE FUNCTION MAY DECIDE.
```

Brain V2 is **primary** for the authorized operator (`CLAIRE_BRAIN_V2_PRIMARY`, see `STATUS.md`): it interprets, decides and answers every conversational turn on the phone and the Claire Desk. Legacy Claire only observes, read-only, in the background. Rollback is the flag; there is no silent per-turn fallback.

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
- `live/` — primary turn (`primaryTurn.ts`), operator authority, legacy read-only observer, grant-bound adapters
- `shadow/` — one-way observer / comparison runner
- `telemetry/` — safe comparison records
- `tests/` — brain-level and cutover regressions

Do not create another decision kernel. Expand Stage C by moving proven organs behind V2 grants, then retire the old control plane.
