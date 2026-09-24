import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const textExt = new Set([".ts",".tsx",".js",".jsx",".mjs",".cjs",".json",".md",".mdx",".html",".css",".scss",".yml",".yaml",".sql",".sh",".svg",".txt",".rtf",".toml",".ini"]);

for (const file of files) {
  if (file.startsWith(".github/workflows/")) continue;
  if (!textExt.has(path.extname(file).toLowerCase()) && !["CLAUDE.md","package.json","vercel.json"].includes(path.basename(file))) continue;
  let content;
  try { content = fs.readFileSync(file, "utf8"); } catch { continue; }
  const original = content;

  for (;;) {
    const next = content
      .replace(/legacy-legacy-dayforge/gi, "legacy-dayforge")
      .replace(/legacyLegacyDayforge/g, "legacyDayforge")
      .replace(/LegacyLegacyDayforge/g, "LegacyDayforge");
    if (next === content) break;
    content = next;
  }

  if (content !== original) fs.writeFileSync(file, content);
}

fs.rmSync("scripts/normalize-retired-name.mjs");
