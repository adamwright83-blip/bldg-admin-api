<!-- LEGACY DAYFORGE COMPATIBILITY: historical route literal reference retained for launch audit tracking. Canonical product is JOYSTICK. -->
# JOYSTICK Launch Readiness Tracker

**Target:** First 10 Trial Customers  
**Started at:** `main@c142c0d55d441f004c6943b11e061657b1c1dd4e`  
**Current Status:** IN PROGRESS

---

## 1. Issues & Launch Blockers

| ID | Severity | Area | Issue Description | Customer Impact | Evidence / Reproduction | Acceptance Criteria | PR / Commit | Status |
|---|---|---|---|---|---|---|---|---|
| ISS-001 | P0 | Landing Routing | Visiting `/` on standard hosts renders legacy concierge (`HeldLanding`) instead of JOYSTICK | New visitors to the domain see laundry concierge and never see JOYSTICK or start flow | `client/src/App.tsx` routes non-driver, non-vendor to `HeldLandingRoute` | Visiting `/` on non-held/non-butler host renders `JoystickLanding` | PR #527 (`e8f2dfc9`) | RESOLVED |
| ISS-002 | P1 | Test Suite | `client/src/pages/JoystickLanding.test.ts` fails asserting legacy `START_PATH = "/dayforge-onboarding"` | Vitest suite fails in CI/local runs | `pnpm test client/src/pages/JoystickLanding.test.ts` exits with code 1 | Test asserts `START_PATH = "/joystick-start"` and passes cleanly | PR #527 (`e8f2dfc9`) | RESOLVED |
| ISS-003 | P1 | Onboarding / First Mission | `FirstMissionDriver.tsx` and `GoldlineGameNav.tsx` contain hardcoded `https://admin.bldg.chat/growth/lantern-city` | Trial customers on any other host/domain lose authentication and are stranded on external host | `FirstMissionDriver.tsx` lines 29, 40 and `GoldlineGameNav.tsx` line 4 | Origin-relative path `/growth/lantern-city` used everywhere | PR #527 (`e8f2dfc9`) | RESOLVED |
| ISS-004 | P2 | Telemetry | Missing key PostHog launch events (`landing_page_visited`, `first_mission_started`, `returning_session`, etc.) | Cannot track trial funnel conversion or activation drop-off | Audit of `captureProductEvent` calls in client | Key lifecycle events instrumented with tenant attribution | PR #528 (`5bfb95dd`) | RESOLVED |
| ISS-005 | P1 | First Action Experience | Journey from onboarding reveal to first real-world action and Day Line reflection needs seamless feedback | Trial customer needs immediate clarity on their first objective and earn progress without third-party integration | Audit of `/play` and `/growth/lantern-city` after acquisition | First action immediately visible, executable, updates Day Line and rewards progress | PR #529 (`4488ecba`) | RESOLVED |
| ISS-006 | P1 | Landing Conversion | Commercial terms ($49/month, 7-day trial, card required, cancel anytime) not visible on public landing page | Visitors enter acquisition funnel without knowing pricing, trial length, or cancellation policy | Inspection of `JoystickLanding.tsx` and `joystick-landing.css` on desktop/mobile | Clear commercial terms visible on desktop and mobile viewports | PR #531 | RESOLVED |
| ISS-007 | P1 | Landing Navigation | Desktop nav links (`#how-it-works`, `#industries`, `#examples`) lead to hidden empty elements | Clicking nav links produces no action; prospective customers cannot explore features or examples | `JoystickLanding.tsx` lines 98–100 `.joystick-anchor { display: none; }` | Nav links jump/scroll to interactive, responsive content sections | PR #531 | RESOLVED |
| ISS-008 | P1 | Interrupted Acquisition | Interrupted acquisition credentials stored only in `sessionStorage` (lost on tab close/new window) | Returning visitors in new tabs lose draft onboarding answers and have to restart | `JoystickAcquisitionPage.tsx` line 22 checks `sessionStorage` only | Dual `sessionStorage` + `localStorage` persistence restores draft state across tab reopens | PR #531 | RESOLVED |

---

## 2. Launch Certification Criteria & Execution Matrix

### 2.1 Source-Level Contracts & Architectural Invariants (Static Verification)
*These test suites verify source code invariants, schemas, and API signatures via `server/saas/launchReadinessCertifications.test.ts`. They confirm static invariants but do not substitute for executable end-to-end acceptance.*

| Test ID | Certification Name | Scope / Target Scenario | Method & Preconditions | Expected Result | Result & Evidence | Status |
|---|---|---|---|---|---|---|
| CERT-1 | New Customer Signup & Activation Contract | Tenant lifecycle & provisioning API shape | Static source inspection & AST check | Contract points defined, schema models present | Verified in `launchReadinessCertifications.test.ts` & `tenantLifecycleCertification.test.ts` | PASSED (Source Contract) |
| CERT-2 | First Action & Day Line Contract | First action driver & Day Line integration points | Static source inspection & schema review | Event emissions, next-up card, and telemetry present | Verified in `launchReadinessCertifications.test.ts` & `firstActionDayLine.test.ts` | PASSED (Source Contract) |
| CERT-3 | Returning Customer Session Contract | Session persistence & continuity contracts | Static source inspection | Session resume endpoints and route safeguards verified | Verified in `launchReadinessCertifications.test.ts` & `dayTwoContinuity.test.ts` | PASSED (Source Contract) |
| CERT-4 | Tenant Isolation Verification Contract | Procedural isolation invariants | Static source inspection & schema assertions | Tenant ID scoping on queries and procedures | Verified in `launchReadinessCertifications.test.ts` & `tenantIsolationCertification.test.ts` | PASSED (Source Contract) |
| CERT-5 | Webhook Replay Idempotency Contract | Stripe webhook idempotency structure | Static source inspection of event tracking | Unique scope/idempotency keys verified | Verified in `launchReadinessCertifications.test.ts` & `saasBilling.lifecycle.integration.test.ts` | PASSED (Source Contract) |
| CERT-6 | Interrupted Session Recovery Contract | Draft acquisition answer versioning & resumption | Static source inspection | Optimistic concurrency & version locks present | Verified in `launchReadinessCertifications.test.ts` (`answerSession` state preservation & version lock) | PASSED (Source Contract) |

---

### 2.2 Executable Customer Acceptance Journeys (End-to-End Execution)
*Executable proof required across running services, real browser viewports, and database operations. Release status remains IN PROGRESS until all acceptance journeys have recorded evidence.*

| Journey ID | Customer Acceptance Journey | Scope & Requirements | Execution Method & Preconditions | Expected Result | Actual Evidence | Status |
|---|---|---|---|---|---|---|
| ACCEPTANCE 1 | Public Landing → Start Journey | Visit `/` on desktop (1440x900) & mobile (390x844). Verify commercial terms ($49/month, 7-day trial, card required, cancel anytime). Verify navigation links reach actual content. Primary CTA reaches `/joystick-start`. | Playwright browser execution against Vite/app shell | Terms visible on both viewports; nav links jump to `#how-it-works`, `#industries`, `#examples`; CTA navigates to `/joystick-start` | Verified via `e2e/launch/acceptanceJourneys.spec.ts` (Desktop & Mobile) | REAL BROWSER PASSED |
| ACCEPTANCE 2 | Three-Question Onboarding & Personalized Preview | Answer 3 questions as real business. Verify state survives browser refresh. Verify preview briefing reflects specific answers. Verify draft preview label before payment. | Real anonymous browser onboarding with real HTTP APIs and disposable MySQL | State preserved on reload; preview contains answer tokens; labeled as draft preview | PR #534, `0b1556b5937fc76b41613b3a3faae239a512a2d1`; [hosted run](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37971466617), `pnpm test:launch:real`; actual procedure, MySQL and browser evidence in [real acceptance report](REAL_CUSTOMER_ACCEPTANCE_EVIDENCE.md). Production schema repair #535 remains approval-held. | REAL BROWSER + BACKEND PASSED (disposable required schema) |
| ACCEPTANCE 3 | Stripe Test-Mode Trial Signup | Customer created, Subscription with 7-day trial, trial end timestamp, payment method attached, tenant provisioned, owner activated, idempotency recorded. | Real Stripe test-mode API with disposable MySQL | Full lifecycle from checkout session to active owner workspace | BLOCKED provider: verified JOYSTICK test key, webhook/app origin and $49/month test price required. Existing fake-adapter MySQL lifecycle PASSED (2 tests) in hosted run 37971466617; no actual Stripe-provider claim. [Credential audit](STRIPE_PROVIDER_ACCEPTANCE.md). | BLOCKED — Missing provider test credentials |
| ACCEPTANCE 4 | First Mission & Day Line Update | Real first mission observation, ATTESTED persisted event, Day Line, refresh, replay and useful next action; guardian gameplay remains separate | Browser / runtime execution of first action and Day Line refresh | Attested field observation recorded, Day Line reflects completion, known-territory projection updates, guardian gameplay remains separate, persists on reload | PR #534, `0b1556b5937fc76b41613b3a3faae239a512a2d1`; [hosted run](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37971466617), `pnpm test:launch:real`; actual procedure, MySQL and browser evidence in [real acceptance report](REAL_CUSTOMER_ACCEPTANCE_EVIDENCE.md). Production schema repair #535 remains approval-held. | REAL BROWSER + BACKEND PASSED (disposable required schema) |
| ACCEPTANCE 5 | Returning Customer Session | Log out / clear cache, log back in as customer, verify landing on active world, Day Line continuity, active mission resumable, Claire context preserved. | Real password login, end browser session, cookie-empty second context login | Resumes directly into active world without restarting onboarding | PR #534, `0b1556b5937fc76b41613b3a3faae239a512a2d1`; [hosted run](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37971466617), `pnpm test:launch:real`; actual procedure, MySQL and browser evidence in [real acceptance report](REAL_CUSTOMER_ACCEPTANCE_EVIDENCE.md). Production schema repair #535 remains approval-held. | REAL BROWSER + BACKEND PASSED (disposable required schema) |
| ACCEPTANCE 6 | Two-Tenant Isolation Under Real Operations | Create second trial customer (distinct business & tenant). Verify zero data leakage across orders, missions, Day Line, billing, Claire context, and game world. | Two persisted bcrypt owners and distinct tenants, real HTTP positive/negative controls and MySQL no-effect assertions | Zero cross-tenant data leakage or bleed under reads and writes | PR #534, `0b1556b5937fc76b41613b3a3faae239a512a2d1`; [hosted run](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37971466617), `pnpm test:launch:real`; actual procedure, MySQL and browser evidence in [real acceptance report](REAL_CUSTOMER_ACCEPTANCE_EVIDENCE.md). Production schema repair #535 remains approval-held. | REAL BROWSER + BACKEND PASSED (disposable required schema) |

---

## 3. Pull Request History

| PR # | Branch | Summary | Merged SHA | Status |
|---|---|---|---|---|
| #527 | `fix/launch-landing-routing` | Fix public landing route, JoystickLanding vitest, and origin-relative links | `e8f2dfc9` | MERGED |
| #528 | `feat/launch-analytics-posthog` | Complete PostHog lifecycle telemetry: onboarding, mission start, Claire calls, returning session | `5bfb95dd` | MERGED |
| #529 | `feat/launch-first-action-dayline` | Direct entry to First Mission from reveal, prominent Day Line empty state & Next Up card, unconditional action telemetry | `4488ecba` | MERGED |
| #530 | `test/launch-readiness-certifications` | Automated source-level certification suite verifying CERT-1 through CERT-6 | `0ef704f5` | MERGED |
| #531 | `feat/launch-acceptance-remediation-p1` | Landing commercial terms & briefing sections, dual credential resilience, executable acceptance suite | `3fa089df` | MERGED |
| #532 | `feat/launch-acceptance-journeys-p2` | Mocked UI regression for first-mission feedback and returning-session rendering; preview comparison only for ACCEPTANCE 6 | `a57a95ee` | MERGED |

| #533 | `codex/real-customer-acceptance` | Correct mocked UI and preview-only isolation claims | `37dacd3549053ddfbe1c03593b1ea52fc5f0863b` | MERGED |
| #534 | `codex/real-acceptance-environment` | Real browser/backend/MySQL onboarding, mission, second-login and tenant-isolation acceptance; persisted Day Line receipt | `4f68941b1e889073cfd00bd135aa0dd8061a513c` | MERGED |
| #535 | `codex/acceptance-schema-approval` | Restore omitted production context schema from existing historical DDL | candidate `00b477e29308ac51bb60603fbd0a6b427ebe8a1a` | OPEN FOR APPROVAL |

## 4. Real Acceptance Release Gates

The completed browser/backend rows above use actual authentication and persisted
MySQL, with guarded required historical schema in the disposable test database.
[Full evidence](REAL_CUSTOMER_ACCEPTANCE_EVIDENCE.md) records exact tests, commands,
procedures, database checks, screenshots, source SHA and hosted CI run.

Production bootstrap omits required context stores. PR #535 repairs those omissions
and remains **OPEN FOR APPROVAL** because it changes production schema. Stripe
provider verification remains **BLOCKED** by missing verified JOYSTICK test-mode
configuration. Overall launch remains **IN PROGRESS**, with **NO-GO** for inviting
the first ten trial customers until both gates are resolved. Earlier mocked UI
coverage remains useful and separately classified; CERT-1 through CERT-6 remain
static source contracts.
