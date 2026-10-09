<!-- LEGACY DAYFORGE COMPATIBILITY: retained historical route/database/environment identifiers only; canonical product is JOYSTICK. -->
# JOYSTICK real customer acceptance evidence

Program date: October 9, 2026. Launch remains **IN PROGRESS**. Recommendation:
**NO-GO for inviting the first ten trial customers** until the approval-held
production schema repair and real Stripe-provider admission are verified.

## Execution identity

- Implementation main merge: `4f68941b1e889073cfd00bd135aa0dd8061a513c`.
- Browser/backend implementation: PR [#534](https://github.com/adamwright83-blip/bldg-admin-api/pull/534), tested source SHA `0b1556b5937fc76b41613b3a3faae239a512a2d1`.
- Tracker correction: merged PR [#533](https://github.com/adamwright83-blip/bldg-admin-api/pull/533), main merge `37dacd3549053ddfbe1c03593b1ea52fc5f0863b`.
- Production schema repair: approval-held, OPEN PR [#535](https://github.com/adamwright83-blip/bldg-admin-api/pull/535), candidate `00b477e29308ac51bb60603fbd0a6b427ebe8a1a`.
- Local: Node 22.22.0, MySQL 8 Docker, Chromium, actual built Vite frontend and bundled Express/tRPC backend on `http://127.0.0.1:4186`.
- Local command: `JOYSTICK_ACCEPTANCE_DATABASE_URL=mysql://root:root@127.0.0.1:3418/joystick_real_acceptance pnpm test:launch:real` — **3 passed**, including independent login and actual two-tenant negative controls.
- Hosted: Ubuntu, Node 22, disposable MySQL 8 service on port 3416, Chromium; command `JOYSTICK_ACCEPTANCE_DATABASE_URL=mysql://root:root@127.0.0.1:3416/joystick_real_acceptance pnpm test:launch:real`.
- Hosted result: **PASSED — 3 real browser tests; full launch exam successful**. [Exact run](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37971466617). Download artifact `joystick-real-acceptance` for JSON procedure/database evidence and browser screenshots.

The environment runs repository migrations followed by guarded existing historical
DDL in `scripts/acceptance-schema-compat.mjs`. That additional schema is restricted
to the disposable localhost database. **These passes establish behavior with the
required schema; they do not establish that current production bootstrap supplies
it.** PR #535 repairs that gap and remains open for approval. Its candidate booted
fresh and booted a second time successfully on an independent disposable MySQL
schema; direct reads of all added table columns passed.

The runner strips application credentials, disables `.env` loading for both
backend and frontend build, starts no production workers, requires an explicit
disposable database, and deletes it in `finally`. Auth uses existing bcrypt
credentials, memberships, signed cookies and actual owner login; there is no
production authentication bypass. Test business/world setup is deterministic
persisted fixture data; neither mission mutations nor browser business procedures
use mocked responses. Existing `e2e/launch` mocks remain separate.

## Acceptance results

| Acceptance | Test / command | Backend procedures | Persisted / browser evidence | Result |
|---|---|---|---|---|
| 1 — Landing | Existing `e2e/launch/acceptanceJourneys.spec.ts`, `pnpm test:launch:acceptance` | Static landing/app navigation | Existing desktop/mobile terms, nav and CTA evidence retained from PR #531 (`3fa089df`); no database behavior claimed | REAL BROWSER PASSED |
| 2 — Onboarding | `real onboarding persists answers, resumes the same draft and labels proposed evidence`; full real command above (`e2e/real/onboarding.spec.ts`) | `system.saas.startJoystickDraft`, `saveJoystickDraftAnswer`, `resume`, `generateJoystickDraftPreview` | MySQL `dayforge_saas_onboarding_sessions` saves all three answers and proposed preview. Real server resume returns same answers and ID after refresh and new browser context. Browser preview reflects business, area and avoidance; accurate draft label. One draft, zero new tenants. Wrong/expired bearer rejected. JSON evidence and preview screenshot attached. | REAL BROWSER + BACKEND PASSED (LOCAL + HOSTED) |
| 3 — Stripe | `SAAS_BILLING_LIFECYCLE_EXAM=1 pnpm vitest run --config vitest.integration.config.ts server/saas/saasBilling.lifecycle.integration.test.ts` against migrated `joystick_billing_lifecycle` | `createLegacyDayforgeSubscriptionCheckout`, `processLegacyDayforgeBillingWebhook`, `activateOnboardingOwner` with fake adapter | REAL MYSQL INTEGRATION PASSED in the exact hosted run above (2 tests). Real MySQL lifecycle is distinct from actual provider execution. Missing verified JOYSTICK test key/webhook secret/app origin/test recurring price. See provider audit below. | BLOCKED — Missing provider test credentials |
| 4 — First mission | `REAL acceptance 4/5: field evidence persists, replays once, and survives an independent second login`; full real command above (`e2e/real/mission.spec.ts`) | `system.goldlineOnboarding.state`, `fieldOutcome`, `system.currentDayLine.today` | Real browser submit; MySQL session completed outcome and exactly one `goldline_world_events` ATTESTED/operator_reported `territory_scout_observed` after replay. Checkpoint territory becomes known in persisted-world projection; guardian gameplay remains incomplete. API Day Line receipt and visible saved observation; refresh retains completion; Field Journal provides another useful editable action. | REAL BROWSER + BACKEND PASSED (LOCAL + HOSTED) |
| 5 — Returning customer | Same real 4/5 test and command | `POST /api/dayforge/auth/login`, `auth.me`, `system.goldlineOnboarding.state`, `system.currentDayLine.today`, `system.claire.driveContext` | End first browser context; new context has no cookies and real `auth.me` is null. Real login form/password endpoint issues cookie. Original tenant, business answers/world, persisted outcome and Day Line restored; Claire identity registry reports original tenant/business. Screenshot records returned completed mission. | REAL BROWSER + BACKEND PASSED (LOCAL + HOSTED) |
| 6 — Tenant isolation | `real authenticated two-tenant HTTP isolation and denied-write persistence`; full real command above (`e2e/real/isolation.spec.ts`) | Listed in response matrix below | Two persisted bcrypt owners, distinct commercial missions, order customers, billing plans, primary Day Lines and world fixtures; actual authenticated HTTP controls both ways, browser login screenshots, DB snapshots before/after hostile writes. | REAL BROWSER + BACKEND PASSED (LOCAL + HOSTED) |

## Two-tenant procedure and response matrix

The same controls run A → B and B → A. JSON attachments include actual input,
HTTP status, response body, and successful procedure results. Nonexistent
procedures are explicitly rejected as denial evidence.

| Procedure | Own-data positive control / hostile result |
|---|---|
| `system.goldlineOnboarding.state` | HTTP 200, original tenant/mission/world fixture only |
| `system.goldlineOnboarding.fieldOutcome` with foreign first-mission ID | HTTP 500, exact `Mission not found in this tenant.`; corresponding foreign and own persisted sessions/events unchanged |
| `system.commercialMission.create/list/get` | HTTP 200, own mission present and foreign mission absent |
| `system.commercialMission.get` foreign ID | HTTP 404 NOT_FOUND |
| `system.commercialMission.transition` foreign ID | HTTP 500, exact `Commercial mission not found`; no mission/event changes |
| `system.currentDayLine.today` | HTTP 200, distinguishable own primary commitment; foreign `targetTenantId` HTTP 403 FORBIDDEN |
| `system.currentDayLine.completeItem` foreign tenant | HTTP 403 FORBIDDEN; commitment unchanged |
| `system.customerAssets.list/detail` | HTTP 200, own persisted order customer only; foreign asset HTTP 404 NOT_FOUND |
| `admin.getOrder`, `admin.updateStatus` foreign order | HTTP 401 UNAUTHORIZED for tenant-owner role; order history is available through scoped customerAssets, administration is restricted |
| `system.saas.me/members` | HTTP 200, own billing/account/owner only; injected foreign tenant ID does not override authenticated tenant |
| `system.claire.driveContext` generic and own mission ID | HTTP 200, correct tenant/business registry and own mission; foreign mission ID HTTP 404 NOT_FOUND |
| `system.businessWorld.get` | HTTP 200, own business tenant only, including when supplied an extra foreign tenant ID |

Denied writes left MySQL snapshots unchanged for `commercial_missions`,
`commercial_mission_events`, `orders`, `day_director_commitments`,
`dayforge_saas_subscriptions`, `goldline_onboarding_sessions`, and
`goldline_world_events`. No P0 cross-tenant read/write was observed. Legacy domain
errors for absent tenant mission IDs currently use HTTP 500; their exact missing
record messages plus unchanged snapshots are recorded, not treated as generic
server-failure proof.

## Credential security and evidence distinctions

Acquisition tokens contain 32 cryptographic random bytes (43 base64url
characters), are stored only as SHA256 hashes on the server, and enforce expiry.
The browser carries a legitimately issued credential into a separate context;
the credential is never embedded in the evidence attachment. Tests assert wrong
token rejection and expired valid-token rejection through actual HTTP.

The first mission is an **operator-attested field observation**. Its persisted
claims are `sale:false`, `conversation:false`, `handoff:false`. It is not a paid
order, verified revenue, commercial win or automatic guardian defeat. Day Line
receipts are read-only and do not change ranking or write authority.

CERT-1–CERT-6 remain **SOURCE CONTRACT PASSED** static contracts. Earlier onboarding,
mission and returning-customer UI coverage remains **MOCKED UI PASSED**. Existing
billing adapter execution is **REAL MYSQL INTEGRATION**, never **REAL STRIPE TEST
MODE**. [Stripe audit](STRIPE_PROVIDER_ACCEPTANCE.md) identifies exact missing
configuration; no Laundry Farm account or live payment configuration was used.

## Additional validation

`pnpm check` passed locally and in hosted CI. Twenty focused Day Line/first-action
regressions passed. Hosted tenant-boundary and billing-lifecycle gates passed on
the tested source SHA. Nomenclature check passed. The final launch exam also
passed real MySQL hostile tenant, COGS, export/deletion, two paying-tenant and
acquisition lifecycle integrations; none of those adapter integrations are
classified as real Stripe-provider execution.

## CI limitation preserved

The broader legacy compatibility `release-journey` gate is **FAILED**, not green:
[final-source run](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37971466861).
A comparison against the documentation-only baseline
[run 37970183494](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37970183494)
found **the identical set of 20 failed Claire tests**, with no added failing test.
This pre-existing suite/fixture work has active PR #476 and is preserved rather
than overwritten or used to claim acceptance success. Real customer-facing Claire
context reads are separately verified by the real acceptance suite. No claim is
made that every repository check passed.

## Outstanding launch gates

1. Approve and apply PR #535's production schema repair, then verify that actual
   deployment bootstrap and required reads succeed. Acceptance compatibility
   DDL must not conceal this release gate.
2. Supply verified JOYSTICK-owned Stripe test credentials/configuration and run
   the real provider sequence: seven-day/$49 monthly trial, card collection,
   single subscription and tenant, signed webhook replay, owner activation,
   and no early charge. The existing fake billing fixture uses nine days and
   synthetic prices; it cannot establish these terms.

No customer invitation or launched-product claim is authorized by this report.
