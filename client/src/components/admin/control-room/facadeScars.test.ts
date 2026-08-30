import { describe, expect, it } from "vitest";
import {
  MAX_PATINA_ZONES,
  MAX_RENDERED_SCARS,
  projectFacade,
  projectFacadeScars,
  scarKindFor,
  scarsWereTruncated,
  type SettledStratum,
} from "./facadeScars";

const strata: SettledStratum[] = [
  {
    businessDate: "2026-08-24",
    incomingAttacks: 1,
    damageAtSettlement: "chipped",
  },
  {
    businessDate: "2026-08-26",
    incomingAttacks: 3,
    damageAtSettlement: "heavily-damaged",
  },
  {
    businessDate: "2026-08-28",
    incomingAttacks: 2,
    damageAtSettlement: "cracked",
  },
];

describe("scars correspond exactly to settled strikes", () => {
  it("draws one mark per real absorbed attack and not one more", () => {
    const scars = projectFacadeScars(strata);
    expect(scars).toHaveLength(1 + 3 + 2);
  });

  it("attributes every mark to a real business date", () => {
    const dates = new Set(projectFacadeScars(strata).map(s => s.businessDate));
    expect(Array.from(dates).sort()).toEqual([
      "2026-08-24",
      "2026-08-26",
      "2026-08-28",
    ]);
  });

  it("invents nothing for a building with no settled history", () => {
    expect(projectFacadeScars([])).toEqual([]);
  });

  it("ignores a day the building absorbed nothing", () => {
    const scars = projectFacadeScars([
      {
        businessDate: "2026-08-25",
        incomingAttacks: 0,
        damageAtSettlement: "pristine",
      },
    ]);
    expect(scars).toEqual([]);
  });
});

describe("severity comes from the settled day, not from decoration", () => {
  it("maps each damage state to its repair kind", () => {
    expect(scarKindFor("chipped")).toBe("patch");
    expect(scarKindFor("cracked")).toBe("seam");
    expect(scarKindFor("heavily-damaged")).toBe("panel");
    expect(scarKindFor("critical")).toBe("graft");
  });

  it("gives every mark from one day the same kind", () => {
    const heavy = projectFacadeScars(strata).filter(
      s => s.businessDate === "2026-08-26"
    );
    expect(heavy).toHaveLength(3);
    expect(new Set(heavy.map(s => s.kind))).toEqual(new Set(["panel"]));
  });
});

describe("placement is deterministic", () => {
  it("puts the same real day in the same place on every render", () => {
    const first = projectFacadeScars(strata);
    const second = projectFacadeScars(strata);
    expect(second).toEqual(first);
  });

  it("keeps a day's position stable as later history accumulates", () => {
    const early = projectFacadeScars(strata.slice(0, 2)).filter(
      s => s.businessDate === "2026-08-24"
    );
    const later = projectFacadeScars([
      ...strata,
      {
        businessDate: "2026-09-02",
        incomingAttacks: 4,
        damageAtSettlement: "critical",
      },
    ]).filter(s => s.businessDate === "2026-08-24");
    expect(later[0]!.xPercent).toBe(early[0]!.xPercent);
    expect(later[0]!.yPercent).toBe(early[0]!.yPercent);
  });

  it("keeps every mark inside the facade, off the extreme edges", () => {
    for (const scar of projectFacadeScars(strata)) {
      expect(scar.xPercent).toBeGreaterThanOrEqual(18);
      expect(scar.xPercent).toBeLessThanOrEqual(82);
      expect(scar.yPercent).toBeGreaterThanOrEqual(22);
      expect(scar.yPercent).toBeLessThanOrEqual(88);
    }
  });

  it("does not stack every mark of a day in one spot", () => {
    const heavy = projectFacadeScars(strata).filter(
      s => s.businessDate === "2026-08-26"
    );
    expect(new Set(heavy.map(s => `${s.xPercent},${s.yPercent}`)).size).toBe(3);
  });
});

describe("age reads as integration, oldest first", () => {
  it("ranks the oldest settled day at zero and the newest at one", () => {
    const scars = projectFacadeScars(strata);
    expect(scars.find(s => s.businessDate === "2026-08-24")!.recency).toBe(0);
    expect(scars.find(s => s.businessDate === "2026-08-28")!.recency).toBe(1);
  });

  it("treats a single settled day as fully recent", () => {
    const scars = projectFacadeScars([strata[0]!]);
    expect(scars[0]!.recency).toBe(1);
  });
});

describe("dense history compresses rather than disappearing", () => {
  // 40 days x 4 strikes = 160 absorbed, far past the individual-draw budget.
  const heavy: SettledStratum[] = Array.from({ length: 40 }).map((_, i) => ({
    businessDate: `2026-06-${String(i + 1).padStart(2, "0")}`,
    incomingAttacks: 4,
    damageAtSettlement: "critical" as const,
  }));

  it("never draws more individual marks than the budget", () => {
    expect(projectFacade(heavy).scars.length).toBeLessThanOrEqual(
      MAX_RENDERED_SCARS
    );
  });

  it("consolidates the older era instead of dropping it", () => {
    const { patina, compressed } = projectFacade(heavy);
    expect(compressed).toBe(true);
    expect(patina.length).toBeGreaterThan(0);
    expect(patina.length).toBeLessThanOrEqual(MAX_PATINA_ZONES);
  });

  it("preserves every absorbed strike across scars plus patina", () => {
    const { scars, patina } = projectFacade(heavy);
    const total = heavy.reduce((sum, s) => sum + s.incomingAttacks, 0);
    const kept =
      scars.length + patina.reduce((sum, z) => sum + z.absorbedStrikes, 0);
    // Nothing is lost: the oldest history became weathering, not absence.
    expect(kept).toBe(total);
  });

  it("keeps the most recent days as individual repairs", () => {
    const { scars } = projectFacade(heavy);
    expect(scars.some(s => s.businessDate === heavy.at(-1)!.businessDate)).toBe(
      true
    );
  });

  it("gives each patina zone a real date range and strike count", () => {
    for (const zone of projectFacade(heavy).patina) {
      expect(zone.fromDate <= zone.toDate).toBe(true);
      expect(zone.absorbedStrikes).toBeGreaterThan(0);
      expect(zone.days).toBeGreaterThan(0);
    }
  });

  it("never splits a single day between drawn and compressed", () => {
    const { scars, patina } = projectFacade(heavy);
    const drawnDates = new Set(scars.map(s => s.businessDate));
    for (const zone of patina) {
      // A compressed zone's range must not contain an individually drawn day.
      for (const date of drawnDates) {
        expect(date >= zone.fromDate && date <= zone.toDate).toBe(false);
      }
    }
  });

  it("does not compress a record that fits", () => {
    const { patina, compressed, scars } = projectFacade(strata);
    expect(compressed).toBe(false);
    expect(patina).toEqual([]);
    expect(scars).toHaveLength(6);
    expect(scarsWereTruncated(strata)).toBe(false);
  });

  it("is deterministic", () => {
    expect(projectFacade(heavy)).toEqual(projectFacade(heavy));
  });
});
