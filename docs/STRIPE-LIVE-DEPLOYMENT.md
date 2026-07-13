# Stripe Live Mode — Deployment Notes (bldg-admin-api)

## 1) Env vars (names only — set in Railway; never commit values)

| Variable                            | Required         | Used by                                                                                        |
| ----------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`                 | Yes (prod)       | Server: create customers, setup intents, payment intents                                       |
| `STRIPE_SECRET_KEY_OVERRIDE`        | No               | Override for alternate Stripe account (optional)                                               |
| `VITE_STRIPE_PUBLISHABLE_KEY`       | Yes (build-time) | Client: Stripe.js in SchedulePickupModal (set in build env so it’s baked into frontend bundle) |
| `APP_SHARED_API_SECRET`             | Yes              | Auth + receipt webhook auth to app.bldg.chat                                                   |
| `JWT_SHARED_SECRET` or `JWT_SECRET` | Yes              | Receipt JWT signing                                                                            |
| `DATABASE_URL`                      | Yes              | DB connection                                                                                  |

**Note:** This API has distinct Stripe domains. Resident laundry payments use `STRIPE_SECRET_KEY`; marketplace event intake uses its own namespaced configuration; DayForge SaaS subscriptions use `DAYFORGE_BILLING_STRIPE_SECRET_KEY` and `DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET`. Never reuse subscription customers, events, or entitlements as laundry-payment truth.

## 2) Which services need which vars

- **bldg-admin-api (Railway):** `STRIPE_SECRET_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY` (via build env), `APP_SHARED_API_SECRET`, `JWT_SHARED_SECRET`/`JWT_SECRET`, `DATABASE_URL`, plus the namespaced DayForge Billing variables when SaaS onboarding is enabled.
- **app.bldg.chat / laundrybutler.bldg.chat:** Configure in those repos (publishable key for any Stripe.js; webhook secret only if they receive Stripe events).

## 3) Routes / webhook paths

- **Outgoing:** bldg-admin-api POSTs to `https://app.bldg.chat/api/webhooks/receipt` after charging a card (with `Authorization: APP_SHARED_API_SECRET`).
- **Incoming server-to-server:** `POST /api/resident/payment-method-lookup` lets the resident backend look up an existing saved Stripe card by phone with `x-app-shared-secret`. It uses the same `STRIPE_SECRET_KEY` / `STRIPE_SECRET_KEY_OVERRIDE` path as admin charging and returns only Stripe IDs plus safe card display metadata.
- **Incoming marketplace webhook:** `POST /api/marketplace-payments/stripe-webhook` uses the marketplace-specific secret and ledger.
- **Incoming DayForge Billing webhook:** `POST /api/dayforge/billing/stripe-webhook` uses `DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET` and the DayForge subscription ledger.

## 4) Live test checklist

1. **Set live keys in Railway** for bldg-admin-api: `STRIPE_SECRET_KEY` (live), `VITE_STRIPE_PUBLISHABLE_KEY` (live). Redeploy so the client bundle gets the live publishable key.
2. **One payment:** In app.bldg.chat (or laundrybutler flow), place an order, enter a real card, complete setup and (when admin charges) confirm charge succeeds. Check Stripe Dashboard (live) for the payment.
3. **Receipt webhook:** After charge, confirm app.bldg.chat receives the receipt (e.g. check logs or in-app receipt for that user).
4. **DB:** Confirm order row has `stripePaymentIntentId` and intake `paid: true` / `status: processing`.
