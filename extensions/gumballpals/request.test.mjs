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


test("worker GET requests omit undefined arguments at the Chrome scripting boundary", async () => {
 const {runInTab}=await import("./browser.js");
 const calls=[];
 globalThis.chrome={scripting:{executeScript:async options=>{assert.ok(options.args.every(value=>value!==undefined));calls.push(options.args);return [{frameId:0,result:{ok:true,value:"ok"}}];}}};
 try {
 await runInTab(42,()=>{},["intake.connection",undefined]);
 await runInTab(42,()=>{},["pickups.connection",undefined]);
 await runInTab(42,()=>{},["intake.claim",{bindingId:"fixture"}]);
 assert.deepEqual(calls,[["intake.connection"],["pickups.connection"],["intake.claim",{bindingId:"fixture"}]]);
 } finally {delete globalThis.chrome;}
});
