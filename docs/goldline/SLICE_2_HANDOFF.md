**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# SLICE 2 HANDOFF — StrategyEngine live-derived snapshot

**Status as of last update: INCOMPLETE — CONTINUE FROM HERE.**
**Branch:** `claude/goldline-slice-2-strategy-truth`
**Base:** `main` at `52f775c88653145686fb2c59d58d9732173e3c7a` (merge commit of PR #154, "Behavioral intervention ledger — Slice 1")
**Draft PR:** #155
**Exact latest commit SHA on this branch:** see bottom of this file — updated on every push. If this section says the same SHA as a stale-looking read, `git log -1` the branch directly; this file can lag by one commit at most.

**No production code has been written yet.** This update round was spent on verified research to de-risk the next session's first move on a truth-sensitive file, rather than pushing an untested guess — see "Research findings, this round" below. That is a deliberate choice, not a stall: this file (`snapshotBuilder.ts`) feeds Claire and the strategy layer, this environment has zero database access to verify anything against, and `REALITY_BRIDGE.md` explicitly forbids inventing a plausible-looking mapping under pressure. Confirmed-real building blocks are documented precisely below so the next session can move fast with confidence instead of re-deriving them.

---

## ⚠️ Naming collision — read this first

`docs/goldline/BUILD_BRIEF_SLICES_1_5.md` defines its own, unrelated **"Slice 2 — Kingdom sequence and campaign contracts."** That is a different feature stream (Lantern City / mission content) and this document has nothing to do with it. Do not merge the two mentally or in code.

**This "Slice 2" is the second step of the sequence defined in `docs/goldline/BEHAVIORAL_SCIENCE_FOUNDATION.md` §5's roadmap:**

1. Behavior/intervention ledger first — **done, merged as PR #154.**
2. **Kill fake StrategyEngine state — this document, in progress.**
3. Finish assertion-guard production wiring.
4. Add resistance/friction signal + behavioral telemetry.
5. Feed that into fiction selection.
6. Outcome-learning layer, then deepen Claire's relationship model.

If you are Codex (or any future agent) picking this up cold: you are on step 2 of that list, nothing else.

---

## Objective

`server/strategy/snapshotBuilder.ts` (the StrategyEngine's `buildStrategySnapshot`) is the function that assembles "canonical business truth" for the strategy/recommendation layer to reason over. Large parts of it are real and live-derived already (goal, active-customer count/trend, 30-day growth metrics, playground rules, MTD spend — all via real DB-backed services). **Four specific sections are hardcoded fixture data, not derived from anything.** ChatGPT and Claude both independently identified this in a prior audit (see chat history referenced in `BEHAVIORAL_SCIENCE_FOUNDATION.md`'s motivation — not reproduced here since this doc must stand alone).

The objective of Slice 2 is: **replace those four hardcoded sections with real queries against existing tables**, so nothing downstream (Claire, the mission director, any future outcome-learning) is ever fed fabricated business state disguised as a snapshot.

This is explicitly **not** a redesign of the snapshot shape (`StrategySnapshotPayload` in `server/strategy/snapshotTypes.ts` stays as-is unless a field genuinely cannot be populated truthfully, in which case mark it `null`/empty and say so — never invent a plausible-looking substitute).

---

## The four hardcoded sections (exact locations, as of base commit `52f775c`)

All in `server/strategy/snapshotBuilder.ts`, inside `buildStrategySnapshot`:

| Section | Lines (approx, base commit) | What it fakes |
|---|---|---|
| `funnelStages` | 146–174 | "Property Discovery / Approval / Resident First Order / Repeat Order" counts and conversion rates — all literal numbers |
| `limitingStage` | 177 | Hardcoded string `"Resident First Order"` — should be *derived* from whichever real funnel stage above has the worst fallout |
| `repeatPipeline` (`recentFirstOrderCustomers`) | ~179–210 | Two fabricated customers, **"Marcus K."** and **"Elena R."**, with invented `firstOrderAt`, `fulfillmentStatus`, `hasSecondOrder` |
| `dormantEligible` | 213–228 | Two fabricated customers, **"David"** (Wilshire Vista) and **"Sarah"** (Sunset Towers), with invented `lastOrderAt`/`daysSinceLastOrder` |
| `accounts` | 231+ | Fabricated building/account records (e.g. "Wilshire Grand Residences") with invented `state: "Contested"` |

Run `grep -n "Marcus K\.\|Elena R\.\|funnelStages\|limitingStage\|dormantEligible\|const accounts" server/strategy/snapshotBuilder.ts` on your checkout to get exact current line numbers — they will have drifted if anything above this function changed.

There is also a synthetic truncation hack downstream, around line ~541: `if (payload.customers.dormantEligible.length > 1) { payload.customers.dormantEligible = payload.customers.dormantEligible.slice(0, 1); }` — this exists only because the fixture data has exactly 2 entries; once dormant customers are real, revisit whether this truncation logic still makes sense or was only ever there to make the fake data look more plausible.

---

## Architecture / approach chosen

**Reuse existing real data services wherever they exist. Do not invent a new data-access layer.**

Confirmed already available in the repo (verified by direct inspection, not assumed):

- `server/strategy/growthMetrics.ts` — `getStrategyActiveCustomers`, `getStrategyGrowthMetrics`. Already wired into `snapshotBuilder.ts` correctly. **Use as the model for how a new real section should be written** (real `getDb()` query, tenant-scoped, time-windowed).
- `shared/customerChurn.ts` — `scoreCustomerChurn(input: CustomerChurnInput)`, a **pure function** (no DB access) that takes order-history observations and returns a churn grade/confidence. This is very likely the right scoring logic for `dormantEligible`, but it needs a real data-fetching layer feeding it real per-customer order history — that fetching layer does not appear to exist yet and may need to be written. Check `server/customerProfile.ts` and `server/adminCustomerAggregate.ts` first; they may already assemble the per-customer order history this needs.
- `server/canonicalBuilding.ts` / `shared/canonicalBuilding.ts` — likely the right source for `accounts` (real buildings, not fabricated ones). Not yet inspected in depth this session — start here.
- No churn/funnel service was found for `funnelStages` specifically. This is the least-scoped section; expect to need a genuinely new query (e.g., counting real customers/orders that fell into each real lifecycle stage over the snapshot window) rather than an existing service.

**Order of attack, easiest → hardest, REVISED after verified research this round** (do them in this order; each is independently shippable):

1. **`dormantEligible` — do this first.** `scoreCustomerChurn` exists in `shared/customerChurn.ts` (pure function, takes `CustomerChurnInput`). `server/customerProfile.ts` has `buildCustomerProfile(phone, rows: Order[])` and `server/adminCustomerAggregate.ts` has `buildAdminCustomerAggregatesInMemory(rows)` — both pure functions that take raw `Order[]` rows and derive last-order-date/aggregate history. **None of these three fetch from the DB themselves.** The real gap is a `getDb()` query against the `orders` table (tenant-scoped) feeding one of those two aggregators, then optionally `scoreCustomerChurn`. This is the most tractable section: the scoring/aggregation logic already exists, only the fetch-and-wire step is missing.
2. `repeatPipeline` — same shape as dormant (first order → second order tracking instead of recency). Check whether `buildCustomerProfile`/`buildAdminCustomerAggregatesInMemory` already expose a "has second order" concept before writing new logic.
3. **`accounts` — DO NOT do this next; see "Open design question" below before touching it.** `server/drizzle/schema.ts` has a real `commercialAccounts` table (`server/**` has real consumers: `commercialPipeline/commercialPipelineService.ts`, `field/fieldOpportunityService.ts`, etc.) — the *data* exists. The blocker is the `state` field.
4. `funnelStages` + `limitingStage` — still hardest, least scaffolding exists. `limitingStage` should fall out for free once `funnelStages` is real: pick the stage with the worst `observedConversionRate` (or largest drop from the previous stage).

**Correction to an earlier version of this doc:** there is no `server/canonicalBuilding.ts`. Only `shared/canonicalBuilding.ts` exists, and it is a **pure logic/types module** (`composeCanonicalBuilding`, `resolveCanonicalBuilding`, siege-depth/phase helpers) — it does not query a database and has no real building *records* in it. Do not start there expecting a data source; it's a shape-composition helper you'd call only after fetching real rows from elsewhere.

**Open design question — do not guess at this, ask Adam or leave it for a session with more room to think:** `snapshotTypes.ts`'s `accounts[].state` is typed as `"Captured" | "Contested" | "Closed" | "Recovery" | "Wait"`. This exact vocabulary was searched for across the entire repo (`grep -rln '"Captured"\|"Contested"\|"Recovery"' server/ shared/`) and **exists nowhere outside `server/strategy/` itself** — not in the territory/Lantern City code, not in `commercialPipelineService.ts`, nowhere. There is currently no real mapping from any business condition (commercial account status, pipeline stage, order recency, anything) to this 5-value enum anywhere in the codebase. Inventing one under time pressure is exactly what `REALITY_BRIDGE.md` prohibits — "Neither [fantasy nor reality] is allowed to impersonate the other." Before writing code for `accounts`, this mapping rule needs a real answer from whoever owns the product decision, not a guess that merely compiles.

---

## What is complete

**Nothing yet.** This handoff was written before any Slice 2 code changes, per explicit instruction to prioritize durability over racing ahead uncommitted. If you are reading this and the "Files changed" section below still says "none," the very first commit on this branch after this doc is where real work starts — check `git log` on this branch to see what actually landed.

---

## What remains

Everything in the "four hardcoded sections" table above. All of it. Full replacement of all four sections, with real DB-backed queries, tenant-scoped, matching the time-window conventions already established by `getStrategyGrowthMetrics` (30-day windows keyed off `America/Los_Angeles`, `en-CA` YMD formatting — copy this convention exactly, don't invent a new date-handling approach).

## Files changed

_(Updated as work lands — check this section's freshness against `git log` on this branch.)_

- None yet.

---

## Known bugs/risks

- **Do not silently change the snapshot's public shape.** Anything consuming `StrategySnapshotPayload` (Claire's context assembler, the mission director, any test fixture) may break if a field's type changes from "always populated" to "sometimes empty." Search for consumers before changing a field's optionality: `grep -rn "StrategySnapshotPayload\|\.funnelStages\|\.dormantEligible\|\.recentFirstOrderCustomers\|\.accounts\b" server/ client/`.
- **The `payload.customers.dormantEligible.length > 1` truncation hack** (line ~541) was very likely written *around* the fixture data's shape. Don't carry it forward unexamined — figure out whether it was a deliberate token-budget guard (plausible, given `DEFAULT_TOKEN_BUDGET` exists) or an artifact of faking exactly 2 dormant customers. If it's a real token-budget concern, real dormant-customer counts could be much larger than 2 in production and this guard becomes load-bearing, not incidental — verify it still does something sane against a real, possibly-large result set.
- **`computeContentHash`/`canonicalJsonStringify`** hash the snapshot payload for caching/staleness detection (`snapshotStore` Map, `strategySnapshots` DB table). Real data changes far more often and unpredictably than fixture data. Confirm this doesn't cause a cache-thrashing problem once inputs are live — not necessarily a blocker, but check the staleness/cache-invalidation logic in this file (search for `StalenessRecord`, `snapshotStore`) understands "the underlying data changed" rather than assuming near-static fixture-like inputs.
- **No test currently asserts the snapshot is non-fake.** There is no existing regression test that would catch a reversion to hardcoded data. Slice 2 should add one — see Tests section below.
- This environment (the one this handoff was authored in) has **no database access and no installed `node_modules`** (see `CLAUDE.md` → "Verification reality"). Every fix in this file must be verified by whoever/whatever continues it, either via a real dev DB or CI (the `goldline-fast-smoke.yml` / `dayforge-release.yml` workflows have real disposable MySQL — see PR #154's own history for exactly how to read real CI logs via `mcp__github__get_job_logs`, including the trick of requesting a large `tail_lines` and reading the saved file directly with Python/grep when the inline result is truncated).

## Tests added or still needed

**None added yet on this branch.** Needed, at minimum:

- One test per replaced section proving it no longer returns the literal fixture values (`"Marcus K."`, `"Elena R."`, `"David"`, `"Sarah"`, `"Wilshire Grand Residences"`, the literal funnel numbers `14/4/12/5`) — a simple string-search assertion against the built snapshot is enough to catch a reversion.
- A test proving each replaced section is tenant-scoped (two tenants with different data get different snapshot sections — follow the tenant-isolation test pattern already established in `server/opsTasks.behavioralLedger.test.ts` and `server/opsTasks.mysql.integration.test.ts` from Slice 1).
- If any section requires a real DB (likely, for all four), it needs a `*.integration.test.ts` file per the `vitest.integration.config.ts` convention (glob is literally `server/**/*.integration.test.ts` — get the filename exactly right; Slice 1 lost real CI time to this exact mistake once, see PR #154 commit history for `opsTasks.mysqlIntegration.test.ts` → `opsTasks.mysql.integration.test.ts`).
- If added to the CI gate, follow the exact pattern Slice 1 established in `.github/workflows/goldline-fast-smoke.yml`: a dedicated, isolated database for anything that needs a genuinely clean schema (see the `goldline_migrate_check` isolation added in Slice 1 and why — two migration mechanisms, `scripts/migrate.mjs` and `db:dayforge:release`'s `applyDayforgeReleaseMigrations`, cannot safely share one database in the same CI job).

## Truth/invariant rules that must not be violated

From `docs/goldline/BEHAVIORAL_SCIENCE_FOUNDATION.md` (binding) and `docs/goldline/REALITY_BRIDGE.md` (binding):

- **Never replace one fabrication with a more convincing one.** If a real query can't populate a field honestly (e.g., no funnel-stage tracking exists yet for some stage), the field must reflect that — null, empty, or an explicit "insufficient data" marker — never a plausible-looking guess.
- **Provenance is not optional.** This file already has a `ProvenanceRecord`/`StalenessRecord` type in `snapshotTypes.ts` — every newly-real section should populate real provenance (source table, query time), not leave provenance fields defaulted/empty for the new sections while the old fixture sections happened to not need them.
- **Do not touch the behavioral ledger (Slice 1) code** (`server/opsTasks.ts`, `server/behavioralLedger/`, `shared/behavioralLedger.ts`, `scripts/migrate.mjs`'s ledger tables) as part of this work unless a snapshot section genuinely needs to read ledger data (none currently do — the four fake sections are all pre-ledger business state, not behavioral history).
- **Do not add COM-B/TDF/BCT annotations, resistance signals, or intervention selection logic in this slice.** That's Slice 4/5 per the roadmap above. Slice 2 is strictly "make existing snapshot fields honest," nothing more.
- Match existing tenant-scoping, timezone (`America/Los_Angeles`), and date-formatting (`en-CA` → `YYYY-MM-DD`) conventions exactly — see lines 98–109 of `snapshotBuilder.ts` for the pattern already in use.

---

## Exact next recommended implementation step

**Start with `dormantEligible`, not `accounts`** (revised after this round's research — see above).

1. Find or write a tenant-scoped `getDb()` query against the `orders` table returning each customer's order rows (check `server/routers.ts` and `server/adminCustomerAggregate.ts`'s call sites first — a query shaped correctly for `buildAdminCustomerAggregatesInMemory`'s `CustomerAggregateDbRow` input very likely already exists somewhere and can be reused rather than rewritten).
2. Feed those rows through `buildAdminCustomerAggregatesInMemory` (or `hydrateCustomerAggregates` in `server/customerProfile.ts` — check which one already produces a last-order-date per customer; pick whichever is the closer match rather than both).
3. Filter/map the result into the `dormantEligible` shape `snapshotTypes.ts` defines (`id`, `firstName`, `buildingName?`, `lastOrderAt`, `daysSinceLastOrder`) — a customer counts as dormant per whatever threshold the current fixture implies (the fixture uses `daysSinceLastOrder` of 42 and 55 as examples; check if `shared/customerChurn.ts` already defines a real dormancy threshold constant before inventing one).
4. Consider whether `scoreCustomerChurn` should gate inclusion (only "high" or "medium" churn grade counts as dormant-eligible) — read `shared/customerChurn.ts` in full before deciding; it may already encode the right threshold logic.
5. Replace the hardcoded `const dormantEligible = [...]` block (server/strategy/snapshotBuilder.ts, ~line 213) with a call to the new function.
6. Add a regression test proving `"David"` and `"Sarah"` (the fixture's literal fabricated names) no longer appear in a built snapshot, plus a tenant-isolation test (two tenants get different dormant lists).
7. Commit, push, update this file's "Files changed" and "What is complete" sections, update the draft PR (#155) description if scope materially changed.
8. Move to `repeatPipeline` next (attack-order step 2), same pattern. Leave `accounts` and `funnelStages` for later — `accounts` is blocked on a product decision (see "Open design question" above), not an implementation gap.

---

**Exact latest commit SHA on this branch:** re-check `git log -1` for the true current HEAD — this line is not live-updated by tooling. As of this update, the branch has two commits past base `52f775c`: the initial handoff doc, and this research-correction update. Both are docs-only; zero production code has changed on this branch so far.
