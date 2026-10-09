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

## Exact requirements to unblock

1. `DAYFORGE_BILLING_STRIPE_SECRET_KEY`: a valid Stripe **test-mode** secret key for a verified JOYSTICK-owned account, with account identity established before any provider operation. Never use Laundry Farm's account.
2. `DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET`: the signing secret for the JOYSTICK test endpoint forwarding to `/api/dayforge/billing/stripe-webhook` in the disposable acceptance environment.
3. `DAYFORGE_BILLING_APP_URL`: the acceptance application's reachable origin, so hosted Checkout returns to that application rather than the default production URL.
4. An active disposable `dayforge_saas_billing_plans` row whose `stripePriceId` references a verified test-mode recurring Stripe price: USD 4,900 cents per month, with `trialDays = 7`. The application reads the price from this database row; it has no separate launch-price environment variable.
5. Test-only Checkout completion and signed webhook delivery/replay against the disposable database. Evidence must establish card collection, one subscription, one tenant, owner activation, seven-day trial, and no early paid charge. No live configuration or payment authority change is authorized by this acceptance run.

## Executable database integration retained

The existing hosted workflow provisions MySQL 8, creates `joystick_billing_lifecycle`, runs repository migrations, and executes:

```sh
SAAS_BILLING_LIFECYCLE_EXAM=1 DATABASE_URL=mysql://root:root@127.0.0.1:3416/joystick_billing_lifecycle node scripts/migrate.mjs
SAAS_BILLING_LIFECYCLE_EXAM=1 DATABASE_URL=mysql://root:root@127.0.0.1:3416/joystick_billing_lifecycle pnpm vitest run --config vitest.integration.config.ts server/saas/saasBilling.lifecycle.integration.test.ts
```

The suite refuses a database whose name does not contain `billing_lifecycle`. It asserts persisted tenant uniqueness, entitlements, activation, cancellation, and duplicate-event handling through `createLegacyDayforgeSubscriptionCheckout`, `processLegacyDayforgeBillingWebhook`, and `activateOnboardingOwner` with direct MySQL assertions.

The injected `fakeStripe` adapter fabricates Checkout, subscription retrieval, and signature verification. Its configurable fixture deliberately uses a nine-day trial and synthetic prices. Consequently, even a passing run is **REAL MYSQL INTEGRATION PASSED**, not proof of a seven-day/$49 provider plan, actual card-on-file behavior, real webhook signatures, or absence of early Stripe charges.

The program's final evidence record must attach the actual hosted run URL, PR, and exact tested SHA. Until that run is observed, this document records available executable coverage and does not claim it passed. Provider acceptance remains BLOCKED regardless of the database integration result.
