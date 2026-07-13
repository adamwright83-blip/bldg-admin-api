# DayForge release gates

PR I has two complementary release checks. Neither check substitutes fixtures
for production provider truth.

## What the gates prove

- The unit harness uses one deterministic `TerritoryBusinessProvider`. It proves
  deduplication, ranking, evidence classification, analytics-property privacy,
  stable event ordering, and refusal to claim external success.
- The MySQL integration journey uses the production stores and services across
  territory persistence, canonical mission creation, BORESLAY, phone handoff,
  Field, proposal, follow-up, account conversion, and paid-order attribution.
- The integration journey executes concurrent retries and asserts one mission,
  game result, reward, phone unlock, phone handoff, and first-order attribution.
- Cross-tenant reads and wrong-assignee phone access are denied.
- Desktop and mobile Chromium exercise the public preview, provider result, and
  refresh/resume boundary with the explicitly gated deterministic provider.

## What the gates do not claim

- Fixture discovery is not Google Places or other live provider evidence.
- Browser Print / Save PDF is not print-provider completion.
- A follow-up record is not an outbound message delivery receipt.
- A paid fixture order has realized-revenue truth, but no invoice evidence. The
  journey asserts `invoicedRevenueCents === 0`.
- Stripe, email, SMS, print, and accounting providers require separate sandbox
  or production verification owned by those systems.

## Local commands

The fast deterministic suite requires no database:

```bash
pnpm test:dayforge:release
```

The database journey is opt-in so a missing database never becomes a false
pass. Point only at a disposable MySQL database:

```bash
export DAYFORGE_RELEASE_DB=1
export DATABASE_URL='mysql://root:root@127.0.0.1:3306/dayforge_release'
pnpm db:dayforge:release
pnpm test:dayforge:release:integration
```

After a production build and Chromium install, run the public browser story:

```bash
pnpm build
pnpm exec playwright install chromium
pnpm test:dayforge:release:e2e
```

The browser server also requires the public-preview secrets documented in the
production rollout guide. CI supplies synthetic secrets and enables
`DAYFORGE_RELEASE_TEST_MODE=1` only with `NODE_ENV=ci`; production cannot select
the deterministic provider.

## CI order

The DayForge workflow performs these gates in order:

1. frozen dependency install;
2. deterministic unit and contract tests plus a focused harness type-check;
3. sequential SQL migration application to a fresh MySQL 8 database;
4. full production-service integration journey;
5. production build;
6. desktop and mobile Chromium preview/resume test.

Every SQL file in `drizzle/` is applied in filename order. This is deliberate:
the post-0017 DayForge migrations are manually maintained and are not all
registered in Drizzle's legacy journal.
