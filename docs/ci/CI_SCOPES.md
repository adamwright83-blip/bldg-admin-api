# CI scopes: what runs on a pull request, and the one check to require

Every pull request runs one workflow, **CI** (`.github/workflows/ci.yml`). Its `scope` job reads the change
and picks the suites it needs; each suite is a reusable workflow that ci.yml calls; its last job,
**`merge-gate`**, passes only when every picked suite passed. `merge-gate` always reports, so a skipped suite
can never leave a merge waiting, and a needed suite can never be skipped into a pass.

A favicon change runs the two guards. A payment change runs the billing lifecycle, the launch exam, resident
intake over HTTP and the payment-admission contracts. Nightly and on demand, everything runs.

- Rules: [`scripts/ci/ciAreas.mjs`](../../scripts/ci/ciAreas.mjs) (the table) and
  [`scripts/ci/ciScopes.mjs`](../../scripts/ci/ciScopes.mjs) (the selection).
- Gate: [`scripts/ci/mergeGate.mjs`](../../scripts/ci/mergeGate.mjs).
- Tests for both, run by the scope job on every pull request: `node --test scripts/ci/*.test.mjs`.
- See what your branch will run: `node scripts/ci/ciScopes.mjs --base origin/main`
  (or `--files path/a.ts path/b.ts`). The same table is on every CI run's summary page.

## How a suite is selected

Every pull request runs the **nomenclature and domain guards** and the **story spoiler guard**. Any change to
code (`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.json`) also runs the **type-check** (`pnpm check`, once, in
ci.yml) and the **unit tests that import a changed file**, directly or not. More than 450 affected unit test
files, or a change to `unit-suite.yml`, runs the whole unit suite on four shards.

A suite (an *area* in `ciAreas.mjs`) runs when a changed file:

1. **matches the area's paths** or is the area's own workflow file. Test files count only for the suites that
   run them (point 2), except in the areas that kept an old paths filter;
2. **is imported by what the area runs**, within two steps: the tests, scripts and Playwright specs its
   workflow names (read from the workflow itself, package scripts expanded), the modules those import, and
   what those modules import. Following every import instead reaches most of the server from any router, and
   would select every suite for every server change;
3. **belongs to a shared layer the area uses**:

   | Layer | Files | Used by |
   | --- | --- | --- |
   | database | `drizzle/**`, `drizzle.config.ts`, `scripts/migrate.mjs`, the release migration applier | every suite that migrates a fresh MySQL: launch exam, billing, intake HTTP, tenant boundary and lifecycle, plan COGS, schema release, story, Fast Goldline contracts and worlds, legacy release |
   | server | `server/_core/**`, `server/routers.ts`, `server/db.ts` | suites that boot the server or check auth: launch exam, intake HTTP, tenant boundary, schema release, Fast Goldline contracts and worlds, legacy release |
   | client | `client/index.html`, `App.tsx`, `main.tsx`, `index.css`, `client/src/_core/**`, `contexts/**`, `hostRouting/**`, `vite.config.ts` | suites that drive the built app in a browser: launch exam, schema release, Fast Goldline worlds, legacy release |

Everything runs, as on the nightly run, when a pull request changes `package.json`, `pnpm-lock.yaml`,
`patches/**`, `tsconfig.json`, `tsconfig.node.json`, either Vitest config, `.npmrc`/`.nvmrc`, or
`.github/workflows/ci.yml`. A change to the rules themselves (`scripts/ci/ci*.mjs`) runs their tests in the
scope job; the nightly run selects everything whatever the rules say.

Areas that had a pull_request `paths:` filter before this change keep that filter exactly, plus the files
their workflow runs, and follow no imports (`importDepth: 0`). They run at least as often as before and no
more, until someone widens one on purpose.

Docs, `artifacts/`, `screenshots/` and Markdown reach no compiler and no suite, only the two guards (which do
read them).

## Suites: what triggers each

"Gated" means merge-gate requires it whenever the scope picks it. Every suite below runs nightly
(10:00 UTC) and on **Actions → CI → Run workflow**.

| Workflow | ci.yml job | Runs on a pull request when | Gated |
| --- | --- | --- | --- |
| nomenclature-hygiene | `guards` | always | yes |
| story-infrastructure (spoiler guard) | `story` | always | yes |
| story-infrastructure (story tables on MySQL) | `story` | story code or what it imports; database layer | yes |
| (inline) type-check | `typecheck` | any code change | yes |
| unit-suite (unit shards) | `unit` | a unit test imports a changed file; whole suite past 450 files | yes |
| unit-suite (intake HTTP) | `intake-http` | payment paths, `residentIntake*`, `intake*`, what the intake contract imports; server and database layers | yes |
| saas-launch-exam | `launch-exam` | auth, payment and tenancy paths; `e2e/real/**`; what its tests import; all three layers | yes |
| saas-billing-lifecycle | `billing` | `server/saas/**`, payment paths, what its tests import; database layer | yes |
| saas-tenant-boundary | `tenant-boundary` | tenancy and auth paths, what its tests import; server and database layers | yes |
| saas-tenant-lifecycle | `tenant-lifecycle` | tenancy paths, what its tests import; database layer | yes |
| saas-plan-cogs | `plan-cogs` | `server/saas/**`, what its test imports; database layer | yes |
| saas-schema-release | `schema-release` | any runtime code in `server/`, `shared/`, `client/src/`, `extensions/` (tests excluded): it proves `pnpm build`, migrations from empty, drift repair, idempotency and `pnpm start`; all three layers | yes |
| procurement-durable-worker | `procurement` | `server/procurement/**`, `procurement/**`, what its tests import | yes |
| goldline-fast-smoke (fast-contracts) | `goldline-smoke` | payment paths, resident agent tools and permissions, what its ~230 contract and MySQL tests import; server and database layers | yes |
| goldline-fast-smoke (six browser worlds) | `goldline-smoke` | each world separately: its client pages, proof-world seed and specs, the server it reads; all three layers | yes |
| legacy-dayforge-compatibility-release | `legacy-release` | `server/legacy/**`, the legacy flagship client, what its release contracts import; all three layers | yes |
| goldline-mobile-regression | `goldline-mobile` | its old paths filter (game, driver, goldline pages, experience, field…) | yes |
| beverly-hills-2d | `beverly-hills-2d` | its old paths filter | yes |
| claire-analysis | `claire-analysis` | its old paths filter (`server/analytics/claire/strategy/**`…) | yes |
| claire-sales-truth | `claire-sales-truth` | its old paths filter | yes |
| claire-strategic-preparation | `claire-strategic-preparation` | its old paths filter | yes |
| daphne-v2-acceptance | `daphne-v2-acceptance` | its old paths filter | yes |
| mission-director-cost | `mission-director-cost` | its old paths filter | yes |
| cleancloud-intake-pilot | `cleancloud-intake-pilot` | its old paths filter | yes |
| cleancloud-late-sales | `cleancloud-late-sales` | its old paths filter | yes |
| google-integrations | `google-integrations` | its old paths filter | yes |
| mitch-event-driven | `mitch-event-driven` | its old paths filter | yes |
| president-stage1 | `president-stage1` | its old paths filter | yes |
| sales-intel-teaching-review | `sales-intel-teaching-review` | its old paths filter | yes |
| first-ten-minutes | — (own `pull_request` trigger) | its own paths filter | **not yet**: see below |

Not run on pull requests, unchanged: `cancel-closed-pr-runs` (on close), `claire-conversation-integrity` and
`claire-prototype-eval` (pushes to named branches, by hand), `lantern-city-territory-mosaic`,
`mitch-claude-executor`, `mitch-independent-reviewer` (by hand), `president-autonomous-agent`,
`saas-retention` (scheduled).

**first-ten-minutes** still triggers itself. The sign-up pull request (#812) edits that workflow, and
converting it here would have conflicted. Once #812 merges: change its `on:` to `workflow_call` +
`workflow_dispatch`, drop its `concurrency` block, move its `paths:` into a new area in `ciAreas.mjs`
(`importDepth: 0`), add its job to ci.yml and to merge-gate's `needs`, and remove it from `STANDALONE`.
`ciScopes.test.mjs` fails until all of those agree.

Pushes to main run the guards and the type-check. Suites run on main only nightly.

## Baseline (before) and after

Measured from the last six completed pull_request runs of each workflow (job minutes, 2026-10-29 to
11-02). Before this change, 12 workflows ran on every pull request that touched code (3 even on docs-only),
14 more had paths filters, and 1 cancels runs on close; 7 never run on pull requests.

| Workflow (before) | Trigger | Jobs | Runner-min per run | Longest job |
| --- | --- | --- | --- | --- |
| goldline-fast-smoke | every PR | 8 | ~49 (contracts 7.5, six browser worlds 41) | 12.5 min |
| unit-suite | every code PR | 5 | ~19 | 4.7 min |
| legacy-dayforge-compatibility-release | every code PR | 1 | ~7.7 | 7.7 min |
| saas-launch-exam | every code PR | 1 | ~5.6 | 5.6 min |
| saas-schema-release | every code PR | 1 | ~3.4 | 3.4 min |
| saas-plan-cogs | every code PR | 1 | ~3.1 | 3.1 min |
| story-infrastructure | every PR | 2 | ~2.4 | 1.6 min |
| saas-tenant-boundary | every code PR | 1 | ~1.8 | 1.8 min |
| procurement-durable-worker | every code PR | 1 | ~1.6 | 1.6 min |
| saas-tenant-lifecycle | every code PR | 1 | ~1.5 | 1.5 min |
| saas-billing-lifecycle | every code PR | 1 | ~1.4 | 1.4 min |
| nomenclature-hygiene | every PR | 1 | ~1.0 | 1.0 min |
| goldline-mobile-regression | paths | 36 | ~104 | 5.3 min |
| claire-strategic-preparation | paths | 2 | ~9.9 | 6.3 min |
| claire-analysis | paths | 1 | ~7.2 | 7.2 min |
| beverly-hills-2d, daphne-v2-acceptance | paths | 1 | ~4.7 | 4.7 min |
| mitch-event-driven, president-stage1, cleancloud-intake-pilot, cleancloud-late-sales | paths | 1 | 2.8–3.6 | 3.6 min |
| first-ten-minutes, mission-director-cost, google-integrations, claire-sales-truth, sales-intel-teaching-review | paths | 1 | 1.4–2.2 (first-ten once took 36) | — |

Duplicated work before: `pnpm check` (about 1.5 min with a 6 GB heap) ran inside 11 suites; it now runs once
(saas-schema-release keeps its own, which its certification test asserts). The launch exam re-runs the
billing, COGS, tenant-lifecycle and hostile-tenant integration tests that their own gates also run (about
10 s each; left as is).

Per kind of change (runner-minutes are job time; "longest job" is the critical path without queueing):

| Change | Before: workflows | Before: runner-min | Before: longest | After: jobs | After: runner-min | After: longest |
| --- | --- | --- | --- | --- | --- | --- |
| Docs only | 3 | 11 | 8 | 2 | 2 | 2 |
| Favicon or static asset | 12 | 96 | 12 | 2 | 2 | 2 |
| Sign-up and accounts (#812's 34 files) | 20 | 125 | 12 | 22 | 110 | 13 |
| One account file | 12 | 96 | 12 | 6 | 14 | 5 |
| SaaS billing (`server/saas/saasBilling.ts`) | 13 | 99 | 12 | 14 | 38 | 8 |
| Tenant code (`tenantIdentity.ts`) | 12 | 96 | 12 | 10 | 40 | 8 |
| Shared contract (`shared/goldlineDayLine.ts`) | 13 | 106 | 12 | 8 | 40 | 8 |
| Lantern City scene | 14 | 205 | 12 | 8 | 131 | 13 |
| Story content (`season-0.json`) | 12 | 96 | 12 | 5 | 11 | 4 |
| Database migration (new SQL + `migrate.mjs`) | 18 | 117 | 12 | 20 | 101 | 13 |
| One suite's workflow file | 12 | 73 | 12 | 3 | 4 | 2 |
| `ci.yml` or dependencies | 15 | 110 | 12 | 28 | 236 | 13 |

What must pass for each (besides the two guards):

| Change | Gated suites |
| --- | --- |
| Docs, favicon | none |
| Sign-up and accounts | type-check, unit (345 files), launch exam, billing, intake HTTP, tenant boundary and lifecycle, plan COGS, schema release, procurement, story (MySQL), Fast Goldline contracts and all six worlds, legacy release, Beverly Hills 2D, Claire sales truth and strategic preparation, Google, Mitch, President, sales-intel review; first-ten-minutes on its own trigger |
| One account file | type-check, launch exam, tenant boundary, schema release |
| SaaS billing | type-check, unit (44 files), launch exam, billing, intake HTTP, tenant boundary and lifecycle, plan COGS, schema release, Fast Goldline contracts, legacy release |
| Tenant code | type-check, unit (357), launch exam, tenant boundary and lifecycle, schema release, story (MySQL), Fast Goldline contracts, legacy release |
| Shared contract | type-check, unit (401), schema release, Fast Goldline contracts, legacy release, Claire strategic preparation |
| Lantern City | type-check, unit (25), schema release, Fast Goldline world, mobile regression, Beverly Hills 2D |
| Story content | type-check, unit (2), schema release, story (MySQL) |
| Database migration | every database-layer suite, all six worlds, and the suites whose old filters name `drizzle/**` or `migrate.mjs` |
| One suite's workflow | that suite |
| `ci.yml`, dependencies | everything, whole unit suite |

Replaying the files of the last 80 merged pull requests through both rule sets (today's import graph,
measured costs): **150 → 98 runner-minutes per pull request on average (−35%)**, 15.4 workflows → 12.3 jobs.
The six browser worlds ran on 76 of 80 before and on 35 after; the whole unit suite on 77 before and 7 after
(the other 64 code changes ran 1–450 affected files). goldline-mobile-regression is unchanged and is now
about 45% of what remains.

## GitHub settings: require one check

`main` has no branch protection today and auto-merge is off; this pull request changes neither. When you
want the gate enforced:

1. **Let it run first.** After this merges, wait for one nightly run, or start one: **Actions → CI → Run
   workflow → main**. It runs everything. If a suite is red on main, fix it before step 3, or every pull
   request that selects it will be blocked.
2. Open any pull request and check that **CI / merge-gate** appears and its summary lists the suites it
   waited for. Old per-workflow checks (for example "SaaS billing lifecycle gate") no longer appear as
   separate runs; their jobs show inside the CI run.
3. **Settings → Rules → Rulesets → New branch ruleset**:
   - Name `main`, Enforcement **Active**, Target branches **Include default branch**.
   - **Require status checks to pass** → **Add checks** → type `merge-gate` → choose the one from
     **GitHub Actions**. Add no other check: `unit 1/4`, `fast-contracts` and the rest are skipped whenever
     the scope does not pick them, and merge-gate already judges them.
   - Leave **Require branches to be up to date before merging** off unless you accept re-running CI after
     every merge to main; the nightly run catches two green changes that break each other.
   - Bypass list: add **Repository admin** so an emergency fix can still merge.
   - Leave **Require a pull request before merging** and auto-merge as they are today.
4. In-flight pull requests pick up CI on their next push; nothing needs rebasing. Runs from before this
   merged keep their old check names and are not required.
5. To back out: disable the ruleset. CI keeps running and reporting; nothing waits on it.

GitHub emails nightly failures to whoever last changed the `schedule:` line in ci.yml.

## Quarantine

A test is quarantined only with all of: evidence (failures on at least three unrelated changes within 30 days,
at the same point, with run links), a named owner, a repair plan, and a date to revisit. A quarantined test
still runs and reports on every pull request that selects its suite, blocks the nightly run, and is never
deleted. When it is repaired, remove its quarantine in the same pull request as the fix.

| Test | Evidence | Owner | Repair plan | Revisit |
| --- | --- | --- | --- | --- |
| `e2e/beverly-hills-2d/round-up.spec.ts` (Round-Up; the failures are on the desktop keyboard path), quarantined on pull requests in `beverly-hills-2d.yml` | 6 of 42 completed runs failed (2026-10-27 to 11-01), all at `round-up.spec.ts:39`, the boxer's `data-boxer="charge"` not seen within 4 s, on five unrelated branches (runs 41269882972, 40652788934, 40652131287, 40624271433, 40439412251, 40439404744); `retries: 0` | Adam, with the Round-Up de-flake task already open | make the boxer's charge deterministic in the spec (wait for the herd-proximity condition, or drive it through the existing `__roundUp*` test hooks) rather than a fixed 1.2 s run-up | 2026-11-15 |

Watched, not quarantined (below the evidence bar):

| Test | Evidence | Owner | Repair plan |
| --- | --- | --- | --- |
| `server/strategy/workThreadIdentity.mysql.integration.test.ts` in fast-contracts' "Prove ops task completion concurrency against real MySQL" | one `ER_LOCK_DEADLOCK` on an `operator_macro_goals` insert in the last 100 Fast Goldline runs (run 41375461995, 2026-11-02), 30 of 31 files passed | Adam | that step runs 31 MySQL files in parallel on one database; give it `--no-file-parallelism` (as daphne-v2-acceptance does) or a database per file. Quarantine only if it reaches the evidence bar |

## When a gated suite fails

A suite the scope selected is relevant to the change by definition. Do not call a failure "unrelated" to get
a merge through: fix it, rerun it if it is a known flake listed above, or quarantine it by the rules above in
its own reviewed change. If the scope selected something that truly cannot be affected, fix the rule in
`ciAreas.mjs` (with a test) rather than overriding the gate.

## Adding or changing a suite

1. Give the workflow `on: workflow_call` (and `workflow_dispatch`), no workflow-level `concurrency` (inside a
   called workflow, `github.workflow` is "CI", so its group would cancel the others).
2. Add an area to `ciAreas.mjs`: `job`, `workflow`, `paths`, `uses`. Roots are read from the workflow.
3. Add the job to ci.yml behind `contains(fromJSON(needs.scope.outputs.jobs || '[]'), '<job>')`, and to
   merge-gate's `needs`.
4. Add a representative change to `ciScopes.test.mjs`. `node --test scripts/ci/*.test.mjs` checks that the
   table, ci.yml and the workflows agree, and that no other workflow starts on `pull_request`.

## Coverage risks that remain

- **Two import steps, not all of them.** A change three or more imports away from a suite's tests selects it
  only through its paths or layers. The unit tests follow every step; the nightly run selects everything.
- **The import graph is read with patterns, not a compiler.** It follows static and dynamic imports,
  `require`, the `@/`, `@shared/`, `@assets/` aliases and quoted repo paths (tests that read source files,
  `migrate.mjs` reading SQL). It misses computed paths, `vi.mock` factories and runtime calls from a page to a
  server route; the browser worlds list their server directories in `paths` for that reason.
- **Old paths filters stay as narrow as they were.** For example, mobile regression never ran on `App.tsx` or
  client-shell changes, and still does not on pull requests; it does nightly.
- **Main between nights.** Pushes to main run only the guards and the type-check. Without "require up to
  date", two individually green pull requests can combine into a red main until the nightly run.
- **first-ten-minutes is not behind merge-gate** until it is converted after #812.
- **Round-Up is quarantined** on pull requests; the deadlock above can still fail a pull request (rerun).
- **Rule changes run only the rule tests.** A careless edit to `ciAreas.mjs` could under-select later pull
  requests until someone notices; the nightly run does not depend on the rules. Review those diffs closely.
- The unit job checks out the pull request head (for its git-history invariants) while the scope reads the
  merge commit; a test added to main after the branch point can be named but not present. Vitest skips it.
