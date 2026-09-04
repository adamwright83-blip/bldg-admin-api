import { readFile, writeFile, mkdir } from "node:fs/promises";
import { zipSync } from "fflate";

// Explicit allowlist: no tests, source data, credentials or backend files.
const files = [
  "manifest.json",
  "worker.js",
  "core.js",
  "browser.js",
  "schedule.js",
  "sync.html",
  "sync.css",
  "sync.js",
];
const entries = {};
for (const file of files)
  entries[file] = new Uint8Array(
    await readFile(
      new URL(`../extensions/gumballpals/${file}`, import.meta.url)
    )
  );
await mkdir(new URL("../client/public/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../client/public/gumballpals.zip", import.meta.url),
  zipSync(entries)
);
console.log("Packaged Gumballpals: eight allowlisted runtime files.");
