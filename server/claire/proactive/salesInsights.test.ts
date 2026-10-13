import { expect, it } from "vitest";
import { selectSalesInsight } from "./salesInsights";
import {
  defaultBusinessQuery,
  type BusinessQueryResult,
} from "../../analytics/businessQuery";
import { resolvePeriod } from "../../analytics/businessPeriods";

function result(precision = true): BusinessQueryResult {
  const now = new Date("2026-10-04T19:00:00Z"),
    timeZone = "America/Los_Angeles";
  return {
    status: "ok",
    query: defaultBusinessQuery("revenue"),
    period: resolvePeriod(
      {
        kind: "between",
        start: "2026-09-01",
        end: "2026-09-30",
        label: "September",
      },
      now,
      timeZone
    ),
    comparisonPeriod: resolvePeriod(
      {
        kind: "between",
        start: "2026-08-01",
        end: "2026-08-31",
        label: "August",
      },
      now,
      timeZone
    ),
    coverage: {
      canonicalRevenue: {
        mayStateExact: precision,
        comparisonMayStateExact: precision,
      },
    } as any,
    data: {
      kind: "totals",
      current: { revenueCents: 349499, orderCount: 50, aovCents: 6990 },
      previous: { revenueCents: 184588, orderCount: 30, aovCents: 6153 },
      comparison: null,
      movers: null,
    },
  };
}
it("derives material closed-month movement and artifact from the same cents", () => {
  const insight = selectSalesInsight(result(), "2026-10-04");
  expect(insight?.speech).toContain("89.3%");
  expect(insight?.series.map(point => point.cents)).toEqual([184588, 349499]);
});
it("suppresses partial, unavailable and trivial data", () => {
  expect(selectSalesInsight(result(false), "2026-10-04")).toBeNull();
  const partial = result();
  if (partial.status === "ok") partial.period.end = "2026-10-04";
  expect(selectSalesInsight(partial, "2026-10-04")).toBeNull();
  const trivial = result();
  if (trivial.status === "ok" && trivial.data.kind === "totals")
    trivial.data.current.revenueCents = 184600;
  expect(selectSalesInsight(trivial, "2026-10-04")).toBeNull();
});
it("states strongest month only when canonical historical ranking proves it", () => {
  const history = result();
  if (history.status !== "ok") throw new Error("fixture");
  history.data = { kind: "period_ranking", groupBy: "month", rows: [{ key: "2026-09", revenueCents: 349499, orderCount: 50, aovCents: 6990 }, { key: "2026-08", revenueCents: 184588, orderCount: 30, aovCents: 6153 }] };
  expect(selectSalesInsight(result(), "2026-10-04", history)?.speech).toContain("strongest completed month");
  history.coverage!.canonicalRevenue!.mayStateExact = false;
  expect(selectSalesInsight(result(), "2026-10-04", history)?.speech).not.toContain("strongest");
});

it("proposes a marketing challenge only from an exact material decline, without inventing its cause", () => {
  const decline = result();
  if (decline.status !== "ok" || decline.data.kind !== "totals") throw new Error("fixture");
  decline.data.current.revenueCents = 100000;
  decline.data.previous!.revenueCents = 200000;
  const insight = selectSalesInsight(decline, "2026-10-04");
  expect(insight).not.toBeNull();
  expect(insight!.recommendedChallenge).toMatchObject({
    kind: "marketing_challenge",
    status: "proposal_only",
    title: "Diagnose the paid-revenue decline",
    requiresOperatorApproval: true,
    sourceObservationReference: insight!.observationReference,
  });
  expect(insight!.speech).toContain("I'd suggest a marketing challenge");
  expect(insight!.recommendedChallenge!.why).toContain("cause has not been established");
  expect(insight!.recommendedChallenge!.completionCondition).toContain("measurable recovery experiment");
});
it("does not suggest a decline challenge for growth or stale/unreliable evidence", () => {
  expect(selectSalesInsight(result(), "2026-10-04")?.recommendedChallenge).toBeNull();
  const missing = result(false);
  if (missing.status === "ok" && missing.data.kind === "totals") {
    missing.data.current.revenueCents = 100000;
    missing.data.previous!.revenueCents = 200000;
  }
  expect(selectSalesInsight(missing, "2026-10-04")).toBeNull();
});
