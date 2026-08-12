import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the exact bug class behind the Sales Intel
 * readability incident: `client/src/pages/goldline/goldline-home.css` had
 * an unscoped `body { background: #080b10 }` rule. Because `App.tsx`
 * imports `Driver` eagerly (not via `lazy()`), and `Driver` -> `GoldlineDriverController`
 * -> `GoldlineHome` -> `goldline-home.css` is also all eager, that rule
 * shipped in the app's shared bundle and applied to every route, including
 * /sales-intel — producing near-invisible dark-on-dark text on a page that
 * never opted into a dark theme.
 *
 * This test walks the REAL eager (non-lazy) import graph starting at
 * App.tsx and asserts that no CSS file reachable that way sets `background`
 * or `color` on a bare `body`, `html`, or `:root` selector. Lazy-loaded
 * routes are exempt — their CSS only ever loads for their own page.
 */

const CLIENT_SRC = resolve(import.meta.dirname);

/** Only `client/src/index.css` is allowed to own the global theme. */
const ALLOWED_GLOBAL_STYLESHEETS = new Set([resolve(CLIENT_SRC, "index.css")]);

const EXTENSIONS = [".tsx", ".ts", ".css"];

function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@shared") || spec.startsWith("@assets")) {
    return null; // outside client/src — not part of this leak class
  }
  if (spec.startsWith("@/")) {
    base = resolve(CLIENT_SRC, spec.slice(2));
  } else if (spec.startsWith(".")) {
    base = resolve(dirname(fromFile), spec);
  } else {
    return null; // bare package import
  }
  if (existsSync(base) && !base.match(/\.(tsx|ts|css)$/)) {
    // directory or extensionless — try extensions, including index files
  }
  for (const ext of EXTENSIONS) {
    if (existsSync(base + ext)) return base + ext;
  }
  if (existsSync(base)) return base;
  return null;
}

/** Every `import ... from "spec"` / `import "spec"` that appears BEFORE the first `lazy(` call in the file — i.e. genuinely eager. */
function eagerImportSpecifiers(source: string): string[] {
  const lazyIndex = source.indexOf("lazy(");
  const eagerSource = lazyIndex === -1 ? source : source.slice(0, lazyIndex);
  const specs: string[] = [];
  for (const match of eagerSource.matchAll(/import\s+(?:[^"'{]*?from\s+)?["']([^"']+)["']/g)) {
    specs.push(match[1]);
  }
  return specs;
}

function collectEagerCssFiles(entryFile: string): Set<string> {
  const visited = new Set<string>();
  const cssFiles = new Set<string>();
  const stack = [entryFile];
  while (stack.length) {
    const file = stack.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    if (!existsSync(file)) continue;
    if (file.endsWith(".css")) {
      cssFiles.add(file);
      continue;
    }
    const source = readFileSync(file, "utf8");
    for (const spec of eagerImportSpecifiers(source)) {
      const resolved = resolveSpecifier(spec, file);
      if (resolved) stack.push(resolved);
    }
  }
  return cssFiles;
}

/** A bare `body`, `html`, or `:root` rule (not `.foo body`, not `body.bar`) that sets background/color. */
function unscopedColorLeak(css: string): string[] {
  const offenders: string[] = [];
  const ruleRegex = /(^|\})\s*((?:body|html|:root)(?:\s*,\s*(?:body|html|:root))*)\s*\{([^}]*)\}/gm;
  for (const match of css.matchAll(ruleRegex)) {
    const selector = match[2];
    const body = match[3];
    if (/(^|;)\s*(background(-color)?|color)\s*:/.test(body)) {
      offenders.push(`${selector} { ${body.trim()} }`);
    }
  }
  return offenders;
}

describe("no eagerly-bundled page CSS leaks a global background/color rule", () => {
  it("walks App.tsx's real eager import graph and finds only the allowed global stylesheet", () => {
    const appTsx = resolve(CLIENT_SRC, "App.tsx");
    const cssFiles = collectEagerCssFiles(appTsx);
    expect(cssFiles.size).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const cssFile of cssFiles) {
      if (ALLOWED_GLOBAL_STYLESHEETS.has(cssFile)) continue;
      const source = readFileSync(cssFile, "utf8");
      const offenders = unscopedColorLeak(source);
      if (offenders.length) {
        violations.push(`${cssFile}:\n  ${offenders.join("\n  ")}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("regression: goldline-home.css specifically no longer sets a bare body background", () => {
    const source = readFileSync(
      resolve(CLIENT_SRC, "pages", "goldline", "goldline-home.css"),
      "utf8"
    );
    expect(unscopedColorLeak(source)).toEqual([]);
  });
});
