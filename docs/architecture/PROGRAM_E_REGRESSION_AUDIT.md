# Program E regression recovery audit

Status: **RECOVERY NOT CERTIFIED**. E5–E8 remain frozen. This is an evidence ledger, not a certification.

## Immutable references and live starting state

- Pre-E: `7ba7310df76a142c053c9c2c857b750e207cb221`, merged PR #499.
- Current starting main / E4b: `6f90f5334416b6a09cdf0f5c2b5fa3c09a61d726`, merged PR #512; PR head `f149a45dae803c543121e858fb8281274941e2df`.
- Fetched origin main, all remote branches and tags before editing. Main had not advanced.
- Created annotated `PRE_PROGRAM_E_BACKUP` and `PROGRAM_E_E4B_CHECKPOINT`; pushed both without force. `git ls-remote --tags origin` verified their peeled commits equal the two SHAs above. These are history references, not separate backups.
- Existing untracked recovery handoff and E5 draft #513 are preserved. Its proposed continuation is superseded by the recovery freeze.

## Environment and reproducibility

macOS, Node `v22.22.0`, pnpm `10.4.1`, frozen lockfile, Vitest `2.1.9`; MySQL `8.0.46` in a newly created Docker container bound only to localhost port 34317. No production environment files or provider credentials were copied. Tests use mocks or disposable databases. MySQL suites create/drop their own randomly named databases. UTC reruns match hosted Linux timezone; initial local-zone runs are retained separately.

Clean managed worktrees:

- `/Users/adamwrightpfi/.codex/worktrees/program-e-recovery-baseline/Cursor_bldg-admin-api` at pre-E.
- `/Users/adamwrightpfi/.codex/worktrees/program-e-regression-recovery/Cursor_bldg-admin-api` initially at E4b, then repair branch `codex/program-e-relocation-regressions`.

Local full logs and job metadata: `/tmp/program-e-recovery-evidence/`. Hosted source logs remain linked below. Preserve or regenerate these logs before cleanup. A broad current Claire run overlapped edits and is excluded from clean comparison evidence; a new committed-revision run is required. Initial clean focused comparisons and the clean baseline Claire run are valid. Repairs are validated separately and never presented as clean starting-main results.

Commands (run `pnpm install --frozen-lockfile` in each checkout first):

```sh
pnpm check
pnpm check:nomenclature
pnpm check:tenant-ratchet
pnpm check:vertical-dependencies
pnpm check:domain-boundaries
pnpm build
pnpm goldline:bundle:budget
pnpm vitest run server/claire
node --test scripts/check-domain-boundaries.test.mjs
```

Matched focused command: `pnpm vitest run` with `server/analytics/paymentAuthorityAdmission.test.ts`, `server/claire/proactive/boardService.test.ts`, `server/claire/operatorMissionCommand.test.ts`, `server/claire/weeklyMission/dailyCommandIntent.test.ts`, `server/claire/weeklyMission/executionType.test.ts`, `server/claire/workdayCargoLinkage.test.ts`, `server/claire/amdVoicemail.test.ts`, plus the two revision-specific files:

| Logical suite | Pre-E | E4b |
|---|---|---|
| CSV sheet sync | `server/cleancloudCsvSheetSync.test.ts` | `server/integrations/cleancloud/cleancloudCsvSheetSync.test.ts` |
| Operator appointments | `server/persistentOperator/operatorAppointments.test.ts` | `server/agents/persistentOperator/operatorAppointments.test.ts` |

Repair focused reproduction omits known baseline CSV and protected AMD fixtures, uses `--maxWorkers=2 --minWorkers=1`, and passes **93/93 tests in seven files**.

Worker integration command: `TZ=UTC DATABASE_URL=mysql://root:program-e-disposable@127.0.0.1:34317/mysql pnpm vitest run --maxWorkers=1 --minWorkers=1 --config vitest.integration.config.ts` followed by `server/procurement/workflowStore.mysql.integration.test.ts` and the applicable `goalCycleStore.mysql.integration.test.ts` / `operatorAppointmentStore.mysql.integration.test.ts` beneath `server/persistentOperator/` (pre-E) or `server/agents/persistentOperator/` (E4b).

Broader domain selection is recorded in `baseline-broad.log` and `repair-broad.log`; these selections have different file sets and are not represented as identical full suites. Workflow commands must additionally be replayed from each revision's YAML, including separate MySQL bootstraps and browser steps. Unexecuted stages remain unavailable, never passing.

## Exact E4b failing job identities

All seven complete workflow logs and job/step metadata were retrieved using `gh run view RUN --log` and `gh run view RUN --json jobs`.

| Workflow run | Job ID / job | Failed step |
|---|---|---|
| [37860639094](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37860639094) | 113595261638 / sales-truth | 6: Canonical money, source completeness, customer knowledge and artifacts |
| [37860639212](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37860639212) | 113595261991 / daphne-durable-two-call | 8: Verify Daphne receipts, style rendering and Stage 3B branch |
| [37860639070](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37860639070) | 113595262072 / release-journey | 7: Run deterministic legacy compatibility contracts |
| [37860639073](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37860639073) | 113595262311 / fast-contracts | 12: Prove Claire domain-port convergence |
| [37860639150](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37860639150) | 113595262421 / durable-worker | 7: Worker loop (fake store) |
| [37860639004](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37860639004) | 113595261209 / nomenclature | 7: Prevent new cross-domain dependency violations |
| [37860638934](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37860638934) | 113595261628 / mobile-build-and-schema | 9: Enforce Goldline bundle budget |

`fast-smoke-world` (113595262321) was cancelled. The six other mobile jobs passed. No conclusion about application correctness is drawn from deployment checks.

## Failure matrix

Repair PR is pending creation; local repair is not a merged repair.

| Test / Job | Pre-E | Post-E | Classification | Root Cause | Repair PR | Final Result |
|---|---|---|---|---|---|---|
| Payment authority admission (sales-truth) | 20 pass | Missing module | PROGRAM E REGRESSION | #510 moved CleanCloud; test still imports `../cleancloudPaidEvidence` | Pending | Local 20 pass; merge pending |
| CSV sync skip cash/unpaid (sales-truth) | Same expected 1 / actual 2 | Same failure | PREEXISTING BASELINE | Not a relocation behavior change; baseline and moved implementation reproduce it | None | Remains; assertion unchanged |
| Operator appointments (durable-worker) | 7 pass | Missing registry | PROGRAM E REGRESSION | #512 left `../../toolRegistry` rather than `../toolRegistry` | Pending | Local 7 pass; merge pending |
| Claire board (worker, Daphne, fast, legacy) | Domain-port tests pass | Wrong mock; real DB accessed or empty board | PROGRAM E REGRESSION | #512 left old obligation-store mock identity | Pending | Local 4 pass, including error propagation and Daphne concise board |
| Operator Mission Command | 34 pass | ENOENT | PROGRAM E REGRESSION | #511 left filesystem URL to old Mission Director | Pending | Local 34 pass |
| Daily Command intent | 12 pass | ENOENT | PROGRAM E REGRESSION | #511 left filesystem URL to old Mission Director | Pending | Local 12 pass |
| Weekly execution type | 13 pass | ENOENT | PROGRAM E REGRESSION | #511 left rank/selection filesystem URLs | Pending | Local 13 pass |
| Day Line cargo linkage | 3 pass | 3 failures | PROGRAM E REGRESSION | #511 left old Day Director mock identity | Pending | Local 3 pass |
| Commercial guard: mission store and pipeline | Gate pass; both calls exist | Two forbidden added-import reports | PROGRAM E REGRESSION (ratchet relocation accounting) | #512 rewrote preexisting calls' import paths; guard treats them as new edges | Pending | Historical E4 diff passes with Git rename and identical-line proof; adversarial checker tests pass |
| Operator goal cycle MySQL | Loads migration, later assertion failure | Cannot open `server/drizzle/0103...` | PROGRAM E REGRESSION | #512 left migration URL one level too shallow | Pending | Path repaired; UTC matched rerun pending |
| Operator appointment MySQL | 14 pass | Cannot open `server/drizzle/0104...` | PROGRAM E REGRESSION | #512 left migration URL one level too shallow | Pending | Local 14 pass; UTC matched rerun pending |
| Procurement availableAt / goal cycle final attempt | Fail in initial local-zone run | Fail after migration-path repair | INFRASTRUCTURE / FLAKY investigation pending | UTC server vs local Node timezone is a hypothesis; do not dismiss until UTC rerun completes | None | UNRESOLVED pending rerun |
| Mobile three.js isolation | Same hero/chunk failure | Same hero/chunk failure | PREEXISTING BASELINE | `hero-DKp6D4HV.js` statically imports `BufferGeometryUtils-WcliCiyr.js`; frontend inputs and lockfile unchanged | None | Both production builds succeed; both budgets fail identically |
| Protected Claire fixtures in legacy release | Baseline reproduces failures | Hosted failures | PREEXISTING BASELINE for reproduced assertions; workflow-environment details remain unresolved | Missing fixture identities, authority evidence, schema/mocks and stale source-shape assertion, individually recorded below | #476 (owner work) | Deferred; protected files untouched |
| Remaining legacy and broad-suite findings | Partial coverage | Partial coverage | UNRESOLVED | See coverage/blockers below | Pending | Not certified |

## Commercial architectural justification

Pre-E `server/commercialPipeline/commercialPipelineService.ts:727` already dynamically imports `../persistentOperator/fieldEventBridge`; current pipeline calls the same bridge at the same logical site. Pre-E commercial mission store likewise calls `bridgeDriverAction`. No conversion semantics or downstream mutation is introduced by #512. The existing ratchet explicitly baselines old debt. The recovery checker derives renames from Git rather than adding named exceptions: the old target must map to the new target and the complete old import line, with only its specifier substituted, must match. New callers, new targets and changed import forms are rejected by executable temporary-Git-repository tests. The diagnostic branch was read, not merged/cherry-picked; its hard-coded exemption was not adopted. Existing bridge debt remains documented; Commercial won still does not establish payment.

## Protected work and baseline Claire findings

Fetched all open PRs. #476, #411, #375, #374, #359, #361, #503 and #504 are open. #495 is merged. None of their branches were altered or merged. #513 remains frozen. No President or Mitch implementation was edited.

#476 exact protected files:

- `server/claire/activeCustomerMetric.test.ts`
- `server/claire/amdVoicemail.test.ts`
- `server/claire/claireTwilioAnalytics.test.ts`
- `server/claire/contextAssembler.test.ts`
- `server/claire/conversation/conversationLedger.test.ts`
- `server/claire/progression/correctivePass.test.ts`
- `server/claire/progression/failureFixtures.test.ts`
- `server/claire/turn/productionCallReplay.test.ts`
- `server/claire/twilioClaireIntegration.test.ts`

Clean baseline Claire run: 155 files, 2032 tests; 11 files failed, 24 assertions failed, 2008 tests passed. Protected failures: active metric (2), AMD source-shape (1), Twilio analytics missing real operator fixture (5), context assembler (1), conversation ledger (1), corrective pass paid-evidence fixtures (5), failure fixtures (2), production replay pending-state fixtures (2), Twilio artifact integration missing operator (1). Additional baseline findings: operatingTruthGuards (1) and repair2SliceB (3), requiring nondeterminism/environment investigation. These are distinct from Program D's four documented historical failures; those four have not yet all been reproduced in this recovery and are not used to excuse unrelated failures.

## Coverage gaps and recovery blockers

- Hosted repair CI, clean committed repair revision, main merge and final recovery SHA not yet verified.
- Broad domains, exact sales-truth/Daphne/worker commands and TypeScript completion still being collected.
- Matched UTC MySQL results still pending; legacy journey and Daphne two-call integration require explicit disposable schema bootstrap and execution.
- Full fast browser workflows, cancelled world smoke and remaining mobile schema steps are not yet replayed locally.
- Broad Claire current run overlapping edits is explicitly excluded; requires clean rerun.
- Historical Program D four-failure reproduction remains incomplete.
- Documentation PRs #503/#504 are deliberately deferred to E7 reconciliation.
- No E5 folder move was performed. No duplicated old implementation, fixture expectation weakening, test disabling, default tenant manufacture or production operation occurred.

**PROGRAM E — RECOVERY BLOCKED** until the pending evidence and any newly identified defects are resolved. **PROGRAM E — LLM LEGIBILITY NOT CERTIFIED**; E8 has not run.
