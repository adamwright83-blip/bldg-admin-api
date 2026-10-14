> **LEGACY DAYFORGE COMPATIBILITY: retained historical literals (table/env names) only; not current architecture. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md.**

# Claire strategic preparation — release readiness (PR #575)

Recorded 2026-10-13. Read-only; nothing here was deployed or written to production.

## Production configuration (Railway `bldg-admin-api` / production, names only)

| Variable | State |
|---|---|
| DATABASE_URL, JWT_SECRET, ANTHROPIC_API_KEY | set |
| TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, CLAIRE_TWILIO_FROM_NUMBER, CLAIRE_OPERATOR_PHONE | set |
| ADMIN_AGENT_SHARED_SECRET, APP_SHARED_API_SECRET (resident app) | set, unchanged by this PR |
| AUTONOMOUS_WORKERS_ENABLED | unset → workers default on; production logs show the heartbeat starting |
| CLAIRE_STRATEGY_QUALITY_REVIEW_ENABLED | unset → independent quality review stays off (certification incomplete by design) |

No new variable is required to deploy.

## Migration

`scripts/migrate.mjs` (runs in the Railway start command) is additive only:
three `CREATE TABLE IF NOT EXISTS` strategic tables, two nullable columns
(`dayforge_saas_tenants.strategyVerticalKey`, `tenant_standing_authorizations.allowedWeekdaysJson`),
and a widened `operator_appointments.appointmentKind` enum (adds `weekday_strategic_planning`).
Verified: fresh migrate, idempotent second run, and older-schema upgrade (`acceptance-schema-compat.mjs`).

## Rollback

1. Railway → redeploy the previous successful deployment (`canRollback: true` on the current one).
2. Leave the schema in place. Old code ignores the new tables and nullable columns.
3. Do **not** narrow the `appointmentKind` enum back while any `weekday_strategic_planning`
   rows exist; mark those appointments cancelled instead if they must not dispatch.

## Operator-only gates (not engineering blockers)

- Real outbound strategic call: requires an explicit operator consent grant; none created.
- Independent strategic-quality certification: intentionally incomplete.
- Synthetic scenarios are not evidence of financial improvement.
