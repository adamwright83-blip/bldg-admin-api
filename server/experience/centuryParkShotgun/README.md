# Century Park East shotgun persistence

This is an independently owned persistence slice. **The live game is not connected to it.**
It started from `origin/main` at `42fe70840502c9043fcd0b81210055fbba0b5af3` in an isolated worktree.
Before publication the branch was fast-forwarded to `origin/main` at `88e05543` (the only new upstream change was Claude’s signup-origin handoff document). No shared Claire, billing, onboarding, direct mission, existing outreach, schema, or composition file is modified.

## Functional in this slice

- `centuryParkShotgunRouter` exposes `preview`, `fire` and `timeline`, with the existing tenant operator membership guard plus explicit denial/demo checks and the existing cookie mutation-origin guard.
- Preview uses the current selected tenant's eligible Century Park East roster. Names and phones are never accepted from the client. Hypotheses remain operator predictions; no correctness score is manufactured.
- An immutable approval row records the tenant, actor, canonical customer identity, name/phone snapshot, last order, opening, hypothesis, selected shell, exact message, approval confirmation, policy version, UTC schedule and execution linkage.
- Database uniqueness permits one approved action per tenant/customer/last-recorded-order lapse, including concurrent requests with different request IDs. The server derives that lapse from the canonical roster. Reusing a request ID with changed content fails. A second operator cannot execute the first operator's approval.
- The approval is saved **before** calling the existing `commitPersonalOutreachDraft` and `approveDurablePersonalOutreach` boundaries. The stable outbox key derives from the persisted shot ID. A failed acknowledgment is recoverable, including after the scheduled time, by reading the existing outbox first. No new sender or dispatcher is introduced.
- A saved schedule remains `awaiting_sender_setup` on today's personal-outreach rail. It is not sent, delivered, a pickup reservation, an applied credit, or a fulfilled offer. Edits and cancellations on the existing outbox are read back without resurrecting or reapproving them.
- Tenant operators can read the same history on another device without localStorage or a current inactive-roster entry. The original approval remains distinct from current outbox wording and schedule.
- Results are read from durable canonical sources, rather than copied into a second business ledger. Trusted inbound evidence needs a matching tenant/customer/operator and a verified send before its observed time. Exact references whose current recipient, content, schedule and revision still match the original approval link directly; unreferenced replies stay customer-timeline observations within the relevant action window. Reported, old, simulated and wrongly linked replies are excluded.
- Native orders are selected by tenant and matched by canonical identity key or the canonical phone snapshot, never by name. Payments use `loadPaidOrderLedger`, with its native/CleanCloud receipt requirements. No mutable order price becomes revenue. Payment references retain their authority receipt IDs and source-observed cents; native amounts come from capture receipts rather than editable order totals. Replies retain source, classification and text; native orders retain status. Later activity is observational; it never verifies the hypothesis or establishes a caused sale. There is no attributed-revenue total or reward write.
- Evidence read failures are returned as unavailable/partial coverage, never as proof of zero activity.

## Deliberately blocked integrations

The initial inventory inspected all **92** open PRs and each changed-file list on 2026-10-25. #715 was already merged; #716 and #714 were open. The pre-publication refresh inspected **96** open PRs and their complete changed-file lists, including Cursor’s four workstreams in #718, #719, #720 and #721; none overlaps this slice. All locally registered worktrees were enumerated and inspected for tracked changes. Unpublished work on another machine cannot be certified absent.

| Integration              | Owner boundary left untouched                                                                                            | Required handoff                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP/tRPC mount          | `server/composition/goldlineWorldRouter.ts`, overlapping #597 and #600                                                   | Its owner imports `centuryParkShotgunRouter` and mounts `centuryParkShotgun: centuryParkShotgunRouter`. Do not mount it under a different domain to bypass ownership.                                                                                                                                                             |
| Production migration     | `scripts/migrate.mjs`, overlapping numerous active PRs; `drizzle/schema.ts` also shared/owned                            | Its owner runs this directory's `migration.sql` through the required production migration path. The isolated table declaration in `schema.ts` supports the service without editing the shared schema. This SQL is tested twice for idempotency, but is **not on production boot**. No runtime table creation is used.             |
| Game UI                  | `client/src/pages/goldline/centuryParkEast3d/CenturyParkEast3D.tsx` still uses the old shared schedule route             | After the mount/migration land, switch only the shotgun to preview/fire/timeline; replace `centuryParkEast.chips.v1` and its result score with server history. Keep the direct mission/Letter Desk path with its owner. Render the precise returned execution state, not a send claim.                                            |
| Free pickup / $10 credit | Real fulfillment belongs to the business/order/credit owners; no independently owned verified fulfillment port was found | Supply a tenant/customer/offer-bound enforceable entitlement or provider fulfillment receipt before enabling either shell. Do not substitute an operator checkbox, a ledger entry, or a simulated receipt. Both shells currently persist `blocked_integration`, produce **no outbox**, and always report `offerFulfilled: false`. |
| Live reply capture       | Existing trusted provider/device adapters                                                                                | This slice reads admitted durable reply evidence; it does not activate a new connector or claim personal-handset replies are already captured in production.                                                                                                                                                                      |

The existing live UI's localStorage history and unsafe success scoring are **unchanged** until the owner completes the wiring. Existing localStorage entries are not imported as verified approvals. Fictional item-finding/vibe/progress storage is outside this persistence slice. This PR does not claim production cross-device gameplay works.

Only `none` is an available shell. Its exact server draft is required because free-form editing could hide a credit or capacity promise while selecting “No offer”. Offer-bearing approvals remain blocked and immutable for that lapse; changing an already approved action requires a future explicit cancellation/replacement lifecycle. There is no daily promotional budget to consume while every promotional offer is disabled; server budget reservation must be integrated before enabling offers.

## UI integration contract

1. Query `preview` with `{ customerId, openingId, hypothesis }`; show `messageBody` and shell availability exactly. A send time is a message time, not an appointment.
2. Fire with `shotgunSubmission` from `shared/centuryParkShotgun.ts`. Retain a UUID through retries, and include the exact `CPE_SHOTGUN_APPROVAL` only after operator approval. Tenant/operator and result authority fields are rejected.
3. On network failure, read `timeline` and retry the unchanged saved submission. A changed approval needs an explicit future replacement flow; generating another UUID never bypasses the lapse constraint.
4. Restore shotgun history and poses from tenant-scoped `timeline`. Distinguish blocked, reserved, retryable, awaiting sender, failed, cancelled and observed send states. Do not use old localStorage entries to chip a customer, grant credit, score a prediction or claim a sale.
5. Display observation timestamps, source references and coverage. `customer_timeline` is temporal identity association, not message attribution. Do not sum these references into caused revenue or treat a reply (including a complaint/STOP) as hypothesis success.

## Verification and limits

The disposable test exercises the standalone router in-process, MySQL approval and outbox persistence, revision and approval audit writers, G14 opt-outs, concurrency, recovery, tenant isolation, permissions, and real result readers. The upstream customer-eligibility read is a deterministic fixture; it does not claim a new production customer-book or source-freshness test. Orders, outbound send observations, replies and receipt data are explicitly synthetic fixtures. No real outreach, order, charge or account credit is made.

The browser/HTTP mount, live fulfillment provider, production migration and real handset connector are not exercised. They remain disconnected above. Existing native and CleanCloud ingestion are consumed, not changed. Identity association follows normalized analytical keys/phone; it is not proof of a natural person's identity. No statistical experiment or causal attribution is implemented.

Run the new GitHub workflow `Century Park shotgun persistence`, or locally against a disposable MySQL 8 database named `cpe_shotgun_disposable*` on localhost:

```sh
pnpm check
pnpm exec vitest run server/experience/centuryParkShotgun/shotgun.test.ts
# DATABASE_URL must identify the disposable database, never a shared/prod database.
node scripts/migrate.mjs
CPE_SHOTGUN_DISPOSABLE_DB=1 ALLOW_TEST_DB=1 pnpm exec vitest run --config vitest.integration.config.ts server/experience/centuryParkShotgun/shotgun.mysql.integration.test.ts
```

The integration test applies only its own migration after the existing migration runner and refuses non-local/non-disposable databases. Its synthetic data can be discarded with the database.

Local verification on 2026-10-25: `pnpm check` passed; 17 disposable MySQL checks and 39 boundary/existing-outreach regression tests passed (56 total). Nomenclature, default-tenant and domain-boundary ratchets passed. The branch remains unmerged.
