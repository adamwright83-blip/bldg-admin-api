import { describe, expect, it } from "vitest";
import {
  BAND_OVERLAP_PX,
  MAX_EDGE_PX,
  MAX_IMAGES,
  planTiles,
  wouldBeDownscaled,
} from "./screenshotTiling";

describe("phone screenshot tiling", () => {
  it("leaves an image that already fits completely alone", () => {
    const plan = planTiles(1170, 1200);
    expect(plan.offsets).toEqual([0]);
    expect(plan.bandHeight).toBe(1200);
  });

  it("recognises the real failure case — a modern phone screenshot", () => {
    // iPhone 14 Pro class. This is the image that produced zero jobs.
    expect(wouldBeDownscaled(1170, 2532)).toBe(true);
    const plan = planTiles(1170, 2532);
    expect(plan.offsets.length).toBeGreaterThan(1);
    expect(plan.bandHeight).toBeLessThanOrEqual(MAX_EDGE_PX);
  });

  it("keeps every band under the provider's resize threshold", () => {
    for (const height of [2000, 2532, 3000, 4000]) {
      const plan = planTiles(1170, height);
      expect(plan.bandHeight).toBeLessThanOrEqual(MAX_EDGE_PX);
    }
  });

  it("overlaps bands so a job row cannot fall into a seam", () => {
    const plan = planTiles(1170, 2532);
    for (let i = 1; i < plan.offsets.length; i += 1) {
      const previousBottom = plan.offsets[i - 1] + plan.bandHeight;
      const gap = previousBottom - plan.offsets[i];
      expect(gap).toBeGreaterThan(0);
    }
  });

  it("covers the whole screenshot — the last band reaches the bottom", () => {
    const height = 2532;
    const plan = planTiles(1170, height);
    const last = plan.offsets[plan.offsets.length - 1];
    expect(last + plan.bandHeight).toBeGreaterThanOrEqual(height);
  });

  it("never exceeds the request's image budget, even for a very tall image", () => {
    const plan = planTiles(1170, 12000);
    expect(plan.offsets.length).toBeLessThanOrEqual(MAX_IMAGES);
    // And still spans the image rather than covering only the top.
    const last = plan.offsets[plan.offsets.length - 1];
    expect(last).toBeGreaterThan(0);
  });

  it("respects a reduced budget when several screenshots share the request", () => {
    const plan = planTiles(1170, 2532, MAX_EDGE_PX, BAND_OVERLAP_PX, 2);
    expect(plan.offsets.length).toBeLessThanOrEqual(2);
  });

  it("does not pretend banding helps an over-wide image", () => {
    // Width is over budget, so the provider resizes regardless; cutting
    // horizontally would cost context and fix nothing.
    const plan = planTiles(3000, 4000);
    expect(plan.offsets).toEqual([0]);
  });

  it("produces deterministic offsets — the same screenshot tiles identically", () => {
    expect(planTiles(1170, 2532)).toEqual(planTiles(1170, 2532));
  });
});
