import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DAYLIGHT_LUMINANCE_FLOOR,
  DAYLIGHT_PALETTE,
  DESIGNATED_DAYLIGHT_SURFACES,
  FORBIDDEN_PATTERNS,
  KNOWN_MOTION_EXCEPTIONS,
  INTENTIONALLY_DARK_SURFACES,
  MOTION_CANON,
  WINDOW_STATES,
  isDaylight,
  luminance,
  paletteTokenNames,
} from "./goldlineVisualCanon";

const ROOT = join(__dirname, "..");
const CITY_CSS = readFileSync(
  join(ROOT, "client/src/components/admin/control-room/admin-control-room.css"),
  "utf8"
);

describe("the canon is internally coherent", () => {
  /*
    The firewall as appearance. If a second state ever gained sustained warmth,
    outreach could be routed through it and the visual would start lying.
  */
  it("exactly one window state may assert sustained warmth", () => {
    const warm = Object.entries(WINDOW_STATES).filter(([, s]) => s.sustainedWarmth);
    expect(warm.map(([name]) => name)).toEqual(["warm"]);
  });

  it("warmth is earned by order evidence and nothing else", () => {
    expect(WINDOW_STATES.warm.earnedBy).toBe("order evidence");
    expect(WINDOW_STATES.stirring.earnedBy).toBe("attested outreach");
    expect(WINDOW_STATES.stirring.sustainedWarmth).toBe(false);
  });

  it("says out loud that a dormant building stays sunlit", () => {
    expect(WINDOW_STATES.quiet.meaning.toLowerCase()).toContain("sunlit");
    expect(WINDOW_STATES.quiet.meaning.toLowerCase()).not.toContain("dark");
  });

  it("keeps unknown distinct from quiet", () => {
    expect(WINDOW_STATES.unknown.meaning.toLowerCase()).toContain("not dormant");
  });

  it("never designates an intentionally dark surface as daylight", () => {
    for (const dark of INTENTIONALLY_DARK_SURFACES) {
      expect(DESIGNATED_DAYLIGHT_SURFACES as readonly string[]).not.toContain(dark);
    }
  });

  it("gives every forbidden pattern a reason a reader can trace", () => {
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(pattern.rule.length).toBeGreaterThan(10);
      expect(pattern.because.length).toBeGreaterThan(15);
    }
  });

  it("carries the World Bible's presentation law forward", () => {
    const rules = FORBIDDEN_PATTERNS.map(p => p.because).join(" ");
    expect(rules).toContain("WORLD_BIBLE §3");
  });
});

describe("the palette is daylight", () => {
  it("every ground and panel token is above the daylight floor", () => {
    const grounds = ["--lc-day-sky", "--lc-day-ground", "--lc-day-label", "--lc-panel"] as const;
    for (const token of grounds) {
      expect(isDaylight(DAYLIGHT_PALETTE[token]), `${token} is too dark`).toBe(true);
    }
  });

  /*
    Ink and edges are SUPPOSED to be dark. Asserting they are keeps someone from
    "fixing" the palette into an unreadable all-cream wash.
  */
  it("keeps ink dark, because dark text is what makes daylight readable", () => {
    expect(luminance(DAYLIGHT_PALETTE["--lc-day-ink"])).toBeLessThan(DAYLIGHT_LUMINANCE_FLOOR);
  });

  it("guards the luminance maths against inverting", () => {
    expect(luminance("#0b1c2f")).toBeLessThan(DAYLIGHT_LUMINANCE_FLOOR);
    expect(luminance("#fffdf4")).toBeGreaterThan(DAYLIGHT_LUMINANCE_FLOOR);
  });
});

describe("the implementation conforms to the canon", () => {
  it("defines every palette token the canon declares", () => {
    for (const token of paletteTokenNames()) {
      expect(CITY_CSS, `${token} is declared in canon but missing from the city CSS`)
        .toContain(`${token}:`);
    }
  });

  it("defines them with the exact values the canon specifies", () => {
    for (const [token, value] of Object.entries(DAYLIGHT_PALETTE)) {
      const match = CITY_CSS.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{3,8})`));
      expect(match, `${token} not found in city CSS`).not.toBeNull();
      expect(match![1].toLowerCase(), `${token} drifted from canon`).toBe(value.toLowerCase());
    }
  });

  /*
    Compositor-only motion. These pages animate continuously on a phone in a van;
    animating anything that triggers layout or paint per frame drops frames on
    exactly the hardware the operator actually has.
  */
  /*
    Much of this stylesheet is minified, so keyframe blocks cannot be matched with
    a lazy regex — it runs straight through one rule into the next and misreports
    which keyframe owns a property. Braces are balanced explicitly instead.
  */
  function cityKeyframes(): Array<{ name: string; body: string }> {
    const found: Array<{ name: string; body: string }> = [];
    const opener = /@keyframes\s+(lc-[a-z-]+)\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = opener.exec(CITY_CSS)) !== null) {
      let depth = 1;
      let index = opener.lastIndex;
      while (index < CITY_CSS.length && depth > 0) {
        if (CITY_CSS[index] === "{") depth += 1;
        else if (CITY_CSS[index] === "}") depth -= 1;
        index += 1;
      }
      found.push({ name: match[1], body: CITY_CSS.slice(opener.lastIndex, index - 1) });
    }
    return found;
  }

  it("extracts keyframes accurately even from the minified rules", () => {
    const names = cityKeyframes().map(k => k.name);
    expect(names).toContain("lc-shimmer");
    expect(names).toContain("lc-ribbon");
    // Proves the balancing works: a lazy match merges these two neighbours.
    expect(names).toContain("lc-gutter");
    expect(names).toContain("lc-reignite");
    const shimmer = cityKeyframes().find(k => k.name === "lc-shimmer")!;
    expect(shimmer.body).not.toContain("@keyframes");
  });

  /*
    Ratchet, not amnesty. Known violations are named in the canon and may remain;
    a NEW one fails the build. Silently rewriting unrelated visuals to satisfy the
    rule would be worse than recording the debt.
  */
  it("adds no new non-compositor animation beyond the recorded exceptions", () => {
    const allowed = new Set<string>(MOTION_CANON.animatableProperties);
    const known = new Set(KNOWN_MOTION_EXCEPTIONS.map(e => `${e.keyframe}:${e.property}`));
    const violations: string[] = [];

    for (const { name, body } of cityKeyframes()) {
      const properties = [...body.matchAll(/[{;]\s*([a-z-]+)\s*:/g)].map(m => m[1]);
      for (const property of new Set(properties)) {
        if (allowed.has(property)) continue;
        if (known.has(`${name}:${property}`)) continue;
        violations.push(`${name} animates ${property}`);
      }
    }
    expect(violations, `new non-compositor animation: ${violations.join(", ")}`).toEqual([]);
  });

  it("the keyframes this work added are compositor-only", () => {
    const allowed = new Set<string>(MOTION_CANON.animatableProperties);
    for (const { name, body } of cityKeyframes()) {
      if (!["lc-shimmer", "lc-ribbon"].includes(name)) continue;
      const properties = [...body.matchAll(/[{;]\s*([a-z-]+)\s*:/g)].map(m => m[1]);
      for (const property of properties) {
        expect(allowed.has(property), `${name} animates ${property}`).toBe(true);
      }
    }
  });

  it("records why each known exception costs something", () => {
    for (const exception of KNOWN_MOTION_EXCEPTIONS) {
      expect(exception.cost.length).toBeGreaterThan(20);
      expect(exception.cost.toLowerCase()).toMatch(/repaint|layout|frame/);
    }
  });

  it("provides a reduced-motion fallback for the city animations", () => {
    expect(MOTION_CANON.reducedMotionFallbackRequired).toBe(true);
    const blocks = CITY_CSS.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/g) ?? [];
    expect(blocks.length, "no reduced-motion block in the city CSS").toBeGreaterThan(0);
    const combined = blocks.join(" ");
    expect(combined).toContain("pwc-building-canon");
    expect(combined).toContain("animation: none");
  });

  it("keeps ambient loops slow and reactions quick", () => {
    const shimmer = CITY_CSS.match(/animation:\s*lc-shimmer\s+([\d.]+)s/);
    expect(shimmer, "lc-shimmer animation not found").not.toBeNull();
    expect(Number(shimmer![1]) * 1000).toBeGreaterThanOrEqual(MOTION_CANON.minAmbientLoopMs);
  });
});
