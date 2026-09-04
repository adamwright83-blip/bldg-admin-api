/**
 * "No dark mode" as a failing test rather than a remembered promise.
 *
 * WHY IT CHECKS A NAMED LIST AND NOT EVERY DECLARATION
 *
 * Scanning every background in the stylesheet was the obvious first idea and it
 * is wrong twice. It rejects legitimately dark things — shadows, architectural
 * detail, the deliberately dark Tower Wars arena — and it still misses the ways
 * a surface actually goes dark in practice: imagery, gradients and overlays. So
 * it asserts on the LARGE SURFACES the operator reads against, by name, and the
 * accompanying screenshots cover what a stylesheet cannot see.
 *
 * The effective declaration is the LAST one for a selector, which is what makes
 * this meaningful: re-darkening a surface by appending a new rule fails here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(__dirname, "admin-control-room.css"), "utf8");

/**
 * The surfaces the operator reads the city against. Not every element — the
 * grounds and panels that fill the screen and decide whether it reads as day.
 */
const DESIGNATED_SURFACES = [
  ".pwc-world",
  ".cr-world-geography-surface",
  ".cr-day-phase",
  ".pwc-page .pwc-metric",
];

/** Relative luminance, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value.split("").map(c => c + c).join("")
      : value.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The last background declared for a selector — the one that actually paints.
 * Deliberately naive about the cascade: these selectors are unique enough in
 * this file that "last wins" matches what the browser does, and the rendered
 * screenshots are what confirm it.
 */
function lastBackgroundFor(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `${escaped}\\s*(?:,[^{]*)?\\{[^}]*?background(?:-color)?:\\s*([^;!}]+)`,
    "g"
  );
  let match: RegExpExecArray | null;
  let last: string | null = null;
  while ((match = pattern.exec(CSS)) !== null) last = match[1].trim();
  return last;
}

/**
 * The custom properties this file defines, so `var(--lc-day-sky)` can be checked
 * rather than skipped. A guard that silently ignored tokenised backgrounds would
 * pass happily while the tokens themselves went dark — which is precisely how
 * the repaint is meant to be edited from now on.
 */
const TOKENS: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const pattern = /(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(CSS)) !== null) map[match[1]] = match[2];
  return map;
})();

/** Every hex colour in a declaration, resolving tokens, so gradients are
 *  checked stop by stop. */
function hexesIn(declaration: string): string[] {
  const resolved = declaration.replace(
    /var\(\s*(--[a-z0-9-]+)\s*(?:,[^)]*)?\)/g,
    (whole, name: string) => TOKENS[name] ?? whole
  );
  return resolved.match(/#[0-9a-fA-F]{3,8}/g) ?? [];
}

/**
 * Below this a surface reads as dark rather than as a shade of daylight. 0.45
 * sits comfortably under cream (~0.95) and well above the slate this replaced
 * (~0.02), so it fails a genuine regression without policing exact tones.
 */
const DAYLIGHT_FLOOR = 0.45;

describe("the city stays daylight", () => {
  it.each(DESIGNATED_SURFACES)("%s paints a light background", selector => {
    const declaration = lastBackgroundFor(selector);
    expect(declaration, `no background found for ${selector}`).not.toBeNull();

    const hexes = hexesIn(declaration!);
    expect(hexes.length, `no colour parsed from "${declaration}"`).toBeGreaterThan(0);

    for (const hex of hexes) {
      expect(
        luminance(hex),
        `${selector} paints ${hex}, which reads as dark. The operator works ` +
          `in LA sun; dark backgrounds lose them. Dark TEXT and SHADOWS are fine.`
      ).toBeGreaterThan(DAYLIGHT_FLOOR);
    }
  });

  /*
    Guards the guard. If the luminance maths inverts, every assertion above
    would pass vacuously and the rule would quietly stop protecting anything.
  */
  it("recognises the slate this replaced as dark", () => {
    expect(luminance("#0b1c2f")).toBeLessThan(DAYLIGHT_FLOOR);
    expect(luminance("#0d1c2d")).toBeLessThan(DAYLIGHT_FLOOR);
    expect(luminance("#fffdf4")).toBeGreaterThan(DAYLIGHT_FLOOR);
  });

  /*
    Tower Wars is a deliberately dark arena and is NOT in the designated list.
    Asserted so a later reader does not "fix" the omission and repaint a surface
    that is meant to be dark.
  */
  it("resolves the city tokens rather than skipping them", () => {
    // If this map were empty every tokenised background would pass vacuously.
    expect(Object.keys(TOKENS).length).toBeGreaterThan(0);
    expect(hexesIn("linear-gradient(180deg, var(--lc-day-sky), var(--lc-day-ground))"))
      .toHaveLength(2);
  });

  it("leaves the Tower Wars arena out of the daylight rule", () => {
    expect(DESIGNATED_SURFACES.some(s => s.startsWith(".tw-"))).toBe(false);
  });
});
