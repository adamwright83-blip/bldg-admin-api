import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the exact bug class behind two incidents in this
 * eager `goldline-home.css` bundle:
 *
 * 1. Sales Intel readability: an unscoped `body { background: #080b10 }`
 *    rule made text near-invisible on /sales-intel, a page that never
 *    opted into a dark theme.
 * 2. Laundry Butler mobile scroll: a `@media (max-width: 699px) { html,
 *    body, #root { overflow: hidden } }` rule permanently disabled
 *    scrolling on every mobile route, including the marketing landing
 *    page — the pricing CTA could scroll partway into view but nothing
 *    below it was ever reachable.
 *
 * Both share the same cause: `App.tsx` imports `Driver` eagerly (not via
 * `lazy()`), and `Driver` -> `GoldlineDriverController` -> `GoldlineHome`
 * (the Suspense fallback shown before the real game lazy-loads) ->
 * `goldline-home.css` is also all eager, so anything set on a bare
 * `body`/`html`/`#root`/`:root` selector in that file ships in the app's
 * shared bundle and applies to every route.
 *
 * This test walks the REAL eager (non-lazy) import graph starting at
 * App.tsx and asserts that no CSS file reachable that way sets
 * `background`, `color`, or `overflow` on a bare `body`, `html`, `#root`,
 * or `:root` selector — including inside `@media` blocks. Lazy-loaded
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

/**
 * Unwraps every `@media (...) { ... }` (and other `@`-block) wrapper,
 * hoisting its inner rules to the top level so the flat rule regex below
 * can see them too. This is what let the `overflow: hidden` leak slip past
 * the original version of this guard — it only ever matched top-level
 * rules, and the offending rule lived inside `@media (max-width: 699px)`.
 */
function unwrapAtBlocks(css: string): string {
  let out = "";
  let depth = 0;
  let i = 0;
  while (i < css.length) {
    if (css[i] === "@") {
      const braceIndex = css.indexOf("{", i);
      if (braceIndex === -1) {
        out += css.slice(i);
        break;
      }
      // Drop the "@media (...) {" prefix — its inner content gets emitted
      // by the normal loop below as if it were top-level.
      i = braceIndex + 1;
      depth += 1;
      continue;
    }
    if (css[i] === "}" && depth > 0) {
      depth -= 1;
      i += 1;
      continue;
    }
    out += css[i];
    i += 1;
  }
  return out;
}

/** A bare `body`, `html`, `#root`, or `:root` rule (not `.foo body`, not `body.bar`) that sets background/color/overflow. */
function unscopedColorLeak(css: string): string[] {
  const offenders: string[] = [];
  const flattened = unwrapAtBlocks(css);
  const ruleRegex = /(^|\})\s*((?:body|html|#root|:root)(?:\s*,\s*(?:body|html|#root|:root))*)\s*\{([^}]*)\}/gm;
  for (const match of flattened.matchAll(ruleRegex)) {
    const selector = match[2];
    const body = match[3];
    if (/(^|;)\s*(background(-color)?|color|overflow(-[xy])?)\s*:/.test(body)) {
      offenders.push(`${selector} { ${body.trim()} }`);
    }
  }
  return offenders;
}

describe("no eagerly-bundled page CSS leaks a global background/color/overflow rule", () => {
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

  it("regression: goldline-home.css specifically no longer sets a bare body background/overflow, including inside @media blocks", () => {
    const source = readFileSync(
      resolve(CLIENT_SRC, "pages", "goldline", "goldline-home.css"),
      "utf8"
    );
    expect(unscopedColorLeak(source)).toEqual([]);
  });
});
