import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const sh = (args, opts = {}) => execFileSync("git", args, { encoding: "utf8", ...opts });
const tracked = () => sh(["ls-files", "-z"]).split("\0").filter(Boolean);
const retiredNeedle = ["day", "forge"].join("");
const marker = "LEGACY DAYFORGE COMPATIBILITY";
const markerSentence =
  marker +
  ": retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md.";

const immutableHistoricalPath = p =>
  p.startsWith(".github/workflows/") ||
  /^drizzle\/004[2-5]_dayforge_/i.test(p) ||
  p === "docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md";

function renamedPath(p) {
  if (!/dayforge/i.test(p) || immutableHistoricalPath(p)) return p;
  return p
    .replace(/dayforgeflagship/g, "__RETIRED_FLAGSHIP__")
    .replace(/Dayforge/g, "LegacyDayforge")
    .replace(/dayforge(?=[A-Z])/g, "legacyDayforge")
    .replace(/dayforge/g, "legacy-dayforge")
    .replace(/__RETIRED_FLAGSHIP__/g, "legacy-dayforge-flagship");
}

const before = tracked();
const moves = before
  .map(oldPath => ({ oldPath, newPath: renamedPath(oldPath) }))
  .filter(x => x.oldPath !== x.newPath);

for (const { oldPath, newPath } of moves) {
  if (fs.existsSync(newPath)) throw new Error("rename collision: " + oldPath + " -> " + newPath);
  fs.mkdirSync(path.dirname(newPath), { recursive: true });
  sh(["mv", oldPath, newPath]);
}

const replacements = new Map();
for (const { oldPath, newPath } of moves) {
  replacements.set(oldPath, newPath);
  const oldBase = path.basename(oldPath);
  const newBase = path.basename(newPath);
  if (oldBase !== newBase && oldBase.toLowerCase() !== retiredNeedle) replacements.set(oldBase, newBase);
  const oldDir = path.dirname(oldPath);
  const newDir = path.dirname(newPath);
  if (oldDir !== newDir && /dayforge/i.test(oldDir)) replacements.set(oldDir, newDir);
  const oldParts = oldPath.split("/");
  const newParts = newPath.split("/");
  for (let i = 0; i < Math.min(oldParts.length, newParts.length); i += 1) {
    if (oldParts[i] !== newParts[i] && oldParts[i].toLowerCase() !== retiredNeedle) {
      replacements.set(oldParts[i], newParts[i]);
    }
  }
}
const replacementPairs = [...replacements.entries()].sort((a, b) => b[0].length - a[0].length);

const textExt = new Set([
  ".ts",".tsx",".js",".jsx",".mjs",".cjs",".json",".md",".mdx",".html",".css",".scss",
  ".yml",".yaml",".sql",".sh",".svg",".txt",".rtf",".toml",".ini"
]);

function isTextFile(p) {
  return textExt.has(path.extname(p).toLowerCase()) || ["CLAUDE.md","package.json","vercel.json"].includes(path.basename(p));
}

function prependBanner(file, content) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".json") return content;
  if (ext === ".md" || ext === ".mdx") {
    return "> **" + marker + ":** Retained historical literals in this file are compatibility/history only; they are not current architecture. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md.\n\n" + content;
  }
  if (ext === ".html" || ext === ".svg") return "<!-- " + markerSentence + " -->\n" + content;
  if (ext === ".sql") return "-- " + markerSentence + "\n" + content;
  if (ext === ".yml" || ext === ".yaml" || ext === ".toml" || ext === ".ini") return "# " + markerSentence + "\n" + content;
  if (ext === ".sh") {
    if (content.startsWith("#!")) {
      const nl = content.indexOf("\n");
      if (nl >= 0) return content.slice(0, nl + 1) + "# " + markerSentence + "\n" + content.slice(nl + 1);
    }
    return "# " + markerSentence + "\n" + content;
  }
  return "/* " + markerSentence + " */\n" + content;
}

for (const file of tracked()) {
  if (file.startsWith(".github/workflows/")) continue;
  if (!isTextFile(file)) continue;
  let content = fs.readFileSync(file, "utf8");
  const original = content;

  for (const [from, to] of replacementPairs) content = content.split(from).join(to);

  content = content
    .replace(/\bDayforge(?=[A-Z0-9_]|\b)/g, "LegacyDayforge")
    .replace(/\bdayforge(?=[A-Z0-9])/g, "legacyDayforge")
    .replace(/(?<!\/)\bdayforge-(?=[a-z0-9])/g, "legacy-dayforge-")
    .replace(/\btest:dayforge:/g, "test:legacy-dayforge:")
    .replace(/\bcheck:dayforge:/g, "check:legacy-dayforge:")
    .replace(/\bdb:dayforge:/g, "db:legacy-dayforge:")
    .replace(/\bdayforge:migrations:/g, "legacy-dayforge:migrations:")
    .replace(/\bdayforge:demo/g, "legacy-dayforge:demo");

  if (file === ".github/workflows/legacy-dayforge-release.yml") {
    content = content
      .replace(/^name:\s*DayForge release gates$/m, "name: Legacy compatibility release gates")
      .replace(/Run deterministic DayForge contracts/g, "Run deterministic legacy compatibility contracts")
      .replace(/dayforge_release/g, "legacy_dayforge_release");
  }

  if (file === "package.json") {
    const pkg = JSON.parse(content);
    pkg.scripts ??= {};
    pkg.scripts["check:nomenclature"] = "node scripts/check-nomenclature.mjs";
    content = JSON.stringify(pkg, null, 2) + "\n";
  }

  if (new RegExp(retiredNeedle, "i").test(content) && !content.includes(marker)) {
    content = prependBanner(file, content);
  }

  if (content !== original) fs.writeFileSync(file, content);
}

for (const file of tracked().filter(p => /^drizzle\/004[2-5]_dayforge_/i.test(p))) {
  let content = fs.readFileSync(file, "utf8");
  if (!content.includes(marker)) fs.writeFileSync(file, "-- " + markerSentence + "\n" + content);
}

if (fs.existsSync("scripts/migrate-retired-product-name.mjs")) {
  fs.rmSync("scripts/migrate-retired-product-name.mjs");
}

console.log(JSON.stringify({ moved: moves.length, replacements: replacementPairs.length }, null, 2));
