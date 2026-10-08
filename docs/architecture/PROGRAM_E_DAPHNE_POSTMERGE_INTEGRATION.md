# Program E4 — Daphne V2 merged-code migration contract

**Assessment:** 2026-10-08, `main@db46a9bfa36c398d1ef8f92b75ca2ee344b5c53b` (after E3b PR #509). This is a **non-overlapping migration handoff**, not a claim that the E4 physical move or production phone replay has occurred.

## Source of truth

[Daphne PR #495](https://github.com/adamwright83-blip/bldg-admin-api/pull/495) merged on 2026-10-08 21:56:07 UTC at `883c477c0397a70ee72423a48ef78fdfdedfd2e3` (PR head `2f55395f5c40df4717fcf2358a4f1f80e2d4d164`). The eight runtime/test paths below are now on main. The prior pre-merge file freeze has ended, **but no physical move is authorized without a separately tested E4 slice**.

[Claire PR #476](https://github.com/adamwright83-blip/bldg-admin-api/pull/476) remains open and owns nine Claire test files. Do not rebase, edit or move those nine files; do not touch President/Mitch protected branches. Program E PRs #501/#502 and #505–#509 are already merged. Open PRs #503/#504 overlap old E0/E1 documentation; do not merge their stale path maps into E4.

## Preserve all eight merged files and semantics

| Current path | Contract |
| --- | --- |
| `server/daphne/explicitPreferenceCorrection.ts` | Explicit utterance only; canonical tenant/operator identity; durable observation and preference write; fresh readback must match both value and source receipt. |
| `server/daphne/explicitPreferenceCorrection.test.ts` | Readback failure, write failure, disabled and persisted statuses remain distinct. |
| `server/daphne/claireAdapter.ts` | Active durable `responseDetail` exposed to Claire; opt-out honored; guidance is interaction style only. |
| `server/claire/turn/claireTurn.ts` | Capture after complete utterance, reload preference, truthful save acknowledgement; concise board only with active `responseDetail <= 0.33` and `conciseBrief`. |
| `server/claire/turn/daphneV2RuntimeCorrection.test.ts` | Concise vs full board and failed-save response tests. |
| `server/claire/turn/daphneV2RuntimeCorrection.mysql.integration.test.ts` | Independent two-call MySQL durability, reverse preference to `0.85`, opt-out restores full board. |
| `server/claire/proactive/boardService.ts` | Deterministic concise speech preserves GUMBALL/CleanCloud warnings, overload and next sales follow-up without reading sixteen recovery names. No recovery truth mutation. |
| `server/claire/proactive/boardService.test.ts` | Warning, overload, sales pause and concise board regression coverage. |

Also preserve `.github/workflows/daphne-v2-acceptance.yml` added by #495. On a future path move, change workflow path triggers **and** test commands together.

### Behavioral invariants

- `status: "persisted"` and `readbackVerified: true` only after a fresh tenant/operator-scoped read confirms the newly written value **and** source observation. A failed write/read cannot be acknowledged as a permanent preference.
- Shorter preference `response_detail=0.2` produces a concise deterministic board on the next independent Claire call; more detail `0.85` or disabled adaptation restores the full board. Do not truncate arbitrary strings or ask a model to rewrite source-backed statuses.
- Do not change Stage 3B's only wired `pattern:explicit_deferral_dismissal` target, consent directives, stable target IDs, or the existing Claire clarify branch.
- Daphne does not own business facts, Orders, Payment, Commercial, CleanCloud, Mission Director ranking, or story canon. The current `server/agents/` is a shared tool runtime, so avoid mixing it up with agent seats.

## Next safe independent Program E slice

**E4a — Daphne directory move only, after rechecking live main and active E branches.** Move `server/daphne/**` as a coherent unit to the Program E agent-seat location. Preserve all exports, tenant/operator scoping, feature flags, receipt identities and idempotency. Update every importer, relative path, test, CI trigger and `docs/architecture/domain-boundaries.json` together. Do not create duplicate compatibility writers or a second preference store.

**E4b — Claire only after PR #476 is resolved.** Keep `server/claire/**` in place while its nine protected tests are under review; the three #495 Claire source/test areas may be moved only in a later coherent, conflict-free slice. Do not touch President or Mitch. If Antigravity already has an E4 PR, use that single PR instead of duplicating it.

## Required verification

1. `pnpm check`, nomenclature, tenant-ratchet, vertical-dependencies and domain-boundaries gates.
2. `pnpm vitest run server/daphne/explicitPreferenceCorrection.test.ts server/claire/proactive/boardService.test.ts server/claire/turn/daphneV2RuntimeCorrection.test.ts server/claire/turn/daphneAdaptation.test.ts` (adjust paths when moved).
3. Disposable-MySQL `pnpm vitest run --config vitest.integration.config.ts server/claire/turn/daphneV2RuntimeCorrection.mysql.integration.test.ts`, including two separate calls, reversal and opt-out.
4. `daphne-durable-two-call` CI remains active on new paths. That check was **green** on #495's head; the same head had a **failed `release-journey` check**, so do not claim all CI passed.
5. Diff merged behavior against `883c477c` and verify no #476, President/Mitch, or business-authority edits. Live phone replay is **not yet certified** by the #495 PR.

**Integration outcome:** Daphne's merged behavior is present on main; E4 physical relocation remains pending. This file provides the exact post-merge move contract to the existing Program E owner without modifying runtime or colliding with active E work.
