# Mitch event-driven producer

This extends `feat/mitch-native-producer-bus` (base commit `02758287cef4fa8c0f7f6af19c84158a10c503ee`). It preserves the production store, work-order claims/leases, implementation/build separation, independent QA, issue/fix/retest lifecycle, and Adam's creative authority.

Normal coordination is now: dispatch a leased bounded work order → return immediately → authenticated structured implementation event → validate tenant/game/milestone/order/executor/lease and exact GitHub branch SHA → record implementation → request independent review → structured reviewer event → fix and dispatch immediately, retest, or wait for Adam. There is no normal handback polling. The hourly tick is recovery only. The old `executeWorkOrder` polling interface remains for legacy callers, and is not used by this worker.

The provider-neutral envelope in `shared/mitchEvents.ts` supports `implementation_handback`, `design_review_handback`, `qa_handback`, `human_decision`, and `agent_failed`. Actor IDs are arbitrary strings. Dispatch and reviewer briefs include the complete event schema, identities, and mandatory final handback instruction. The Small Comforts seed now asks one question: can player-controlled positioning/angling of the brass button produce the reflected train-light payoff before the Conductor reacts? Existing live work orders are not rewritten.

## Ingress and authority

`POST /webhooks/github` verifies HMAC SHA-256 over raw bytes, using a constant-time comparison. It accepts created issue comments only for the configured repository and issue. A comment must contain `## ACTOR → MITCH`, `<!-- mitch-event:v1 -->`, and one fenced JSON event. Unstructured prose, malformed data, unauthorized authors, and unrelated issue comments cannot complete work. Authority comes from explicit GitHub **login + GitHub App identity** rules, not the heading or JSON actor claim. App-authored comments must match the configured App slug/id; a shared visible login cannot make Claude impersonate ChatGPT or vice versa. Implementation branch refs are checked through GitHub's API before recording a build. Preview/artifact handbacks must also carry `evidence.buildCommitSha` matching the returned commit. Compile/test flags now require explicit evidence booleans; a list of commands alone cannot assert that compilation/tests passed.

`POST /callbacks/mitch` accepts the same envelope with an **actor-scoped bearer credential**. `MITCH_CALLBACK_ACTOR_TOKENS` maps one unique token to one actor ID; a credential assigned to an executor cannot submit a reviewer event. Callback credentials cannot submit human decisions. Human decisions require the configured GitHub human identity authorized as `adam`. Acceptance requires the exact verified build; it does not merge or release anything.

## Durability and recovery

The MySQL inbox persists events and GitHub delivery IDs, with unique keys and payload hashes. Identical retries are safe, including a fresh delivery ID for the same event. Changing a payload under an existing event ID, or mapping a delivery to another event, is rejected. Local intake is serialized and database advisory locks serialize event effects across replicas. Work-order leases and review assignment audits reject stale executors, stale builds, unassigned reviewers, and additional reviews after a build's review was consumed.

Existing production services perform several writes rather than one shared transaction. If applying an event fails, it becomes `dead_letter`; interrupted processing older than an hour is also quarantined. This deliberately prevents blind replay of potentially completed effects. Inspect `mitch_producer_events.last_error`, reconcile the existing work order/build/QA/audit state, and resolve the failed step before any operator replay. Pending, never-started events drain on intake, startup, and hourly recovery. The recovery tick also scans authorized structured issue comments to recover missed webhook deliveries; this scan is not the normal cadence. Fully automatic crash recovery of partially applied events remains a limitation; this pass does not promise transactional exactly-once processing across remote GitHub side effects.

## Setup required before operation

1. Apply the required migration in `scripts/migrate.mjs` (which reads `drizzle/0111_mitch_producer_events.sql`) to the producer database before starting the worker. The worker fails closed without durable persistence. This change has not run migrations against a live database.
2. Set `DATABASE_URL`, `MITCH_TENANT_ID`, `MITCH_GITHUB_TOKEN`, `MITCH_GITHUB_REPO`, and `MITCH_GITHUB_ISSUE_NUMBER` (defaults to 370). Keep the existing exact base branch/SHA settings aligned with the intended work order. The token needs read access to branch refs and issue comments, and write access to issue comments.
3. Set a high-entropy `MITCH_GITHUB_WEBHOOK_SECRET`.
4. Set `MITCH_GITHUB_ACTOR_RULES` to a JSON array of integration-bound authority rules. Example: `[{"login":"adamwright83-blip","appSlug":"claude","actorIds":["github-producer-bus:claude"]},{"login":"adamwright83-blip","appSlug":"chatgpt-codex-connector","actorIds":["chatgpt_design_review"]},{"login":"adamwright83-blip","actorIds":["adam"]}]`. App-authored comments must match their App rule; the app-less rule is reserved for the human.
5. Set `MITCH_CALLBACK_ACTOR_TOKENS` to a JSON object mapping actor ID to a **unique** high-entropy callback token. Tokens may not be shared across actors.
6. Set `MITCH_AGENT_WAKE_ENDPOINTS` to a JSON object mapping actor ID to `{"url":"https://…","token":"…"}`. Mitch POSTs a deterministic wake envelope immediately after dispatching implementation or independent review work. The receiving agent bridge should dedupe on `x-mitch-wake-id`.
7. Configure a GitHub repository webhook at the producer's public HTTPS `/webhooks/github` URL, content type `application/json`, matching webhook secret, subscribing to **Issue comments**. Health is at `/healthz`.
8. Connect actual executor/reviewer wake endpoints and their structured handback callbacks. Set `MITCH_EXECUTOR_ENABLED=true` only once the executor wake target is live. GitHub API access by itself does not establish an execution provider; without this explicit setting the dispatcher retains `MissingExecutionProviderError` behavior.
9. `MITCH_PRODUCER_RECOVERY_MS` defaults to one hour. Handback polling settings apply only to the retained legacy provider method. New producers use webhooks/callbacks plus immediate outbound wakes.

A valid handback wakes Mitch immediately, and Mitch immediately emits a provider-neutral outbound wake when it routes the next executor/reviewer task. GitHub remains the durable transcript; it is no longer relied on as the alarm clock. Concrete Claude/ChatGPT/Codex/Cursor/Antigravity wake endpoints still have to be configured before those external products can actually be launched by the worker.

## Verification

Unit/HTTP tests: `node_modules/.bin/vitest run server/mitch`.

Disposable MySQL proof: set `MITCH_EVENT_TEST_DATABASE_URL`, then run `node_modules/.bin/vitest run --config vitest.integration.config.ts server/mitch/mitchEventInbox.mysql.integration.test.ts`. The test creates the two inbox tables in that explicitly supplied database and cleans its fixture rows. Do not point it at production.

GitHub signature implementation follows https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries and includes their published HMAC test vector.

The game-development director/skill router from Prompt 2 is intentionally reserved for the review gate in the supplied instructions. This pass does not claim to diagnose fun automatically.

## Change manifest and results

Changed files:

- `shared/mitchEvents.ts`: provider-neutral envelope, parser, callback brief.
- `server/mitch/mitchEventInbox.ts`: durable inbox/delivery dedupe and processing serialization.
- `server/mitch/mitchEventIngress.ts`: signed GitHub webhook, GitHub App-bound authority, and actor-scoped internal callbacks.
- `server/mitch/mitchAgentWake.ts`: provider-neutral immediate outbound wake contract plus HTTP wake adapter.
- `server/mitch/mitchEventService.ts`: identity validation and immediate orchestration.
- `server/mitch/githubProducerBus.ts`: real branch/SHA verification.
- `server/mitch/githubProducerExecutionProvider.ts`: immediate dispatch and mandatory handback contract.
- `server/mitch/mitchDispatcher.ts`: asynchronous dispatch and duplicate/build safeguards.
- `server/mitch/mitchProducerCoordinator.ts`: immediate bounded transitions, reviewer wake contracts, authenticated reviewer provenance, durable human stop, review reopening, and retry cap.
- `server/mitch/mitchQaService.ts`: cross-game/milestone and exact retest safeguards plus fail-closed compile/test requirements before VERIFIED.
- `server/mitch/mitchStore.ts`: compile/test flags require explicit evidence.
- `server/mitch/producerWorkerMain.ts`: event-driven runtime and hourly recovery.
- `server/mitch/smallComfortsProduction.ts`: one-button physical alignment proof.
- `drizzle/0111_mitch_producer_events.sql` and `scripts/migrate.mjs`: inbox migration and required boot-path registration.
- `server/mitch/mitchEvents.test.ts` and `server/mitch/githubProducerBus.test.ts`: event, HTTP, production lifecycle, callback, and branch identity tests.
- `server/mitch/mitchEventInbox.mysql.integration.test.ts`: opt-in disposable MySQL durability/concurrency proof.
- `docs/mitch/EVENT_DRIVEN_PRODUCER.md`: architecture, setup, limitations, and this manifest.

Validation on 2026-10-04:

- `vitest run server/mitch`: **49 tests passed in 7 files**.
- `tsc --noEmit --incremental false`: **passed**.
- Producer worker `esbuild` bundle: **passed**.
- `node --check scripts/migrate.mjs` and `git diff --check`: **passed**.
- Explicit MySQL inbox integration suite: **1 test skipped**, because `MITCH_EVENT_TEST_DATABASE_URL` was not provided. Durable MySQL behavior remains unverified against a live test database in this session.
