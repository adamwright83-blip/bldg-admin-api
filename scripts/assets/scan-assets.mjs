/**
 * Regenerates client/src/game/assets/generated/assetManifest.json from disk.
 *
 * This script reports what is ON DISK. It deliberately makes no judgement about
 * purpose or status — that is hand-authored in registry.ts, which is the thing a
 * human has to update when new art lands. Keeping the two apart is what makes
 * "an unregistered asset fails the build" possible: the scanner always sees the
 * new file, the registry does not, and the test catches the gap.
 *
 *   npm run assets:scan
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..", "..");
/**
 * TWO asset roots, not one. This was missed on the first pass and it matters:
 *   public  -> served as-is, referenced at runtime as "/assets/..."
 *   bundled -> imported through the "@/" alias, hashed by Vite at build time
 * A registry that only saw `public` called 78 real, live images "missing".
 */
const PUBLIC_ROOT = join(REPO, "client", "public");
const ASSET_ROOTS = [
  { kind: "public", base: PUBLIC_ROOT, dir: join(PUBLIC_ROOT, "assets"), prefix: "/assets" },
  { kind: "bundled", base: join(REPO, "client", "src"), dir: join(REPO, "client", "src", "assets"), prefix: "@/assets" },
];
const OUT = join(REPO, "client", "src", "game", "assets", "generated", "assetManifest.json");

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".avif"]);

/** Reads intrinsic pixel dimensions without an image library. */
function dimensions(buf, ext) {
  try {
    if (ext === ".png" && buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (ext === ".gif" && buf.length > 10) {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (ext === ".webp" && buf.length > 30 && buf.toString("ascii", 8, 12) === "WEBP") {
      const fourcc = buf.toString("ascii", 12, 16);
      if (fourcc === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (fourcc === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (fourcc === "VP8L") {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
    }
    if (ext === ".jpg" || ext === ".jpeg") {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i += 1; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        }
        i += 2 + len;
      }
    }
  } catch { /* an unreadable header is reported as unknown, not as a crash */ }
  return null;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const entries = ASSET_ROOTS.flatMap(({ kind, base, dir }) => {
  let files = [];
  try { files = walk(dir); } catch { return []; }
  return files.filter((p) => IMAGE_EXT.has(p.slice(p.lastIndexOf(".")).toLowerCase())).map((path) => {
  const buf = readFileSync(path);
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  const dim = dimensions(buf, ext);
  const rel = relative(base, path).split(/[\\/]/).join("/");
  return {
    url: kind === "public" ? "/" + rel : "@/" + rel,
    root: kind,
    bytes: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex").slice(0, 16),
    format: ext.slice(1),
    width: dim?.width ?? null,
    height: dim?.height ?? null,
  };
  });
});

writeFileSync(
  OUT,
  JSON.stringify({ generatedBy: "npm run assets:scan", count: entries.length, assets: entries }, null, 1) + "\n",
);
const mb = (entries.reduce((n, e) => n + e.bytes, 0) / 1e6).toFixed(1);
console.log(`assets:scan — ${entries.length} images, ${mb} MB -> ${relative(REPO, OUT)}`);
