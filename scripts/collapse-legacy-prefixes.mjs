import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const files=execFileSync("git",["ls-files","-z"],{encoding:"utf8"}).split("\0").filter(Boolean);
const exts=new Set([".ts",".tsx",".js",".jsx",".mjs",".cjs",".json",".md",".mdx",".html",".css",".scss",".yml",".yaml",".sql",".sh",".svg",".txt",".rtf",".toml",".ini"]);
for(const file of files){
  if(file.startsWith(".github/workflows/")) continue;
  if(!exts.has(path.extname(file).toLowerCase()) && !["CLAUDE.md","package.json","vercel.json"].includes(path.basename(file))) continue;
  let c;
  try{c=fs.readFileSync(file,"utf8");}catch{continue;}
  const before=c;
  for(;;){
    const next=c
      .replace(/legacyLegacyDayforge/g,"legacyDayforge")
      .replace(/LegacyLegacyDayforge/g,"LegacyDayforge")
      .replace(/legacy-legacy-dayforge/g,"legacy-dayforge");
    if(next===c) break;
    c=next;
  }
  if(c!==before) fs.writeFileSync(file,c);
}
fs.rmSync("scripts/collapse-legacy-prefixes.mjs");
