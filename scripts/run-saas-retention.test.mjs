import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveRetentionMode, runRetention } from "./run-saas-retention.mjs";

const secret = "retention-secret-value";

function enabledEnv(overrides = {}) {
  return {
    JOYSTICK_RETENTION_ENABLED: "1",
    JOYSTICK_RETENTION_URL: "https://retention.example.test",
    JOYSTICK_RETENTION_SECRET: secret,
    JOYSTICK_RETENTION_DRY_RUN: "1",
    JOYSTICK_RETENTION_CONFIRM_DELETE: "0",
    GITHUB_EVENT_NAME: "schedule",
    ...overrides,
  };
}

test("scheduled and unconfirmed runs stay dry-run", () => {
  assert.deepEqual(resolveRetentionMode({ GITHUB_EVENT_NAME: "schedule" }), { action: "dry_run" });
  assert.equal(
    resolveRetentionMode({
      JOYSTICK_RETENTION_DRY_RUN: "1",
      GITHUB_EVENT_NAME: "schedule",
    }).action,
    "dry_run"
  );
  assert.equal(
    resolveRetentionMode({
      JOYSTICK_RETENTION_DRY_RUN: "0",
      JOYSTICK_RETENTION_CONFIRM_DELETE: "1",
      GITHUB_EVENT_NAME: "schedule",
    }).action,
    "refuse"
  );
  assert.equal(
    resolveRetentionMode({
      JOYSTICK_RETENTION_DRY_RUN: "0",
      JOYSTICK_RETENTION_CONFIRM_DELETE: "0",
      GITHUB_EVENT_NAME: "workflow_dispatch",
    }).action,
    "refuse"
  );
});

test("only a confirmed manual dispatch may delete", () => {
  assert.equal(
    resolveRetentionMode({
      JOYSTICK_RETENTION_DRY_RUN: "0",
      JOYSTICK_RETENTION_CONFIRM_DELETE: "1",
      GITHUB_EVENT_NAME: "workflow_dispatch",
    }).action,
    "delete"
  );
});

test("a refused live delete does not call the endpoint", async () => {
  let called = false;
  const code = await runRetention(
    enabledEnv({
      JOYSTICK_RETENTION_DRY_RUN: "0",
      JOYSTICK_RETENTION_CONFIRM_DELETE: "0",
      GITHUB_EVENT_NAME: "schedule",
    }),
    async () => {
      called = true;
      throw new Error("fetch should not run");
    }
  );
  assert.equal(code, 1);
  assert.equal(called, false);
});

test("an enabled dry-run posts dryRun true and does not print the secret", async () => {
  let body;
  let authorization;
  const code = await runRetention(enabledEnv(), async (_url, init) => {
    body = JSON.parse(init.body);
    authorization = init.headers.authorization;
    return {
      ok: true,
      async text() {
        return JSON.stringify({
          dryRun: true,
          batchLimit: 250,
          totalEligible: 0,
          resources: [],
          policyVersion: "test",
        });
      },
    };
  });
  assert.equal(code, 0);
  assert.equal(body.dryRun, true);
  assert.equal(authorization, `Bearer ${secret}`);
});

test("a confirmed manual dispatch posts dryRun false", async () => {
  let body;
  const code = await runRetention(
    enabledEnv({
      JOYSTICK_RETENTION_DRY_RUN: "0",
      JOYSTICK_RETENTION_CONFIRM_DELETE: "1",
      GITHUB_EVENT_NAME: "workflow_dispatch",
    }),
    async (_url, init) => {
      body = JSON.parse(init.body);
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            dryRun: false,
            batchLimit: 250,
            totalEligible: 1,
            resources: [{ resource: "rate_limit_buckets", eligible: 1, purged: 1 }],
            policyVersion: "test",
          });
        },
      };
    }
  );
  assert.equal(code, 0);
  assert.equal(body.dryRun, false);
});

test("the workflow cron cannot select a live delete by default", () => {
  const source = readFileSync(
    new URL("../.github/workflows/saas-retention.yml", import.meta.url),
    "utf8"
  );
  assert.match(source, /confirm_delete/);
  assert.doesNotMatch(source, /inputs\.dry_run && '1' \|\| '0'/);
  assert.match(source, /dry=1\n\s*confirm=0/);
  assert.match(source, /INPUT_DRY_RUN" = "false"/);
  assert.match(source, /INPUT_CONFIRM_DELETE" = "true"/);
  assert.match(source, /JOYSTICK_RETENTION_DRY_RUN=\$dry/);
  assert.match(source, /JOYSTICK_RETENTION_CONFIRM_DELETE=\$confirm/);
  assert.match(source, /cron: "17 11 \* \* \*"/);
});
