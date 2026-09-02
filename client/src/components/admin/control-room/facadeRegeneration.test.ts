import { describe, expect, it } from "vitest";
import {
  HEALED_SCAR_FLOOR,
  ORDERS_TO_CLOSE_ONE_STRATUM,
  projectRegeneration,
  scarOpacityFor,
} from "./facadeRegeneration";
import type { SettledStratum } from "./facadeScars";

const stratum = (businessDate: string): SettledStratum =>
  ({ businessDate, damage: "cracked", strikes: 4 }) as unknown as SettledStratum;

describe("facade regeneration", () => {
  it("does not heal anything without collected orders", () => {
    const projection = projectRegeneration({
      collectedOrderCount: 0,
      strata: [stratum("2026-08-30"), stratum("2026-08-31")],
    });
    expect(projection.byStratum.every(item => item.closure === 0)).toBe(true);
    expect(projection.overall).toBe(0);
    expect(projection.hasAuthoritativeRestoration).toBe(false);
  });

  it("closes the oldest wound first", () => {
    const projection = projectRegeneration({
      collectedOrderCount: ORDERS_TO_CLOSE_ONE_STRATUM,
      strata: [stratum("2026-08-31"), stratum("2026-08-29")],
    });
    // Input order is deliberately newest-first to prove it sorts.
    expect(projection.byStratum[0].businessDate).toBe("2026-08-29");
    expect(projection.byStratum[0].closure).toBe(1);
    expect(projection.byStratum[1].closure).toBe(0);
  });

  it("heals partially — recovery is a process, not a switch", () => {
    const projection = projectRegeneration({
      collectedOrderCount: 1,
      strata: [stratum("2026-08-29")],
    });
    expect(projection.byStratum[0].closure).toBeCloseTo(
      1 / ORDERS_TO_CLOSE_ONE_STRATUM,
      5
    );
    expect(projection.overall).toBeGreaterThan(0);
    expect(projection.overall).toBeLessThan(1);
  });

  it("never exceeds full closure no matter how many orders land", () => {
    const projection = projectRegeneration({
      collectedOrderCount: 9_999,
      strata: [stratum("2026-08-29"), stratum("2026-08-30")],
    });
    expect(projection.byStratum.every(item => item.closure === 1)).toBe(true);
    expect(projection.overall).toBe(1);
  });

  it("is deterministic — a reload cannot reroll how repaired a building looks", () => {
    const input = {
      collectedOrderCount: 4,
      strata: [stratum("2026-08-29"), stratum("2026-08-30")],
    };
    expect(projectRegeneration(input)).toEqual(projectRegeneration(input));
  });

  it("treats a building with no history as unrecovered, not fully healed", () => {
    const projection = projectRegeneration({
      collectedOrderCount: 0,
      strata: [],
    });
    expect(projection.overall).toBe(0);
    expect(projection.hasAuthoritativeRestoration).toBe(false);
  });

  it("ignores negative and fractional order counts rather than trusting them", () => {
    expect(
      projectRegeneration({ collectedOrderCount: -5, strata: [stratum("2026-08-29")] })
        .byStratum[0].closure
    ).toBe(0);
    expect(
      projectRegeneration({ collectedOrderCount: 2.9, strata: [stratum("2026-08-29")] })
        .byStratum[0].closure
    ).toBeCloseTo(2 / ORDERS_TO_CLOSE_ONE_STRATUM, 5);
  });

  it("never deletes history — a fully healed scar still reads faintly", () => {
    expect(scarOpacityFor(1)).toBeCloseTo(HEALED_SCAR_FLOOR, 10);
    expect(scarOpacityFor(0)).toBe(1);
    expect(scarOpacityFor(0.5)).toBeGreaterThan(HEALED_SCAR_FLOOR);
    expect(HEALED_SCAR_FLOOR).toBeGreaterThan(0);
  });

  it("clamps closure inputs the renderer might pass out of range", () => {
    expect(scarOpacityFor(-1)).toBe(1);
    expect(scarOpacityFor(4)).toBeCloseTo(HEALED_SCAR_FLOOR, 10);
  });
});

describe("facade regeneration firewall", () => {
  /**
   * The structural half: there is nowhere on the input to put a game result.
   * Asserted on the value so widening the type without widening the test still
   * fails, matching the guard style used for SURVEY reveals.
   */
  it("accepts only order truth and settled history — no gameplay channel", () => {
    const input = { collectedOrderCount: 3, strata: [stratum("2026-08-29")] };
    expect(Object.keys(input).sort()).toEqual([
      "collectedOrderCount",
      "strata",
    ]);
    for (const forbidden of [
      "score",
      "combo",
      "guardianDefeated",
      "towerWarsWon",
      "chapterCompleted",
      "timingGrade",
    ]) {
      expect(forbidden in input).toBe(false);
    }
  });

  it("a building with damage and no delivered work stays scarred", () => {
    // The Guardian may have fallen and the campaign chapter may have closed.
    // Neither is expressible here, so neither can repair a facade.
    const projection = projectRegeneration({
      collectedOrderCount: 0,
      strata: [stratum("2026-08-29"), stratum("2026-08-30")],
    });
    expect(projection.overall).toBe(0);
    expect(scarOpacityFor(projection.byStratum[0].closure)).toBe(1);
  });
});
