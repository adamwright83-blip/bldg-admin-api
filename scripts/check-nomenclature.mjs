/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const needle = ["day", "forge"].join("");
const marker = ["LEGACY DAY", "FORGE COMPATIBILITY"].join("");
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const violations = [];
const binaryExt = /\.(?:png|jpe?g|webp|gif|ico|mp4|mov|wav|mp3|woff2?|ttf|otf|pdf|zip)$/i;

function pathClearlyLegacy(p) {
  const lower = p.toLowerCase();
  if (!lower.includes(needle)) return true;
  if (/legacy[-_/]?dayforge|legacydayforge/.test(lower)) return true;
  if (new RegExp("^drizzle/004[2-5]_" + needle + "_").test(lower)) return true;
  return false;
}

for (const file of files) {
  if (!pathClearlyLegacy(file)) violations.push("ambiguous path: " + file);
  if (binaryExt.test(file)) continue;

  let content;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (!content.toLowerCase().includes(needle)) continue;

  const hasMarker = content.includes(marker);
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.toLowerCase().includes(needle)) continue;
    if (line.toLowerCase().includes("legacy")) continue;
    if (hasMarker) continue;
    if (file === "vercel.json" && new RegExp('"/' + needle).test(line)) continue;
    violations.push(file + ":" + (i + 1) + ": unqualified retired name");
  }
}

if (violations.length) {
  console.error("Nomenclature semantic-hygiene violations:");
  for (const v of violations) console.error(" - " + v);
  process.exit(1);
}
console.log("Nomenclature semantic hygiene: clean.");
