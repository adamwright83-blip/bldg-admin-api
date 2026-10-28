import { describe, expect, it } from "vitest";
import type { LanternTerritoryMetric, LanternTerritoryReport } from "@shared/lanternTerritoryReport";
import { chapterEyebrow, heroLines, HOME_NAV, metricView, neighbourhoodCards, neighbourhoodHref, NOT_WIRED, claimDailyIntro, localDay } from "./homeModel";

function territory(id: string, name: string, revenueCents: number | null, locatedCustomers: number): LanternTerritoryMetric {
  return {
    id,
    name,
    revenueCents,
    previousRevenueCents: null,
    revenueChangeCents: null,
    paidOrderCount: null,
    activeCustomers: null,
    dormantCustomers: null,
    locatedCustomers,
    direction: "unknown",
    directionReliable: false,
    evidenceNote: "",
    customers: [],
  };
}

function report(territories: LanternTerritoryMetric[], status: LanternTerritoryReport["status"] = "ready"): LanternTerritoryReport {
  return { status, territories } as LanternTerritoryReport;
}

describe("metricView", () => {
  it("an unsourced figure says Not wired yet, never $0", () => {
    expect(metricView({ value: null, previous: 100, changePct: null, precision: "unavailable" }, "cents")).toEqual({
      text: NOT_WIRED,
      wired: false,
      recorded: false,
      change: null,
    });
    expect(metricView(undefined, "count").text).toBe(NOT_WIRED);
  });

  it("formats money, counts and the change", () => {
    expect(metricView({ value: 1234500, previous: 1000000, changePct: 23.5, precision: "exact" }, "cents")).toMatchObject({
      text: "$12,345",
      recorded: false,
      change: { text: "+23.5%", direction: "up" },
    });
    expect(metricView({ value: 7, previous: 10, changePct: -30, precision: "recorded" }, "count")).toMatchObject({
      text: "7",
      recorded: true,
      change: { text: "−30%", direction: "down" },
    });
    expect(metricView({ value: 7, previous: 2, changePct: 250, precision: "exact" }, "count").change?.text).toBe("+250%");
    expect(metricView({ value: 3, previous: null, changePct: null, precision: "exact" }, "count").change).toBeNull();
  });
});

describe("neighbourhoodCards", () => {
  it("shows only the operator's real neighbourhoods, biggest first", () => {
    const cards = neighbourhoodCards(
      report([
        territory("echo-park", "Echo Park", 20000, 4),
        territory("bel-air", "Bel Air", null, 0),
        territory("silver-lake", "Silver Lake", 90000, 12),
        territory("los-feliz", "Los Feliz", null, 3),
      ])
    );
    expect(cards.map(card => card.id)).toEqual(["silver-lake", "echo-park", "los-feliz"]);
    expect(cards[0]).toMatchObject({ name: "Silver Lake", revenueText: "$900", customers: 12 });
    expect(cards[2]!.revenueText).toBe(NOT_WIRED);
  });

  it("is empty when the geography is unsupported or the report has not loaded", () => {
    expect(neighbourhoodCards(report([territory("x", "X", 100, 1)], "unsupported_geography"))).toEqual([]);
    expect(neighbourhoodCards(undefined)).toEqual([]);
  });
});

describe("neighbourhoodHref", () => {
  it("opens an existing game or tower view, otherwise the island board", () => {
    expect(neighbourhoodHref("silver-lake")).toContain("cozy=1");
    expect(neighbourhoodHref("beverly-hills")).toBe("/growth/lantern-city?level=beverly-hills");
    expect(neighbourhoodHref("century-city")).toBe("/growth/lantern-city?level=century-park-east");
    expect(neighbourhoodHref("echo-park")).toBe("/growth/lantern-city");
  });
});

describe("top bar", () => {
  it("every icon goes somewhere real", () => {
    expect(HOME_NAV.map(item => item.path)).toEqual(["/growth/lantern-city", "/customers", "/operations", "/money", "/settings"]);
  });
});

describe("hero copy", () => {
  const line = (key: string) => ({ key, text: `server text ${key}`, still: null });
  it("puts the last before-line in Claire's note when there are two or more", () => {
    expect(heroLines([line("b1"), line("b2")])).toEqual({ hook: [line("b1")], note: line("b2") });
    expect(heroLines([line("b1")])).toEqual({ hook: [line("b1")], note: null });
  });
  it("numbers the chapter", () => {
    expect(chapterEyebrow(1)).toBe("CHAPTER 01");
    expect(chapterEyebrow(12)).toBe("CHAPTER 12");
  });
});

describe("claimDailyIntro", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  const evening = new Date(2026, 9, 27, 21, 0);
  const nextMorning = new Date(2026, 9, 28, 8, 0);

  it("plays on the first open of the day and not again that day", () => {
    const storage = memory();
    expect(claimDailyIntro({ now: evening, reducedMotion: false, search: "", storage })).toBe(true);
    expect(claimDailyIntro({ now: evening, reducedMotion: false, search: "", storage })).toBe(false);
    expect(claimDailyIntro({ now: nextMorning, reducedMotion: false, search: "", storage })).toBe(true);
  });

  it("never plays with reduced motion, unless forced with ?intro=1", () => {
    expect(claimDailyIntro({ now: evening, reducedMotion: true, search: "", storage: memory() })).toBe(false);
    expect(claimDailyIntro({ now: evening, reducedMotion: true, search: "?intro=1", storage: memory() })).toBe(true);
  });

  it("plays when storage is unavailable rather than failing", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(claimDailyIntro({ now: evening, reducedMotion: false, search: "", storage: broken })).toBe(true);
    expect(claimDailyIntro({ now: evening, reducedMotion: false, search: "", storage: null })).toBe(true);
  });

  it("uses the viewer's own calendar day", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
