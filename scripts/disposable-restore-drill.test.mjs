import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  assessRestoreTarget,
  classifyDisposableServer,
  scanDumpFile,
  scanDumpLine,
} from "./disposable-restore-drill.mjs";

const LOCAL = "mysql://drill:super-secret@127.0.0.1:3306/joystick_restore_drill";
const scriptPath = new URL("./disposable-restore-drill.mjs", import.meta.url);

function combined(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

test("local disposable target is accepted and the password is not part of the public result", () => {
  const result = assessRestoreTarget({
    targetUrl: LOCAL,
    env: { DATABASE_URL: "mysql://app:other@127.0.0.1:3306/app" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.target.host, "127.0.0.1");
  assert.equal(result.target.database, "joystick_restore_drill");
  const published = JSON.stringify({ ok: result.ok, reasons: result.reasons, host: result.target.host });
  assert.equal(published.includes("super-secret"), false);
});

test("RAILWAY_ENVIRONMENT=production refuses even a loopback target", () => {
  const result = assessRestoreTarget({
    targetUrl: LOCAL,
    env: { RAILWAY_ENVIRONMENT: "production" },
  });
  assert.equal(result.ok, false);
  assert.match(result.reasons.join("\n"), /RAILWAY_ENVIRONMENT is production/);
});

test("RAILWAY_ENVIRONMENT_NAME=production refuses a loopback target", () => {
  const result = assessRestoreTarget({
    targetUrl: "mysql://drill@localhost:3306/joystick_restore_drill",
    env: { RAILWAY_ENVIRONMENT_NAME: " Production " },
  });
  assert.equal(result.ok, false);
  assert.match(result.reasons.join("\n"), /RAILWAY_ENVIRONMENT_NAME is production/);
});

test("production and non-local hostnames are refused", () => {
  const samples = [
    "mysql://user:secret@monorail.proxy.rlwy.net:43111/railway",
    "mysql://user:secret@mysql.railway.internal:3306/railway",
    "mysql://user:secret@db.bldg.chat:3306/production",
    "mysql://user:secret@mydb.abcdefghijkl.us-west-2.rds.amazonaws.com:3306/app",
    "mysql://user:secret@10.1.2.3:3306/joystick_restore_drill",
  ];
  for (const targetUrl of samples) {
    const result = assessRestoreTarget({ targetUrl, env: {} });
    assert.equal(result.ok, false, targetUrl);
    assert.match(result.reasons.join("\n"), /not local|looks like production/);
    assert.equal(JSON.stringify(result.reasons).includes("secret"), false);
  }
});

test("a matching DATABASE_URL is refused as a live database", () => {
  const result = assessRestoreTarget({
    targetUrl: LOCAL,
    env: { DATABASE_URL: "mysql://other:pw@127.0.0.1:3306/joystick_restore_drill" },
  });
  assert.equal(result.ok, false);
  assert.match(result.reasons.join("\n"), /DATABASE_URL/);
});

test("a non-disposable database name is refused", () => {
  const result = assessRestoreTarget({
    targetUrl: "mysql://drill@127.0.0.1:3306/railway",
    env: {},
  });
  assert.equal(result.ok, false);
  assert.match(result.reasons.join("\n"), /_drill or _disposable/);
});

test("classifyDisposableServer allows only an empty server or the empty drill database", () => {
  assert.equal(classifyDisposableServer(["mysql", "information_schema"], "joystick_restore_drill").action, "create");
  assert.equal(
    classifyDisposableServer(["mysql", "joystick_restore_drill"], "joystick_restore_drill").action,
    "load_if_empty"
  );
  assert.equal(classifyDisposableServer(["railway"], "joystick_restore_drill").action, "refuse");
  assert.equal(
    classifyDisposableServer(["joystick_restore_drill", "app"], "joystick_restore_drill").action,
    "refuse"
  );
});

test("dump scanner rejects statements that can leave the disposable database", () => {
  const state = { inBlockComment: false };
  assert.equal(scanDumpLine("CREATE DATABASE `railway`;", "joystick_restore_drill", state).reasons.length, 1);
  assert.match(
    scanDumpLine("DROP DATABASE production;", "joystick_restore_drill", state).reasons.join("\n"),
    /DROP DATABASE/
  );
  assert.match(
    scanDumpLine("USE `railway`;", "joystick_restore_drill", state).reasons.join("\n"),
    /USE/
  );
  assert.equal(scanDumpLine("USE `joystick_restore_drill`;", "joystick_restore_drill", state).reasons.length, 0);
  assert.match(
    scanDumpLine("SELECT LOAD_FILE('/etc/passwd');", "joystick_restore_drill", state).reasons.join("\n"),
    /server file/
  );
});

test("cli refuses a production target before a missing dump or mysql client matters", () => {
  const result = spawnSync(
    process.execPath,
    [
      scriptPath.pathname,
      "--execute",
      "--dump",
      "/no/such/production-backup.sql",
      "--target",
      "mysql://user:secret@containers-us-west-1.railway.app:3306/production",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, PATH: "/nonexistent", RAILWAY_ENVIRONMENT: "production" },
    }
  );
  assert.equal(result.status, 2);
  const output = combined(result);
  assert.match(output, /refused/);
  assert.match(output, /RAILWAY_ENVIRONMENT is production/);
  assert.equal(output.includes("secret"), false);
  assert.doesNotMatch(output, /mysql client/);
});

test("cli check does not connect or require mysql for a safe target", () => {
  const result = spawnSync(
    process.execPath,
    [scriptPath.pathname, "--target", LOCAL],
    { encoding: "utf8", env: { ...process.env, PATH: "/nonexistent", DATABASE_URL: "" } }
  );
  assert.equal(result.status, 0, combined(result));
  assert.match(combined(result), /No database was changed/);
  assert.equal(combined(result).includes("super-secret"), false);
});

test("cli refuses an unsafe dump before loading it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "restore-drill-dump-"));
  const dump = join(dir, "unsafe.sql");
  writeFileSync(dump, "CREATE DATABASE railway;\nUSE railway;\n");
  try {
    const fileReasons = await scanDumpFile(dump, "joystick_restore_drill");
    assert.ok(fileReasons.some(reason => /CREATE DATABASE|USE/.test(reason)));
    const result = spawnSync(
      process.execPath,
      [scriptPath.pathname, "--execute", "--dump", dump, "--target", LOCAL],
      { encoding: "utf8", env: { ...process.env, PATH: "/nonexistent", DATABASE_URL: "" } }
    );
    assert.equal(result.status, 2);
    assert.match(combined(result), /refused/);
    assert.doesNotMatch(combined(result), /mysql client/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("module URL stays a file URL for the direct-invocation guard", () => {
  assert.equal(pathToFileURL(scriptPath.pathname).protocol, "file:");
});
