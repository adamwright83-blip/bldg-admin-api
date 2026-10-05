# President autonomous execution — reconciliation notes

Branch: `feat/president-autonomous-execution`

This branch is intentionally isolated from the parallel architecture, payment/revenue,
customer-geography, Lantern City and Mitch workstreams.

## Ownership

President owns:

- `server/president/cycle/**`
- `server/president/fabric/**`
- `shared/presidentCycle.ts`
- `drizzle/0120_president_autonomous_cycles.sql`
- `scripts/president-cycle-*.{ts,mjs}`

The only existing President files changed to make the new system runnable are:

- `server/president/httpRoutes.ts` — mounts the authenticated autonomous-cycle router.
- `server/president/workerMain.ts` — lets the autonomous cycle fabric run independently
  of the older external-agent transport.

No President code imports `server/mitch/**`, and no Mitch code should import President.

## Production persistence

`FileCycleStore` is development/test only.

Production uses `MysqlCycleStore` and
`drizzle/0120_president_autonomous_cycles.sql`. Apply that table with:

```sh
PRESIDENT_CYCLE_SCHEMA_MIGRATION_APPROVED=YES \
PRESIDENT_DATABASE_URL=... \
node scripts/president-cycle-migrate.mjs
```

Do not point the migration runner at production until that schema change is explicitly
approved. Immediately before merge, re-check that migration number `0120` is still
unused by current `main` and every open overlapping PR. Rename it if necessary.

## Required runtime capabilities

The autonomous cycle is honest about readiness. A complete production run needs:

- `OPENAI_API_KEY` for both ChatGPT proposal and final synthesis.
- Either `ANTHROPIC_API_KEY`, or an explicitly enabled Claude CLI provider, for the
  Claude critique.
- `claude` CLI for the current engineering/research executor and independent reviewer.
- authenticated `gh` CLI for branch/PR operations.
- git and the repository checkout specified by `PRESIDENT_REPO_ROOT`.
- the President MySQL table above.
- owner notification configuration.
- `PRESIDENT_EXECUTION_ENABLED=1` for approved overnight execution.

A missing capability blocks readiness; no other model or fake receipt substitutes for it.

## Final integration gate

Before this PR is marked merge-ready:

1. Fetch latest `origin/main`.
2. Identify Customer/Geography/Lantern/payment architecture work merged since this
   branch base.
3. Reconcile onto latest main once, preserving canonical domain ownership from main.
4. Re-check migration number availability.
5. Run `pnpm check`, nomenclature checks, the complete President tests, MySQL durability
   tests and the strongest acceptance witness available.
6. Run the real engineering execution witness: isolated worktree → code edit → check →
   commit → pushed mission branch → PR → different read-only reviewer → PASS → stop
   before merge.
7. If OpenAI credentials are available, run the real
   ChatGPT → Claude → ChatGPT deliberation. If not, leave that single witness explicitly
   BLOCKED; never substitute Claude for ChatGPT.
8. Diff against latest main and verify no protected architecture/payment/geography/Mitch
   ownership was absorbed by this branch.

## Human authority

President may recommend three items, but execution begins only after a durable Adam
approval receipt records the final approved candidate IDs. President never merges its
own engineering PRs.
