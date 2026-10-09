<!-- LEGACY DAYFORGE COMPATIBILITY: retained historical database, route and environment literals only; canonical product is JOYSTICK. -->
# JOYSTICK Stripe provider acceptance

Acceptance 3: **BLOCKED — Missing provider test credentials**. Audited October 9, 2026. No Stripe API request, real charge, account modification, or Laundry Farm account access was performed.

## Configuration audit

The audit inspected variable names and presence only; it did not print secret values.

| Location | Result |
| --- | --- |
| Workspace `.env` and `.env.local` | No Stripe or billing variables configured |
| Agent process environment | No Stripe or billing variables configured |
| Repository Actions secrets (`gh secret list --repo adamwright83-blip/bldg-admin-api`) | No secrets listed |
| Environment secret names (`gh api repos/adamwright83-blip/bldg-admin-api/environments/{environment}/secrets`) | No secrets listed for Preview, Production, or supportive-creation / production |
| `.github/workflows/saas-launch-exam.yml` | Explicit placeholder test key and webhook secret; these are not valid provider credentials |

This establishes absence from the inspected acceptance configuration. It does not assert that no credentials exist in unrelated external services. Unrelated payment credentials must not be reused.

## Railway scope check

Read-only Railway project/service discovery found two accessible projects. `dev-new` has only a production environment and no services. The locally linked `supportive-creation` project has only a production environment, containing `bldg-admin-api` from this repository, infrastructure, temporary examination/report services, and the JOYSTICK retention cron. None is an established isolated JOYSTICK SaaS billing test application/environment.

Production and unrelated temporary-service variable values were deliberately not inspected or reused. Their Stripe configuration and account ownership remain **UNINSPECTED**, not proven absent. A production service or `mysql-codex-test` database name does not establish a safe JOYSTICK Stripe test account. No eligible external test configuration was discovered, so the exact blocker remains valid JOYSTICK-owned test credentials and test-price/webhook setup in the acceptance environment. This finding must not be generalized to “all external credentials are absent.” No Railway configuration was changed or service restarted.

## Exact requirements to unblock

1. `DAYFORGE_BILLING_STRIPE_SECRET_KEY`: a valid Stripe **test-mode** secret key (must start with `sk_test_`) for a verified JOYSTICK-owned account, with account identity established before any provider operation. Never use Laundry Farm's account.
2. `DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET`: the signing secret (must start with `whsec_`) for the JOYSTICK test endpoint forwarding to `/api/dayforge/billing/stripe-webhook` in the disposable acceptance environment.
3. `DAYFORGE_BILLING_APP_URL`: the acceptance application's reachable origin, so hosted Checkout returns to that application rather than the default production URL.
4. `JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID`: the explicitly allowlisted Stripe account ID for the dedicated JOYSTICK test account. Rejects if retrieved account does not match or if Laundry Farm is detected.
5. An active disposable `dayforge_saas_billing_plans` row whose `stripePriceId` references a verified test-mode recurring Stripe price: USD 4,900 cents per month, with `trialDays = 7`. The application reads the price from this database row; it has no separate launch-price environment variable.
6. Execution against a designated disposable test database (name must contain `billing_lifecycle`, `joystick_real_acceptance`, or `stripe_acceptance`).
7. Complete end-to-end verification of all 11 mandatory provider and persistence conditions before any `PASSED` status is issued.

## Executable database integration retained

The existing hosted workflow provisions MySQL 8, creates `joystick_billing_lifecycle`, runs repository migrations, and executes:

```sh
SAAS_BILLING_LIFECYCLE_EXAM=1 DATABASE_URL=mysql://root:root@127.0.0.1:3416/joystick_billing_lifecycle node scripts/migrate.mjs
SAAS_BILLING_LIFECYCLE_EXAM=1 DATABASE_URL=mysql://root:root@127.0.0.1:3416/joystick_billing_lifecycle pnpm vitest run --config vitest.integration.config.ts server/saas/saasBilling.lifecycle.integration.test.ts
```

The suite refuses a database whose name does not contain `billing_lifecycle`. It asserts persisted tenant uniqueness, entitlements, activation, cancellation, and duplicate-event handling through `createLegacyDayforgeSubscriptionCheckout`, `processLegacyDayforgeBillingWebhook`, and `activateOnboardingOwner` with direct MySQL assertions.

The injected `fakeStripe` adapter fabricates Checkout, subscription retrieval, and signature verification. Its configurable fixture deliberately uses a nine-day trial and synthetic prices. Consequently, even a passing run is **REAL MYSQL INTEGRATION PASSED**, not proof of a seven-day/$49 provider plan, actual card-on-file behavior, real webhook signatures, or absence of early Stripe charges.

Hosted execution: [launch run 37971466617](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/37971466617), PR #534, exact source SHA `0b1556b5937fc76b41613b3a3faae239a512a2d1`. Billing lifecycle: **REAL MYSQL INTEGRATION PASSED**, 2 tests. Provider acceptance remains **BLOCKED** regardless of the database integration result.

## Test-mode harness and result semantics

An automated test-mode acceptance harness is implemented at `server/saas/stripeProviderAcceptance.ts` and tested via `server/saas/stripeProviderAcceptance.test.ts`.

### Result Semantics
- **BLOCKED:** Required external credentials, allowlisted account ID, or approved configuration are missing.
- **FAILED:** A configured acceptance run executes against disposable DB/provider, but an assertion (allowlist match, account safety, price/currency, trial days, payment method presence, webhook processing, idempotency replay, tenant provisioning, owner activation, early charge absence) fails.
- **PASSED:** All 11 mandatory end-to-end provider and persistence assertions complete successfully. The harness NEVER returns PASSED on preliminary checks.

### Mandatory Verification Steps for PASSED
1. An explicitly approved JOYSTICK Stripe account ID matching `JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID`.
2. A $49/month USD recurring price in Stripe.
3. A 7-day trial period.
4. Test-mode Checkout completion.
5. Payment-method collection attached to subscription.
6. Exactly one intended Stripe subscription.
7. Correct signed webhook processing (`checkout.session.completed`).
8. Replay of the same signed event without duplicate tenant, subscription, or financial effect (`ignored` with `duplicate_event`).
9. Exactly one correctly provisioned tenant in database.
10. Successful owner activation.
11. No unintended early charge (amount_paid = 0 during trial).
