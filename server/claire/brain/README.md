# `server/claire/brain/`

Claire Brain V2 — the **cognitive control plane**. Claire’s organs (business truth, provenance, memory, actions, character, transport) stay where they are and are imported through adapters.

```
EVERYTHING MAY INFORM.
ONLY EXECUTIVE FUNCTION MAY DECIDE.
```

**This tree has no production authority.** Production still speaks and mutates through `runClaireTurn()` in `server/claire/turn/claireTurn.ts`.

| Doc | Role |
|---|---|
| `docs/claire-brain-v2.md` | Canonical architecture |
| `docs/claire-brain-v2-handoff.md` | Next-agent handoff (update before every push) |
| `STATUS.md` | One-screen phase board |

Layout:

- `contracts/` — authority types (plan before prose; branded grants)
- `perception/` — what was said; completeness
- `workingMemory/` — current thread, pending, ordered query (resolved ≠ presented)
- `businessMemory/` — adapters over existing readers; synthetic filter
- `episodicMemory/` — history; not current truth
- `selfMemory/` — canon, rapport, disclosure entitlements
- `goals/` — recommendations only
- `executive/` — **only** place that may mint grants or decide
- `actions/` — execute grants; do not interpret
- `response/` — renderer consumes ResponsePlan
- `adapters/` — V1 state mapping
- `telemetry/` — shadow comparison records (no secrets)
- `shadow/` — `runClaireBrainTurn()` read-only runner
- `tests/` — brain-level tests

Do not scatter new brain authority across `server/claire/` outside this directory.
