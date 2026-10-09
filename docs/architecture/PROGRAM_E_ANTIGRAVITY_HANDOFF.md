# Program E — Antigravity continuation handoff

Status snapshot: October 8, 2026 Pacific. This is a continuation guide, not final certification. Fetch live main and open PRs before acting; this snapshot will be updated as remaining work is completed.

## Verified checkpoints and completed PRs

| Milestone | GitHub / exact checkpoint | Disposition |
|---|---|---|
| Pre-E / Program D | #499; `7ba7310df76a142c053c9c2c857b750e207cb221` | Historical semantic reference, never reset main |
| E4b | #512; `6f90f5334416b6a09cdf0f5c2b5fa3c09a61d726` | Recovery starting main |
| Recovery | [#514](https://github.com/adamwright83-blip/bldg-admin-api/pull/514); `53fe3b0b5218ff5a836f47948d0a17f6ed62fac8` | MERGED; E0–E4 regression gate passed |
| E5a Driver Orders | [#515](https://github.com/adamwright83-blip/bldg-admin-api/pull/515); `d602fa6058969ca7ee7a28d7e2202b9b09531eb9` | MERGED; verified tree equals validated PR source |
| E5b Driver/overview split | [#516](https://github.com/adamwright83-blip/bldg-admin-api/pull/516); merged main `69aa6777bc912fbe259b5dd2d3cf166a78dbc986` | MERGED; complete hosted validation, only exact baseline failures |
| E5c authority split | [#517](https://github.com/adamwright83-blip/bldg-admin-api/pull/517); branch `codex/program-e-e5-authority-splits` | OPEN; local validation complete, hosted CI pending; do not presume merged |
| E5 remaining / E6 / E7 / E8 | Not complete at this snapshot | No LLM certification |

Immutable annotated tags were pushed and remotely peeled, including after recovery merge:

- `PRE_PROGRAM_E_BACKUP` → `7ba7310df76a142c053c9c2c857b750e207cb221`.
- `PROGRAM_E_E4B_CHECKPOINT` → `6f90f5334416b6a09cdf0f5c2b5fa3c09a61d726`.

Do not move existing tags, force-push main, reset history, restore duplicate old implementations, or revert Program E wholesale. Original Program D certification/evidence is intact.

## Recovery: reuse the evidence, do not restart investigation

Canonical recovery report: `docs/architecture/PROGRAM_E_REGRESSION_AUDIT.md`. Portable failure identities, summaries and full-log hashes: `docs/architecture/evidence/program-e-recovery-2026-10-08.json`. Source logs on Adam's host: `/tmp/program-e-recovery-evidence/`; GitHub Actions links in the audit are durable remote evidence.

Confirmed relocation defects repaired in #514: CleanCloud and Operator imports; Claire Mission Director filesystem roots; proactive obligation-store mock; workday Day Director mock; Operator MySQL migration URLs; CleanCloud authority integration import; Narrator Commercial source roots; silently omitted CleanCloud/Commercial workflow selectors; local proof imports; inactive President forbidden-path globs. No business behavior, expectation, nine protected Claire test files, tenant default or production data was changed.

The domain ratchet uses Git rename evidence plus matching historical import lines, rather than a named whitelist. `scripts/check-domain-boundaries.test.mjs` creates disposable Git repositories and rejects new callers, targets and changed import forms. Run ratchets against the PR base/main, not only the preceding documentation commit. E5b also includes Experience destinations so relocating code cannot evade Commercial/Money/Geography downstream restrictions.

CI previously cancelled contracts/world at five minutes; exact check annotations proved the timeout. Contracts now has 20 minutes, world 15, campaign/territory remain five. No test or step was removed. Cancellation is never a pass.

### Actual matched validation

- TypeScript and all four architecture gates pass.
- Focused relocation + Narrator: 8 files, 144/144.
- UTC MySQL worker: 34/34 both revisions; local Pacific worker timing produced false mismatches, so match CI `TZ=UTC`.
- Legacy journey + Daphne: 4/4 pre-E, 5/5 repaired; extra durable preference assertion is independent merged #495.
- CleanCloud customer authority: 1/1 both; restored CleanCloud + Commercial selection: 9 files, 83/83 both.
- Native Orders/Payment/Commercial MySQL: eight files, 21/21 both. Expanded ten-file selection: 24 passes, identical three root fixtures failing (two omit tenant authority; one omits Payment admission).
- Remaining fast MySQL stages: eight files, 25/25 baseline, 26/26 repair (extra #495 assertion). Separate production bootstrap ran twice successfully on both clean databases.
- Full Claire UTC: 155 files, baseline 2012 pass / 20 fail; repair 2016 pass / identical 20 fail.
- Exact legacy workflow: 210 files, baseline 2324 pass / 20 fail; repair 2328 pass / same 20 fail. Actual hosted pre-E run 37844902234 independently confirms the baseline identities.
- Sales workflow: 28 files, 348 pass / six skip / sole CSV failure, both.
- Broad domain selection differs: baseline 108 files / 717 pass / four fail / six skip; repair 117 files / 815 pass / same four fail / six skip. Do not claim identical selections.
- Program D historical four: 33 pass / same four fail across six selected files.
- Production build passes both. Bundle budget fails identically, `hero-DKp6D4HV.js` statically imports `BufferGeometryUtils-WcliCiyr.js`.

### Baseline exceptions, not permission to weaken assertions

1. Twenty assertions in nine protected #476 Claire files (see exact identities in JSON).
2. CleanCloud CSV cash/unpaid-count assertion (expected 1, received 2).
3. Mobile hero/three.js bundle isolation; six other mobile jobs pass. Blocked later steps are unavailable, not inferred passing.
4. Seven world browser cases: `.lc-lantern` missing/zero on desktop/mobile, plus desktop `.gl-world-title`; 16 pass / seven skip / 12 dependent serial cases not run on BOTH revisions. Exact hosted pre-E diagnostic 3001c1dc changes only timeout metadata, all application/test/fixture/dependency source identical to the tag. [Pre-E run 37871962549](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37871962549), [final recovery run 37872555538](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37872555538).
5. Four Program D fixtures: Gumball digest, missing-native-proof Money (external evidence is 73,739 cents), two Tower Wars actor/commitment fixtures.
6. Planning prepReadiness plus two Operator fieldEventBridge DB-unavailable fixtures reproduce in UTC: 18 pass / three fail each.
7. The three expanded native root-authority fixtures above.

No unresolved new E0–E4 regression remains in investigated coverage. These are scoped baseline exceptions; never generalize to all repository tests passing or failing. Final recovery hosted source and merged main trees were identical.

## Protected concurrent work

Fetch live statuses and file patches. Preserve #476, President #411/#375/#374/#359, Mitch #361. President does not manage Mitch. Merged Daphne #495 is current behavior, not disposable legacy. Do not relocate Claire while #476 is open. Exact protected files:

- `server/claire/activeCustomerMetric.test.ts`
- `server/claire/amdVoicemail.test.ts`
- `server/claire/claireTwilioAnalytics.test.ts`
- `server/claire/contextAssembler.test.ts`
- `server/claire/conversation/conversationLedger.test.ts`
- `server/claire/progression/correctivePass.test.ts`
- `server/claire/progression/failureFixtures.test.ts`
- `server/claire/turn/productionCallReplay.test.ts`
- `server/claire/twilioClaireIntegration.test.ts`

Docs #503/#504 remain open and must be deliberately reconciled in E7; do not merge stale inventories. #513 is a frozen prior E5 handoff draft, not a validated source slice. Neither was modified. President protected `scripts/migrate.mjs` patches add blocks near the end; future schema URL path edits around lines 1512/1569 are independent existing hunks, but recheck live patches. Likewise preserve President router registrations and schema sections if shared composition files change.

## E5 ownership decisions already established

Read `PROGRAM_E_E5_CLASSIFICATION.md` and `evidence/program-e-e5b-files.json`.

Completed E5a: all seven `server/joystick/driverOrder*` files → `server/domains/orders/driver/`; field router, Orders convergence mock/import and SaaS source assertion updated. Public routes stable; no legacy visibility behavior or native tenant/Payment fence changed. 57 contract assertions, matched 4/4 real-MySQL races, TypeScript/four gates and hosted validation passed. `server/joystick` has no remaining implementation.

Completed E5b (#516): `driverGameWorldService`, progression projection and mission interpretation → `server/experience/goldline/driver/`; real cold-call workflow/test → `server/field/outreach/`; real Scout application → `server/field/scout/`; mixed public router → `server/composition/driverGameWorldRouter.ts`; four read-only `businessWorld` files → `server/experience/lanternCity/businessOverview/` with overview filenames. API names and schema/event contracts remain stable. No active protected file overlaps.

E5b local: TypeScript/four gates, ratchets against main and adversarial checker pass; expanded broader selection 34 files / 200 pass / same two Tower Wars baseline failures; interpretation MySQL 4/4 on clean pre-E and moved source. Initial pre-move MySQL invocation overlapped edits and is EXCLUDED; the clean rerun is valid. Before broader move: 32 files / 188 pass / same two Tower Wars failures; different selections must be disclosed.

### Authority splits implemented in #517 (verify merge status first)

1. Before #517, `worldForgeService.ts` mixed physical identity/aliases/bindings, provider/official research, canonical Commercial prospect admission and tower artwork. Separate owned Geography helpers from Field application orchestration, official-site transport into Integrations, and pure artwork/contract/provider responsibilities. Keep persisted forge states, idempotency keys, source classification, admission, transitions, errors and provider guards unchanged. It creates only through the existing Commercial mission owner; do not move that real admission into a game builder. `identityResolver.ts` is geographic identity, not game identity. Shared pure game/visual contracts are legitimate in `shared`; avoid new Field→Game implementation coupling merely to extract a pure prompt.
2. Before #517, `cityWorldService.ts` materialized provisional display entities/aliases for already-geocoded customers, with transaction/unique-alias race recovery. Extract that exact materializer into Geography before moving read composition to Lantern City. It does NOT create native customers/payments. Preserve unknown coordinates and identity semantics.
3. Before #517, `towerWarsService.ts` lines ~420 onward had four promise functions; activation writes `dayDirectorCommitments`. Move the real permission-backed promise application to Planning, update router/test imports directly, and keep game revenue/attack calculations in Experience. No compatibility re-export/second owner. Existing two identity fixtures remain baseline until independently repaired.

#517 implementation: exact old function bodies now live in Geography `physicalEntityApplication.ts` and `provisionalPropertyEntities.ts`, Planning `dayDirector/towerWarsPromiseService.ts`, Field `propertyDiscovery/towerForgeWorkflow.ts`, Integrations `propertyResearch/officialPropertyResearch.ts`, and pure shared `propertyEvidence.ts` / `towerForgeContracts.ts` / `towerGenerationPrompt.ts`. Image provider/contracts tests are under Experience `goldline/builder/`. Physical identity resolver/test moved to Geography. No wrappers or compatibility re-exports. Source-body identity was independently checked against main (except exported ownership declarations). TypeScript/four gates pass; same logical broad selection remains 200 pass / two baseline promise failures across 34 files. MySQL journal→city plus captured-payment→Tower Wars is exactly 14/14 before/after with explicit proof mode. No active protected PR file overlap. All code is committed/pushed; hosted CI still must be classified before merge.

### Remaining physical E5 map (classify before actual move)

- Goldline chapter/campaign state, world event receipts, outcome branches, territory definitions and future-pressure projection → justified `server/experience/goldline/world/` portions.
- `lanternCityOverviewService` and city composition → `server/experience/lanternCity/`; existing objective-mark loader/router are read-only and belong there too.
- `fieldJournalProcessingService`, deterministic journal extraction and operator-reported commitments are field applications, not game/native financial authority. Preserve exact transcript grounding, ATTESTED versus VERIFIED labels, persisted processing/error state and domain calls.
- `echoFollowUpService` reads actual Commercial follow-ups verbatim; place that reader with Commercial, not a second agent/planner. Router may remain composition, behavior unchanged.
- `frontierIntelligenceService` is provider-sourced target research with bounded LLM ranking, not canonical facts; Field targeting/Integrations boundaries.
- `campaignTravelAdapter` is Google Distance Matrix transport; Integrations. CI/test routing is explicitly disabled.
- Mixed `goldlineWorldRouter` contains Forge application + game + read projection wiring; split/compose around the owners rather than wholesale game relocation.
- Tower Wars bank/settlement/impacts consume canonical admitted economics; move justified mode portions to `server/experience/goldline/modes/towerWars/` after promise split.
- `goldlineWorld/schema.sql` is a mixed historical bootstrap corpus; preserve every DDL/table/event literal. Decide an explicit bootstrap/compatibility owner; update `scripts/migrate.mjs` URLs without touching President additions. Do not aesthetically rename deployed schema.

## E6–E8 remaining work

E6: classify eight `legacyDayforge*` roots, move safe portions under `server/legacy/dayforge/`, preserve deployed DB/schema/event/env/API contracts and document live compatibility. Inspect `server/routers.ts` / `_core/index.ts`; extract established owning behavior, keep wiring focused, retain protected registrations. Update TS configs, workflow selectors, dynamic imports, mocks and filesystem literals. Preserve no duplicate wrappers.

E7: exhaustive active-old-path + authority/dependency/documentation audit, including source literals, dynamic imports, mocks, workflow silent selector omissions, source assertions, SQL URLs and duplicate authorities. Do not rewrite historical Program A–D evidence as current paths. Classify historical serialized references individually. Reconcile #503/#504 against actual final tree. Update root `ARCHITECTURE.md`, `CLAUDE.md`, ownership JSON, Program E audit, codebase finder, convergence status and subsystem READMEs. Current prose is stale about agent/Planning/Lantern City roots and #495 status; code wins. One obvious canonical entrypoint remains ARCHITECTURE.md.

E8 only after final validated E7 main: fresh competent evaluator with ordinary repository access and NO prior JOYSTICK conversation, execution prompt or handoff. Two independent evaluators if available; preserve their FULL answers. Ask what JOYSTICK/product value/Claire/Daphne/President/Mitch are; how seats differ; Day Line/Mission Director roles; Orders lifecycle and Payment admission owners; occurrence versus captured amount; Commercial won; CleanCloud; Lantern City; game state; whether game can create business truth; exact change locations for Orders/Stripe/Claire/Daphne/Tower Wars; legacy directories; VERIFIED/INFERRED/UNKNOWN and uninspected areas. Require cited implementation paths, correct ownership and no invented functionality. Commercial won=paid, game owns revenue, or implicit missing tenant=default fails. If no fresh evaluator, E8 PENDING. Never fabricate certification.

## Exact practical continuation procedure

1. Fetch main/open PRs; inspect new commits and protected patches. Do not reset to this snapshot.
2. If #517 remains open, inspect all hosted check logs. Compare failed legacy/world/bundle identities with the established evidence, not just conclusions. Fix any NEW failure; do not merge unvalidated code. Normal merge only, with matching head SHA, then fetch main and compare tree to validated head.
3. Branch from that latest verified main. For each next coherent slice: CLASSIFY → SPLIT → MOVE → update every consumer/mock/source-root/workflow → focused + broader + real-MySQL coverage → TypeScript/four gates against base → hosted CI → normal merge → fetch/verify main. No next move on an unvalidated previous move.
4. Keep all work committed/pushed. If usage/tools block completion, preserve an accurate GitHub handoff and stop affected work. User authorizes sequential validated PRs/merges without routine approval, but never production operations, protected branch edits, force pushes, weakened tests or fabricated certification.

Useful commands (read live workflow/package definitions before reusing):

```sh
pnpm check
pnpm check:nomenclature
DEFAULT_TENANT_RATCHET_BASE=origin/main pnpm check:tenant-ratchet
pnpm check:vertical-dependencies
DOMAIN_BOUNDARY_RATCHET_BASE=origin/main pnpm check:domain-boundaries
node --test scripts/check-domain-boundaries.test.mjs
TZ=UTC pnpm vitest run <equivalent logical paths>
TZ=UTC DAYFORGE_RELEASE_DB=1 DATABASE_URL=<disposable-db> pnpm vitest run --config vitest.integration.config.ts <integration-paths>
```

Mac test environment: Node22.22.0/pnpm10.4.1 frozen lockfile/Vitest2.1.9/MySQL8.0.46. Created-only disposable container `program-e-recovery-mysql`, root password `program-e-disposable`, port 127.0.0.1:34317; `program_e_pre`/`program_e_post` numbered-migration DBs; separate `_empty` CI legacy replicas and `_prod` production-bootstrap DBs. These are fake test credentials, never inherited production env. Do not touch preexisting `codex-architecture-mysql` or Supabase containers. The unused created browser DB container was removed.

Managed worktrees on Adam's host: clean exact pre-E at `/Users/adamwrightpfi/.codex/worktrees/program-e-recovery-baseline/Cursor_bldg-admin-api`; active source at `/Users/adamwrightpfi/.codex/worktrees/program-e-regression-recovery/Cursor_bldg-admin-api`; this handoff at `/Users/adamwrightpfi/.codex/worktrees/program-e-browser-baseline-proof/Cursor_bldg-admin-api`. Original Desktop checkout remains on prior handoff branch with its untracked recovery handoff intact; do not disturb it.

Helper `/tmp/program-e-recovery-evidence/relocate.py` rewrites resolved relative imports/mocks/literal URLs using an explicit `active-move-map.json`, then `git mv`. It does not cover arbitrary template strings, root-based paths, workflow selectors or docs; audit those manually. Do not invoke tests while files are being rewritten. No subagents were used so far; only E8 explicitly authorizes fresh independent evaluators.

## Verdict

E0–E4 recovery PASSED; E5a/E5b merged, E5c awaiting hosted validation; E5 partial; E6/E7/E8 PENDING at this snapshot.

**PROGRAM E — LLM LEGIBILITY NOT CERTIFIED.** Do not print JOYSTICK ARCHITECTURE PROJECT COMPLETE until final main contains validated E5/E6/E7, semantic invariants still hold and independent cold-model acceptance passes.
