# Procurement workflow foundation runbook

This runbook covers Slice 1 only. It does not authorize mandates, payments,
vendor outreach, or live procurement.

## Production migration gate

Do not run the production migration until the SQL in `procurement/migrations`
has been reviewed and a fresh database backup has completed.

The production-safe command is:

```sh
railway run --service MySQL --environment production -- \
  sh -c 'DATABASE_URL="$MYSQL_PUBLIC_URL" pnpm db:procurement:migrate'
```

Check status before and after:

```sh
railway run --service MySQL --environment production -- \
  sh -c 'DATABASE_URL="$MYSQL_PUBLIC_URL" pnpm db:procurement:status'
```

Never use `pnpm db:push` or `drizzle-kit migrate` for these tables. The
procurement runner owns its separate `held_schema_migrations` ledger and
verifies checksums plus postconditions.

## Railway worker service

Create a separate service from the same admin repository only after the
production migration is applied and verified.

- Start command: `pnpm start:worker`
- Health endpoint: `GET /healthz` on Railway's injected `PORT`
- Required environment: `DATABASE_URL`
- Optional tuning: `PROCUREMENT_WORKER_ID`, `PROCUREMENT_WORKER_CONCURRENCY`,
  `PROCUREMENT_WORKER_POLL_MS`, `PROCUREMENT_WORKER_LEASE_MS`,
  `PROCUREMENT_WORKER_RETRY_BASE_MS`, `PROCUREMENT_WORKER_POOL_SIZE`
- Restart policy: Railway `ON_FAILURE`, with a bounded retry count during the
  initial rollout
- Logs: Railway service logs; every claim, retry, completion, and dead-letter
  is also persisted in `procurement_execution_history`

Multiple worker instances are safe: claims use a transaction with
`FOR UPDATE SKIP LOCKED`, and every claimed step receives a unique lease owner.
Handlers must still use stable idempotency keys for any future external side
effect.

## Graceful shutdown and recovery

On `SIGTERM` or `SIGINT`, the worker stops polling, finishes in-flight work,
closes the health server, and releases its pool. If a process dies abruptly,
the lease expires and another worker can reclaim the step. Exhausted retries,
expired deadlines, and terminal handler failures are copied to
`procurement_dead_letters`.

## Rollback limitations

The Slice 1 migration is additive. MySQL DDL implicitly commits, so it cannot
be rolled back transactionally. Recovery is restore-from-backup or a separately
reviewed compensating migration. Do not drop the new tables merely because the
worker is disabled; disabling or removing the worker service is the safe first
rollback.
