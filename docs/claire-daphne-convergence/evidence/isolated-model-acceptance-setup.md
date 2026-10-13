# Isolated live-model acceptance setup

The production service has an existing ANTHROPIC_API_KEY. Its value was not read into any artifact. Runtime logs identify Claire's served model as claude-sonnet-4-6. No new model request or phone call was made during this production inspection.

Use scripts/run-isolated-claire-model-acceptance.py to construct a fresh child environment. It keeps only the model credential, basic process paths, explicit test flags, and CLAIRE_ACCEPTANCE_DB_URL after checking that the database hostname is local. It does not pass the production database URL, Twilio credentials/phone numbers, email credentials, OpenAI key, or Railway variable collection to the child.

With CLAIRE_ACCEPTANCE_DB_URL already set to the disposable local database, run from the integrated worktree:

```sh
RAILWAY_CALLER=skill:use-railway@1.6.1 \
RAILWAY_AGENT_SESSION=railway-skill-issue565-production-evidence \
railway run --no-local \
  -p 293ee4d1-ee4f-4701-8a56-18ad120009a2 \
  -e 330bff45-7d21-4cdf-be04-b38cea76fcfb \
  -s 9d63863a-2626-47a0-bd65-c3ba8db54258 \
  -- python3 scripts/run-isolated-claire-model-acceptance.py \
  pnpm exec tsx <reviewed-live-acceptance-harness.ts>
```

Replace the harness placeholder with the integrated acceptance harness once it is ready. The command was inspected against Railway CLI 5.66.0 help. The wrapper was syntax checked; this setup has not yet executed a live provider test.

Seed the isolated database with tenant default, OpenID adam-admin and user id 1 to exercise Brain V2's real production-operator guard. The name is a production-shaped identity in the disposable local database. No phone binding or communication provider credentials may be installed there.

Before a live run, ensure that application imports cannot load a local .env restoring excluded credentials, and replace all call, SMS and email adapters with recording fakes. The real model is the sole intended external call. Review every default mutation hook, telemetry write and adaptation hook for local database scope. A harness's read-only label or stubbing only its primary commitment function does not certify isolation.

Daphne memory/adaptation flags are deliberately not copied from production. Set the desired test flags explicitly within the acceptance harness, after the local database and transport isolation assertions, to cover both enabled and disabled behavior.

