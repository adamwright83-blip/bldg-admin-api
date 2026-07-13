# DayForge boss demo runbook

This is a presentation runbook, not a feature spec. It assumes the DayForge
product itself — mission persistence, territory scoring, BORESLAY, Field,
proposals, Churn Radar, pipeline/revenue, tenant onboarding + Stripe billing,
and security — is already built (PRs #11-#19; see
`docs/dayforge-feature-inventory.md`, `docs/dayforge-production-rollout.md`,
`docs/dayforge-release-gates.md`, `docs/dayforge-saas-onboarding-billing.md`).

## Presenter-facing URL

**The intended URL is `https://admin.bldg.chat/julydemo`.** As of this
writing that is not yet live — `admin.bldg.chat` currently serves a
static-only Vercel deployment with no backend attached to it at all (see
`docs/dayforge-production-deployment.md` for the full investigation and the
exact remaining steps: merging the DayForge stack to `main`, running
migrations against production, and wiring `admin.bldg.chat` to a backend).

The full, real, working application from this same repository **is already
live today at `https://api.bldg.chat`**, deployed via Railway from `main`.
Once the DayForge stack merges and the demo tenant is enabled there (see the
deployment doc), the boss-facing URL is `https://api.bldg.chat/julydemo` —
functionally identical to `/julydemo` anywhere else, just a different
hostname than the one originally requested. That decision (present at
`api.bldg.chat`, or invest in wiring `admin.bldg.chat` to a backend first)
is a deployment call for whoever has production access, not something this
document assumes for you.

**Everything below this point is the engineering/local-development
appendix** — it stands the app up on your own machine for testing,
debugging, and driving the browser-automation checks. It is not what you
should show your boss; use the deployed URL above for that.

## Before the meeting (local engineering setup)

### 1. Checkout

```bash
git fetch origin
git checkout claude/dayforge-boss-demo-completion
```

### 2. Install

```bash
pnpm install --frozen-lockfile
```

### 3. Environment variables

Copy `.env.example` (if present) or create `.env` at the repo root. The
variables below are the real names the code reads — confirmed against
`server/_core/env.ts`, `server/territory/googlePlacesTerritoryProvider.ts`,
`server/dayforgeDemo/providerStatus.ts`, `server/_core/sms.ts`, and
`server/procurement/agentMailVendorEmailProvider.ts`.

**Demo mode (required to reach the demo control page):**

- `DAYFORGE_DEMO_ENABLED=true` — server-side demo gate (`server/_core/env.ts`).
- `DAYFORGE_DEMO_TENANT_SLUG` — optional; defaults to `sunset-laundry-demo`.
- `VITE_DAYFORGE_DEMO_MODE=true` — client-side gate for `/dayforge-demo`
  (`client/src/pages/DayforgeDemoControlPage.tsx`). Without this the control
  page shows "Demo mode is off" and nothing else.

**Core app:**

- `DATABASE_URL` — MySQL connection string.
- `JWT_SECRET` — signs driver/field handoff tokens; required before enabling
  field routes.
- `PORT` — optional, defaults to `3000` (`server/_core/index.ts`).

**Territory intelligence (map/scan provider):**

- `GOOGLE_MAPS_API_KEY` (or `GOOGLE_PLACES_API_KEY`) — server-only. Leave
  unset and the territory provider reports `NOT_CONFIGURED`; the demo will
  fall back to whatever deterministic/demo provider is wired for
  `DAYFORGE_DEMO_ENABLED`, not live Google data.

**Stripe billing:**

- `DAYFORGE_BILLING_STRIPE_SECRET_KEY`
- `DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET`
- `DAYFORGE_BILLING_APP_URL`
- `DAYFORGE_STRIPE_PRICE_ID`
- Optional plan variables: `DAYFORGE_STRIPE_PLAN_KEY`,
  `DAYFORGE_STRIPE_PLAN_NAME`, `DAYFORGE_STRIPE_PRODUCT_ID`,
  `DAYFORGE_STRIPE_TRIAL_DAYS`, `DAYFORGE_STRIPE_FOUNDING_PLAN`,
  `DAYFORGE_STRIPE_FOUNDING_AVAILABILITY`, `DAYFORGE_STRIPE_MAX_SUBSCRIPTIONS`,
  `DAYFORGE_STRIPE_ENTITLEMENTS`, `DAYFORGE_BILLING_GRACE_DAYS`.
- `server/dayforgeDemo/providerStatus.ts` reports the Stripe demo chip by
  checking `DAYFORGE_BILLING_STRIPE_SECRET_KEY` directly (the same variable
  `server/saas/saasBilling.ts` uses for real DayForge billing calls): unset
  or shorter than 20 characters → `NOT_CONFIGURED`, an `sk_live_...` key →
  `LIVE`, anything else (e.g. `sk_test_...`) → `TEST`.

**SMS (Twilio, used for Churn Radar's manual SMS composer):**

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- All three unset → `NOT_CONFIGURED`. There is no `TEST` state for SMS in
  this codebase.

**Email (AgentMail, used for vendor/procurement flows, not core DayForge):**

- `AGENTMAIL_API_KEY`
- `AGENTMAIL_VENDOR_INBOX_ID`
- `AGENTMAIL_VENDOR_INBOX_EMAIL`
- All three unset → `NOT_CONFIGURED`.

**Print:** no environment variable exists. Print is always the browser
Print/Save-as-PDF fallback (`printProviderStatus()` always returns
`BROWSER_PDF_FALLBACK`) — there is no physical print/label provider wired up.

### 4. Database setup

Point `DATABASE_URL` at a disposable MySQL 8 database. Do not run this
against a shared or production database.

```bash
export DATABASE_URL='mysql://root:root@127.0.0.1:3306/dayforge_demo'
```

### 5. Migrations

```bash
pnpm db:dayforge:release
```

This runs `server/dayforgeRelease/applyReleaseMigrations.ts`, which applies
every SQL file in `drizzle/` in filename order (the post-0017 DayForge
migrations are manually maintained, per `docs/dayforge-release-gates.md`).

### 6. Demo tenant setup/reset/verify

```bash
pnpm dayforge:demo:setup     # seeds the sunset-laundry-demo tenant
pnpm dayforge:demo:verify    # confirms seed data and migrations are consistent
```

If something goes sideways mid-demo, `pnpm dayforge:demo:reset` restores the
seeded starting state (also reachable from the "Reset demo" button on
`/dayforge-demo`, gated behind a confirm step). `pnpm dayforge:migrations:verify`
confirms the applied schema matches what the release gate expects.

Or run all of the above (env validation, DB connect, migrations, demo
reset+seed, server start, smoke check) in one command:

```bash
pnpm dayforge:demo
```

It prints every URL below plus current provider status and exits leaving the
server running in the background if it had to start one.

### 7. Start the app

```bash
pnpm dev
```

This runs `tsx watch server/_core/index.ts`, which serves both the API and
the Vite-built client on `http://localhost:3000` (override with `PORT`).
There is no separate client dev server process — Vite is wired through the
same Express process via `vite.config.ts`. (`pnpm dayforge:demo` above does
this step for you if the server isn't already running.)

**Known gotcha:** `server/_core/index.ts` loads `.env` via an *async*
`await import("dotenv/config")`, but some modules (`server/_core/env.ts`)
are evaluated synchronously before that import resolves, so `JWT_SECRET`
and similar vars can silently read as empty on the very first boot from a
fresh `.env` file (you'll see `DOMException [DataError]: Zero-length key is
not supported` in the server log on login). If you hit this, export the
required vars directly in your shell instead of relying on the `.env` file,
e.g. `set -a; source .env; set +a; pnpm dev`, or just restart the dev
server once — subsequent restarts pick up `.env` correctly once the module
cache is warm.

### 8. Log in

Two separate login systems exist in this codebase — using the wrong one is
the most common way to get a confusing "not found" or "not enabled for the
tenant" error mid-demo:

- **DayForge tenant login** (`/dayforge-login`) — the one you want for
  BORESLAY, Field, Proposal, Pipeline, and Churn Radar, because it's the
  only login that resolves your session to the `sunset-laundry-demo` tenant:
  - Workspace slug: `sunset-laundry-demo`
  - Email: `demo-owner@sunsetlaundry.example` (or `demo-field@sunsetlaundry.example`
    for the driver/field role)
  - Password: `SunsetDemo2026!`
  - (`server/dayforgeDemo/demoTenantSeed.ts` seeds this password's bcrypt
    hash into `dayforge_saas_user_credentials` on every `dayforge:demo:setup`
    / `dayforge:demo:reset` run; it's a fixed, publicly-documented demo-only
    value, never a production secret.)
- **Legacy admin login** (the `LoginForm` on `/dayforge-demo` and
  `/commercial-missions`) — role `admin`, password from the `ADMIN_PASSWORD`
  env var. This unlocks the demo control page and the legacy mission-admin
  view, but it is **tenant-blind**: it does not resolve to the demo tenant,
  so opening BORESLAY/Field/Pipeline/Churn Radar in this session will 404 or
  403 even though the demo tenant is fully seeded. Use it only for
  `/dayforge-demo` itself.

### 9. Provider status verification

Open `http://localhost:3000/dayforge-demo` (requires
`VITE_DAYFORGE_DEMO_MODE=true`, `DAYFORGE_DEMO_ENABLED=true`, and an
authenticated admin session). The provider chip row at the top
(Google / Stripe / Email / SMS / Print) shows exactly what
`server/dayforgeDemo/providerStatus.ts` detects from your current `.env` —
confirm every chip matches what you intend to demo *before* the room fills
up. A red/`NOT_CONFIGURED` chip mid-presentation is the single most avoidable
failure in this runbook.

### 10. Browser requirements

- A recent Chromium-based browser (Chrome/Edge) or Safari. The release gate's
  own browser story runs on desktop and mobile Chromium
  (`docs/dayforge-release-gates.md`).
- Pop-ups must be allowed for the demo origin — the proposal collateral step
  opens the browser's native Print/Save-as-PDF dialog in a new context, and
  Churn Radar's SMS step opens the OS-native SMS composer.
- Have a second, narrower browser window (or device) ready if you want to
  show the mobile field/driver experience live instead of just narrating it.

## Five-minute demo

Fast path through the core story: intelligence → engagement → execution →
revenue. Use `/dayforge-demo` to jump each link in a new tab so you never
lose your place.

1. **Landing** (`/dayforge`) — one line on what DayForge is.
2. **Territory** (`/territory-preview`) — run a scan, point at one ranked,
   scored opportunity.
3. **Mission** (`/commercial-missions`) — show the persisted Mission 042 the
   scan produced.
4. **BORESLAY win** (`/boreslay-rally?missionId=...`) — play (or fast-forward)
   to a qualifying result; phone mission unlocks.
5. **Field** (`/driver/sales-mission/:missionId`) — show the guided
   preparation/arrival/outcome flow, mark the visit won.
6. **Proposal** (`/commercial-proposal/:missionId`) — show the approved,
   watermark-free collateral.
7. **Won → revenue** (`/commercial-pipeline`) — show the account converting
   and realized revenue attributed to a paid order.

Stop there if the room is short on time — this is the spine of the product.

## Fifteen-minute demo

Full walkthrough. This matches the checklist rendered on `/dayforge-demo`
exactly (`CHECKLIST` in `client/src/pages/DayforgeDemoControlPage.tsx`), so
you can drive from that control page and just click "Open" on each row.

1. **Landing page** — `/dayforge`. Framing: this is a persisted-mission,
   real-provider product, not a mockup.
2. **Map My Territory** — `/territory-preview`. Enter an address, run a scan.
3. **Territory results** — same page. Point at ranking, scoring reasons, and
   evidence provenance (fact vs. estimate vs. inference labeling).
4. **Create Mission 042** — `/commercial-missions`. Show the canonical,
   tenant-scoped persisted mission the scan produced.
5. **Play BORESLAY** — `/boreslay-rally?missionId=<id>`. Play to a qualifying
   result; note this wraps the existing deterministic game engine rather than
   injecting network state into the replay/physics loop.
6. **Unlock phone mission** — back on `/commercial-missions`. Show the
   exactly-once `phone_unlocked` event and the one-time secure handoff link.
7. **Open DayForge Field** — `/driver/sales-mission/:missionId`. Sign in via
   `/dayforge-login` as `demo-field@sunsetlaundry.example` (see "Log in"
   above) or use the phone handoff link, show the mission brief.
8. **Complete preparation** — same page. Walk the tenant-configured checklist;
   required items must be completed or explicitly skipped before departure.
9. **View approved proposal** — `/commercial-proposal/:missionId`. Show the
   current approved, unexpired, non-draft version (drafts are watermarked and
   cannot be printed).
10. **Record visit outcome** — back in Field. Log notes and a structured
    outcome.
11. **Mark account won** — `/commercial-missions`. Show the estimated
    contract value recorded — explicitly labeled as *not* realized revenue
    yet.
12. **Attribute first paid order** — `/commercial-pipeline` or
    `/commercial-missions`. Attribute an existing paid order to the won
    mission; this is a one-time, human-confirmed action.
13. **Show realized revenue** — `/commercial-pipeline`. Point out the value
    ladder: estimated opportunity → approved agreement → (no invoice truth
    exists) → paid order → realized revenue.
14. **Show complete admin timeline** — `/commercial-missions`. Scroll the
    full audit/event history for the mission: scan → game → phone unlock →
    field → proposal → won → attribution, all as immutable events.
15. **Show Churn Radar recovery mission** — `/churn-radar`. Run or open a
    scan, show a risk-scored customer, the grounded win-back draft, and the
    manual (never auto-sent) SMS composer gate.

## Talking points

- **Why territory intelligence matters.** Reps don't need more addresses,
  they need ranked, evidence-backed opportunities with a reason attached to
  every score — demand, capacity fit, route efficiency, contactability. That
  reasoning is visible, not a black box.
- **Why BORESLAY exists.** Cold outreach has a motivation problem before it
  has a data problem. Wrapping the real opportunity in a game with a
  qualifying result and a real unlock (a phone mission) turns "make some
  calls" into something a rep actually wants to play.
- **How Field reduces avoidance.** A guided preparation → navigation → talk
  track → outcome flow removes the blank-page dread of an unstructured sales
  visit. The checklist is persisted and tenant-configurable, so it resumes
  correctly across devices instead of resetting if the rep's phone dies.
- **How proposals become operational.** A proposal isn't a Google Doc
  someone free-hands — it's an immutable, versioned snapshot of the mission
  plus the tenant's proposal profile, administrator-approved, and the only
  thing the Field checklist accepts as "collateral ready."
- **How wins become real revenue.** "Won" only ever records an estimated
  contract value. Realized revenue requires a separate, explicit, human
  attribution of an actual paid order — the system refuses to let a verbal
  yes or an approved agreement silently become a revenue number.
- **How Churn Radar recovers existing revenue.** This isn't prospecting —
  it's a cadence-based risk score over a tenant's real order history, with a
  fact-grounded draft that a human must approve and a contact-permission gate
  that must independently pass before the SMS composer ever opens.
- **Why one persisted mission is the key differentiator.** Every surface —
  scan, game, phone handoff, field visit, proposal, pipeline, revenue,
  timeline — reads and writes the *same* canonical mission row. Nothing here
  is five disconnected demos stapled together; it's one auditable object
  moving through a lifecycle.

## Demo recovery

- **Territory provider unavailable** (`GOOGLE_MAPS_API_KEY` /
  `GOOGLE_PLACES_API_KEY` missing or rate-limited): the provider status chip
  on `/dayforge-demo` will read `NOT_CONFIGURED` before you're on stage — set
  it beforehand. If it fails mid-demo, fall back to narrating the already-
  seeded Mission 042 from `pnpm dayforge:demo:setup` instead of running a
  live scan.
- **Stripe unavailable:** skip live checkout; open `/dayforge-settings` (or
  the routed `/billing` page) and narrate the plan/subscription state and
  Billing Portal link instead of clicking through Stripe Checkout live.
- **SMS unavailable** (`TWILIO_*` unset, so the chip reads
  `NOT_CONFIGURED`): the Churn Radar SMS button will still open the native
  OS SMS composer with a pre-filled message — that composer works with no
  Twilio credentials because DayForge never sends the SMS itself, it only
  hands off to the device. Narrate that "Contacted" remains a manually
  reported, provider-delivery-unverified action either way.
- **Email unavailable** (`AGENTMAIL_*` unset): email is on the vendor/
  procurement side, not core DayForge — skip it, it isn't part of the 15-step
  checklist.
- **PDF popup blocked:** the proposal print step opens the browser's native
  Print/Save-as-PDF dialog. If the browser blocks it, allow pop-ups for the
  demo origin and retry, or pre-open the proposal in a second tab before the
  meeting starts.
- **Database reset needed:** run `pnpm dayforge:demo:reset`, or click "Reset
  demo" on `/dayforge-demo` (requires a confirm click; cannot be undone).
  Re-verify with `pnpm dayforge:demo:verify`.
- **Mission already completed** (from a prior run-through): reset the demo
  tenant (above) rather than trying to reuse a finished mission — the
  lifecycle is exactly-once for game results, rewards, and phone unlocks, so
  a completed mission won't let you replay those steps.
- **Field assignment expired** (phone handoff links expire after 24 hours,
  single-consumption): generate a fresh handoff from `/commercial-missions`
  rather than reusing an old link.
- **Browser refresh:** safe at any point. Field, proposal, and pipeline state
  are all server-persisted with optimistic versioning — a refresh resumes
  exactly where you left off, it does not lose progress.
- **Mobile link unavailable** (no second device on hand): resize your
  desktop browser window to a mobile viewport and reload the same
  `/driver/sales-mission/:missionId` URL — the Field UI is responsive, so
  this is an acceptable live substitute for a real phone.

## Honest limitations

State these plainly if asked — don't oversell what's wired up in a typical
dev/demo setup:

- **Google/territory:** `LIVE` only if `GOOGLE_MAPS_API_KEY` or
  `GOOGLE_PLACES_API_KEY` is set; otherwise `NOT_CONFIGURED` and the demo is
  running against seeded/deterministic data, not live business discovery.
- **Stripe:** `NOT_CONFIGURED` with no `DAYFORGE_BILLING_STRIPE_SECRET_KEY`
  (or one under 20 characters), `TEST` for any other key (e.g. `sk_test_`),
  `LIVE` only for an `sk_live_` key. The demo tenant's own subscription
  row is always a fixed `trialing`-status simulated record seeded by
  `dayforge:demo:setup`/`reset` — it grants BORESLAY/Field/Pipeline/Churn
  Radar access without touching Stripe at all, independent of whatever this
  chip reports; the chip only reflects whether *real* Stripe calls would
  succeed if a tenant tried to check out.
- **Email:** `NOT_CONFIGURED` unless all three `AGENTMAIL_*` variables are
  set. Not part of the core 15-step checklist.
- **SMS:** `NOT_CONFIGURED` unless all three `TWILIO_*` variables are set.
  There is no "TEST" tier for SMS — it's live or nothing. Even when
  configured, DayForge never auto-sends the Churn Radar recovery message; it
  only opens the OS-native SMS composer for a human to send. "Contacted" is
  always a self-reported, provider-delivery-unverified operator action, not
  a delivery receipt.
- **Print:** always `BROWSER_PDF_FALLBACK`. There is no physical print/label
  hardware integration in this codebase. `browser_print_opened` means
  DayForge successfully opened the browser's print workflow — it is not
  proof a printer produced anything or that collateral reached anyone.
- **Revenue:** a won mission or an approved agreement never creates realized
  revenue by itself. Only an explicit, human-confirmed attribution of an
  existing *paid* order does, and even then invoiced revenue is tracked
  separately and stays at zero — there is no invoice-truth data source in
  this system yet.

## Real routes and ports referenced above

From `client/src/App.tsx`:

- `/dayforge` — public landing.
- `/dayforge-login` — DayForge tenant login (slug + email + password); see
  "Log in" above for the demo credentials.
- `/territory-preview` — territory scan/results.
- `/commercial-missions` — mission admin/timeline.
- `/boreslay-rally` — BORESLAY game.
- `/driver/sales-mission/:missionId` — DayForge Field (driver).
- `/commercial-proposal/:missionId` — proposal/collateral print view.
- `/churn-radar` — Churn Radar scans and recovery missions.
- `/commercial-pipeline` — pipeline and revenue attribution.
- `/dayforge-settings` and `/billing` — tenant settings, subscription plan,
  and Stripe Billing Portal link.
- `/dayforge-demo` — the demo control page described above (gated by
  `DAYFORGE_DEMO_ENABLED` + `VITE_DAYFORGE_DEMO_MODE`).

From `package.json` / `server/_core/index.ts`:

- `pnpm dev` runs `tsx watch server/_core/index.ts`, serving on
  `http://localhost:$PORT` (default `3000`).
