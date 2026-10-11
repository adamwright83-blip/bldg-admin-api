# Lost Property — Session Handoff Log

Every execution session reads this file first and appends one entry before it stops.
The spec is `docs/hiddenGame/LOST_PROPERTY_SPEC.md`. This log never changes the spec.

Entry format:

```
## <date> — session <n> — PR <id>
Branch / PR link:
Done:
VERIFIED (commands + results):
INFERRED:
UNKNOWN:
Blockers (with evidence):
Exact next step:
```

## 2026-10-10 — reconciliation (no code)

Branch: `claude/lost-property-pr1-unlock-gate` (not merged, do not merge as-is).
Done: v1 PR 1 (three-finished-days unlock) built and pushed, 225 tests passing. Its unlock rule contradicts
`docs/JOYSTICK_SYSTEM_MAP.md` §3a and breaks two §7 forbidden items. Spec v2 written and approved.
Reusable from v1: per-lineage completion resolver, insert-only unlock ledger, `hidden_game_chapter_unlocks`
table, router/query shape, gate presenter, Islands badge.
Must change: Ch.1 on first verified sale; Ch.2–3 on 3 completed Objectives each, counted from ledgers by
completion time (not observed on read); preview; content note; tags; Day Line data.
Exact next step: session 1 executes PR 1 per spec §2.
