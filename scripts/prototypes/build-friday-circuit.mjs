#!/usr/bin/env node
/**
 * Builds the clockwork prototype ("The Friday That Didn't Exist") into one self-contained page that anyone can open
 * and play: no server, no setup. Usage: node scripts/prototypes/build-friday-circuit.mjs [outDir]
 *
 * Writes <outDir>/friday-circuit.html (the page's content, for hosting where the host supplies the document) and
 * <outDir>/friday-circuit.local.html (a complete document, for opening from disk). Fonts come from Google Fonts;
 * everything else, Rook's placeholder art included, is inlined.
 */
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2] ?? "tmp/friday-circuit";
const result = await build({
  entryPoints: ["client/src/pages/prototypes/fridayCircuit/standalone.tsx"],
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  jsx: "automatic",
  write: false,
  outdir: "out",
  loader: { ".module.css": "local-css" },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
const js = result.outputFiles.find(file => file.path.endsWith(".js")).text;
const css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
const rook = readFileSync("client/public/assets/first-ten/crew/rook.webp").toString("base64");

const head = `<title>The Friday That Didn't Exist</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=Fraunces:ital,wght@0,500;0,600;1,400;1,500&display=swap">
<style>:root{color-scheme:dark}body{margin:0;background:#1d150f}${css}</style>`;
const body = `<div id="friday-circuit-root"></div>
<script>window.__FRIDAY_CIRCUIT_ROOK__="data:image/webp;base64,${rook}";</script>
<script>${js.replace(/<\/script/gi, "<\\/script")}</script>`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "friday-circuit.html"), `${head}\n${body}\n`);
writeFileSync(
  join(outDir, "friday-circuit.local.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">${head}</head><body>${body}</body></html>\n`
);
console.log(`friday-circuit: ${Math.round((head.length + body.length) / 1024)} KB → ${outDir}`);
