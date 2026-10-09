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

Broader domain selection is recorded in `baseline-broad.log` and `repair-broad.log`; these selections have different file sets and are not represented as identical full suites. Workflow commands must additionally be replayed from each revision's YAML, including separate MySQL bootstraps and browser steps. Unexecuted stages remain unavailable, never passing. The exact legacy deterministic command was additionally run on separate empty disposable databases with CI=true, NODE_ENV=ci, TZ=UTC and the workflow fixture flags/secrets, matching its pre-bootstrap job order.

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

Repair and audit PR: [#514](https://github.com/adamwright83-blip/bldg-admin-api/pull/514). Local validation is complete for the listed repairs; hosted final-head validation and merge are still required.

| Test / Job | Pre-E | Post-E | Classification | Root Cause | Repair PR | Final Result |
|---|---|---|---|---|---|---|
| Payment authority admission (sales-truth) | 20 pass | Missing module | PROGRAM E REGRESSION | #510 moved CleanCloud; test still imports `../cleancloudPaidEvidence` | #514 | Local 20 pass; merge pending |
| CSV sync skip cash/unpaid (sales-truth) | Same expected 1 / actual 2 | Same failure | PREEXISTING BASELINE | Not a relocation behavior change; baseline and moved implementation reproduce it | None | Remains; assertion unchanged |
| Operator appointments (durable-worker) | 7 pass | Missing registry | PROGRAM E REGRESSION | #512 left `../../toolRegistry` rather than `../toolRegistry` | #514 | Local 7 pass; merge pending |
| Claire board (worker, Daphne, fast, legacy) | Domain-port tests pass | Wrong mock; real DB accessed or empty board | PROGRAM E REGRESSION | #512 left old obligation-store mock identity | #514 | Local 4 pass, including error propagation and Daphne concise board |
| Operator Mission Command | 34 pass | ENOENT | PROGRAM E REGRESSION | #511 left filesystem URL to old Mission Director | #514 | Local 34 pass |
| Daily Command intent | 12 pass | ENOENT | PROGRAM E REGRESSION | #511 left filesystem URL to old Mission Director | #514 | Local 12 pass |
| Weekly execution type | 13 pass | ENOENT | PROGRAM E REGRESSION | #511 left rank/selection filesystem URLs | #514 | Local 13 pass |
| Day Line cargo linkage | 3 pass | 3 failures | PROGRAM E REGRESSION | #511 left old Day Director mock identity | #514 | Local 3 pass |
| Commercial guard: mission store and pipeline | Gate pass; both calls exist | Two forbidden added-import reports | PROGRAM E REGRESSION (ratchet relocation accounting) | #512 rewrote preexisting calls' import paths; guard treats them as new edges | #514 | Historical E4 diff passes with Git rename and identical-line proof; adversarial checker tests pass |
| Operator goal cycle MySQL | Loads migration, later assertion failure | Cannot open `server/drizzle/0103...` | PROGRAM E REGRESSION | #512 left migration URL one level too shallow | #514 | UTC matched worker run: 34/34 pass on both revisions |
| Operator appointment MySQL | 14 pass | Cannot open `server/drizzle/0104...` | PROGRAM E REGRESSION | #512 left migration URL one level too shallow | #514 | UTC matched worker run: 34/34 pass on both revisions |
| Procurement availableAt / goal cycle final attempt | Fail in initial local-zone run | Fail after migration-path repair | INFRASTRUCTURE / FLAKY (timezone configuration) | Local Node timezone versus UTC MySQL; both revisions pass all 34 assertions with TZ=UTC | None | Resolved under matched CI timezone; no production-code change |
| Mobile three.js isolation | Same hero/chunk failure | Same hero/chunk failure | PREEXISTING BASELINE | `hero-DKp6D4HV.js` statically imports `BufferGeometryUtils-WcliCiyr.js`; frontend inputs and lockfile unchanged | None | Both production builds succeed; both budgets fail identically |
| Protected Claire fixtures in legacy release | Baseline reproduces failures | Hosted failures | PREEXISTING BASELINE for reproduced assertions; workflow-environment details remain unresolved | Missing fixture identities, authority evidence, schema/mocks and stale source-shape assertion, individually recorded below | #476 (owner work) | Deferred; protected files untouched |
| Remaining legacy and broad-suite findings | Partial coverage | Partial coverage | UNRESOLVED | See coverage/blockers below | #514 | Not certified |

## Commercial architectural justification

Pre-E `server/commercialPipeline/commercialPipelineService.ts:727` already dynamically imports `../persistentOperator/fieldEventBridge`; current pipeline calls the same bridge at the same logical site. Pre-E commercial mission store likewise calls `bridgeDriverAction`. No conversion semantics or downstream mutation is introduced by #512. The existing ratchet explicitly baselines old debt. The recovery checker derives renames from Git rather than adding named exceptions: the old target must map to the new target and the complete old import line, with only its specifier substituted, must match. New callers, new targets and changed import forms are rejected by executable temporary-Git-repository tests. The diagnostic branch was read, not merged/cherry-picked; its hard-coded exemption was not adopted. Existing bridge debt remains documented; Commercial won still does not establish payment.

## Protected work and baseline Claire findings

Fetched all open PRs. #476, #411, #375, #374, #359, #361, #503 and #504 are open. #495 is merged. None of their branches were altered or merged. #513 remains frozen. No actively edited President or Mitch implementation was changed. The inactive `scripts/president-github-agent.ts` forbidden-path prompt was mechanically updated to retain protection of the relocated Commercial, platform authority and Payment files. The seven protected PR file lists were fetched; none includes that script. `package.json` is shared with #359/#374, but their exact patches only add `president:stage1:witness`; recovery edits only `test:legacy-dayforge:release`. No protected script entry or implementation hunk is changed.

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

## Additional migration-completeness repairs

- #510 left `server/geography/cleanCloudCustomerAuthority.integration.test.ts` importing removed CleanCloud evidence. Updated to the canonical integration. The real MySQL assertion passes both pre-E and repair (1/1 each).
- #510 left two old CleanCloud test paths in `goldline-fast-smoke.yml`; Vitest silently selected other matching files and omitted those suites. Updated both explicit paths. Matched CleanCloud evidence + Commercial selection: 9 files / 83 tests pass on both revisions.
- #508 left `test:legacy-dayforge:release` selecting the removed `server/commercialPipeline` directory. Updated the selector to `server/domains/commercial`, restoring its original logical coverage.
- #510 left three dynamic imports in `scripts/goldline-wave-local.ts`. Corrected only their paths. This local fixture operation was not executed against an inherited or production database.
- #505/#507/#508 moved the files protected by the President GitHub prompt, but left its forbidden globs at removed paths. Corrected the globs to Commercial, platform authority and Payment. This preserves protection rather than adding autonomy or changing executive behavior.

Two literal `resolve(REPO_ROOT, "server/commercialPipeline")` roots in `server/goldlineVerification/sliceE.productionIngestion.test.ts` were also left by #508. Pre-E passes 51/51; unrepaired current fails two ENOENT assertions; canonical root repair restores 51/51 without weakening the authority assertions.

A Git-rename-based scan of static imports, dynamic literal imports, `vi.mock`, `require`, literal filesystem URLs and repository-root literals found no further references to removed implementations after these fixes. Historical labels and architecture prose are not treated as active imports. Final exhaustive documentation reconciliation remains E7.

## Validation collected

| Coverage | Pre-E | Repair |
|---|---|---|
| Main TypeScript | Exit 0 | Exit 0, clean committed repair run |
| Legacy release harness TypeScript | Exit 0 | Exit 0 |
| Four architecture gates | Pass | Pass; also passes against the historical E4b parent and PRE_PROGRAM_E_BACKUP, not merely the repair parent |
| Focused relocation defects | Tests pass before moves (CSV/AMD baseline failures excluded) | Seven files, 93/93 pass |
| Worker real MySQL, TZ=UTC | 3 files, 34/34 pass | 3 files, 34/34 pass |
| Legacy journey + Daphne real MySQL | 2 files, 4/4 pass | 2 files, 5/5 pass; extra durable concise-style test introduced independently by #495 |
| CleanCloud customer authority real MySQL | 1/1 pass | 1/1 pass |
| CleanCloud evidence + Commercial coverage | 9 files, 83/83 pass | 9 files, 83/83 pass |
| Narrator production-ingestion authority | 51/51 pass | 51/51 pass; unrepaired current had two ENOENT failures |
| Legacy deterministic workflow command, empty disposable DB | 210 files; 2324 pass, 20 failures | 210 files; 2328 pass, identical 20 failures |
| Sales-truth workflow logical selection | 28 files; 348 pass, 6 skipped, CSV assertion fails | Same counts and same sole failure |
| Full Claire, TZ=UTC | 155 files; 2012 pass, 20 failures | 155 files; 2016 pass, same 20 failures; four extra tests from #495 |
| Broad domains / workers / receipts | 108 files; 717 pass, 6 skipped, 4 failures | 117 files; 815 pass, 6 skipped, same 4 failures (different selections; not an identical full-suite claim) |
| Program D historical failure selection | 33 pass, four documented failures | Identical |
| Production build | Pass | Pass |
| Bundle budget | Same preexisting hero/three.js failure | Identical chunks and failure |
| Daphne + worker deterministic workflow commands | Baseline covered by domain suite and board reproduction | 13 files, 84/84 pass |

Full Claire UTC runs agree on exactly the 20 failures in the nine protected #476 files. The extra four failures in the initial local-time baseline Claire run disappeared under matching UTC runner configuration (operatingTruthGuards and repair2SliceB); they are environment-sensitive, not evidence of migration defects. The initial overlapping current run is excluded.

The actual hosted pre-E legacy [run 37844902234](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37844902234), PR #499 head `a2874762a8599750425fd50aebd26c0790313530`, independently records exactly the same 20 failures in nine files, 2324 passes across 210 files. This supports PREEXISTING BASELINE classification under the hosted empty-database environment, not just a local approximation.

Hosted first-head run evidence: worker [37869436846](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37869436846), Daphne [37869436817](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37869436817), and nomenclature [37869436869](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37869436869) pass. Sales [37869436814](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37869436814) fails only the matched baseline CSV assertion. The later mobile [37869702515](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37869702515) log confirms the identical baseline bundle failure. These run SHAs precede the final audit commit; final-head checks still must be reviewed. Superseded fast and legacy runs were cancelled by workflow concurrency, never represented as passing.

## Remaining gate dependencies and unavailable portions

- Final-head hosted CI, repair/audit merge, latest-main fetch and exact recovery SHA must still be verified.
- Hosted legacy deterministic failures must be checked against the reproduced protected baseline exceptions; no new failure may be silently folded into that group.
- Final hosted fast contracts and world browser smoke remain required. Local pre-E browser smoke was not replayed; pre-E frontend source, lockfile and resulting bundle identities are unchanged, but this is not a fabricated browser pass.
- The workflows' remaining MySQL stages and mobile schema coverage are provided by final hosted CI, not inferred from TypeScript or deployment results.
- The field bridge DB-unavailable fixtures (two assertions) and prepReadiness assertion also reproduce in matched UTC follow-ups: 18 pass / 3 fail on each revision. They are separate PREEXISTING BASELINE fixtures, not timezone-dismissed regressions.
- Documentation PRs #503/#504 remain open and deliberately deferred to E7.
- No protected work is currently demonstrated to block a *new* migration regression: the protected failures reproduce before E. Their baseline repair belongs to #476.
- E5–E8 have not begun. No directory was moved, duplicate implementation restored, expectation weakened, test disabled, tenant manufactured or production operation performed.

**PROGRAM E — RECOVERY BLOCKED** pending final safety evidence and merge. **PROGRAM E — LLM LEGIBILITY NOT CERTIFIED**; E8 has not run.
