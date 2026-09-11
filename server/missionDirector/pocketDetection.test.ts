import { describe, expect, it } from "vitest";
import { detectTimePockets } from "./pocketDetection";

describe("detectTimePockets", () => {
  it("returns an open-ended low-confidence pocket with no minute count when nothing is scheduled", () => {
    const pockets = detectTimePockets({
      timeline: [{ id: "a", title: "unscheduled follow-up", scheduledAt: null, kind: "follow_up" }],
    });
    expect(pockets).toHaveLength(1);
    expect(pockets[0].kind).toBe("open_ended");
    expect(pockets[0].minutes).toBeNull();
    expect(pockets[0].usableMinutes).toBeNull();
    expect(pockets[0].confidence).toBe("low");
  });

  it("computes a high-confidence between_stops pocket from two real scheduled items", () => {
    const pockets = detectTimePockets({
      timeline: [
        { id: "p1", title: "Pickup", scheduledAt: "2026-09-12T15:00:00.000Z", kind: "pickup" },
        { id: "d1", title: "Delivery", scheduledAt: "2026-09-12T16:30:00.000Z", kind: "delivery" },
      ],
      travelReserveMinutes: 15,
    });
    expect(pockets).toHaveLength(1);
    expect(pockets[0].kind).toBe("between_stops");
    expect(pockets[0].minutes).toBe(90);
    expect(pockets[0].usableMinutes).toBe(75);
    expect(pockets[0].confidence).toBe("high");
    expect(pockets[0].boundedBy).toEqual({ before: "p1", after: "d1" });
  });

  it("never emits a pocket for an item with no real scheduledAt", () => {
    const pockets = detectTimePockets({
      timeline: [
        { id: "p1", title: "Pickup", scheduledAt: "2026-09-12T15:00:00.000Z", kind: "pickup" },
        { id: "flex", title: "Flexible visit", scheduledAt: null, kind: "commercial_visit" },
      ],
    });
    // Only one fixed item — no pair to bound a between_stops pocket.
    expect(pockets).toHaveLength(0);
  });

  it("floors usableMinutes at zero when the reserve exceeds the gap", () => {
    const pockets = detectTimePockets({
      timeline: [
        { id: "p1", title: "Pickup", scheduledAt: "2026-09-12T15:00:00.000Z", kind: "pickup" },
        { id: "d1", title: "Delivery", scheduledAt: "2026-09-12T15:05:00.000Z", kind: "delivery" },
      ],
      travelReserveMinutes: 15,
    });
    expect(pockets[0].usableMinutes).toBe(0);
  });
});
