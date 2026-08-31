import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  OPUS_BALL_CENTRE,
  OPUS_DRIVER_HEAD,
  OPUS_DRIVER_HINGE,
  OPUS_PIECE_ASSETS,
  OPUS_STRIKE_DIRECTION,
  hingeOriginPercent,
} from "./opusWeaponGeometry";

const css = readFileSync(
  new URL("./admin-control-room.css", import.meta.url),
  "utf8"
);
const tsx = readFileSync(new URL("./TowerWars.tsx", import.meta.url), "utf8");

describe("no legacy club or ball geometry survives", () => {
  it("has deleted the .tw-opus-driver:after gold ellipse", () => {
    expect(css).not.toMatch(/\.tw-opus-driver:after/);
    expect(css).not.toMatch(/\.tw-opus-driver::after/);
  });

  it("keeps the .tw-opus-ball CSS circle gone", () => {
    expect(css).not.toContain("tw-opus-ball");
    expect(tsx).not.toContain("tw-opus-ball");
  });

  it("renders the club from the real art, never a CSS blob", () => {
    // The old club was a border-radius + linear-gradient shape. Those exact
    // legacy colours must not reappear anywhere in the stylesheet.
    for (const legacy of ["#d7b56b", "#e0b96a", "#6b451d", "#503013"]) {
      expect(css.toLowerCase()).not.toContain(legacy);
    }
    expect(css).toContain(OPUS_PIECE_ASSETS.driver);
  });
});

describe("the tower plate carries neither club nor ball", () => {
  it("uses the twice-cleaned plate and no earlier tower art", () => {
    expect(tsx).toContain(OPUS_PIECE_ASSETS.plate);
    expect(tsx).not.toContain("opus-la-tower-v2.png");
    expect(tsx).not.toContain("opus-la-tower-plate-v3.png");
  });

  it("ships the club and the ball as separate assets from the plate", () => {
    const assets = new Set(Object.values(OPUS_PIECE_ASSETS));
    expect(assets.size).toBe(3);
  });
});

describe("exactly one ball rendering path for OPUS", () => {
  it("declares the ball art once, on the projectile", () => {
    const refs = css.match(/opus-la-ball-v1\.png/g) ?? [];
    expect(refs).toHaveLength(1);
    expect(css).toMatch(
      /\.tw-projectile\[data-weapon="golf-ball"\]:before\{[^}]*opus-la-ball-v1\.png/
    );
  });

  it("renders a single golf-ball projectile element", () => {
    const occurrences = tsx.match(/"golf-ball"/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("does not let the generic projectile animation drive the ball wrapper", () => {
    // The wrapper carries scale(1.12) to stay locked to the tower; letting the
    // shared flight animation touch it would overwrite that transform.
    expect(css).toContain(
      '.tw-piece.is-firing .tw-projectile[data-weapon="golf-ball"]{animation:none}'
    );
  });
});

describe("the ball is on the tee at rest and absent from it in flight", () => {
  const flight = css.match(/@keyframes tw-golfball-flight\{([^@]*)\}/)?.[1] ?? "";

  it("holds the ball on the tee through the backswing", () => {
    // 0% and 50% both sit at zero translation: the ball cannot leave the tee
    // before the club arrives.
    expect(flight).toContain("0%,50%{transform:translate(0,0) scale(1);opacity:1}");
  });

  it("carries the ball away and fades it out by the end", () => {
    expect(flight).toMatch(/100%\{transform:translate\(46vw,-9vh\)/);
    expect(flight).toMatch(/100%\{[^}]*opacity:0/);
  });

  it("returns the ball to the tee rather than holding the end state", () => {
    // No fill-mode: once the animation ends the ball is back on the tee.
    expect(css).toContain(
      '.tw-piece.is-firing .tw-projectile[data-weapon="golf-ball"]:before{animation:tw-golfball-flight .65s ease-in}'
    );
    expect(css).not.toMatch(/tw-golfball-flight[^;}]*forwards/);
  });

  it("is visible at rest", () => {
    expect(css).toMatch(
      /\.tw-projectile\[data-weapon="golf-ball"\]\{[^}]*opacity:1/
    );
  });
});

describe("locked strike geometry", () => {
  it("puts the driver head to the LEFT of the ball", () => {
    expect(OPUS_DRIVER_HEAD.x).toBeLessThan(OPUS_BALL_CENTRE.x);
  });

  it("sends the ball left to right, toward Century Park East", () => {
    expect(OPUS_STRIKE_DIRECTION).toBe("left_to_right");
    const flight = css.match(/@keyframes tw-golfball-flight\{([^@]*)\}/)?.[1] ?? "";
    const dx = Number(flight.match(/translate\((-?\d+)vw/)?.[1]);
    expect(dx).toBeGreaterThan(0); // positive X = toward CPE, which renders right
  });

  it("hangs the hinge above the head so the shaft runs downward", () => {
    expect(OPUS_DRIVER_HINGE.y).toBeLessThan(OPUS_DRIVER_HEAD.y);
    expect(OPUS_DRIVER_HINGE.x).toBeLessThan(OPUS_DRIVER_HEAD.x);
  });

  it("pivots the swing at the hinge, not the tower base", () => {
    const { x, y } = hingeOriginPercent();
    expect(css).toContain(`transform-origin:${x}% ${y}%`);
  });

  it("locks the club and ball to the tower's own scale", () => {
    // The OPUS tower image is scaled 1.12 from centre bottom; both overlays
    // must match it exactly or they drift off the building.
    const towerScale = css.match(
      /\.tw-piece\.is-opus \.tw-building-layer\{transform:scale\(([\d.]+)\)/
    )?.[1];
    expect(towerScale).toBe("1.12");
    for (const rule of [
      /\.tw-opus-driver\{[^}]*transform:scale\(1\.12\);transform-origin:center bottom/,
      /\.tw-projectile\[data-weapon="golf-ball"\]\{[^}]*transform:scale\(1\.12\);transform-origin:center bottom/,
    ]) {
      expect(css).toMatch(rule);
    }
  });
});
