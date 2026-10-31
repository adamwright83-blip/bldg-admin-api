#!/usr/bin/env node
// Program E navigation guard. No runtime imports and no business behavior.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const map = JSON.parse(readFileSync(resolve(root, "docs/architecture/PROGRAM_E_OWNERSHIP_MAP.json"), "utf8"));
const bad = [];
const check = (condition, message) => { if (!condition) bad.push(message); };
check(map.schemaVersion === 1, "unknown ownership map format");
const expected = new Set();
for (const group of map.pathGroups) {
  for (const p of group.paths) {
    check(!expected.has(p), "duplicate directory: " + p);
    expected.add(p);
    check(existsSync(resolve(root, p)), "missing inventory directory: " + p);
  }
}
const current = readdirSync(resolve(root, "server"), { withFileTypes: true })
  .filter(d => d.isDirectory()).map(d => "server/" + d.name);
for (const p of current) check(expected.has(p), "unclassified server directory: " + p);
for (const p of expected) check(current.includes(p), "stale server directory in inventory: " + p);
const keys = new Set();
for (const c of map.concepts) {
  check(!keys.has(c.concept), "duplicate concept: " + c.concept);
  keys.add(c.concept);
  check(existsSync(resolve(root, c.writePath)), "missing owning write pointer for " + c.concept);
  check(existsSync(resolve(root, c.readPath)), "missing canonical/read pointer for " + c.concept);
}
for (const p of map.protectedWorkstreams.frozenPaths) {
  check(existsSync(resolve(root, p)), "missing protected Daphne path: " + p);
}
if (bad.length) { for (const e of bad) console.error("PROGRAM E MAP: " + e); process.exit(1); }
console.log("Program E map valid: " + expected.size + " current server directories; " + keys.size + " mapped concepts; " + map.protectedWorkstreams.frozenPaths.length + " protected Daphne paths.");
