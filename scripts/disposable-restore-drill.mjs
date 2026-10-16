#!/usr/bin/env node
/**
 * Disposable-only MySQL restore drill.
 *
 * Loads a logical dump into an empty local database whose name ends in
 * `_drill` or `_disposable`. Refuses to run when the target looks like
 * production: a production hostname, RAILWAY_ENVIRONMENT=production,
 * RAILWAY_ENVIRONMENT_NAME=production, or any non-local database.
 *
 * The script never reads DATABASE_URL as the restore target. It refuses when
 * the target is that configured database, and it refuses a server that already
 * has any other user database. It does not drop databases or tables.
 *
 * Check only (no connection, no restore):
 *   node scripts/disposable-restore-drill.mjs \
 *     --target 'mysql://drill@127.0.0.1:3306/joystick_restore_drill'
 *
 * Execute against a disposable local server with no other user databases:
 *   node scripts/disposable-restore-drill.mjs --execute \
 *     --dump ./backup.sql \
 *     --target 'mysql://drill@127.0.0.1:3306/joystick_restore_drill'
 */

import { spawn } from "node:child_process";
import { createReadStream, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const SYSTEM_SCHEMAS = new Set([
  "information_schema",
  "mysql",
  "performance_schema",
  "sys",
]);
const DISPOSABLE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,62}(?:_drill|_disposable)$/;

export function assessRestoreTarget({ targetUrl, env = {} } = {}) {
  const reasons = [];
  if (isProductionValue(env.RAILWAY_ENVIRONMENT)) {
    reasons.push("RAILWAY_ENVIRONMENT is production");
  }
  if (isProductionValue(env.RAILWAY_ENVIRONMENT_NAME)) {
    reasons.push("RAILWAY_ENVIRONMENT_NAME is production");
  }

  if (targetUrl == null || String(targetUrl).trim() === "") {
    reasons.push(
      "restore target is missing; pass --target or set RESTORE_DRILL_DATABASE_URL"
    );
    return { ok: false, reasons, target: null };
  }

  let target;
  try {
    target = parseMysqlUrl(String(targetUrl));
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : "invalid restore target");
    return { ok: false, reasons, target: null };
  }

  if (!LOCAL_HOSTS.has(target.host)) {
    reasons.push(`database host ${target.host} is not local`);
  }
  if (productionHostReason(target.host)) {
    reasons.push(productionHostReason(target.host));
  }
  if (!DISPOSABLE_NAME.test(target.database)) {
    reasons.push(
      "database name must end in _drill or _disposable and contain only letters, numbers, and underscores"
    );
  }
  if (target.socketOverride) {
    reasons.push("restore target must not select a socket or alternate host");
  }

  const liveUrl = env.DATABASE_URL;
  if (liveUrl != null && String(liveUrl).trim() !== "") {
    try {
      const live = parseMysqlUrl(String(liveUrl));
      if (sameDatabase(target, live)) {
        reasons.push(
          "target matches DATABASE_URL; refusing to restore over the configured database"
        );
      }
    } catch {
      reasons.push(
        "DATABASE_URL is set but could not be parsed; refusing because the live database cannot be distinguished"
      );
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    target: {
      host: target.host,
      port: target.port,
      database: target.database,
      user: target.user,
      password: target.password,
    },
  };
}

export function classifyDisposableServer(schemaNames, drillName) {
  const userSchemas = [];
  for (const name of schemaNames) {
    const trimmed = String(name ?? "").trim();
    if (!trimmed || SYSTEM_SCHEMAS.has(trimmed.toLowerCase())) continue;
    userSchemas.push(trimmed);
  }
  if (userSchemas.length === 0) {
    return { action: "create", reason: null };
  }
  const sameDrill = userSchemas.filter(
    name => name.toLowerCase() === drillName.toLowerCase()
  );
  if (userSchemas.length === sameDrill.length && sameDrill.length === 1) {
    return { action: "load_if_empty", reason: null };
  }
  return {
    action: "refuse",
    reason:
      "MySQL server already has a database other than the disposable drill database; no restore was attempted",
  };
}

export function scanDumpLine(line, databaseName, state) {
  const reasons = [];
  let visible = line;
  if (state.inBlockComment) {
    const end = visible.indexOf("*/");
    if (end === -1) return { reasons, state };
    visible = visible.slice(end + 2);
    state = { inBlockComment: false };
  }
  while (visible.includes("/*")) {
    const start = visible.indexOf("/*");
    const end = visible.indexOf("*/", start + 2);
    if (end === -1) {
      visible = visible.slice(0, start);
      state = { inBlockComment: true };
      break;
    }
    visible = `${visible.slice(0, start)} ${visible.slice(end + 2)}`;
  }
  if (visible.includes("\0")) {
    reasons.push("dump is not a plain SQL text file");
  }
  const trimmed = visible.replace(/--.*$/, "").trim();
  if (!trimmed) return { reasons, state };
  if (/\bCREATE\s+DATABASE\b/i.test(trimmed)) {
    reasons.push("dump contains CREATE DATABASE");
  }
  if (/\bDROP\s+DATABASE\b/i.test(trimmed)) {
    reasons.push("dump contains DROP DATABASE");
  }
  if (/\bINTO\s+OUTFILE\b/i.test(trimmed) || /\bLOAD_FILE\s*\(/i.test(trimmed)) {
    reasons.push("dump contains a server file read or write");
  }
  if (/^SOURCE\b/i.test(trimmed) || /^\\[.]/.test(trimmed)) {
    reasons.push("dump contains a mysql client command");
  }
  if (/^USE\b/i.test(trimmed)) {
    const match = trimmed.match(/^USE\s+`?([A-Za-z0-9_]+)`?\s*;?$/i);
    if (!match || match[1].toLowerCase() !== databaseName.toLowerCase()) {
      reasons.push("dump contains USE for a database other than the disposable target");
    }
  }
  return { reasons, state };
}

export async function scanDumpFile(filePath, databaseName) {
  const reasons = new Set();
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let state = { inBlockComment: false };
  try {
    for await (const line of lines) {
      const scanned = scanDumpLine(line, databaseName, state);
      state = scanned.state;
      for (const reason of scanned.reasons) reasons.add(reason);
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return [...reasons];
}

function isProductionValue(value) {
  return String(value ?? "").trim().toLowerCase() === "production";
}

function productionHostReason(host) {
  const value = host.toLowerCase();
  if (
    value.includes("railway") ||
    value.includes("rlwy") ||
    value.endsWith(".internal") ||
    value.includes("bldg.chat") ||
    value.includes("amazonaws.com") ||
    value.split(".").includes("production")
  ) {
    return `database host ${host} looks like production`;
  }
  return null;
}

function parseMysqlUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("restore target URL is invalid");
  }
  if (url.protocol !== "mysql:" && url.protocol !== "mysql2:") {
    throw new Error("restore target must be a mysql URL");
  }
  const host = (url.hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (database.includes("/") || database.includes("\\")) {
    throw new Error("restore target database name is invalid");
  }
  const keys = [...url.searchParams.keys()];
  const socketOverride = keys.some(key => /socket|host|pipe/i.test(key));
  const port = url.port ? Number(url.port) : 3306;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("restore target port is invalid");
  }
  const user = decodeURIComponent(url.username || "");
  if (!user) throw new Error("restore target username is missing");
  let password = "";
  if (url.password) {
    password = decodeURIComponent(url.password);
    if (/[\r\n\0]/.test(password) || /[\r\n\0]/.test(user)) {
      throw new Error("restore target credentials contain a newline");
    }
  }
  return { host, port, database, user, password, socketOverride };
}

function sameDatabase(left, right) {
  return (
    left.host === right.host &&
    left.port === right.port &&
    left.database.toLowerCase() === right.database.toLowerCase()
  );
}

function quoteCnf(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function writeClientDefaults(target) {
  const dir = mkdtempSync(join(tmpdir(), "restore-drill-"));
  const file = join(dir, "client.cnf");
  const lines = [
    "[client]",
    `host=${quoteCnf(target.host)}`,
    `port=${target.port}`,
    `user=${quoteCnf(target.user)}`,
    "protocol=TCP",
    "connect-timeout=5",
  ];
  if (target.password) lines.push(`password=${quoteCnf(target.password)}`);
  writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
  return {
    dir,
    file,
    remove() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function runMysql(defaultsFile, args, inputPath) {
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(
      "mysql",
      [`--defaults-extra-file=${defaultsFile}`, "--batch", "--skip-column-names", ...args],
      { stdio: [inputPath ? "pipe" : "ignore", "pipe", "pipe"], shell: false }
    );
    let stdout = "";
    let stderr = "";
    if (inputPath) {
      const input = createReadStream(inputPath);
      input.pipe(child.stdin);
      input.on("error", () => child.kill());
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout = `${stdout}${chunk}`.slice(-4000);
    });
    child.stderr.on("data", chunk => {
      stderr = `${stderr}${chunk}`.slice(-2000);
    });
    child.on("error", error => {
      finish({
        status: 127,
        stdout,
        stderr: error.code === "ENOENT" ? "mysql client is not available" : "mysql client failed to start",
      });
    });
    child.on("close", status => finish({ status: status ?? 1, stdout, stderr }));
  });
}

async function assertDisposableServer(target, defaultsFile) {
  if (!DISPOSABLE_NAME.test(target.database)) {
    return { ok: false, code: 2, message: "drill database name is not disposable; no restore was attempted" };
  }
  const listed = await runMysql(defaultsFile, [
    "--execute",
    "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name",
  ]);
  if (listed.status === 127) {
    return { ok: false, code: 1, message: "mysql client is not available; no restore was attempted" };
  }
  if (listed.status !== 0) {
    return {
      ok: false,
      code: 1,
      message: "could not inspect the disposable MySQL server; no restore was attempted",
    };
  }
  const names = listed.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const classified = classifyDisposableServer(names, target.database);
  if (classified.action === "refuse") {
    return { ok: false, code: 2, message: classified.reason };
  }
  if (classified.action === "create") {
    const created = await runMysql(defaultsFile, [
      "--execute",
      `CREATE DATABASE \`${target.database}\``,
    ]);
    if (created.status !== 0) {
      return {
        ok: false,
        code: 1,
        message: "could not create the empty drill database; no dump was loaded",
      };
    }
    return { ok: true };
  }
  const counted = await runMysql(defaultsFile, [
    "--execute",
    `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${target.database}' AND table_type = 'BASE TABLE'`,
  ]);
  if (counted.status !== 0) {
    return { ok: false, code: 1, message: "could not count drill tables; no dump was loaded" };
  }
  const count = Number(counted.stdout.trim().split(/\r?\n/).pop());
  if (!Number.isFinite(count) || count !== 0) {
    return {
      ok: false,
      code: 2,
      message: "drill database is not empty; refusing to restore over an existing database",
    };
  }
  return { ok: true };
}

function printRefusal(reasons) {
  console.error("Disposable restore drill refused.");
  for (const reason of reasons) console.error(`- ${reason}`);
}

export async function runRestoreDrill({ argv = process.argv.slice(2), env = process.env } = {}) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    console.log(helpText());
    return 0;
  }
  const targetUrl = parsed.target ?? env.RESTORE_DRILL_DATABASE_URL;
  const assessment = assessRestoreTarget({ targetUrl, env });
  if (!assessment.ok) {
    printRefusal(assessment.reasons);
    return 2;
  }
  const target = publicTarget(assessment.target);
  if (parsed.dump) {
    let dumpReasons;
    try {
      dumpReasons = await scanDumpFile(parsed.dump, assessment.target.database);
    } catch {
      printRefusal(["dump file is not readable; no restore was attempted"]);
      return 2;
    }
    if (dumpReasons.length) {
      printRefusal(dumpReasons);
      return 2;
    }
  }
  if (!parsed.execute) {
    console.log("Disposable restore drill check passed. No database was changed.");
    console.log(`target_host=${target.host}`);
    console.log(`target_port=${target.port}`);
    console.log(`target_database=${target.database}`);
    console.log("restore=not_run");
    return 0;
  }
  if (!parsed.dump) {
    printRefusal(["--execute requires --dump; no restore was attempted"]);
    return 2;
  }

  const defaults = writeClientDefaults(assessment.target);
  try {
    const ready = await assertDisposableServer(assessment.target, defaults.file);
    if (!ready.ok) {
      console.error(ready.message);
      return ready.code;
    }
    const loaded = await runMysql(
      defaults.file,
      ["--database", assessment.target.database],
      parsed.dump
    );
    if (loaded.status === 127) {
      console.error("mysql client is not available; no restore was attempted");
      return 1;
    }
    if (loaded.status !== 0) {
      console.error("restore into the disposable database failed");
      return 1;
    }
    console.log("Disposable restore drill loaded the dump into the empty local database.");
    console.log(`target_host=${target.host}`);
    console.log(`target_port=${target.port}`);
    console.log(`target_database=${target.database}`);
    return 0;
  } finally {
    defaults.remove();
  }
}

function publicTarget(target) {
  return { host: target.host, port: target.port, database: target.database };
}

function parseArgs(argv) {
  const parsed = { execute: false, help: false, target: undefined, dump: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--execute") parsed.execute = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--target") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("--target requires a mysql URL");
      parsed.target = value;
    } else if (arg === "--dump") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("--dump requires a file path");
      parsed.dump = value;
    }
    else throw new Error(`unknown argument: ${arg}`);
  }
  return parsed;
}

function helpText() {
  return [
    "Usage: node scripts/disposable-restore-drill.mjs [--execute] [--dump file.sql] [--target mysql://user@127.0.0.1:3306/name_drill]",
    "Without --execute the script only checks the target and does not connect.",
    "The target host must be localhost, 127.0.0.1, or ::1.",
    "The database name must end in _drill or _disposable.",
    "RAILWAY_ENVIRONMENT=production and RAILWAY_ENVIRONMENT_NAME=production are refused.",
  ].join("\n");
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runRestoreDrill().then(
    code => process.exit(code),
    error => {
      console.error(error instanceof Error ? error.message : "restore drill failed");
      process.exit(1);
    }
  );
}
