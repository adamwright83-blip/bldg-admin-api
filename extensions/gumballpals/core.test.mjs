import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  pacificToday,
  initialRange,
  validateRange,
  validateExportUrl,
  parseCsv,
  assertPairing,
  recoveryState,
} from "./core.js";
const range = { from: "2026-08-15", to: "2026-09-03" };
const url =
  "https://cleancloudapp.com/include/data-export-endpoint.php?type=1&d1=15&m1=08&y1=2026&d2=03&m2=09&y2=2026&stores=[123]&group=";
const header =
  "Order ID,Placed,Customer,Customer ID,Address,Paid,Payment Date,Total";
test("Pacific date is still Sep 3 when UTC is Sep 4", () => {
  assert.equal(pacificToday(new Date("2026-09-04T01:00:00Z")), "2026-09-03");
  assert.equal(initialRange(new Date("2026-09-04T01:00:00Z")).to, "2026-09-03");
});
test("rejects tomorrow, invalid dates, reversed and oversized windows", () => {
  for (const [from, to] of [
    ["2026-09-03", "2026-09-04"],
    ["2026-02-30", "2026-03-01"],
    ["2026-09-03", "2026-09-01"],
    ["2026-01-01", "2026-09-03"],
  ])
    assert.throws(() => validateRange(from, to, "2026-09-03"));
  assert.deepEqual(validateRange(range.from, range.to, "2026-09-03"), range);
});
test("only observed report endpoint, dates, and one numeric store are accepted", () => {
  assert.equal(validateExportUrl(url, range).storeId, "123");
  for (const bad of [
    url.replace("cleancloudapp.com", "evil.test"),
    url.replace("type=1", "type=2"),
    url.replace("[123]", "[123,456]"),
    url.replace("d1=15", "d1=16"),
    url + "&type=1",
    url + "&token=x",
    url.replace("group=", "group=all"),
  ])
    assert.throws(() => validateExportUrl(bad, range));
});
test("CSV supports BOM, quoted commas, embedded newlines, and escaped quotes", () => {
  const rows = parseCsv(
    "\ufeff" +
      header +
      '\r\n1,2026-08-20,"Example, Person",7,"line1\nline2",Yes,2026-08-21,"12.34"\r\n'
  );
  assert.equal(rows[0].Customer, "Example, Person");
  assert.equal(rows[0].Address, "line1\nline2");
});
test("rejects HTML, malformed/truncated CSV, duplicate headers and order IDs", () => {
  for (const bad of [
    "<html>Login</html>",
    header + '\n"truncated',
    header + "\n1,2",
    header + ",Total\n",
    header + "\n1,a,b,c,d,Yes,e,1\n1,a,b,c,d,Yes,e,1",
  ])
    assert.throws(() => parseCsv(bad));
  assert.deepEqual(parseCsv(header + "\n"), []);
});
test("pairing locks actor, tenant, store ID and label", () => {
  const binding = {
    tenantId: "one",
    actorId: "a",
    storeId: "123",
    storeLabel: "Example",
  };
  assert.doesNotThrow(() => assertPairing(binding, { ...binding }));
  for (const key of Object.keys(binding))
    assert.throws(() => assertPairing(binding, { ...binding, [key]: "other" }));
});
test("interrupted imports are unknown, never successful or automatically replayed", () => {
  assert.equal(recoveryState({ phase: "importing" }).phase, "outcome_unknown");
  assert.equal(recoveryState({ phase: "downloading" }).phase, "interrupted");
  assert.equal(recoveryState({ phase: "completed" }).phase, "completed");
});
test("permissions are scoped; no cookie, debugger, remote script or broad host access", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("./manifest.json", import.meta.url), "utf8")
  );
  assert.deepEqual(manifest.permissions, ["storage", "scripting", "downloads", "alarms"]);
  assert.deepEqual(manifest.optional_host_permissions, [
    "https://cleancloudapp.com/*",
    "https://admin.bldg.chat/*",
  ]);
  assert.equal(manifest.externally_connectable, undefined);
  const ui = await readFile(new URL("./sync.js", import.meta.url), "utf8");
  assert.ok(!ui.includes("innerHTML"));
});
