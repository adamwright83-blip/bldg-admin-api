# President autonomous execution reconciliation

Branch: `chatgpt/president-autonomous-execution`

This branch is intentionally isolated from the concurrent architecture/payment work.

## President-owned additions

- `shared/presidentCycle.ts`
- `server/president/cycle/**`
- `server/president/fabric/**`
- `drizzle/0120_president_autonomous_cycles.sql`

## Existing President files intentionally touched

- `server/president/router.ts` — founder review/approval/execution API surface.
- `server/president/workerMain.ts` — scheduled deliberation and approved-cycle execution; legacy target runtime no longer required merely to boot.
- `server/president/reasoning.ts`, `programPlanner.ts`, `skillRouter.ts`, `cabinet.ts` — remove conceptual routing of President work to Mitch.
- `client/src/pages/PresidentPage.tsx` — Adam review/replacement/approval surface.
- `scripts/president-migrate.mjs` — explicit President migration runner includes 0120.

## Protected workstreams not edited

- `server/commercialPipeline/**`
- `server/commercialCampaigns/**`
- `server/authority/**`
- canonical revenue/payment files
- Mitch-owned source/contracts

The President engineering executor also refuses to mutate those paths.

## Merge/reconciliation rules

1. Do not merge this branch automatically.
2. Reconcile any concurrent edits to the existing President files above by preserving:
   - ChatGPT → Claude → ChatGPT deliberation order;
   - `AWAITING_ADAM_REVIEW` before a durable `ADAM_APPROVED` receipt;
   - exact approved candidate IDs as the only executable mission set;
   - zero President→Mitch execution routing;
   - separate non-Mitch executor/reviewer actors;
   - human merge gate;
   - MySQL durability for cycle/mission state.
3. Do not replace the MySQL cycle store with local file persistence in production.
4. Do not grant the President executor merge-to-main authority during reconciliation.
