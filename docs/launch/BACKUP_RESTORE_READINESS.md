# Backup and restore readiness

Operator notes for the production MySQL recovery gate. This page records what was checked in the repository. It does not record a live Railway inspection.

## VERIFIED in the repository

`docs/JOYSTICK-SAAS-LAUNCH-OPS.md` still describes the production posture as:

- MySQL service is single-node.
- Scheduled volume backups are not configured.
- Point-in-time recovery is not enabled.
- The custom MySQL start command includes `--disable-log-bin`.
- No restore drill has been proven.

Those sentences are document text. They are not a fresh look at the running service.

`--disable-log-bin` appears in that launch-ops document and in `artifacts/president-stage1/database-witness.json`, which copies the same document. No Dockerfile, Railway config, MySQL config, or start script in this repository contains the flag. The captured API start command in `artifacts/claire-strategy/acceptance/railway-read-only.json` is `node scripts/migrate.mjs && NODE_ENV=production node dist/index.js`. That is the application process, not `mysqld`.

Retention could delete without a person present. `.github/workflows/saas-retention.yml` runs on cron `17 11 * * *`. Before this change, a scheduled run set `JOYSTICK_RETENTION_DRY_RUN` to `0`. `scripts/run-saas-retention.mjs` treated every value other than `1` as a live delete and posted `dryRun: false`. The retention route defaults `dryRun` to false, and the service deletes eligible rows when `dryRun` is not true. Once `JOYSTICK_RETENTION_ENABLED=1` and the retention URL and secret are set, that daily run could delete production rows with nobody watching.

Scheduled workflows run from the default branch. `main` still has the unguarded expression, so this branch does not stop that daily run. The guarded workflow below is on this branch only.

The scheduler on this branch is fail-closed:

- The cron and any dispatch that does not confirm both inputs stay dry-run.
- A live delete is posted only for `workflow_dispatch` with `dry_run=false` and `confirm_delete=true`.
- `scripts/run-saas-retention.mjs` refuses any other live-delete combination and does not send the request.
- A direct call to the retention route can still delete when the caller sends `dryRun: false` and possesses the retention secret. That path is not the unattended schedule.

`scripts/disposable-restore-drill.mjs` loads a logical dump only when all of these are true:

- The host is `localhost`, `127.0.0.1`, or `::1`.
- `RAILWAY_ENVIRONMENT` and `RAILWAY_ENVIRONMENT_NAME` are not `production`.
- The host does not look like Railway, `bldg.chat`, RDS, or a host labeled `production`.
- The database name ends in `_drill` or `_disposable`.
- The target is not the database in `DATABASE_URL`.
- The dump does not contain `CREATE DATABASE`, `DROP DATABASE`, `USE` of another database, `LOAD_FILE`, or `INTO OUTFILE`.
- `--execute` was passed. Without it, the script does not connect.
- The MySQL server has no user database other than the empty drill database.

The script does not drop databases or tables. It does not read `DATABASE_URL` as the restore target.

## INFERRED

Nothing in this note treats the launch-ops audit sentences as proof of the current Railway project. The code path on `main` can delete when retention is enabled. Reading `JOYSTICK_RETENTION_ENABLED` from GitHub Actions returned HTTP 403, so whether that variable is `1` is unknown.

## UNKNOWN (not seen in Railway)

This session did not call Railway. These are unknown:

- Whether a volume backup schedule is on.
- Whether any completed backup exists.
- Whether the running MySQL service is still single-node.
- Whether the running MySQL start command still includes `--disable-log-bin`.
- Whether point-in-time recovery is enabled.
- The production MySQL version.

Do not treat a backup as existing until a person sees a completed backup in Railway.

## Founder action if the Railway backup is still off

In the Railway dashboard, on the production MySQL service:

1. Open the mounted volume's Backups controls.
2. Enable a **Daily** scheduled volume backup.
3. Do not replace, recreate, or restore over the production volume.
4. Wait until a completed backup is visible in that Backups list.
5. Restore that backup only into a separate volume or service, then record the date, source backup time, restored identity, and what was verified.
6. Remove the temporary restore copy only after that record exists.

Point-in-time recovery is a separate change. The launch-ops document says the current custom start command disables binary logging, so do not convert the service automatically and do not combine that change with a schema or application deploy.

## Local disposable drill

After a dump exists from a copy, not from a command aimed at production:

```sh
node scripts/disposable-restore-drill.mjs \
  --target 'mysql://drill@127.0.0.1:3306/joystick_restore_drill'

node scripts/disposable-restore-drill.mjs --execute \
  --dump ./backup.sql \
  --target 'mysql://drill@127.0.0.1:3306/joystick_restore_drill'
```

Use a MySQL server that has no other user databases. The first command does not connect. The second refuses production targets and refuses a server that already holds another database. Do not point it at a port-forward of production. A populated server is refused because another database is present. An empty server reached through localhost cannot be distinguished from a disposable local server.
