# Contractor-neutral business game — Slices 1–15

Implementation date: 2026-08-09

Product rule: the core FIELD/HQ game is contractor-category neutral. Laundry
Butler is the first configured operating tenant and retains the existing real
laundry/dry-cleaning order workflow at `/new-order` and the legacy operational
surfaces under `/admin`.

## Baseline and stability gate

- Initial full suite: 2,455 passing, 6 skipped, 6 failing across 5 files.
- Final full suite: 2,482 passing, 6 skipped, the same 6 failures across the
  same 5 files.
- Initial repository TypeScript check had existing errors. The final check adds
  no diagnostic in an overhaul file.
- Production build passes.
- Desktop and mobile browser checks passed with no page errors or framework
  overlays. Because the backend cannot boot locally without production
  `DATABASE_URL`, browser checks used intercepted test-only responses and never
  added mock state to production code.

## Slice 1 — Canonical event/evidence contract

1. Changed: added global value provenance, verification classes, business
   event envelope, provenanced values, and deterministic event deduplication.
2. Reused: order payment events, mission events, commercial follow-ups, visit
   outcomes, journals, and the existing evidence philosophy.
3. Added: `shared/businessGame.ts` and `server/businessEvents/`.
4. Legacy: no source event table was replaced or migrated.
5. Migration: none.
6. Tests: source identity/time preservation, provider verification, attested
   mission transitions, and duplicate world-delta suppression.
7. Commands: focused Vitest, repository TypeScript check, full suite, build.
8. Data quality: historical rows keep their existing evidence strength; weak
   manual information is not upgraded.
9. Next: adapt additional event families only as a projection needs them.

## Slice 2 — Customer/property projection foundation

1. Changed: introduced a canonical residential/commercial customer asset read
   model with service, payment, health, recovery, commercial value, and timeline.
2. Reused: orders, payment projections, churn snapshots/interventions,
   commercial accounts/locations/contacts/opportunities/pipeline/follow-ups.
3. Added: `server/customerAssets/` and tenant-scoped tRPC endpoints.
4. Legacy: old customer tables/components remain; no destructive identity merge.
5. Migration: none.
6. Tests: deterministic phone/composite identity and tenant separation.
7. Commands: focused Vitest, TypeScript diagnostic filtering, full build/suite.
8. Data quality: residential coordinates remain explicitly unresolved; unknown
   commercial receivables and averages remain unknown.
9. Next: add a verified geocoding write path before spatial placement.

## Slice 3 — FIELD/HQ shell

1. Changed: added the contractor-neutral, light-mode FIELD/HQ product shell.
2. Reused: existing auth, tenant membership, tenant brand configuration, and
   Laundry Butler `/new-order` workflow.
3. Added: `client/src/product/ProductShell.tsx` and shared product styling.
4. Legacy: AdminHostApp continues under `/admin`; it no longer defines the new
   shell. Mobile defaults to FIELD, desktop to HQ, and field role cannot enter HQ.
5. Migration: none.
6. Tests: build, existing auth/host contracts, desktop/mobile browser checks.
7. Commands: Vitest, Vite/esbuild production build, Playwright fallback checks.
8. Data quality: brand falls back to Laundry Butler only for the known legacy
   default tenant when no tenant profile exists.
9. Next: migrate operational drilldowns without breaking legacy deep links.

## Slice 4 — FIELD Today

1. Changed: unified real pickups, deliveries, payment blockers, assigned
   follow-ups, dispatches, and route exceptions into one ordered projection.
2. Reused: orders and `dayforgeToday` commercial aggregation.
3. Added: `server/field/fieldTodayService.ts`, types/router, and FIELD UI.
4. Legacy: the static Goldline route/objective list is bypassed.
5. Migration: none.
6. Tests: blocker/overdue ordering and stable-ID timeline deduplication; existing
   assignment and payment behavior suites remain green.
7. Commands: focused Vitest, TypeScript checks, browser mobile verification.
8. Data quality: verified travel duration is not yet available; no fake route
   time is shown.
9. Next: connect a tenant-approved routing provider and persisted job assignee.

## Slice 5 — Contextual FIELD opportunity engine

1. Changed: added deterministic generation, feasibility filters, value/time
   ranking, and explicit empty-result reasons.
2. Reused: missions, opportunities, account location/contact, service radius,
   capacity, and exactly-once mission activation.
3. Added: `fieldOpportunityService.ts`, FIELD moves API, and accept mutation.
4. Legacy: hard-coded calls/objectives/hustle state are bypassed.
5. Migration: none.
6. Tests: 45-minute viable gap, 20-minute rejection, no eligible target,
   permission exclusion, and capacity-full suppression.
7. Commands: focused Vitest, TypeScript check, browser FIELD check.
8. Data quality: nearby visits are not recommended without current location;
   customer recovery calls are not invented when channel permission is absent.
9. Next: add live routing estimates and explicit operator time budgets.

## Slice 6 — WORLD backend

1. Changed: added a server-owned persistent world projection.
2. Reused: customer assets, tenant locations, territory scans, payment events,
   mission events, memberships, pipeline values, and capability evaluation.
3. Added: `server/businessWorld/` and authorized `businessWorld.get`.
4. Legacy: the Kingdom frontend and client-side joins no longer define HQ.
5. Migration: none.
6. Tests: real-state business-stage derivation without XP authority.
7. Commands: focused Vitest, build, TypeScript, browser verification.
8. Data quality: unresolved coordinates are a first-class state; estimated,
   approved, and realized commercial values remain distinct.
9. Next: optimize/cache only after projection invalidation rules are proven.

## Slice 7 — WORLD frontend

1. Changed: added a physical WORLD map, HQ/resource cards, threats, recent
   changes, and an honest unresolved-record lane.
2. Reused: WORLD projection only; the client does not join source tables.
3. Added: `WorldView.tsx` and responsive spatial styles.
4. Legacy: Kingdom fantasy and AdminHostApp rooms are bypassed.
5. Migration: none.
6. Tests: desktop 1440×1000 browser render, interactive snapshot, no overlay or
   console/page errors with test-only transport interception.
7. Commands: Playwright fallback, image inspection, production build.
8. Data quality: unresolved entities are never assigned decorative coordinates.
9. Next: add geographic clustering when real world density requires it.

## Slice 8 — Customer Vault

1. Changed: added canonical asset list/detail, money/health/service summaries,
   contact/property state, and a durable event timeline.
2. Reused: Slice 2 projection across FIELD and HQ.
3. Added: `CustomerVault.tsx` and `/product/customer/:assetId` drilldown.
4. Legacy: no separate game-customer entity was created.
5. Migration: none.
6. Tests: identity tests plus build/browser route verification.
7. Commands: focused Vitest, build, TypeScript.
8. Data quality: missing churn scans, coordinates, or attributable commercial
   invoice data are displayed as warnings/unknown.
9. Next: add authorized review/referral projections when source data is durable.

## Slice 9 — GROW aggregator

1. Changed: combined commercial prospects/follow-ups and churn recovery into a
   ranked, cross-domain scarcity view with durable decisions.
2. Reused: commercial pipeline/follow-ups/opportunities, churn snapshots and
   interventions, configured capacity.
3. Added: `server/grow/`, `GrowView.tsx`, and decision persistence.
4. Legacy: separate SaaS opportunity lists remain drilldowns, not primary GROW.
5. Migration: `0048_business_game_projections.sql` adds move decisions.
6. Tests: expiry, capacity suppression, and value-per-time ranking.
7. Commands: Vitest, migration discovery tests, build, TypeScript.
8. Data quality: owner growth time and safe spend are unknown until configured.
9. Next: add referral/review/campaign sources after their permissions and costs
   are authoritative.

## Slice 10 — MONEY

1. Changed: added a clean money projection and transparent scenario evaluator.
2. Reused: payment projections, Customer Vault receivables/commercial realized
   revenue, and the existing True P&L parser/trust warnings.
3. Added: `server/money/` and `MoneyView.tsx`.
4. Legacy: the cockpit remains available but no longer defines MONEY.
5. Migration: none.
6. Tests: insufficient-data scenario and transparent operator-input scenario.
7. Commands: money/P&L/payment tests, build, TypeScript.
8. Data quality: non-default tenants do not receive tenant-blind P&L data;
   reserve and expansion capital return `INSUFFICIENT_DATA`.
9. Next: configure tenant reserve policy and durable expense sources.

## Slice 11 — Unload the Day

1. Changed: added idempotent day resolution over completed operations, verified
   payments, commercial events, recovery, journal state, deltas, and tomorrow.
2. Reused: operations events, payment events, mission events, recovery events,
   journals, FIELD Today, and event adapters.
3. Added: `server/unload/` and `UnloadView.tsx`.
4. Legacy: sales journal remains authoritative and is wrapped, not replaced.
5. Migration: `0048_business_game_projections.sql` adds immutable resolutions.
6. Tests: event replay dedupe; database uniqueness protects tenant/date/actor and
   request replay. DST-safe business-day boundaries are used.
7. Commands: focused Vitest, migration tests, build, TypeScript.
8. Data quality: no journal creates a warning, not a fake learned insight.
9. Next: add more source adapters only where a durable event exists.

## Slice 12 — HUNT integration

1. Changed: HUNT is now an intense, contextual FIELD submode driven by eligible
   real moves, adaptive momentum, and the Armory.
2. Reused: contextual FIELD moves, adaptive sales meter, mission routes.
3. Added: `HuntView.tsx` and `/product/hunt`.
4. Legacy: Goldline is no longer the driver home. Its Tomb Raider skin is
   preserved at `/archive/lara-croft-skin` with an archive boundary README.
5. Migration: none.
6. Tests: existing adaptive meter/mission tests, build, archive browser render.
7. Commands: Vitest, build, Playwright fallback, screenshot inspection.
8. Data quality: HUNT stays quiet when no move survives feasibility filtering.
9. Next: add live route updates after mission acceptance.

## Slice 13 — Coaching and objection archetypes

1. Changed: added an Armory projection and evidence-derived Anchor, Ghost,
   Gatekeeper, and Staller presentation labels.
2. Reused: personal journals, mission coaching artifacts/claims, curated sources,
   and foundation tactics.
3. Added: `server/armory/` and HUNT Armory presentation.
4. Legacy: fictional enemy events are not persisted.
5. Migration: none.
6. Tests: factual pattern classification and no-match/no-invention behavior;
   existing coaching provenance tests remain green.
7. Commands: armory/coaching/motivation tests, build, TypeScript.
8. Data quality: mission predictions remain mission-context guidance and are not
   relabeled as personal learning.
9. Next: add explicit user correction when an archetype mapping is wrong.

## Slice 14 — Capability engine

1. Changed: added an auditable `FIRST_HIRE_READY` policy and business-stage feed.
2. Reused: real order demand/weight, configured capacity, recurring customer
   assets, trusted P&L margin, and memberships.
3. Added: `server/capabilities/` and `CapabilitiesView.tsx`.
4. Legacy: XP and sales momentum are explicitly excluded from readiness.
5. Migration: none.
6. Tests: locked, approaching, ready, active, and no false unlock on missing data.
7. Commands: capability/WORLD tests, full build/suite, TypeScript.
8. Data quality: profitable declined demand, reserve, and schedule saturation
   remain missing in current schema, so production does not falsely unlock.
9. Next: capture those three metrics durably before enabling real first-hire action.

## Slice 15 — Minimal team domain

1. Changed: TEAM activates only for real non-owner tenant memberships; optional
   operating profiles and persisted commercial mission allocation are exposed.
2. Reused: tenant memberships, users, roles, and mission assignment.
3. Added: `server/team/`, `TeamView.tsx`, profile/event tables, conditional nav.
4. Legacy: no giant team/HR system and no fake organization chart was added.
5. Migration: `0049_team_operating_profiles.sql`.
6. Tests: team truth boundary, membership/auth regressions, capability active
   state, release migration discovery, build, full suite.
7. Commands: focused team/security tests, production build, full Vitest suite,
   TypeScript diagnostic filtering, `git diff --check`.
8. Data quality: owner-independent revenue remains unknown because sales mission
   assignment is not proof of production execution.
9. Next: add authoritative job executor/vehicle assignment before production
   allocation, incentives, or owner-independent revenue.

## Final commands and results

- `pnpm build` — passed.
- `pnpm test` — 2,482 passed, 6 skipped, 6 baseline failures unchanged.
- `pnpm check` — repository still has pre-existing errors; zero diagnostic in an
  overhaul file.
- Focused mission, payment, proof, churn, P&L, tenant, migration, FIELD, WORLD,
  GROW, MONEY, Unload, coaching, capability, and team suites — passed.
- `git diff --check` — passed.

## Migration requirement

Apply `0048_business_game_projections.sql` and
`0049_team_operating_profiles.sql` through the existing guarded release migration
workflow before enabling the new mutations in a deployed environment. No
database migration was executed against a live or local database in this pass.
