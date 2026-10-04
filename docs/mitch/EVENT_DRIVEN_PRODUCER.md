# Mitch event-driven producer

This extends `feat/mitch-native-producer-bus` (base commit `02758287cef4fa8c0f7f6af19c84158a10c503ee`). It preserves the production store, work-order claims/leases, implementation/build separation, independent QA, issue/fix/retest lifecycle, and Adam's creative authority.

Normal coordination is now: dispatch a leased bounded work order → return immediately → authenticated structured implementation event → validate tenant/game/milestone/order/executor/lease and exact GitHub branch SHA → record implementation → request independent review → structured reviewer event → fix and dispatch immediately, retest, or wait for Adam. There is no normal handback polling. The hourly tick is recovery only. The old `executeWorkOrder` polling interface remains for legacy callers, and is not used by this worker.

The provider-neutral envelope in `shared/mitchEvents.ts` supports `implementation_handback`, `design_review_handback`, `qa_handback`, `human_decision`, and `agent_failed`. Actor IDs are arbitrary strings. Dispatch and reviewer briefs include the complete event schema, identities, and mandatory final handback instruction. The Small Comforts seed now asks one question: can player-controlled positioning/angling of the brass button produce the reflected train-light payoff before the Conductor reacts? Existing live work orders are not rewritten.

## Ingress and authority

`POST /webhooks/github` verifies HMAC SHA-256 over raw bytes, using a constant-time comparison. It accepts created issue comments only for the configured repository and issue. A comment must contain `## ACTOR → MITCH`, `<!-- mitch-event:v1 -->`, and one fenced JSON event. Unstructured prose, malformed data, unauthorized authors, and unrelated issue comments cannot complete work. Authority comes from the explicit GitHub login-to-actor allowlist, not the heading or JSON actor claim. Implementation branch refs are checked through GitHub's API before recording a build. Preview/artifact handbacks must also carry `evidence.buildCommitSha` matching the returned commit. Compile/test flags now require explicit evidence booleans; a list of commands alone cannot assert that compilation/tests passed.

`POST /callbacks/mitch` accepts the same envelope with `Authorization: Bearer <MITCH_CALLBACK_TOKEN>`. This is an internal trusted executor/reviewer credential; distribute it only to trusted integrations. It cannot submit human decisions. Human decisions require the configured GitHub author authorized as `adam`. Acceptance requires the exact verified build; it does not merge or release anything.

## Durability and recovery

The MySQL inbox persists events and GitHub delivery IDs, with unique keys and payload hashes. Identical retries are safe, including a fresh delivery ID for the same event. Changing a payload under an existing event ID, or mapping a delivery to another event, is rejected. Local intake is serialized and database advisory locks serialize event effects across replicas. Work-order leases and review assignment audits reject stale executors, stale builds, unassigned reviewers, and additional reviews after a build's review was consumed.

Existing production services perform several writes rather than one shared transaction. If applying an event fails, it becomes `dead_letter`; interrupted processing older than an hour is also quarantined. This deliberately prevents blind replay of potentially completed effects. Inspect `mitch_producer_events.last_error`, reconcile the existing work order/build/QA/audit state, and resolve the failed step before any operator replay. Pending, never-started events drain on intake, startup, and hourly recovery. The recovery tick also scans authorized structured issue comments to recover missed webhook deliveries; this scan is not the normal cadence. Fully automatic crash recovery of partially applied events remains a limitation; this pass does not promise transactional exactly-once processing across remote GitHub side effects.

## Setup required before operation

1. Apply the required migration in `scripts/migrate.mjs` (which reads `drizzle/0111_mitch_producer_events.sql`) to the producer database before starting the worker. The worker fails closed without durable persistence. This change has not run migrations against a live database.
2. Set `DATABASE_URL`, `MITCH_TENANT_ID`, `MITCH_GITHUB_TOKEN`, `MITCH_GITHUB_REPO`, and `MITCH_GITHUB_ISSUE_NUMBER` (defaults to 370). Keep the existing exact base branch/SHA settings aligned with the intended work order. The token needs read access to branch refs and issue comments, and write access to issue comments.
3. Set high-entropy `MITCH_GITHUB_WEBHOOK_SECRET` and `MITCH_CALLBACK_TOKEN`.
4. Set `MITCH_GITHUB_ACTOR_MAP` to a JSON object mapping actual authorized GitHub logins to internal actors. Example structure: `{"actual-executor-login":["github-producer-bus:claude"],"actual-reviewer-login":["chatgpt_design_review"],"actual-human-login":["adam"]}`. Replace every example login. If multiple agents share one GitHub login, that login has all mapped authority; GitHub cannot distinguish those agents.
5. Configure a GitHub repository webhook at the producer's public HTTPS `/webhooks/github` URL, content type `application/json`, matching webhook secret, subscribing to **Issue comments**. Health is at `/healthz`.
6. Connect an actual executor and reviewer that react to Mitch's issue comments and emit structured handbacks. Set `MITCH_EXECUTOR_ENABLED=true` only once the external coding executor is connected. GitHub API access by itself does not establish an execution provider; without this explicit setting the dispatcher retains `MissingExecutionProviderError` behavior.
7. `MITCH_PRODUCER_RECOVERY_MS` defaults to one hour. Handback polling settings apply only to the retained legacy provider method. New producers should use events.

A GitHub comment delivery wakes Mitch immediately. Posting the next request to the issue does not by itself launch Claude, ChatGPT, Codex, or another external agent. Those agents still need an event subscription or agent integration; an hourly agent watcher would remain an external latency bottleneck. No external executor/reviewer integration, webhook, secret, deployment, merge, or issue comment has been changed by this implementation.

## Verification

Unit/HTTP tests: `node_modules/.bin/vitest run server/mitch`.

Disposable MySQL proof: set `MITCH_EVENT_TEST_DATABASE_URL`, then run `node_modules/.bin/vitest run --config vitest.integration.config.ts server/mitch/mitchEventInbox.mysql.integration.test.ts`. The test creates the two inbox tables in that explicitly supplied database and cleans its fixture rows. Do not point it at production.

GitHub signature implementation follows https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries and includes their published HMAC test vector.

The game-development director/skill router from Prompt 2 is intentionally reserved for the review gate in the supplied instructions. This pass does not claim to diagnose fun automatically.

## Change manifest and results

Changed files:

- `shared/mitchEvents.ts`: provider-neutral envelope, parser, callback brief.
- `server/mitch/mitchEventInbox.ts`: durable inbox/delivery dedupe and processing serialization.
- `server/mitch/mitchEventIngress.ts`: signed GitHub webhook and authenticated internal callback.
- `server/mitch/mitchEventService.ts`: identity validation and immediate orchestration.
- `server/mitch/githubProducerBus.ts`: real branch/SHA verification.
- `server/mitch/githubProducerExecutionProvider.ts`: immediate dispatch and mandatory handback contract.
- `server/mitch/mitchDispatcher.ts`: asynchronous dispatch and duplicate/build safeguards.
- `server/mitch/mitchProducerCoordinator.ts`: immediate bounded transitions, review contracts, durable human stop, review reopening, and retry cap.
- `server/mitch/mitchQaService.ts`: cross-game/milestone and exact retest safeguards.
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
