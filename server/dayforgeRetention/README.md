# DayForge retention operations

`POST /api/internal/dayforge/retention/run` runs bounded, idempotent cleanup after migration `0043` is deployed. Authenticate with `Authorization: Bearer $DAYFORGE_RETENTION_SECRET` or `x-dayforge-retention-secret`.

Example body:

```json
{ "dryRun": true, "batchLimit": 250 }
```

Schedule a dry run first, then a regular small production batch. A run never removes `dayforge_audit_events`, operational outcome evidence, or the current authoritative game-result/replay row. Replay payload redaction begins only after the schema can preserve a replay hash and redaction proof. The executable matrix in `retentionPolicy.ts` is the source of truth for lifetimes. Tables are detected before use, including the optional future evidence-upload table, so cleanup remains safe during staged rollouts.
