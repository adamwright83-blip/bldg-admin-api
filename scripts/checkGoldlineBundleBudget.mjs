#!/usr/bin/env node
/**
 * Slice 18 performance gate. Measures the built Goldline chunks against the
 * budget the product owner set explicitly:
 *
 *   main lazy Goldline runtime  < 150 KB gzip
 *   each encounter chunk        < 10 KB gzip, code-split
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

console.log("");
console.log(ok ? "[bundle-budget] OK" : "[bundle-budget] FAILED");
process.exit(ok ? 0 : 1);
