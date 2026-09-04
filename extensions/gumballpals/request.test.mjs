import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

test("actual UI request omits absent script arguments and preserves supplied payloads", async () => {
  const source = await readFile(new URL("./sync.js", import.meta.url), "utf8");
  const requestSource = source.slice(
    source.indexOf("const request ="),
    source.indexOf("const uuid =")
  );
  assert.ok(requestSource.startsWith("const request ="));
  const calls = [];
  const request = runInNewContext(`${requestSource}\nrequest;`, {
    goldlineTab: 42,
    goldlineRequest: () => {},
    runInTab: (tab, func, args) => {
      assert.equal(tab, 42);
      assert.ok(
        args.every(value => value !== undefined),
        "Chrome rejects undefined script arguments"
      );
      calls.push(JSON.parse(JSON.stringify(args)));
    },
  });
  request("context");
  request("context", undefined);
  request("receipt", { tenantId: "test", requestId: "test-request" });
  assert.deepEqual(calls, [
    ["context"],
    ["context"],
    ["receipt", { tenantId: "test", requestId: "test-request" }],
  ]);
});
