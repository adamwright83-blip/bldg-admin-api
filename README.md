# bldg-admin-api — JOYSTICK

The API, the admin and driver web apps, Claire, and the Goldline games for JOYSTICK.

**Start with [ARCHITECTURE.md](ARCHITECTURE.md).** It is the canonical guide: what JOYSTICK is,
who owns each business fact, and the one legal path from real evidence to a game consequence.
[docs/JOYSTICK_SYSTEM_MAP.md](docs/JOYSTICK_SYSTEM_MAP.md) defines the vocabulary.

## Before you change anything

- **Another repo depends on this one in production.** The resident app (`app.bldg.chat`) calls
  this API over HTTP. Renaming a resident agent tool, changing its input or output shape, or
  rotating `ADMIN_AGENT_SHARED_SECRET` / `APP_SHARED_API_SECRET` breaks residents without failing
  any build or test here. [CLAUDE.md §1](CLAUDE.md) lists exactly what it relies on.
- **`scripts/migrate.mjs` is the production schema authority.** `pnpm start` runs it before the
  server. It does not run `drizzle/*.sql`; a numbered migration is not live until an idempotent
  copy is added there.
- **Games have one canonical build each.** Small Comforts (the three mice in the suitcase) is
  [`preview/small-comforts/`](preview/small-comforts/README.md), and [`STORY.md`](preview/small-comforts/STORY.md) says what happens in each chapter. Read a game's README before
  touching it; older branches, artifacts and prototypes of the same game exist and are wrong.

## Layout

| Path | What it is |
|---|---|
| `client/` | React app: admin, driver, Claire Desk, Lantern City and the games |
| `server/` | Express + tRPC API, Claire, Daphne, President, Mitch, and the background workers |
| `shared/` | Types and contracts used by both |
| `drizzle/` | Drizzle schema (`schema.ts`) and historical numbered migrations |
| `e2e/` | Playwright suites, one `playwright.*.config.ts` per suite at the root |
| `docs/` | Architecture and design notes; `docs/goldline/` docs marked binding constrain new work |
| `docs/history/` | Superseded handoffs and reports, kept as records |
| `scripts/` | Build, migration and CI guard scripts |
| `preview/` | Standalone previews and canonical game builds |
| `artifacts/` | Captured evidence from past work |

The root config files stay at the root. CI workflows, open PRs and the configs' own relative
paths depend on that, and `GOLDLINE_CANON.md` is pinned there by its own header and a test.

## Run it

```bash
pnpm install
cp .env.example .env
pnpm dev     # API with the client
pnpm check   # tsc
pnpm test    # vitest unit tests
```

Integration tests (`vitest.integration.config.ts`) need MySQL. The production database is on
Railway's private network, so DB-backed screens generally cannot be exercised locally. Say so
rather than claiming you verified them.

## Deploy

- **Railway** runs the API: `pnpm build`, then `pnpm start`. The build also bundles the
  procurement, Mitch and President workers into `dist/`.
- **Vercel** serves the gojoystick.com front door from `vercel.json` and `middleware.js`; both
  must stay at the root.
- **CI** is per-area workflows in `.github/workflows/`. The naming, tenant-default and
  domain-boundary guards run on every PR to `main`.
