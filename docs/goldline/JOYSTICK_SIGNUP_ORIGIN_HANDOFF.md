<!-- LEGACY DAYFORGE COMPATIBILITY: the billing environment variable names below are retained historical identifiers only; the customer-facing product is JOYSTICK. -->
# JOYSTICK signup on gojoystick.com — billing handoff

**Status:** approved by Adam on 2026-10-25. Written by Claude (first-ten-minutes owner) for Cursor (paid-customer
lifecycle and Stripe owner).
**Goal:** new JOYSTICK customers start signup, pay, and return from Stripe on `gojoystick.com`, and never see
`admin.bldg.chat`. Existing checkout flows, billing portals, webhooks and integrations keep working.

## Ownership

| Area | Owner |
|---|---|
| Billing code: `server/saas/saasBilling.ts`, Stripe objects, plan rows, webhook, Railway billing variables | **Cursor** |
| Homepage `client/public/joystick-home/`, `vercel.json` front-door rewrites, `JoystickAcquisitionPage.tsx`, the first-ten-minutes experience (`docs/goldline/FIRST_TEN_MINUTES.md`) | **Claude** |
| Production Stripe configuration and any Railway variable change | **Adam** decides; nothing changes before the full path is verified |

Not in scope: Claire's Twilio callbacks, Stripe webhook URLs, the resident app, legacy BLDG domains.

---

## 1. Facts (VERIFIED 2026-10-25, against `main` and production)

**Return URLs.** `server/saas/saasBilling.ts` builds every billing return from one helper, `appUrl()`, which reads
`DAYFORGE_BILLING_APP_URL` and defaults to `https://admin.bldg.chat`. Three call sites:

| Line on main | Flow | Path |
|---|---|---|
| 113 | Subscription checkout success, both JOYSTICK (`onboardingMode === "joystick_generic"`) and the older onboarding | `/joystick-start` or `/dayforge-onboarding` |
| 114 | Same, cancel | same |
| 163 | Billing portal return | `/dayforge-settings` |

Changing the variable would move all three. That is why the change must be per flow.

**Pinned by tests.** `shared/joystickHostRouting.test.ts` test "leaves Stripe return URLs unchanged…" asserts the
three template strings, the `admin.bldg.chat` default, and that `saasBilling.ts` does not contain `gojoystick.com`.
`docs/launch/JOYSTICK_DOMAIN_MIGRATION_AUDIT.md` item 4 records the rule. Both must be updated in the same PR.

**Production billing is not configured.** On the production `bldg-admin-api` service the billing variables
`DAYFORGE_BILLING_STRIPE_SECRET_KEY`, `DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET` and `DAYFORGE_BILLING_APP_URL` are all
absent. The public `system.saas.plans` query returns `[]`. The signup page therefore shows a disabled
"BILLING CONNECTION PENDING" button: no one can buy JOYSTICK in production today. Activation is gated by
`docs/JOYSTICK-SAAS-LAUNCH-OPS.md` (backups, restore drill, live keys, canary).

**Railway has one environment:** `production`. There is no staging.

**The other Stripe key** in production, `STRIPE_SECRET_KEY`, serves resident and marketplace payments
(`server/marketplacePayments/`, resident payment methods). It does not read `appUrl()` and is not affected.

**Why the origin matters.** `JoystickAcquisitionPage.tsx` keeps the draft's resume token in `localStorage` /
`sessionStorage` for the origin the visitor started on. Stripe's success URL carries only `?session=` and
`?checkout=`, deliberately never the token. If Stripe returns the buyer to a different origin than the one the draft
started on, the page cannot resume and starts a new draft: **the paid buyer is stranded.** The return origin must
equal the start origin.

**Front door state after Claude's PR #716:** the homepage offers "Bring your own business" into
`FUNNEL_ORIGIN + /joystick-start?world=…`, with `FUNNEL_ORIGIN = 'https://admin.bldg.chat'` in
`client/public/joystick-home/app.js`. `vercel.json` rewrites `/joystick-start` so `gojoystick.com/joystick-start`
serves the funnel. The draft configuration stores `selectedExperience`.

---

## 2. The billing change (Cursor)

**Recommended design: record the start origin on the draft, return to it.**

1. In `startJoystickDraft`, read the request's `Origin` header and store it on the onboarding session only when it is
   in an explicit allowlist: `https://gojoystick.com` and `https://admin.bldg.chat` (extend deliberately). Anything
   else, or no header, stores nothing.
2. In `createLegacyDayforgeSubscriptionCheckout`, for `joystick_generic` sessions only, build success and cancel URLs
   from the stored origin, falling back to `appUrl()`. The older onboarding flow keeps `appUrl()`.
3. Leave the billing portal (`return_url`, line 163) on `appUrl()` in this change. Existing customers' portal returns
   are untouched. Moving it is a separate decision once a JOYSTICK settings page is served on the apex.
4. Leave `DAYFORGE_BILLING_APP_URL` unset or unchanged. No global flip.

Why this design: there is no cutover window. A draft started on `admin.bldg.chat` before the release still returns
there; a draft started on `gojoystick.com` returns there. No buyer can be stranded by the order of deploys.

Storage: the session row already has `configurationJson`, but it is written at the identity step, after the start.
Prefer a nullable column (for example `returnOrigin varchar(64)`) via the repo's migration path; confirm
`scripts/migrate.mjs` actually applies it in production (it has skipped `drizzle/*.sql` before).

Tests to change in the same PR:

- `shared/joystickHostRouting.test.ts`: replace the "unchanged" assertions with the per-flow contract (JOYSTICK uses
  the allowlisted start origin; older onboarding and the portal use `appUrl()`; the allowlist rejects any other
  origin).
- `server/saas/joystickAcquisition.lifecycle.integration.test.ts`: assert `success_url` starts with the start origin
  for a draft started with `Origin: https://gojoystick.com`, and with `appUrl()` when no origin was recorded.
- `docs/launch/JOYSTICK_DOMAIN_MIGRATION_AUDIT.md` item 4: record the per-flow rule.

## 3. Claude's matching change (after Cursor's merges)

`FUNNEL_ORIGIN` in `client/public/joystick-home/app.js` becomes `''` so the homepage enters the funnel on
`gojoystick.com`. Its test in `shared/joystickSelectedExperience.test.ts` changes with it. This ships only after
section 4 passes.

## 4. Full-path verification (before any production Stripe change)

Production has no billing keys and there is no staging environment, so the full path runs locally in Stripe test
mode, using the harness that already exists (`scripts/run-stripe-provider-acceptance.ts`,
`server/saas/stripeProviderAcceptance.ts`).

**What Adam needs to do (one sitting, about 15 minutes):**

1. In the Stripe dashboard, switch to **Test mode**. Copy the test secret key (`sk_test_…`) and the test account id
   (`acct_…`, Settings → Account details).
2. Install and log in to the Stripe CLI (it opens a browser for Adam to approve):
   ```bash
   brew install stripe/stripe-cli/stripe
   ```
   ```bash
   stripe login
   ```
3. Give the test key and account id to the session running the test (Cursor or Claude) in chat, or put them in a
   local untracked `.env.stripe-test`. Never a live key.

**What the session then does:**

1. Start a disposable MySQL with Docker (the harness refuses non-disposable databases) and run migrations into it.
2. Create the test-mode Product and Price for the advertised offer ($49/month, 7-day trial, card required) and the
   plan row pointing at it; the offer guard in `server/saas/joystickStripeOffer.ts` will refuse anything else.
3. Run the app locally, and forward webhooks:
   ```bash
   stripe listen --forward-to localhost:3000/api/dayforge/billing/stripe-webhook
   ```
   Use the printed `whsec_…` as `DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET` for the local server only.
4. Run the harness (`scripts/run-stripe-provider-acceptance.ts`), which must report `PASSED`.
5. Walk the browser path with the homepage's `FUNNEL_ORIGIN` pointed at the local server: homepage → sample →
   "Bring your own business" → questions → preview → identity → Stripe test checkout with card `4242 4242 4242 4242`
   → return on the **same origin** → workspace provisioned → password → login → `/onboarding`. Confirm the
   session's `configurationJson.selectedExperience` matches the world chosen on the homepage, and that exactly one
   tenant, membership and subscription exist after webhook retries.
6. Record the result in the PR.

Only after that: Adam decides when to configure production billing per `docs/JOYSTICK-SAAS-LAUNCH-OPS.md` (live key,
live webhook, live price, live canary). Nothing in this handoff changes production Stripe.
