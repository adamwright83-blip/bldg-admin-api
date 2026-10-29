// Trims the Special Delivery preview build (vite.special-delivery-preview.config.ts) into a static folder a
// claude.ai artifact can hold: only the public files the courtyard uses, the 16.5 MB courtyard split into parts
// (one artifact file may be at most 15 MB; artifactGltfLoader.ts joins them), and asset URLs made relative so the
// page works wherever it is served.
//
//   npx vite build --config vite.special-delivery-preview.config.ts && node preview/special-delivery/package-artifact.mjs
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const out = path.join(root, "tmp/special-delivery-preview-build");
const allow = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "artifact-files.json"), "utf8")
);
const keepFiles = new Set(allow.files);
const keepDirs = allow.dirs ?? [];
const MAX_FILE = 15 * 1024 * 1024;
const PART = 9 * 1024 * 1024; // bytes per model part (12 MB of base64 text)

if (!existsSync(path.join(out, "index.html")))
  throw new Error(`no preview build at ${out}; run vite build first`);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}
function pruneEmpty(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) pruneEmpty(p);
  }
  if (dir !== out && readdirSync(dir).length === 0) rmdirSync(dir);
}

// 1. keep the page, vite's own chunks (hashed, at the top of assets/) and the courtyard's public files
let removed = 0;
for (const file of walk(out)) {
  const rel = path.relative(out, file).split(path.sep).join("/");
  const viteChunk = /^assets\/[^/]+\.(js|css)$/.test(rel);
  const keep =
    rel === "index.html" ||
    viteChunk ||
    keepFiles.has(rel) ||
    keepDirs.some(d => rel.startsWith(d));
  if (!keep) {
    rmSync(file);
    removed++;
  }
}
pruneEmpty(out);

// 2. models as base64 text in JSON parts, with a manifest (an artifact serves no .glb, and caps each file)
for (const glb of walk(out).filter(f => f.endsWith(".glb"))) {
  const bytes = readFileSync(glb);
  const parts = [];
  // whole 3-byte groups per part, so each part decodes on its own
  const step = PART - (PART % 3);
  for (let at = 0, i = 0; at < bytes.length; at += step, i++) {
    const name = `${path.basename(glb)}.part${i}.json`;
    writeFileSync(
      path.join(path.dirname(glb), name),
      JSON.stringify(
        bytes.subarray(at, Math.min(bytes.length, at + step)).toString("base64")
      )
    );
    parts.push(name);
  }
  writeFileSync(
    `${glb}.parts.json`,
    JSON.stringify({ size: bytes.length, encoding: "base64", parts })
  );
  rmSync(glb);
}

// 3. asset URLs relative to the page (JS) or to the stylesheet, which lives in assets/ (CSS)
let rewrites = 0;
for (const file of walk(path.join(out, "assets"))) {
  if (!/\/assets\/[^/]+\.(js|css)$/.test(file)) continue;
  const src = readFileSync(file, "utf8");
  const next = file.endsWith(".css")
    ? src.replace(/url\((["']?)\/assets\//g, (_m, q) => `url(${q}./`)
    : src.replace(/(["'`])\/assets\//g, (_m, q) => `${q}./assets/`);
  if (next !== src) {
    rewrites += (
      src.match(
        file.endsWith(".css") ? /url\((["']?)\/assets\//g : /(["'`])\/assets\//g
      ) ?? []
    ).length;
    writeFileSync(file, next);
  }
}

// 4. the page itself: the artifact host supplies the document skeleton (doctype, head, viewport), so the page is
//    just its title, its look, vite's two tags and the root
const html = readFileSync(path.join(out, "index.html"), "utf8");
const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "Special Delivery";
const tags = [
  ...html.matchAll(
    /<(script|link)\b[^>]*(?:src|href)="\.\/assets\/[^"]+"[^>]*>(?:<\/script>)?/g
  ),
].map(m => m[0]);
if (tags.length < 2)
  throw new Error(
    "vite's script and stylesheet tags were not found in index.html"
  );
writeFileSync(
  path.join(out, "index.html"),
  [
    `<title>${title}</title>`,
    "<style>",
    "  :root { --sky: #cfe7fa; color-scheme: light; }",
    "  html, body, #root { margin: 0; height: 100%; background: var(--sky); overscroll-behavior: none; }",
    "</style>",
    ...tags,
    '<div id="root"></div>',
    "",
  ].join("\n")
);

// 5. what an artifact will accept
const files = walk(out);
const total = files.reduce((n, f) => n + statSync(f).size, 0);
const big = files.filter(f => statSync(f).size > MAX_FILE);
console.log(
  `artifact: ${files.length} files, ${(total / 1e6).toFixed(1)} MB; removed ${removed}; ${rewrites} asset URLs made relative`
);
if (big.length) throw new Error(`files over 15 MB: ${big.join(", ")}`);
if (files.length > 255)
  throw new Error(`${files.length} files: one publish takes at most 255`);
if (total > 64 * 1024 * 1024)
  throw new Error(
    `${(total / 1e6).toFixed(1)} MB: one publish takes at most 64 MB`
  );
