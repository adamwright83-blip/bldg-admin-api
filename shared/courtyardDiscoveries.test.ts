import { describe, expect, it } from "vitest";
import {
  EMPTY_DISCOVERIES,
  applyObservation,
  discoveriesFromFlight,
  normalizeDiscoveries,
  rememberedBefore,
} from "./courtyardDiscoveries";

const NOW = "2026-10-29T18:00:00.000Z";

describe("courtyard discoveries", () => {
  it("proves only what a flight's observed contacts show", () => {
    expect(
      discoveriesFromFlight({
        flightId: "f1aaaaaa",
        delivered: false,
        via: ["fan", "cup0", "cup1", "cup2"],
        cups: [0, 1, 2],
      })
    ).toEqual(["three_cups"]);
    expect(
      discoveriesFromFlight({
        flightId: "f2aaaaaa",
        delivered: true,
        via: ["fan"],
        cups: [],
      })
    ).toEqual(["first_delivery"]);
    expect(
      discoveriesFromFlight({
        flightId: "f3aaaaaa",
        delivered: true,
        via: ["fan", "cat", "tail"],
        cups: [],
      })
    ).toContain("cat_assist");
    expect(
      discoveriesFromFlight({
        flightId: "f4aaaaaa",
        delivered: true,
        via: ["fan", "line"],
        cups: [],
      })
    ).toContain("fan_and_line");
    // a cat touch that did not end in the basket proves nothing about the cat
    expect(
      discoveriesFromFlight({
        flightId: "f5aaaaaa",
        delivered: false,
        via: ["cat", "tail"],
        cups: [],
      })
    ).toEqual([]);
    // cups out of order are not the trick
    expect(
      discoveriesFromFlight({
        flightId: "f6aaaaaa",
        delivered: false,
        via: ["cup2", "cup1", "cup0"],
        cups: [2, 1, 0],
      })
    ).toEqual([]);
  });

  it("counts a flight once however many times it is sent", () => {
    const obs = {
      kind: "flight" as const,
      flight: {
        flightId: "flight_one",
        delivered: true,
        via: ["fan"],
        cups: [],
      },
    };
    const once = applyObservation(EMPTY_DISCOVERIES, obs, NOW);
    const twice = applyObservation(once, obs, "2026-10-29T18:00:05.000Z");
    expect(twice).toEqual(once);
    expect(once.deliveries).toBe(1);
    expect(once.attempts).toBe(1);
    expect(once.discoveries.first_delivery).toEqual({
      firstAt: NOW,
      lastAt: NOW,
      count: 1,
    });
  });

  it("keeps the first time a beat happened, and the fan's last setting", () => {
    let s = applyObservation(
      EMPTY_DISCOVERIES,
      { kind: "beat", beat: "orchestra_performed" },
      NOW
    );
    s = applyObservation(
      s,
      { kind: "beat", beat: "orchestra_performed" },
      "2026-10-30T09:00:00.000Z"
    );
    expect(s.beats.orchestra_performed).toBe(NOW);
    s = applyObservation(s, { kind: "fan", setting: "forward" }, NOW);
    expect(s.fan).toBe("forward");
  });

  it("reads anything stored as a valid state", () => {
    expect(normalizeDiscoveries(null)).toEqual(EMPTY_DISCOVERIES);
    const odd = normalizeDiscoveries({
      fan: "sideways",
      deliveries: -3,
      discoveries: { three_cups: { firstAt: NOW, count: 2.7 }, made_up: {} },
      recentFlights: [1, "x"],
    });
    expect(odd.fan).toBe("up");
    expect(odd.deliveries).toBe(0);
    expect(odd.discoveries.three_cups).toEqual({
      firstAt: NOW,
      lastAt: NOW,
      count: 2,
    });
    expect(Object.keys(odd.discoveries)).toEqual(["three_cups"]);
    expect(odd.recentFlights).toEqual(["x"]);
  });

  it("shows a remembered thing on the next visit, not mid-visit", () => {
    const visit = new Date("2026-10-30T09:00:00Z").getTime();
    expect(rememberedBefore(NOW, visit)).toBe(true);
    expect(rememberedBefore("2026-10-30T09:05:00Z", visit)).toBe(false);
    expect(rememberedBefore(undefined, visit)).toBe(false);
  });
});
