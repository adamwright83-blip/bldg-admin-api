#!/usr/bin/env node
/**
 * Validates a corridor manifest against shared/corridorManifest.ts's zod
 * schema AND confirms every referenced asset/data file actually exists on
 * disk. Run against corridor_01 as the proof case, and against any future
 * corridor pack before it ships — a malformed manifest fails here, loudly
 * and specifically, instead of rendering corrupted in the browser.
 *
 * Usage: node scripts/validateCorridorManifest.mjs [corridorId]
 * Defaults to corridor_01.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCorridorManifest } from "../shared/corridorManifest.ts";

const corridorId = process.argv[2] ?? "corridor_01";
const corridorDir = resolve(process.cwd(), "client/public/assets/goldline", corridorId);
const manifestPath = resolve(corridorDir, "manifest.json");

if (!existsSync(manifestPath)) {
  console.error(`[validate-corridor] No manifest.json found for '${corridorId}' at ${manifestPath}`);
  process.exit(1);
}

const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
const result = parseCorridorManifest(raw);

let ok = true;
if (!result.success) {
  ok = false;
  console.log(`  [FAIL] manifest schema: ${result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
} else {
  console.log("  [PASS] manifest schema valid");
}

if (result.success) {
  const manifest = result.data;
  const checkFile = (label, relativePath) => {
    if (relativePath === null) {
      console.log(`  [SKIP] ${label}: not present (allowed to be null)`);
      return;
    }
    const full = resolve(corridorDir, relativePath);
    if (existsSync(full)) {
      console.log(`  [PASS] ${label}: ${relativePath}`);
    } else {
      ok = false;
      console.log(`  [FAIL] ${label}: ${relativePath} does not exist at ${full}`);
    }
  };

  checkFile("assets.far", manifest.assets.far);
  checkFile("assets.mid", manifest.assets.mid);
  checkFile("assets.foreground", manifest.assets.foreground);
  checkFile("assets.effects", manifest.assets.effects);
  checkFile("assets.portal", manifest.assets.portal);
  checkFile("assets.stronghold", manifest.assets.stronghold);
  checkFile("assets.waterfallVideo", manifest.assets.waterfallVideo);
  checkFile("data.traversal", manifest.data.traversal);
  checkFile("data.occlusion", manifest.data.occlusion);
  checkFile("data.goldRoute", manifest.data.goldRoute);
}

console.log("");
console.log(ok ? "[validate-corridor] OK" : "[validate-corridor] FAILED");
process.exit(ok ? 0 : 1);
