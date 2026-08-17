import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The bottom action bar's one hard constraint.
 *
 * The icon strip is a single four-frame sprite atlas, drawn at
 * `${index * 33.333}%` across a 400%-wide background. A fifth entry in that
 * list has no frame to point at and spills a fixed four-column grid into a
 * second row. That is exactly what happened when ADD WORK was added: the fifth
 * button drew a sliver of nothing and pushed the bar over the map.
 *
 * So new utilities go in the text-only strip instead, and this test is what
 * stops the next one from being appended to the sprite list by reflex.
 */

const dir = path.dirname(new URL(import.meta.url).pathname);
const source = readFileSync(path.join(dir, "GoldlineHome.tsx"), "utf8");
const homeCss = readFileSync(path.join(dir, "goldline-home.css"), "utf8");

function sourceBlock(declaration: string): string {
  const start = source.indexOf(declaration);
  expect(start, `${declaration} not found`).toBeGreaterThan(-1);
  const end = source.indexOf("\n  ];", start);
  expect(end, `${declaration} is not a closed array literal`).toBeGreaterThan(
    start
  );
  return source.slice(start, end);
}

describe("the sprite action bar matches its atlas", () => {
  it("has exactly one action per sprite frame", () => {
    const block = sourceBlock("const actionItems = [");
    const labels = [...block.matchAll(/label: "([^"]+)"/g)].map(m => m[1]);
    expect(labels).toEqual([
      "BUILD MISSION",
      "NEW ORDER",
      "LOG A WALK-IN",
      "UNLOAD THE DAY",
    ]);
  });

  it("declares no conditional entries, which would change the count at runtime", () => {
    // A `...(flag ? [...] : [])` spread here passes the length check above while
    // still rendering a fifth button on a real phone.
    expect(sourceBlock("const actionItems = [")).not.toContain("...(");
  });

  it("keeps the grid at four columns to match", () => {
    expect(homeCss).toMatch(/\.action-bar\s*\{[^}]*repeat\(4, 1fr\)/);
    expect(source).toContain("index * 33.333");
  });

  it("gives the strip's buttons their own styling, not the sprite buttons'", () => {
    // Descendant selectors would hand the strip an 88px-tall gold sprite
    // button, which is why every sprite rule is scoped to a direct child.
    expect(homeCss).not.toMatch(/\.action-bar (button|i|span)\b/);
    expect(homeCss).toContain(".action-bar > button");
  });
});

describe("the utility strip is laid out by the bar, not floated above it", () => {
  it("renders inside the action bar", () => {
    const barStart = source.indexOf('<nav className="action-bar"');
    const stripStart = source.indexOf('className="utility-strip"');
    const barEnd = source.indexOf("</nav>", barStart);
    expect(stripStart).toBeGreaterThan(barStart);
    expect(stripStart).toBeLessThan(barEnd);
  });

  it("spans the grid rather than being positioned at a guessed offset", () => {
    const rule = homeCss.slice(
      homeCss.indexOf(".utility-strip {"),
      homeCss.indexOf("}", homeCss.indexOf(".utility-strip {"))
    );
    expect(rule).toContain("grid-column: 1 / -1");
    // An absolute `bottom:` here is the overlap bug this screen keeps shipping.
    expect(rule).not.toContain("position: absolute");
    expect(rule).not.toContain("bottom:");
  });

  it("derives its own columns from its contents", () => {
    // ADD WORK is conditional and LOG A SIGNAL is conditional, so a hardcoded
    // column count here would be wrong in three of the four combinations.
    const rule = homeCss.slice(
      homeCss.indexOf(".utility-strip {"),
      homeCss.indexOf("}", homeCss.indexOf(".utility-strip {"))
    );
    expect(rule).toContain("grid-auto-flow: column");
    expect(rule).not.toMatch(/repeat\(\d/);
  });
});
