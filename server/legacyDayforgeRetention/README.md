> **LEGACY DAYFORGE COMPATIBILITY:** Retained historical literals in this file are compatibility/history only; they are not current architecture. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md.

# DayForge retention operations

`POST /api/internal/dayforge/retention/run` runs bounded, idempotent cleanup after migration `0043` is deployed. Authenticate with `Authorization: Bearer $DAYFORGE_RETENTION_SECRET` or `x-legacy-dayforge-retention-secret`.

Example body:

```json
{ "dryRun": true, "batchLimit": 250 }
```

Schedule a dry run first, then a regular small production batch. A run never removes `dayforge_audit_events`, operational outcome evidence, or the current authoritative game-result/replay row. Replay payload redaction begins only after the schema can preserve a replay hash and redaction proof. The executable matrix in `retentionPolicy.ts` is the source of truth for lifetimes. Tables are detected before use, including the optional future evidence-upload table, so cleanup remains safe during staged rollouts.

## JOYSTICK scheduled operation

The customer-safe scheduler is `.github/workflows/saas-retention.yml`. It calls the existing bounded retention endpoint through `scripts/run-saas-retention.mjs`.

It is intentionally inert until production configuration is explicitly supplied:

- repository variable `JOYSTICK_RETENTION_ENABLED=1`
- repository variable `JOYSTICK_RETENTION_BATCH_LIMIT` (optional, defaults to 250, max 1000)
- repository secret `JOYSTICK_RETENTION_URL` (the production API base URL, no trailing slash required)
- repository secret `JOYSTICK_RETENTION_SECRET`
- matching Railway/API secret `DAYFORGE_RETENTION_SECRET`

Safe activation sequence:

1. Configure the matching secret in the production API and GitHub without committing it.
2. Set the production URL secret.
3. Leave `JOYSTICK_RETENTION_ENABLED` unset and manually dispatch the workflow with `dry_run=true`.
4. Verify the returned policy version/resource counts.
5. Set `JOYSTICK_RETENTION_ENABLED=1`.
6. Manually run one bounded non-dry batch and verify expected deletion counts.
7. Leave the daily schedule enabled.

If the scheduler is disabled it exits successfully without touching data. If enabled but its URL or secret is missing it fails closed. No scheduler path can bypass the endpoint's authentication, batch ceiling, retention policy, or evidence-object deletion safeguards.
