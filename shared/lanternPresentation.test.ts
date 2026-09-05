/**
 * The lantern presentation tier, tested through REAL cadence computation.
 *
 * Almost every case below builds its cadence by handing actual order dates to
 * `inferCustomerCadence` rather than by writing a `CustomerCadence` literal.
 * That is deliberate: the interesting failures are all about what the
 * classifier will and will not certify as measured, and a hand-written literal
 * would happily assert `confidence: "measured"` for a customer who has ordered
 * once — proving nothing except that the projection trusts its input.
 */
import { describe, expect, it } from "vitest";
import { inferCustomerCadence, type CustomerCadence } from "./lanternCity";
import {
  WEEKLY_CADENCE_DAYS,
  describeLanternPresentation,
  isWeeklyCadence,
  lanternArtStateFor,
  projectLanternPresentation,
} from "./lanternPresentation";

const TODAY = "2026-09-05";

/** Order dates every `intervalDays`, most recent `daysAgo` before TODAY. */
function orderDates(count: number, intervalDays: number, daysAgo = 0): string[] {
  const base = Date.UTC(2026, 8, 5) - daysAgo * 86_400_000;
  return Array.from({ length: count }, (_, index) =>
    new Date(base - (count - 1 - index) * intervalDays * 86_400_000)
      .toISOString()
      .slice(0, 10)
  );
}

const cadenceFor = (dates: string[], sparseFallback: "active" | "dimming" | "dark" = "active") =>
  inferCustomerCadence({ qualifyingOrderDates: dates, today: TODAY, sparseFallback });

describe("bright requires a proven weekly rhythm", () => {
  it("brightens a customer who genuinely orders every week", () => {
    const cadence = cadenceFor(orderDates(10, 7));
    expect(cadence.confidence).toBe("measured");
    expect(cadence.state).toBe("active");
    expect(projectLanternPresentation(cadence)).toBe("bright");
  });

  it("keeps a proven but non-weekly active customer at normal", () => {
    // Fortnightly is a real, healthy, measured rhythm — and it is not weekly.
    const cadence = cadenceFor(orderDates(10, 14));
    expect(cadence.confidence).toBe("measured");
    expect(cadence.state).toBe("active");
    expect(projectLanternPresentation(cadence)).toBe("normal");
  });

  it("does not brighten a recent order with no history behind it", () => {
    // THE SPREADSHEET CASE. A row with a recent Last Order and nothing else
    // cannot prove a rhythm, so it is active-normal. This is the shortcut a
    // future change is most likely to take, which is why it is pinned.
    const cadence = cadenceFor(orderDates(1, 0));
    expect(cadence.confidence).toBe("sparse");
    expect(projectLanternPresentation(cadence)).toBe("normal");
  });

  it("does not brighten from lifetime volume", () => {
    // 38 lifetime orders, all of them long ago. Volume is not a rhythm and it
    // is certainly not present activity.
    const cadence = cadenceFor(orderDates(38, 7, 400));
    expect(cadence.state).toBe("dark");
    expect(projectLanternPresentation(cadence)).toBe("dark");
  });

  it("needs enough dates to measure an interval at all", () => {
    // Two orders is one interval; the classifier requires more before it will
    // certify a cadence, and the projection must respect that refusal.
    const cadence = cadenceFor(orderDates(2, 7));
    expect(cadence.confidence).toBe("sparse");
    expect(projectLanternPresentation(cadence)).toBe("normal");
  });
});

describe("dormancy and cooling outrank any measured history", () => {
  it("darkens a formerly perfect weekly customer who stopped", () => {
    const cadence = cadenceFor(orderDates(20, 7, 90));
    expect(cadence.confidence).toBe("measured");
    expect(cadence.state).toBe("dark");
    expect(projectLanternPresentation(cadence)).toBe("dark");
  });

  it("dims a weekly customer who has slipped a couple of cycles", () => {
    const cadence = cadenceFor(orderDates(20, 7, 13));
    expect(cadence.state).toBe("dimming");
    expect(projectLanternPresentation(cadence)).toBe("dim");
  });

  it("carries the sparse fallback states straight through", () => {
    expect(projectLanternPresentation(cadenceFor([], "dark"))).toBe("dark");
    expect(projectLanternPresentation(cadenceFor([], "dimming"))).toBe("dim");
    expect(projectLanternPresentation(cadenceFor([], "active"))).toBe("normal");
  });
});

describe("the weekly band is defined once", () => {
  it("excludes fortnightly and monthly rhythms", () => {
    expect(isWeeklyCadence(7)).toBe(true);
    expect(isWeeklyCadence(WEEKLY_CADENCE_DAYS.min)).toBe(true);
    expect(isWeeklyCadence(WEEKLY_CADENCE_DAYS.max)).toBe(true);
    expect(isWeeklyCadence(WEEKLY_CADENCE_DAYS.min - 1)).toBe(false);
    expect(isWeeklyCadence(WEEKLY_CADENCE_DAYS.max + 1)).toBe(false);
    expect(isWeeklyCadence(14)).toBe(false);
    expect(isWeeklyCadence(30)).toBe(false);
  });

  it("treats an unmeasured interval as not weekly", () => {
    expect(isWeeklyCadence(null)).toBe(false);
    expect(isWeeklyCadence(Number.NaN)).toBe(false);
    expect(isWeeklyCadence(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("presentation never becomes business truth", () => {
  it("only ever splits active, and leaves the other states alone", () => {
    const states: Array<CustomerCadence["state"]> = ["active", "dimming", "dark"];
    for (const state of states) {
      const measured: CustomerCadence = {
        state,
        confidence: "measured",
        expectedCadenceDays: 7,
        daysSinceLastOrder: 3,
        expectedNextOrder: null,
        cyclesMissed: 0,
      };
      const result = projectLanternPresentation(measured);
      if (state === "active") expect(result).toBe("bright");
      else expect(result).toBe(state === "dimming" ? "dim" : "dark");
    }
  });

  it("maps back onto the three lantern artworks that exist", () => {
    // There are three lantern PNGs, not four. Bright and normal are the same
    // object burning differently, not a different customer type.
    expect(lanternArtStateFor("bright")).toBe("active");
    expect(lanternArtStateFor("normal")).toBe("active");
    expect(lanternArtStateFor("dim")).toBe("dimming");
    expect(lanternArtStateFor("dark")).toBe("dark");
  });

  it("says every state in words, so brightness is never the only signal", () => {
    const seen = new Set<string>();
    for (const p of ["bright", "normal", "dim", "dark"] as const) {
      const text = describeLanternPresentation(p);
      expect(text.length).toBeGreaterThan(0);
      seen.add(text);
    }
    expect(seen.size).toBe(4);
  });
});
