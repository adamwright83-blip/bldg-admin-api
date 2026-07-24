# DayForge V3 — 30-Day Sales-Readiness Progress Ledger

## Execution contract

- Branch: `codex/dayforge-30-day-v3`
- Starting and rollback commit: `fc6d70c025086d727e3cb3fd5ecb8a9f0b369187`
- Starting remote state: `main` and `origin/main` both resolved to the rollback commit.
- Delivery: small dependency-correct commits pushed only to the feature branch; never merge or push directly to `main`.
- Scope authority: the complete V3 master prompt, the approved ChatGPT clarification, and the accepted execution plan.

## Phase status

| Phase | Status | Evidence |
| --- | --- | --- |
| 0 — baseline, route map, safety net | Complete | Route/provider/payment/storage audits recorded; baseline release tests and build pass, with unrelated repository failures isolated below. |
| 1 — shared contracts and data foundation | Complete | Migration `0045`, shared contracts, canonical contact/mission persistence, dispatch, proof, coaching, campaign-link foundation, and 81 focused tests pass. |
| 2 — DayForge Today and walk-in | Not started | — |
| 3 — auth and preview continuation | Not started | Current login fallback to `/julydemo` re-verified. |
| 4 — canonical driver, BORESLAY, IRL mission, coaching | Not started | Existing canonical handoff and Rally/driver assets re-verified. |
| 5 — campaign and automatic attribution | Not started | Current manual order-ID attribution re-verified. |
| 6 — proof dashboard | Not started | — |
| 7 — third-party tenant completion | Not started | — |
| 8 — full release, browser, and visual gates | Not started | Baseline results below. |

## Verified existing architecture

- `server/commercialMissions/commercialMissionStore.ts` owns the canonical mission creation transaction and persists mission steps.
- `commercial_mission_phone_handoffs` already stores hashed, expiring, assignment-bound secure handoffs.
- BORESLAY uses the live Rally renderer/engine and existing mission lifecycle integration; the repository already contains side-specific target art and a `buttHybrid`-style scoring path.
- The driver UI has local mission target/state machinery and reusable photo-preview components that are not sufficient as authoritative production truth.
- `commercial_order_attributions` is the existing commercial revenue ledger. Attribution currently requires a manually confirmed order ID and a won/converted commercial account.
- Revenue reconciliation refreshes already-attributed orders from `orders.paid`, `orders.total`, and `orders.paidAt`; it does not discover new orders.
- `DayforgeLoginPage.tsx` currently redirects every successful login to `/julydemo`.
- Territory Preview supplies preview context to login/onboarding, but the current login destination discards it.
- Existing release infrastructure includes focused TypeScript, Vitest, MySQL integration, migration verification, production build, and Playwright commands.

## Baseline verification — 2026-07-23

| Command | Result |
| --- | --- |
| `npm run check:dayforge:release` | Pass |
| `npm run test:dayforge:release` | Pass: 23 files, 97 tests |
| `npm run build` | Pass; existing large-chunk warnings only |
| `npm run check` | Pre-existing failure on clean rollback SHA; no V3 edits were present |
| `npm test` | Pre-existing failure: 5 tests failed, 2,310 passed, 6 skipped |
| `npm run dayforge:migrations:verify` | Environment has `DATABASE_URL`, but the configured database is unavailable |

The repository-wide typecheck currently reports existing errors in `adminLiveModel.ts`, `Home.tsx`, `_core/index.ts`, several vendor/procurement modules, `clearent.ts`, `customerProfile.ts`, `tabularIngestion.ts`, and `routers.ts`. The full unit suite has five existing failures in `adminLiveModel.test.ts`, `operationsEventsDashboard.test.ts`, `marketplacePaymentDryRunRoute.test.ts`, and `residentIntake.test.ts`. These are baseline failures, not evidence against focused V3 changes. The final gate will rerun both commands and distinguish unchanged baseline diagnostics from new failures.

Database integration is pending a reachable disposable MySQL database. Playwright 1.61.1 is installed; browser E2E remains to be run against the implementation. Neither gate will be reported as passing without direct evidence.

## Auth continuation contract

Authenticated destinations resolve in this intentional order:

1. active valid secure mission handoff;
2. valid preview continuation;
3. valid same-origin internal `returnTo`;
4. `/dayforge-today`.

`/julydemo` remains explicit demo-only behavior. External, protocol-relative, script/data, malformed, expired, and unauthorized continuations fail closed.

## Attribution and refund contract

- A valid explicit signed campaign wins for its order.
- Original first-touch acquisition is preserved independently from order-specific campaign credit.
- A later unsourced order may inherit acquisition only when customer identity and service property/address match and no newer source conflicts.
- Changed address, ambiguous identity, fuzzy matching, and conflicting sources require review.
- No arbitrary attribution expiration window is introduced.
- Realized revenue uses canonical net paid truth when available. Known unpaid orders, cancellations, and full refunds contribute zero.
- Partial-refund math is not invented when the canonical payment system lacks reliable net amounts; the attribution enters review instead.
- Corrections are tenant-scoped, audited, and preserve history. Attribution never changes the customer charge.

## Phase 1 implementation evidence

- The canonical commercial contact contract now carries name, title, email, phone, relationship type, preferred channel, source/provenance, source URL/time, and notes end to end.
- Contact matching prioritizes normalized email, then normalized phone, then non-generic normalized name/title; repeated submissions enrich an existing lower-confidence contact and unnamed contacts receive collision-safe identities.
- `commercial_mission_steps` remains the ordered root. `commercial_mission_irl_step_details` is a narrow companion keyed to the canonical step and stores navigation, timing, reveal, proof, verification, reviewer, fulfillment, and structured metadata.
- Durable tenant-scoped records now cover in-app/SMS dispatch, private proof uploads and deletion tombstones, coaching artifacts with claim provenance, campaign links, first-touch/order-specific acquisition, correction history, payment projections/events, and auth continuation.
- Unknown opportunity values remain nullable and are explicitly separated from known estimates in shared and UI aggregates.
- SMS is opt-in per dispatch and requires the secure handoff; durable in-app dispatch works without Twilio. Provider-not-configured is stored truthfully.
- Proof records are server-backed, authorization-scoped, MIME/size limited, reviewable, retryable after rejection, and coupled to recoverable object-deletion lifecycle records. The retention policy is 90 days.
- Coaching stores schema-validated concise output, source claims, evidence references, prompt/model metadata, stable context hashes, fallback state, and no hidden reasoning. Account content is treated as untrusted context.

## Files changed through Phase 1

- `drizzle/schema.ts` and `drizzle/0045_dayforge_30_day_foundation.sql` — backward-compatible Phase 1 schema.
- `shared/commercialMission.ts`, `shared/commercialPipeline.ts`, `shared/commercialProposal.ts`, `shared/dayforgeCoaching.ts`, and `shared/dayforgeContinuation.ts` — shared contracts and validation.
- `server/commercialMissions/*`, `server/commercialCampaigns/*`, and `server/dayforgeCoaching/*` — canonical persistence and service foundations.
- `server/dayforgeRetention/retentionService.ts`, `server/storage.ts`, and `server/_core/sms.ts` — private proof lifecycle and dispatch adapters.
- `scripts/dayforge-migrations-verify.ts` and focused migration/service/contract tests — compatibility and behavior gates.
- Existing commercial opportunity surfaces now distinguish unknown estimates rather than manufacturing zero-value certainty.

## Migrations added

- `drizzle/0045_dayforge_30_day_foundation.sql` — nullable location/value truth, contact enrichment, canonical IRL companion state, dispatch, evidence lifecycle, coaching artifacts, campaign/acquisition/correction/payment foundations, and auth continuations. All additions are additive or relax prior non-null assumptions; no destructive rewrite is included.

## Tests added

- Phase 1 focused suite: 11 files, 81 tests passing on 2026-07-24.
- Coverage includes full-contact persistence and enrichment, email/phone/fallback/blank identity behavior, tenant boundaries, canonical step persistence, dispatch idempotency, proof authorization/review/retry/retention, campaign token and assignment behavior, coaching provenance/context safety, continuation validation, and migration structure.
- Clean non-incremental TypeScript still reports only the previously recorded repository baseline diagnostics; no Phase 1 file appears in the diagnostic set.

## Environment variables and external setup

The environment contains values for `DATABASE_URL`, Stripe, Anthropic, and Twilio, but secret values were not printed or persisted. The configured database was unreachable during baseline migration verification. Credential presence alone will not be treated as provider-health or live-send evidence. Missing/unreachable providers leave only their corresponding live verification pending; adapters, truthful status, fallbacks, and tests remain required.

## Manual acceptance still required

- Final operator-run smoke test with a real account and non-sensitive contact data.
- Stripe test-mode paid order through a real campaign link if credentials are available.
- Optional Twilio sandbox/live-send confirmation when configured.
- Subjective art-direction review after objective screenshot and interaction gates pass.

## Deviations and blockers

- The requested “pre-auth working-state commit” is represented by the existing clean rollback SHA `fc6d70c`; no empty commit will be created.
- No unresolved product blocker is known at baseline.
