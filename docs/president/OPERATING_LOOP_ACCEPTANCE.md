# President operating loop acceptance

Successor base: `045f96f96db671f2b7dba54440408a688cb50521`.
Reconciled main: `8a8a284473fd33855481ac34fcf9034f356b6849`.
Source PR #377: `62a23a16a17b9b51c9e04b43e8422acb21e76bf4`.
The later Hidden Game documentation is preserved by the semantic merge.

## Reproducible proof

Use a disposable local MySQL 8 server with root/root on port 3411, or set
`PRESIDENT_MYSQL_TEST_PORT` to a separate port. Never use a production database.

```
PRESIDENT_MYSQL_TEST=1 pnpm exec vitest run server/president
pnpm president:stage1:witness
pnpm exec vite --host 127.0.0.1 --port 4189
pnpm exec playwright test --config playwright.president.config.ts
```

The executive-cycle test regenerates `artifacts/president-intelligence/witness.json`
and `founder-surface-fixture.json` from actual MySQL persistence. It replaces the
obsolete source witness; it does not edit an old model answer to pass nomenclature.
The production reasoning source now requests canonical JOYSTICK naming and rejects
unqualified retired terminology. Test providers and fetched source fixtures are
explicitly `TEST_FIXTURE`; production routes never select them.

The cycle proves grounded evidence, validated structured reasoning, a durable
PROPOSED objective, one bounded founder authorization question, ACTIVE selection,
source-backed allowlisted research with stored citations and snapshots, a final
MEASURE plan, failed transport, durable retry across coordinator restart,
authenticated execution return, exact callback replay, independent review,
worker measurement/learning, ACHIEVED objective and COMPLETED program, and the next
brief. An execution return first enters REVIEW_PENDING; it never certifies itself.

Negative HTTP witnesses reject malformed (400), unauthorized (401), expired/stale
execution, wrong object/actor, unknown/over-budget cost, altered replay, wrong
review artifact, and stale reviewed execution (409). Concurrent identical execution
callbacks produce one persisted return and charge once. Review leases survive
restart; retries preserve exact artifact identity and terminate after a bounded
number of review wake attempts. Retry ceilings conservatively reserve attempted
spend, including lost returns; they cannot manufacture spare authority.

## Runtime and product

Founder route: `/president`. The server requires the configured owner OpenID and
admin authorization; tenant users, other admins and unauthenticated callers cannot
read or mutate company state. Browser coverage renders the fixture extracted from
MySQL, submits one bounded founder decision, and proves a forbidden response shows
an honest error. Browser fixture interception exists only in the test harness.

The worker recovers executions and reviews, reconciles independently verified final
measurement, asks at most three open objective-selection questions, and plans one
selected program per cycle through the real structured provider. Missing provider
credentials fail honestly after existing recovery work has progressed.

Deployment requires `OWNER_OPEN_ID`, President durable DB configuration,
`ANTHROPIC_API_KEY` for production reasoning/research, and configured execution and
independent-review transports. Set `PRESIDENT_AGENT_TARGETS_JSON`,
`PRESIDENT_AGENT_CALLBACK_TOKENS_JSON`, and `PRESIDENT_CALLBACK_BASE_URL`, then run
`start:president-worker`. Configuration status is not a connectivity proof.
Executor transport must honor `x-president-work-id` idempotency and echo
`step.attemptCount` as `evidence.executionAttempt`. Reviewer transport must echo
`handback.eventId` as `evidence.executionEventId`. These bind callbacks to the
current exact work rather than trusting an actor's success claim.

Schema setup remains explicit: `president:schema:migrate` requires
`PRESIDENT_DATABASE_URL` and `PRESIDENT_SCHEMA_MIGRATION_APPROVED=YES`; a target
matching the ordinary application DB additionally requires
`PRESIDENT_PRODUCTION_SCHEMA_APPROVED=YES`. Ordinary boot creates zero President
tables. The explicit runner succeeds twice on a disposable database, and the SaaS
schema release exam still passes afterward. Existing authority migrations survive.

## Boundaries and limitations

Company records remain separate from tenant/customer truth tables. President never
issues payment, message, customer-win, action-completion, or field-observation
Authority Receipts. A verified internal artifact is not a commercial outcome.
Research stores fetched source text separately from unverified synthesis; missing
telemetry stays UNKNOWN. The public-domain allowlist is currently focused on
technical primary sources, not arbitrary commercial market research.

This pass does not activate production schema, deploy a worker, create transport
services, invent company metrics, or autonomously recruit executive agents. Human
physical work and consequential release/production decisions remain bounded by
founder authority. UI exposes unsupported human follow-through as blocked rather
than fabricating completion. Reasoning/research providers have bounded calls and
request ceilings; this pass does not claim audited provider billing telemetry.

## Validation classification

President-specific: 63 tests pass, including real MySQL lifecycle and executive-cycle
coverage. Authority plus President focused run: 79 tests passed before the final nomenclature regression (now 81). Desktop browser: 3 tests pass. Full TypeScript,
production build, nomenclature, tenant ratchet, and vertical dependency gates pass.

Full repository unit run: 9158 passed, 18 failed, 18 skipped (908 files). All 18
failures reproduce exactly in 12 failing suites on an archived original-main tree:
customer aggregates, CSV sync, operations events, sovereign truth, customer digest,
field-event bridge, Tower Wars, Claire decisionRecord (three known failures), public
landing, Colosseum truth, driver mobile actions, and Claire proactive briefing.
No unrelated test or product behavior was changed to hide these failures.

An initial TypeScript run hit Node's default heap limit; with an explicit 6 GB heap
it passes. President CI provides that memory ceiling. No live paid provider request
or production mutation was used for acceptance.
