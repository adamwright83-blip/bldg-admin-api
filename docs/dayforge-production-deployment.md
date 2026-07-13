# DayForge production deployment plan

This document is the result of a **read-only** investigation of the actual
deployment topology for `adamwright83-blip/bldg-admin-api`. No production
infrastructure, environment variables, or database were modified to produce
it. It exists so a human with deploy authority can execute the remaining
steps with full knowledge of what will happen — do not treat any command
below as already run.

## What actually serves each domain today (confirmed by direct inspection)

This repo deploys to **two separate platforms that are not currently wired
together the way `admin.bldg.chat/julydemo` requires**:

| Domain | Platform | What's live there today | Confirmed by |
| --- | --- | --- | --- |
| `https://admin.bldg.chat` | Vercel project `bldg-admin-api` (org `adamwright83-2158s-projects`) | **Static frontend only.** `curl https://admin.bldg.chat/api/trpc/auth.me` returns Vercel's own `NOT_FOUND` (platform-level, not the app's), and `/julydemo`, `/dayforge-demo`, `/commercial-missions` all 404 the same way. `vercel.json` at repo root is a hand-maintained allowlist of SPA rewrite rules with **no `/api/*` rule and no serverless function directory** — there is no backend reachable from this domain at all right now. | Direct `curl`/`dig` against the live domain, `cat vercel.json` |
| `https://api.bldg.chat` | Railway project `supportive-creation`, service `bldg-admin-api` (same repo, `main` branch, auto-deploy) | **The real, complete, working app** — Express + tRPC + MySQL, same unified server architecture as local dev (`server/_core/index.ts`). `curl https://api.bldg.chat/api/trpc/auth.me` returns a real tRPC response. Currently running commit `250952a` ("Tighten landingfinal copy...") — `main`, **not** this branch. | `railway status`, `curl` against the live domain |
| MySQL (Railway service `MySQL`, same project) | Railway | The production database `DATABASE_URL` on the `bldg-admin-api` Railway service points at. `DAYFORGE_DEMO_ENABLED` is **not set** on this service today (demo mode is off, as it should be by default). | `railway variables --service bldg-admin-api --kv` (names only; no secret values were printed or logged) |

**The practical implication:** the literal requirement
`https://admin.bldg.chat/julydemo` cannot go live by deploying code alone.
`admin.bldg.chat` has no path to a backend today. There are two honest ways
to satisfy the spirit of the request, and the choice is a product/infra
decision, not an engineering one:

1. **Wire `admin.bldg.chat` to the existing working backend** — add a
   Vercel rewrite (or `VITE_API_URL` frontend env var pointing at
   `https://api.bldg.chat`, if CORS/cookie-domain settings allow a
   cross-origin split) so `admin.bldg.chat` calls `api.bldg.chat` for
   `/api/*`. This is new production wiring, not just "deploy the branch."
2. **Present the demo at `https://api.bldg.chat/julydemo` instead** — this
   already is the fully working unified app; once this branch's commits
   reach `main` and demo mode is enabled, `/julydemo` would work there with
   zero additional infra changes.

I have not made this decision for you. Both are below as explicit options.

## Stack integration status (PRs #11–#20)

`claude/dayforge-boss-demo-completion` (this branch) is stacked on
`codex/dayforge-pr-i-analytics-release` (PR #19's branch), which is itself
the tip of the #11→#19 stack. I did not independently re-verify each
individual PR's base/head/mergeability via the GitHub API in this pass (that
was already established in the prior session that opened PR #20 against
PR #19's branch as base) — what I can state directly from `git log`:

- This branch's history (`git log --oneline`) contains every commit from
  `codex/dayforge-pr-i-analytics-release` up to and including
  `696c4a9599e41451bb2863770aec6a4c7db810cb` (the verified PR #19 head),
  plus this branch's own commits on top.
- `main`'s current tip (`250952a`) does **not** contain any of the PR
  #11–#20 DayForge work — `main` is still pre-DayForge-stack.
- No PR in the #11–#20 range has been merged or closed. All should remain
  open until a human confirms the integration approach below.

**Before merging anything**, run this to get the exact current mergeability
state (I did not run it in this pass to avoid GitHub API rate/permission
surprises mid-session, but it's the correct read-only check):

```bash
for pr in 11 12 13 14 15 16 17 18 19 20; do
  gh pr view "$pr" --repo adamwright83-blip/bldg-admin-api \
    --json number,baseRefName,headRefName,mergeable,mergeStateStatus,isDraft
done
```

## Recommended integration sequence (not yet executed)

Given the stack is linear (#11→#12→...→#19→#20, each based on the previous),
the **preferred approach** from the task spec is sequential merge:

```bash
# Repeat for 11 through 20, in order. Each merge updates the next PR's base
# automatically if GitHub's "update branch" is used, or you rebase manually.
gh pr merge 11 --repo adamwright83-blip/bldg-admin-api --merge  # or --rebase, matching repo convention
# ... verify CI green on #12 after #11 lands, then:
gh pr merge 12 --repo adamwright83-blip/bldg-admin-api --merge
# ... continue through #20
```

The **acceptable alternative** (single cumulative integration PR) is simpler
given how large this stack is:

```bash
git fetch origin --prune
git switch -c dayforge-cumulative-integration origin/claude/dayforge-boss-demo-completion
git diff origin/main...HEAD --stat   # confirm this is the full cumulative diff
gh pr create --base main --head dayforge-cumulative-integration \
  --title "DayForge: cumulative production integration (PRs #11-#20)" \
  --body "Cumulative integration of the full DayForge stack. See PR #20 and docs/dayforge-production-deployment.md for context."
```

Either way: **do not merge PR #20 alone.** Its base is PR #19's branch, not
`main` — merging only #20 into `main` would silently omit PRs #11–#19's
commits from `main` entirely.

## Migrations against the production database

The production `DATABASE_URL` (Railway `bldg-admin-api` service, `MySQL`
service in the same project) has **not** been migrated for the DayForge
schema — `main` doesn't contain migrations 0035–0044 yet, so neither does
whatever schema the production database currently has.

Exact commands, to run **after** the stack lands on `main` and **before**
declaring the demo live:

```bash
# 1. Back up first. Railway's MySQL plugin supports snapshot/backup from its
#    dashboard (Data tab) -- take one immediately before migrating.

# 2. Verify current schema state against what's expected pre-migration:
DATABASE_URL="$(railway variables --service bldg-admin-api --kv | grep ^DATABASE_URL= | cut -d= -f2-)" \
  pnpm dayforge:migrations:verify
# Expect this to FAIL before migrating -- that's the correct "not yet applied" signal.

# 3. Apply migrations (uses server/dayforgeRelease/applyReleaseMigrations.ts,
#    applies every drizzle/*.sql file in filename order):
DATABASE_URL="$(railway variables --service bldg-admin-api --kv | grep ^DATABASE_URL= | cut -d= -f2-)" \
  pnpm db:dayforge:release

# 4. Re-verify:
DATABASE_URL="..." pnpm dayforge:migrations:verify
# Expect PASS on all 11 checks now.
```

Do this against the Railway `bldg-admin-api` service's `DATABASE_URL`
specifically (obtained via `railway variables --service bldg-admin-api`, not
typed by hand) — never against a locally-guessed connection string.

## Enabling the demo tenant in production

Only after migrations are verified:

```bash
railway variables --service bldg-admin-api \
  --set DAYFORGE_DEMO_ENABLED=true \
  --set DAYFORGE_DEMO_TENANT_SLUG=sunset-laundry-demo
# This triggers a redeploy on Railway automatically.

# Then, from a machine with the production DATABASE_URL (e.g. `railway run`,
# which injects the service's real env vars without printing them):
railway run --service bldg-admin-api pnpm dayforge:demo:setup
railway run --service bldg-admin-api pnpm dayforge:demo:verify
```

`dayforge:demo:setup`/`reset` are tenant-scoped by construction
(`server/dayforgeDemo/demoTenantReset.ts` scopes every delete to
`demoTenantId()`, which is derived from `DAYFORGE_DEMO_TENANT_SLUG`) — they
cannot touch any other tenant's rows, and refuse to run at all unless
`DAYFORGE_DEMO_ENABLED=true`.

## Wiring `admin.bldg.chat` to a backend (if that's the chosen path)

Two concrete options, in order of how much they change:

**Option A — proxy through Vercel.** Add to `vercel.json`:

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://api.bldg.chat/api/:path*" },
    { "source": "/julydemo", "destination": "/index.html" },
    ...
  ]
}
```
Plus set `VITE_API_URL=https://api.bldg.chat` as a Vercel build-time env var
so the frontend's tRPC client targets the right origin
(`client/src/main.tsx`'s `API_BASE` logic already supports this). Cookies
would then be cross-origin between `admin.bldg.chat` and `api.bldg.chat` —
verify `server/_core/cookies.ts`'s `getSessionCookieOptions` sets
`SameSite=None; Secure` for this case, or the session cookie silently won't
be sent back.

**Option B — present at `api.bldg.chat` instead.** No infra change needed.
Once the stack is on `main` and migrated, `https://api.bldg.chat/julydemo`
works immediately, because that's the actual full-stack deployment.

I recommend Option B for the boss demo specifically — it's zero additional
infra risk, and "api.bldg.chat" vs "admin.bldg.chat" is a naming detail, not
a functional gap, for a presentation. Option A is the right long-term fix if
`admin.bldg.chat` is meant to be the permanent authenticated-app domain
going forward, but it's a separate, larger piece of work (cookie/CORS/CSP
implications across the whole app, not just this demo) that deserves its
own review, not a rider on a boss-demo branch.

## Rollback

- **Application:** Railway keeps prior deployments; `railway status`
  → find the previous successful deployment ID →
  `railway redeploy <deploymentId> --service bldg-admin-api` (or use the
  Railway dashboard's "Redeploy" on the prior build).
- **Vercel:** the dashboard's Deployments tab → "Promote to Production" on
  the prior deployment, or `git revert` the merge commit and let auto-deploy
  redeploy the reverted state.
- **Database:** migrations 0035–0044 are additive (new tables/columns per
  `docs/dayforge-release-gates.md`'s own convention) — they do not need to
  be rolled back to revert the application. If a specific migration must be
  reverted, restore from the pre-migration backup taken in step 1 above;
  there is no automated down-migration tooling in this repo.
- **Demo tenant:** `DAYFORGE_DEMO_ENABLED=false` immediately hides
  `/julydemo` and disables the reset/seed endpoints, without touching any
  data.

## Post-deployment validation

`playwright.dayforge.config.ts` already supports targeting a deployed URL —
no new tooling needed:

```bash
# Against whichever domain ends up serving the app (api.bldg.chat, or
# admin.bldg.chat if Option A was taken):
DAYFORGE_RELEASE_BASE_URL=https://api.bldg.chat \
  DAYFORGE_RELEASE_EXTERNAL_SERVER=1 \
  pnpm test:dayforge:release:e2e
```

`DAYFORGE_RELEASE_EXTERNAL_SERVER=1` skips the config's local
`node dist/index.js` webServer step so Playwright drives the real deployed
origin instead of spawning a local process.

Confirm manually: `/julydemo` loads, `/dayforge-login` authenticates the
seeded demo owner, `MISSION 042` displays, reset works, and existing
unrelated routes (`/`, `/admin`, `/driver`, vendor portal) are unaffected —
i.e. this deploy didn't regress anything already live for real customers.
