#!/usr/bin/env node
/**
 * Validates the Goldline PWA surface without a browser: manifest JSON
 * shape, required fields, icon files actually exist at their declared
 * sizes, and the service worker script parses as valid JS. Run before
 * release the same way scripts/validateCorridorManifest.mjs is.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

let ok = true;
const fail = (message) => {
  ok = false;
  console.log(`  [FAIL] ${message}`);
};
const pass = (message) => console.log(`  [PASS] ${message}`);

const manifestPath = resolve(process.cwd(), "client/public/goldline.webmanifest");
if (!existsSync(manifestPath)) {
  fail(`manifest not found at ${manifestPath}`);
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const requiredFields = ["name", "short_name", "start_url", "scope", "display", "background_color", "theme_color", "icons"];
  if (manifest.name !== "JOYSTICK" || manifest.short_name !== "JOYSTICK") {
    fail(`manifest product name must be JOYSTICK, got name=${JSON.stringify(manifest.name)} short_name=${JSON.stringify(manifest.short_name)}`);
  } else {
    pass("manifest product name is JOYSTICK");
  }
  for (const field of requiredFields) {
    if (manifest[field] == null) fail(`manifest missing required field: ${field}`);
    else pass(`manifest.${field} = ${JSON.stringify(manifest[field])}`);
  }
  if (manifest.display !== "standalone" && manifest.display !== "fullscreen") {
    fail(`manifest.display should be standalone/fullscreen for an installed-app feel, got "${manifest.display}"`);
  }
  if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
    fail("manifest.icons must be a non-empty array");
  } else {
    const has192 = manifest.icons.some(icon => icon.sizes === "192x192");
    const has512 = manifest.icons.some(icon => icon.sizes === "512x512");
    if (!has192) fail("manifest is missing a 192x192 icon (minimum for installability)");
    else pass("manifest has a 192x192 icon");
    if (!has512) fail("manifest is missing a 512x512 icon (used on higher-DPI home screens)");
    else pass("manifest has a 512x512 icon");
    for (const icon of manifest.icons) {
      const iconPath = resolve(process.cwd(), "client/public", icon.src.replace(/^\//, ""));
      if (existsSync(iconPath)) pass(`icon file exists: ${icon.src}`);
      else fail(`icon file missing: ${icon.src}`);
    }
  }
}

const installHeadPath = resolve(process.cwd(), "client/src/game/pwa/installPwaHead.ts");
if (!existsSync(installHeadPath)) {
  fail(`install wiring not found at ${installHeadPath}`);
} else {
  const installHead = readFileSync(installHeadPath, "utf8");
  if (!installHead.includes('manifestLink.href = "/goldline.webmanifest"')) {
    fail("install wiring does not point at /goldline.webmanifest");
  } else {
    pass("install wiring links /goldline.webmanifest");
  }
  if (!installHead.includes('"/assets/goldline/pwa/icon-192.png"')) {
    fail("install wiring does not use the existing 192 icon");
  } else {
    pass("install wiring uses the existing 192 icon");
  }
}

const swPath = resolve(process.cwd(), "client/public/goldline-sw.js");
if (!existsSync(swPath)) {
  fail(`service worker not found at ${swPath}`);
} else {
  const source = readFileSync(swPath, "utf8");
  try {
    new Function(source);
    pass("service worker script parses as valid JavaScript");
  } catch (error) {
    fail(`service worker has a syntax error: ${error.message}`);
  }
  if (!source.includes('const CACHE_VERSION = "goldline-shell-v3"')) {
    fail("service worker cache version must be goldline-shell-v3");
  } else {
    pass("service worker cache is goldline-shell-v3");
  }
  if (!source.includes('"/goldline.webmanifest"')) {
    fail("service worker precache does not include the manifest");
  } else {
    pass("service worker precache includes the manifest");
  }
  if (!/pathname\.startsWith\("\/api\/"\)/.test(source)) {
    fail("service worker does not appear to special-case /api/ requests — authoritative data could be cached");
  } else {
    pass("service worker explicitly excludes /api/ from caching");
  }
}

console.log("");
console.log(ok ? "[validate-pwa] OK" : "[validate-pwa] FAILED");
process.exit(ok ? 0 : 1);
