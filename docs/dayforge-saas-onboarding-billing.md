# DayForge SaaS onboarding and billing

## Production contract

Migration `0042_dayforge_saas_onboarding_billing.sql` creates the standalone DayForge tenant, membership, multi-location operating configuration, plan, subscription, entitlement, import, billing-event, and audit spine. It also makes CleanCloud paid-order deduplication tenant-scoped.

The canonical access decision is server-side:

1. Authentication loads the persisted user.
2. The persisted user tenant overrides the request hostname.
3. A DayForge procedure requires an active membership with an allowed tenant role.
4. Product routes require the matching entitlement.
5. Subscription truth must be active, trialing, or inside an explicitly bounded past-due grace period.
6. Manual entitlement rows override plan rows and are never deleted by plan synchronization.

`default` and `laundry_farm` are temporarily grandfathered through `DAYFORGE_LEGACY_TENANT_IDS` so existing first-party operation continues during the SaaS migration. New tenants fail closed when the database, membership, subscription, or entitlement is unavailable.

## Public and authenticated routes

- `/dayforge-onboarding`: resumable, server-backed business/store/service/capacity/route setup and Stripe handoff.
- `/dayforge-login`: tenant slug, email, and password authentication with account lockout.
- `/dayforge-invite`: exact-once owner-generated team invitation acceptance.
- `/dayforge-settings`: billing portal, membership visibility, role invitations, and CleanCloud import.
- `POST /api/dayforge/billing/stripe-webhook`: raw-body Stripe Billing webhook.
- `POST /api/dayforge/auth/login`: tenant login; production requests require an allowed Origin.

The onboarding resume token and invite token are stored only as SHA-256 hashes. The browser retains the onboarding credential in session storage; it is a credential for loading server state, never the authoritative onboarding state. Invite tokens travel in the URL fragment so they are not sent in HTTP request URLs.

## Stripe isolation

DayForge subscription billing is intentionally separate from resident laundry charges, saved payment methods, vendor Connect, and marketplace payment ledgers.

Required production variables:

- `DAYFORGE_BILLING_STRIPE_SECRET_KEY`
- `DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET`
- `DAYFORGE_BILLING_APP_URL`
- `DAYFORGE_STRIPE_PRICE_ID`

Plan variables:

- `DAYFORGE_STRIPE_PLAN_KEY`
- `DAYFORGE_STRIPE_PLAN_NAME`
- `DAYFORGE_STRIPE_PRODUCT_ID`
- `DAYFORGE_STRIPE_TRIAL_DAYS`
- `DAYFORGE_STRIPE_FOUNDING_PLAN`
- `DAYFORGE_STRIPE_FOUNDING_AVAILABILITY`
- `DAYFORGE_STRIPE_MAX_SUBSCRIPTIONS`
- `DAYFORGE_STRIPE_ENTITLEMENTS`
- `DAYFORGE_BILLING_GRACE_DAYS`

The client submits a plan key. It never submits a Stripe price or customer ID. Checkout resolves the active price on the server; the Billing Portal resolves the customer from the authenticated tenant. A dedicated checkout ledger claims limited/founding-plan capacity transactionally, releases the claim on `checkout.session.expired`, and preserves Stripe idempotency across retries.

Webhook processing verifies the Stripe signature, reserves the event ID, retrieves current subscription truth for non-deletion events, rejects stale state by Stripe event creation time in SQL, and permits a failed ledger event to retry. Handled types are:

- `checkout.session.completed`
- `checkout.session.expired`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

## Provisioning behavior

Tenant provisioning occurs only from signed subscription events. It is deterministic by onboarding session and projects the canonical onboarding configuration into:

- DayForge tenant, locations, services, weekday capacity, route windows, and membership state.
- Territory Intelligence operator profile.
- Commercial proposal profile when all required real operator fields exist.
- Plan entitlements.
- Normalized customer/order import storage.

Owner activation is transactionally claimed exactly once and requires current subscription access. Admin, operator, and field members are added with one-time invitation tokens. Field members map to the existing technical driver role while tenant authorization remains membership-based.

## Deployment order

1. Apply migration `0042_dayforge_saas_onboarding_billing.sql`.
2. Set the namespaced Stripe and plan variables.
3. Configure Stripe to send the listed events to `/api/dayforge/billing/stripe-webhook`.
4. Deploy the server and client together.
5. Confirm `/dayforge-onboarding` lists the environment-backed plan.
6. Complete a Stripe test-mode checkout and verify one tenant, one subscription, plan entitlements, and owner activation.
7. Verify cancellation and payment failure remove or grace product access while `/dayforge-settings` and Billing Portal remain available.

Do not remove the legacy tenant allowlist until existing first-party users have explicit memberships and subscription/access policy rows.
