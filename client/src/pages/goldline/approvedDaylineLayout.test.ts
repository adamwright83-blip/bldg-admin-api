import { describe, expect, it } from "vitest";
import type { DayPlanStop } from "../driver/goldlineDayPlanModel";
import { approvedDaylinePlacements } from "./approvedDaylineLayout";

function stop(id: string, kind: DayPlanStop["kind"]) {
  return { id, kind };
}

describe("approved DAY LINE layout", () => {
  it("places all five canonical actions at their approved measured rectangles", () => {
    expect(
      approvedDaylinePlacements([
        stop("pickup:1", "pickup"),
        stop("dropoff:1", "dropoff"),
        stop("sales:1", "sales"),
        stop("growth:1", "growth"),
        stop("marketing:1", "marketing"),
      ])
    ).toEqual([
      {
        left: 198,
        top: 256,
        width: 275,
        height: 119,
        pinLeft: 102,
        pinTop: 300,
      },
      {
        left: 631,
        top: 402,
        width: 268,
        height: 118,
        pinLeft: 543,
        pinTop: 449,
      },
      {
        left: 559,
        top: 677,
        width: 301,
        height: 130,
        pinLeft: 324,
        pinTop: 701,
      },
      {
        left: 629,
        top: 961,
        width: 238,
        height: 108,
        pinLeft: 515,
        pinTop: 1030,
      },
      {
        left: 559,
        top: 1238,
        width: 334,
        height: 83,
        pinLeft: 500,
        pinTop: 1263,
      },
    ]);
  });

  it("keeps approved landmarks for a subset without manufacturing missing actions", () => {
    const placements = approvedDaylinePlacements([
      stop("growth:1", "growth"),
      stop("pickup:1", "pickup"),
    ]);
    expect(placements).toHaveLength(2);
    expect(placements.map(placement => placement.top)).toEqual([961, 256]);
    expect(
      approvedDaylinePlacements([stop("marketing:1", "marketing")])[0]
    ).toEqual({
      left: 559,
      top: 1238,
      width: 334,
      height: 83,
      pinLeft: 500,
      pinTop: 1263,
    });
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "keeps %i generic or repeated actions independently readable in the scene",
    count => {
      const stops = Object.freeze(
        Array.from({ length: count }, (_, index) =>
          Object.freeze(stop(`source:${index}`, count === 1 ? "prep" : "sales"))
        )
      );
      const placements = approvedDaylinePlacements(stops);

      expect(placements).toHaveLength(stops.length);
      expect(new Set(placements.map(placement => placement.top)).size).toBe(
        count
      );
      expect(
        placements.every(
          placement =>
            placement.top >= 256 &&
            placement.top + placement.height <= 1320 &&
            placement.left >= 0 &&
            placement.left + placement.width <= 941
        )
      ).toBe(true);
      placements.forEach((placement, index) => {
        expect(placement.pinLeft).toBeLessThan(placement.left);
        expect(placement.pinTop).toBeGreaterThanOrEqual(placement.top);
        expect(placement.pinTop).toBeLessThanOrEqual(
          placement.top + placement.height
        );
        if (index > 0) {
          const previous = placements[index - 1];
          expect(placement.top - previous.top).toBeGreaterThanOrEqual(128);
          expect(placement.top).toBeGreaterThan(previous.top + previous.height);
        }
      });
      expect(stops.map(item => item.id)).toEqual(
        Array.from({ length: count }, (_, index) => `source:${index}`)
      );
    }
  );

  it("keeps mixed repeated actions in projection order without overlapping known landmarks", () => {
    const placements = approvedDaylinePlacements([
      stop("sales:1", "sales"),
      stop("growth:1", "growth"),
      stop("sales:2", "sales"),
      stop("processing:1", "processing"),
    ]);
    expect(placements.map(placement => placement.top)).toEqual([
      256, 574, 892, 1210,
    ]);
  });

  it("continues long days with separate slots instead of shrinking or colliding them", () => {
    const placements = approvedDaylinePlacements(
      Array.from({ length: 12 }, (_, index) => stop(`sales:${index}`, "sales"))
    );
    expect(placements).toHaveLength(12);
    expect(placements[11].top + placements[11].height).toBeGreaterThan(1320);
    expect(
      placements.every(
        (placement, index) =>
          placement.width === 334 &&
          placement.height === 110 &&
          (index === 0 || placement.top >= placements[index - 1].top + 128)
      )
    ).toBe(true);
  });

  it("returns fresh placement records and an empty layout for an empty projection", () => {
    expect(approvedDaylinePlacements([])).toEqual([]);
    const first = approvedDaylinePlacements([stop("pickup:1", "pickup")]);
    first[0].top = 0;
    expect(approvedDaylinePlacements([stop("pickup:1", "pickup")])[0].top).toBe(
      256
    );
  });
});
