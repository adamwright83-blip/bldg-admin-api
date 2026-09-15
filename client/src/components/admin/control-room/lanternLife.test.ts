import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lanternPhaseSeconds } from "./lanternLife";

const css = readFileSync(new URL("./admin-control-room.css", import.meta.url), "utf8");
const home = readFileSync(
  new URL("../../../pages/AdminHome.tsx", import.meta.url),
  "utf8"
);

/**
 * Confirmed in a real browser against a production build: each state resolves
 * to its own animation on .lc-lantern-body::after, with --lc-phase honoured and
 * infinite iteration. These guard the properties that made that true.
 *
 * Live Home still paints `.lc-lantern` glyphs on WorldGeographySurface.
 * Live V6 lanterns are static silhouette art and do not use this CSS cycle.
 */
describe("lantern ambient life", () => {
  it("gives every cadence state its own resting behaviour", () => {
    for (const [state, anim] of [
      ["active", "lc-breathe"],
      ["dimming", "lc-falter"],
      ["dark", "lc-embers"],
    ]) {
      expect(css).toMatch(
        new RegExp(`\\.lc-lantern\\.state-${state} \\.lc-lantern-body::after[\\s\\S]{0,200}${anim}`)
      );
    }
  });

  it("draws idle life on the halo, never on the body's own animation slot", () => {
    expect(css).toContain(".lc-lantern-body::after");
    expect(css).toMatch(/animation:lc-gutter/);
    expect(css).toMatch(/animation:lc-reignite/);
  });

  it("staggers lanterns so the city never pulses in lockstep", () => {
    expect(css).toContain("animation-delay: var(--lc-phase, 0s)");
    expect(home).toContain("lanternPhaseSeconds");
    expect(home).toContain('["--lc-phase" as string]');
  });

  it("keeps the failing light irregular rather than a steady pulse", () => {
    const falter = css.slice(css.indexOf("@keyframes lc-falter"));
    const stops = falter.slice(0, falter.indexOf("}\n}")).match(/\d+%\s*\{/g) ?? [];
    expect(stops.length).toBeGreaterThanOrEqual(6);
  });

  it("still respects reduced motion, keeping the information without the movement", () => {
    const lanternBlock = css.slice(css.indexOf(".lc-lantern-body::after"));
    const reduced = lanternBlock.slice(lanternBlock.indexOf("prefers-reduced-motion"));
    expect(reduced).toContain(".lc-lantern-body::after { animation: none !important; }");
    expect(reduced).toMatch(/state-active[\s\S]{0,80}opacity: 0\.85/);
    expect(reduced).toMatch(/state-dark[\s\S]{0,80}opacity: 0/);
  });
});

describe("lanternPhaseSeconds", () => {
  it("is stable and spread — a reload must not reshuffle the city's rhythm", () => {
    expect(lanternPhaseSeconds("cluster-a")).toBe(lanternPhaseSeconds("cluster-a"));
    expect(lanternPhaseSeconds("cluster-a")).not.toBe(lanternPhaseSeconds("cluster-b"));
    const a = lanternPhaseSeconds("koreatown:1");
    const b = lanternPhaseSeconds("century-city:9");
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(7);
    expect(Math.abs(a - b)).toBeGreaterThan(0.01);
  });
});

/**
 * Confirmed against real computed styles in a browser: both towers resolve
 * lc-tower-presence at 9s infinite, each binding its own identity colour into
 * the gradient (OPUS purple, CPE amber).
 */
describe("tower presence", () => {
  it("targets the class CityTowerButton actually renders", () => {
    const surface = readFileSync(
      new URL("./WorldGeographySurface.tsx", import.meta.url),
      "utf8"
    );
    expect(surface).toMatch(/pwc-building \$\{.*opus.*cpe/s);
    expect(css).toContain(".pwc-building::before");
  });

  it("gives each tower its own identity colour rather than one highlight", () => {
    expect(css).toMatch(/\.pwc-building\.opus \{ --lc-tower-glow/);
    expect(css).toMatch(/\.pwc-building\.cpe \{ --lc-tower-glow/);
  });

  it("looms slower than a lantern flickers", () => {
    const tower = css.match(/animation: lc-tower-presence (\d+)s/);
    expect(Number(tower?.[1])).toBeGreaterThan(7);
  });

  it("respects reduced motion", () => {
    expect(css).toMatch(/\.pwc-building::before \{ animation: none !important/);
  });
});
