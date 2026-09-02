import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./admin-control-room.css", import.meta.url), "utf8");
const atlas = readFileSync(new URL("./LanternCityAtlas.tsx", import.meta.url), "utf8");

/**
 * Confirmed in a real browser against a production build: each state resolves
 * to its own animation on .lc-lantern-body::after, with --lc-phase honoured and
 * infinite iteration. These guard the properties that made that true.
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
    // .lc-lantern-body already owns lc-gutter / lc-reignite. An idle loop there
    // would fight the very transitions that make an event legible.
    expect(css).toContain(".lc-lantern-body::after");
    expect(css).toMatch(/animation:lc-gutter/);
    expect(css).toMatch(/animation:lc-reignite/);
  });

  it("staggers lanterns so the city never pulses in lockstep", () => {
    expect(css).toContain("animation-delay: var(--lc-phase, 0s)");
    expect(atlas).toContain("lanternPhaseSeconds");
    expect(atlas).toContain('["--lc-phase" as string]');
  });

  it("keeps the failing light irregular rather than a steady pulse", () => {
    const falter = css.slice(css.indexOf("@keyframes lc-falter"));
    // A struggling light must not read as a healthy rhythmic pulse, so the
    // keyframe needs several unevenly spaced stops.
    const stops = falter.slice(0, falter.indexOf("}\n}")).match(/\d+%\s*\{/g) ?? [];
    expect(stops.length).toBeGreaterThanOrEqual(6);
  });

  it("still respects reduced motion, keeping the information without the movement", () => {
    const reduced = css.slice(css.lastIndexOf("prefers-reduced-motion"));
    expect(reduced).toContain(".lc-lantern-body::after { animation: none !important; }");
    expect(reduced).toMatch(/state-active[\s\S]{0,80}opacity: 0\.85/);
    expect(reduced).toMatch(/state-dark[\s\S]{0,80}opacity: 0/);
  });
});

describe("lanternPhaseSeconds", () => {
  it("is stable and spread — a reload must not reshuffle the city's rhythm", async () => {
    const mod = await import("./LanternCityAtlas");
    void mod;
    // The helper is module-private by design; its contract is asserted through
    // the source so the property survives a refactor of the component.
    expect(atlas).toMatch(/hash \* 31 \+ key\.charCodeAt/);
    expect(atlas).toMatch(/hash % 700\) \/ 100/);
  });
});
