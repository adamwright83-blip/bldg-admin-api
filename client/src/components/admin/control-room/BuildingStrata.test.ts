import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { intensityClass, shortDate } from "./BuildingStrata";
import { settleTowerWars } from "@shared/towerWarsSettlement";
import { TOWER_WARS_ATTACK_THRESHOLD_CENTS } from "@shared/goldlineGameConfig";
import type { TowerWarsBusinessEvent } from "@shared/towerWars";

let sequence = 0;
function event(
  businessDate: string,
  buildingId: TowerWarsBusinessEvent["buildingId"],
  cents: number
): TowerWarsBusinessEvent {
  sequence += 1;
  return {
    eventId: `event:${sequence}`,
    occurredAt: `${businessDate}T12:00:00.000Z`,
    businessDate,
    buildingId,
    buildingDisplayName: buildingId,
    orderId: sequence,
    customerIdentity: `customer:${sequence}`,
    customerDisplayName: null,
    customerPhone: null,
    revenueSource: "stripe",
    realOrderValueCents: cents,
    sourceEvidence: {},
  };
}

describe("stratum intensity bands", () => {
  it("maps absorbed attacks onto the four damage bands", () => {
    expect(intensityClass(1)).toBe("cr-stratum--chipped");
    expect(intensityClass(2)).toBe("cr-stratum--cracked");
    expect(intensityClass(3)).toBe("cr-stratum--heavy");
    expect(intensityClass(4)).toBe("cr-stratum--critical");
  });

  it("keeps saturating above four rather than inventing a fifth band", () => {
    expect(intensityClass(12)).toBe("cr-stratum--critical");
  });
});

describe("stratum dates", () => {
  it("renders a compact month/day without a year", () => {
    expect(shortDate("2026-08-29")).toBe("8/29");
    expect(shortDate("2026-12-01")).toBe("12/1");
  });
});

describe("the facade consumes real settled history", () => {
  const settlement = settleTowerWars({
    events: [
      event("2026-08-25", "opus_la", TOWER_WARS_ATTACK_THRESHOLD_CENTS),
      event("2026-08-27", "opus_la", TOWER_WARS_ATTACK_THRESHOLD_CENTS * 3),
      event("2026-08-29", "opus_la", TOWER_WARS_ATTACK_THRESHOLD_CENTS),
    ],
    todayBusinessDate: "2026-08-29",
  });
  const cpe = settlement.buildings.century_park_east;

  it("has strata oldest-first from the settlement, which the view reverses", () => {
    expect(cpe.strata.map(s => s.businessDate)).toEqual([
      "2026-08-25",
      "2026-08-27",
    ]);
    // The component renders [...strata].reverse() so the oldest sits lowest.
    const rendered = [...cpe.strata].reverse();
    expect(rendered[0]!.businessDate).toBe("2026-08-27");
    expect(rendered.at(-1)!.businessDate).toBe("2026-08-25");
  });

  it("gives each settled day a band the view can render", () => {
    expect(cpe.strata.map(s => intensityClass(s.incomingAttacks))).toEqual([
      "cr-stratum--chipped",
      "cr-stratum--heavy",
    ]);
  });

  it("keeps today separate from the settled record", () => {
    expect(cpe.today.incomingAttacks).toBe(1);
    expect(cpe.settledScars).toBe(4);
  });
});

describe("facade copy never presents a denominator", () => {
  const raw = readFileSync(
    new URL("./BuildingStrata.tsx", import.meta.url),
    "utf8"
  );
  // Strip comments: the doc block explains why there are no percentages here,
  // and a guard that trips on its own rationale is worse than no guard.
  const source = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("renders no percentage or fraction of a total", () => {
    // A real business has no completion denominator; the facade must not
    // imply one. Guarding the copy is cheaper than re-litigating it later.
    expect(source).not.toMatch(/toFixed\(\s*\d*\s*\)\s*}?\s*%/);
    expect(source).not.toContain("percent");
    expect(source).not.toMatch(/\bout of\b/);
  });

  it("keeps the exact counts behind a disclosure rather than shouting them", () => {
    expect(source).toContain("Show me the math");
    expect(source).toContain("showCounts");
  });
});
