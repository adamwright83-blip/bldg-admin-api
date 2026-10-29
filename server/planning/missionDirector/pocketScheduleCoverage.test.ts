import { describe, expect, it } from "vitest";
import { detectTimePockets } from "./pocketDetection";

const timeline = [
  {
    id: "p1",
    title: "Pickup OPUS",
    scheduledAt: "2026-10-29T16:00:00.000Z",
    kind: "pickup",
  },
  {
    id: "d1",
    title: "Delivery CPE",
    scheduledAt: "2026-10-29T20:00:00.000Z",
    kind: "delivery",
  },
];

describe("time pockets respect schedule coverage", () => {
  it("a verified-complete schedule keeps its high-confidence pocket", () => {
    const pockets = detectTimePockets({
      timeline,
      scheduleCoverage: { complete: true, reason: null },
    });
    expect(pockets.some(p => p.confidence === "high")).toBe(true);
  });

  it("an unverified schedule claims no window: every pocket is low confidence, with the reason", () => {
    const pockets = detectTimePockets({
      timeline,
      scheduleCoverage: {
        complete: false,
        reason: "Deliveries aren't synced from CleanCloud yet.",
      },
    });
    expect(pockets.length).toBeGreaterThan(0);
    expect(pockets.every(p => p.confidence === "low")).toBe(true);
    expect(pockets[0]!.warnings.at(-1)).toMatch(
      /Schedule not verified complete: Deliveries aren't synced/
    );
  });

  it("without coverage information the detector behaves exactly as before", () => {
    expect(detectTimePockets({ timeline })).toEqual(
      detectTimePockets({
        timeline,
        scheduleCoverage: { complete: true, reason: null },
      })
    );
  });
});
