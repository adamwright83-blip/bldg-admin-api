#!/usr/bin/env node
/**
 * Stage the standalone proof build for a claude.ai artifact.
 *
 *   npx vite build --config vite.coastal-proof-preview.config.ts
 *   node scripts/coastal-proof/stageArtifact.mjs <out-dir>
 *
 * The artifact host wraps the page in its own <html>/<head>/<body>, so the
 * staged index.html is the page content only (title, style, root, scripts).
 * Artifacts do not serve .glb, so each GLB ships as `<name>.glb.json`
 * ({ "data": base64 }); the runtime falls back to it when `<name>.glb` 404s.
 * Prints the supporting-file map to pass as the Artifact tool's `files`.
 */
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const SRC = resolve("tmp/coastal-proof-preview-build");
const OUT = resolve(process.argv[2] ?? "tmp/coastal-proof-artifact");

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(SRC, OUT, { recursive: true });

const html = await readFile(join(SRC, "index.html"), "utf8");
const head = html.slice(html.indexOf("<head>") + 6, html.indexOf("</head>"));
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
const keep = head
  .split("\n")
  .filter(line => !/<meta charset|<meta name="viewport"/.test(line))
  .join("\n");
const fragment = `${keep.trim()}\n${body.trim()}\n`;
await writeFile(join(OUT, "index.html"), fragment);

for (const file of await walk(OUT)) {
  if (file.endsWith(".glb")) {
    const data = (await readFile(file)).toString("base64");
    await writeFile(`${file}.json`, JSON.stringify({ format: "glb-base64", data }));
    await rm(file);
  }
}

const files = {};
for (const file of await walk(OUT)) {
  const rel = relative(OUT, file);
  if (rel !== "index.html") files[rel] = file;
}
console.log(JSON.stringify({ file_path: join(OUT, "index.html"), files }, null, 2));
