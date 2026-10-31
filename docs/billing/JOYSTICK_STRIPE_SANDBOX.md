<!-- LEGACY DAYFORGE COMPATIBILITY: the billing environment variables (DAYFORGE_*) and the webhook route (/api/dayforge/...) keep their historical names; they are compatibility identifiers only. The product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. -->
# JOYSTICK Stripe sandbox: $79 a month, no trial

Written 2026-10-31. Sandbox (Stripe test mode) only. Nothing here creates a live charge, and the code refuses to.

## The offer

| Plan | Plan key | Price | Trial | When the card is charged |
|---|---|---|---|---|
| Monthly (advertised) | `joystick-growth-standard` | 7900 USD cents ($79), interval month | none | at checkout |
| Annual (optional, unchanged) | `joystick-growth-annual` | 46800 USD cents ($468), interval year | 7 days | after the trial |

The contract lives in `server/saas/joystickStripeOffer.ts`. Checkout opens only when the plan row's trial equals the
advertised trial (monthly 0, annual 7) and the configured Stripe price, retrieved from Stripe, is exactly that amount,
currency and interval. A monthly row with a trial, or a $49 price, keeps checkout closed. With no trial, Checkout is
sent no `trial_period_days` at all.

Annual: it used to share the monthly trial constant. It keeps its seven days and its $468 price. The landing page no
longer restates annual savings figures that were computed from $49.

## Sandbox objects

| Object | Id |
|---|---|
| Price ($79/month) | `price_1UWX4RDygmVPA3tjPx1S5NMD` |
| Product | `prod_VXcJu4mQ9O10Df` |
| Customer portal configuration | `bpc_1UWX6fDygmVPA3tjqzUEn5uD` |
| Webhook endpoint | `we_1UWXCnDygmVPA3tjb1GakMBW`, path `/api/dayforge/billing/stripe-webhook`, API version `2026-09-30` |

The code reads none of these ids from source. They come from the variables below.

## Railway variables (service `bldg-admin-api`)

| Variable | Value | Notes |
|---|---|---|
| `DAYFORGE_BILLING_STRIPE_SECRET_KEY` | the JOYSTICK sandbox secret, `sk_test_…` | `sk_live_`/`rk_live_` and anything not `sk_test_` are refused by `billingSecretGate` (`server/saas/paidCustomerLifecycle.ts`): checkout and the portal stay closed. Never the Laundry Farm account. |
| `DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET` | the `whsec_…` signing secret of `we_1UWXCnDygmVPA3tjb1GakMBW` | |
| `DAYFORGE_STRIPE_PRICE_ID` | `price_1UWX4RDygmVPA3tjPx1S5NMD` | |
| `DAYFORGE_STRIPE_PRODUCT_ID` | `prod_VXcJu4mQ9O10Df` | |
| `DAYFORGE_STRIPE_PLAN_KEY` | `joystick-growth-standard` | Verified: `JOYSTICK_MONTHLY_PLAN_KEY`. Unset, the code uses `dayforge`, which is not the advertised plan. |
| `DAYFORGE_STRIPE_TRIAL_DAYS` | `0` | Any other value for the monthly plan: the plan row is not synced and checkout stays closed (`trial_days`). |
| `DAYFORGE_BILLING_PORTAL_CONFIGURATION_ID` | `bpc_1UWX6fDygmVPA3tjqzUEn5uD` | Passed as `configuration` to the billing portal. Unset, Stripe uses the account's default portal. A value that is not `bpc_…` refuses to open the portal. |
| `DAYFORGE_BILLING_APP_URL` | leave unset | Defaults to `https://admin.bldg.chat`. See below. |

`syncConfiguredSaasPlan` (`server/saas/saasStore.ts`) writes the plan row from these variables the next time plans
are read, so a deploy with the new values is all it takes. An old row (the $49 price, 7 days) is not changed if
`DAYFORGE_STRIPE_TRIAL_DAYS` still says 7; checkout simply stays closed until it says 0.

Public checkout stays closed (`JOYSTICK_PUBLIC_CHECKOUT_LIVE = false`); live-mode webhook events are ignored by the
route (`screenPaidLifecycleWebhook`).

### `DAYFORGE_BILLING_APP_URL`

Not read from Railway in this change (production variable values were not inspected); the workflow that requested
it reported the variable unset. Unset, `appUrl()` in `server/saas/saasBilling.ts` is `https://admin.bldg.chat`, so:

- checkout success/cancel return to `https://admin.bldg.chat/joystick-start?session=…&checkout=success|cancelled`
  (the older laundry onboarding returns to its legacy-named onboarding route);
- the billing portal returns to `https://admin.bldg.chat/dayforge-settings`.

That default is right. `admin.bldg.chat` is the `bldg-admin-api` Railway service
(`docs/launch/JOYSTICK_DOMAIN_MIGRATION_AUDIT.md`, verified 2026-10-25), it serves both routes (`client/src/App.tsx`),
and the homepage sends signups to `admin.bldg.chat/joystick-start` (`FUNNEL_ORIGIN` in
`client/public/joystick-home/app.js`), so a signup returns to the origin it started on. A signup started on another
origin (gojoystick.com) would come back to `admin.bldg.chat`; that per-origin return is
`docs/goldline/JOYSTICK_SIGNUP_ORIGIN_HANDOFF.md`, not this change. Do not set this variable to a loopback or
`*.up.railway.app` origin; the acceptance run below does not need it.

## The webhook against API version 2026-09-30

The endpoint renders event payloads in its own version; objects the handler retrieves come back in the client's
pinned version, `2025-03-31.basil`. Read against the installed SDK types (stripe 20.3.1, `2026-01-28.clover`):

| Field the handler reads | Where it is | State |
|---|---|---|
| `invoice.subscription` (invoice.paid / invoice.payment_failed) | gone since basil; `invoice.parent.subscription_details.subscription` | **Was broken** (invoice events never found their subscription). Fixed in `server/saas/stripeWebhookShapes.ts`; the old field and the line items' `parent.subscription_item_details.subscription` are also read. |
| `subscription.current_period_end` | gone since basil; `subscription.items.data[].current_period_end` | **Was broken** (stored period end was always null). Fixed; the old field is still read. |
| `checkout.session.subscription` | present (string or Subscription) | unchanged |
| `subscription.status`, `metadata`, `customer`, `latest_invoice`, `trial_end`, `cancel_at_period_end` | present | unchanged |
| `subscription.cancel_at` | present | now also read: a scheduled `cancel_at` counts as "set to end" alongside `cancel_at_period_end` |
| `invoice.amount_paid`, `post_payment_credit_notes_amount` | present | unchanged |
| `invoice.amount_refunded` | not on Invoice in these types | reads as 0; no change made (refunds arrive as their own events and are never counted as revenue) |

Unknown, and not guessed: anything Stripe changed between `2026-01-28.clover` (the newest version the installed SDK
describes) and `2026-09-30`. docs.stripe.com was not reachable from the environment that made this change. In
particular, which of `cancel_at_period_end` / `cancel_at` a portal cancellation sets at 2026-09-30 is not verified;
both are handled. The acceptance run below checks the real endpoint's version and the real payloads.

The client stays pinned to `2025-03-31.basil`. Moving the pin changes the shape of every API response the billing
code reads (subscriptions, invoices, Checkout sessions), so it should move only with tests against that version.
Staying on basil also keeps Checkout-created subscriptions in classic billing mode; `2025-09-30.clover` made flexible
billing mode the default for API-created subscriptions. (That default, as it applies to Checkout, is from the
change brief, not verified here.)

## Proof that ran without a Stripe key (stand-in Stripe, local MySQL)

`server/saas/saasBilling.lifecycle.integration.test.ts`, suite "JOYSTICK $79/month, no trial — stand-in Stripe …":
the plan synced from the variables above (trial 0), checkout at 7900/month with a card and no
`trial_period_days`, HMAC-signed 2026-shaped `customer.subscription.created`, `invoice.paid` and
`checkout.session.completed` → one tenant, active, paid, period end from the item → duplicate and live-mode events
change nothing → owner password → login → returning login → portal with `bpc_1UWX6fDygmVPA3tjqzUEn5uD` →
`customer.subscription.updated` (cancel at period end) keeps access → `customer.subscription.deleted` ends it → login
refused. Stripe's answers are stood in; nothing reaches Stripe.

```sh
docker exec ftm-mysql mysql -uroot -proot -e "CREATE DATABASE IF NOT EXISTS joystick_billing_lifecycle_79"
DATABASE_URL=mysql://root:root@127.0.0.1:3411/joystick_billing_lifecycle_79 node scripts/migrate.mjs
SAAS_BILLING_LIFECYCLE_EXAM=1 NODE_ENV=test DATABASE_URL=mysql://root:root@127.0.0.1:3411/joystick_billing_lifecycle_79 \
  npx vitest run --config vitest.integration.config.ts server/saas/saasBilling.lifecycle.integration.test.ts
```

Unit coverage of the 2026 payload shapes: `server/saas/stripeWebhookShapes.test.ts`.

## The real sandbox run (Adam, inside Railway)

`scripts/run-stripe-provider-acceptance.ts --target=railway-sandbox` runs inside the deployed container, so it uses
the deployed app's own variables, database and webhook endpoint. It refuses anything but an `sk_test_` key before
any Stripe call, and fails if any Stripe object it reads is not test mode.

1. Set the Railway variables above and let the service redeploy.
2. Run (the CLI asks to register an SSH key the first time; `railway run` will not work, it runs on your computer):

   ```sh
   railway ssh --service bldg-admin-api -- sh -c 'cd /app && JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID=acct_XXXXXXXX JOYSTICK_STRIPE_WEBHOOK_ENDPOINT_ID=we_1UWXCnDygmVPA3tjb1GakMBW JOYSTICK_STRIPE_CHECKOUT_WAIT_MS=600000 npx tsx scripts/run-stripe-provider-acceptance.ts --target=railway-sandbox'
   ```

   `acct_XXXXXXXX` is the JOYSTICK sandbox account id (Stripe dashboard → Settings → Account). `PORT` is set by
   Railway; the run signs in at `http://127.0.0.1:$PORT`.
3. It prints a Stripe **test-mode** Checkout URL. Open it within 10 minutes and pay with `4242 4242 4242 4242`, any
   future date, any CVC. The success page then lands on `admin.bldg.chat/joystick-start`, which will not know this
   signup (the run keeps its resume token in memory); that is expected.
4. It reports JSON: `PASSED`, `BLOCKED` (a variable is missing, or Checkout was not completed in time) or `FAILED`
   with `failureStep`.

What `PASSED` means, in order: the allowlisted sandbox account; the endpoint is enabled, test mode, on
`2026-09-30`, delivering every handled event to `/api/dayforge/billing/stripe-webhook`; the plan row is
`joystick-growth-standard`, trial 0, on the configured price, which Stripe says is 7900 USD a month on the configured
product; Checkout completed with a card, the subscription is `active` with no trial on that one price, and the first
invoice is `paid`, 7900 USD, `subscription_create`, naming its subscription under `parent.subscription_details`; the
deployed app processed the genuine `checkout.session.completed` and `invoice.paid` deliveries into one active, paid
tenant with a period end; a locally signed replay of the same event id is ignored; the owner's password works for a
login and a returning login; the portal opens for that tenant's customer with `bpc_1UWX6fDygmVPA3tjqzUEn5uD`;
`cancel_at_period_end` is processed and the owner can still sign in; the subscription is then canceled (in test mode,
standing in for the period end), `customer.subscription.deleted` is processed and login is refused.

It leaves one canceled sandbox tenant (business "Stripe Acceptance …", email `stripe-acceptance-…@example.com`) in
the deployed database and a canceled test customer in the Stripe sandbox. `server/saas/tenantLifecycle.ts`
(`planTenantDeletion` / `deleteTenantData`) removes the tenant if wanted.

Local alternative (loopback app, local `joystick_stripe_acceptance` database, `stripe listen --forward-to
localhost:<port>/api/dayforge/billing/stripe-webhook`): `docs/launch/STRIPE_PROVIDER_ACCEPTANCE.md`.
