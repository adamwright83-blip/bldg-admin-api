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

## 2026-10-10 — session 1 — PR 1 (unlock gate, spec v2 rule)
Branch / PR link: `claude/lost-property-pr1-unlock-gate` (PR opened, NOT merged: stop point A, migration needs Adam's approval).
Done: server unlock reworked to spec v2 §2 / system map §3a.
- Ch.1 opens at the first verified sale (paid order truth, admitted receipt, territory-classified customer location). Never gated by Objectives.
- Ch.2 and Ch.3 each open after 3 completed Objectives counted from the previous chapter's open time, by ledger completion time, deduped (commitment/objective via `actionTargetId`). Independent of the player opening the game.
- Ch.4 never opens. Unlocks insert-only. Owner-only preview (`HIDDEN_GAME_PREVIEW_OPEN_IDS` + `HIDDEN_GAME_PREVIEW_TENANT_ID`), writes nothing.
- Migration `0128` changed in place (unmerged): only unique key is (tenant, operator, chapter); date key removed. Wired in `scripts/migrate.mjs`.
- Client: gate presenter on the v2 shape; tags "Chapter n" / "n to go" / blank / "?"; "Contains mature themes." at the entry; "Preview" ribbon; neutral shut copy "The suitcase is shut for now." Islands tile updated. Fixed a `tenantAtlas.test.ts` mock that the earlier PR 1 commit had already broken.
VERIFIED (commands + results):
- `pnpm check` (tsc): clean.
- `vitest run server/experience client/src/components/admin/control-room`: 71 files, 674 tests pass (24 in the eligibility service, plus gate tests).
- `check:nomenclature`, `check:vertical-dependencies`, `check:tenant-ratchet` (+0/-0), `check:domain-boundaries`: all pass.
INFERRED:
- Which commitments count as Day Line Objectives: growth kind, or `operatorMission` metadata.
- Campaign-run vs. objective overlap is not deduped (could double count).
- Sale time = order `createdAt` (payment time is not on the record).
- If Ch.1 opens on a historical first sale, past Objectives since then can open Ch.2/3 at once. `HIDDEN_GAME_COUNT_FROM` floor exists, unset. Adam to decide the anchor.
UNKNOWN:
- Nothing has run against a real database, including migration `0128` and the reads. No local DB exists.
- Not seen on a physical iPhone (Adam's check).
- Backup/restore: `docs/JOYSTICK-SAAS-LAUNCH-OPS.md` states no restore drill has been proven. Take a backup before applying the migration.
- Entry card shows only on the Hollywood island; spec says the territory of the first sale. Day Line "Tonight: Lost Property, Chapter n" card is not built (data only).
Blockers (with evidence): stop point A. Migration PR needs Adam's approval before merge.
Exact next step: Adam approves/merges PR 1 (and runs the migration path normally); then session 2 starts PR 2 (three.js runtime, plates + live 3D) on a stacked branch. Adam supplies the 11 plates and 3 felt-mouse .glb files per spec §9.
