#!/usr/bin/env node
/**
 * Slice 18 performance gate. Measures the built Goldline chunks against the
 * budget the product owner set explicitly:
 *
 *   main lazy Goldline runtime  < 150 KB gzip
 *   each encounter chunk        < 10 KB gzip, code-split
 *   three.js                    only inside the lazy Coastal Market proof graph
 *
 * Run after `pnpm build`. Exits non-zero (and prints which chunk failed) if
 * any budget is exceeded, so a meaningful regression is caught in CI rather
 * than discovered by reading a build log.
 */
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ASSET_DIR = resolve(process.cwd(), "dist/public/assets");
const MAIN_BUDGET_BYTES = 150 * 1024;
const ENCOUNTER_BUDGET_BYTES = 10 * 1024;

const CHECKS = [
  { prefix: "GoldlineGameHome", suffix: ".js", budget: MAIN_BUDGET_BYTES, label: "Goldline main runtime" },
  { prefix: "GatekeeperEncounter", suffix: ".js", budget: ENCOUNTER_BUDGET_BYTES, label: "Gatekeeper encounter chunk" },
  { prefix: "GhostEncounter", suffix: ".js", budget: ENCOUNTER_BUDGET_BYTES, label: "Ghost encounter chunk" },
  { prefix: "StallerEncounter", suffix: ".js", budget: ENCOUNTER_BUDGET_BYTES, label: "Staller encounter chunk" },
];

function findAsset(prefix, suffix) {
  const files = readdirSync(ASSET_DIR);
  return files.find(file => file.startsWith(prefix) && file.endsWith(suffix)) ?? null;
}

let ok = true;
for (const check of CHECKS) {
  const file = findAsset(check.prefix, check.suffix);
  if (!file) {
    console.log(`  [FAIL] ${check.label}: no built asset matching '${check.prefix}*${check.suffix}' found`);
    ok = false;
    continue;
  }
  const gzipSize = gzipSync(readFileSync(resolve(ASSET_DIR, file))).length;
  const withinBudget = gzipSize <= check.budget;
  const kb = (bytes) => `${(bytes / 1024).toFixed(1)}KB`;
  console.log(
    `  [${withinBudget ? "PASS" : "FAIL"}] ${check.label}: ${file} = ${kb(gzipSize)} gzip (budget ${kb(check.budget)})`
  );
  if (!withinBudget) ok = false;
}

/*
 * three.js isolation. The file-size checks above cannot see the import graph,
 * so this walks it: three.js builds carry the `__THREE__` marker, and every
 * built chunk that contains it must belong to the lazy Coastal Market proof
 * graph. Neither the app entry nor GoldlineGameHome may reach it through
 * static imports, and index.html may not preload it.
 */
const THREE_MARKER = "__THREE__";
const PROOF_PREFIX = "CoastalMarketProofPage";
const jsFiles = readdirSync(ASSET_DIR).filter(file => file.endsWith(".js"));
const source = new Map(jsFiles.map(file => [file, readFileSync(resolve(ASSET_DIR, file), "utf8")]));
const staticImportsOf = file => {
  const deps = new Set();
  const text = source.get(file) ?? "";
  for (const match of text.matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/g)) deps.add(match[1]);
  return deps;
};
const staticClosure = entry => {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (!file || seen.has(file) || !source.has(file)) continue;
    seen.add(file);
    for (const dep of staticImportsOf(file)) stack.push(dep);
  }
  return seen;
};
const withThree = jsFiles.filter(file => source.get(file).includes(THREE_MARKER));
const proofEntry = jsFiles.find(file => file.startsWith(PROOF_PREFIX));
const appEntry = jsFiles.find(file => file.startsWith("app-"));
const mainRuntime = jsFiles.find(file => file.startsWith("GoldlineGameHome"));
const isolationFailures = [];
if (!proofEntry) isolationFailures.push(`no built '${PROOF_PREFIX}*.js' chunk found`);
if (withThree.length === 0) isolationFailures.push(`no chunk carries '${THREE_MARKER}' (is the proof still built?)`);
const proofGraph = proofEntry ? staticClosure(proofEntry) : new Set();
for (const file of withThree) {
  if (!proofGraph.has(file)) isolationFailures.push(`${file} contains three.js but is outside the proof graph`);
  for (const [other] of source) {
    if (other !== file && staticImportsOf(other).has(file) && !proofGraph.has(other)) {
      isolationFailures.push(`${other} statically imports three.js chunk ${file}`);
    }
  }
}
for (const [label, entry] of [["app entry", appEntry], ["Goldline main runtime", mainRuntime]]) {
  if (!entry) continue;
  const leaked = [...staticClosure(entry)].filter(file => withThree.includes(file));
  if (leaked.length) isolationFailures.push(`${label} ${entry} statically reaches three.js via ${leaked.join(", ")}`);
}
try {
  const html = readFileSync(resolve(ASSET_DIR, "..", "index.html"), "utf8");
  for (const file of withThree) if (html.includes(file)) isolationFailures.push(`index.html references ${file}`);
} catch {
  isolationFailures.push("dist/public/index.html not found");
}
// chunks the app entry already loads (React, shared helpers) are not the proof's cost
const appGraph = appEntry ? staticClosure(appEntry) : new Set();
const proofOnly = [...proofGraph].filter(file => !appGraph.has(file));
const proofGzip = proofOnly.reduce((sum, file) => sum + gzipSync(source.get(file)).length, 0);
const kb2 = bytes => `${(bytes / 1024).toFixed(1)}KB`;
if (isolationFailures.length) {
  for (const failure of isolationFailures) console.log(`  [FAIL] three.js isolation: ${failure}`);
  ok = false;
} else {
  console.log(
    `  [PASS] three.js isolation: three.js is only in ${withThree.join(", ")}, inside the lazy proof graph ` +
      `(proof-only chunks ${proofOnly.join(", ")} = ${kb2(proofGzip)} gzip); ` +
      `not statically reachable from ${appEntry} or ${mainRuntime}`
  );
}

console.log("");
console.log(ok ? "[bundle-budget] OK" : "[bundle-budget] FAILED");
process.exit(ok ? 0 : 1);
