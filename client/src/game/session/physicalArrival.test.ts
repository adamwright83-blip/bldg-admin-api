import { describe, expect, it } from "vitest";
import {
  PHYSICAL_ARRIVAL,
  PhysicalArrivalTracker,
  haversineMeters,
} from "./physicalArrival";

const target = { id: "places:test", lat: 34.05, lng: -118.25 };

function sampleAtMeters(input: {
  eastMeters?: number;
  northMeters?: number;
  accuracyMeters?: number;
  timestampMs: number;
}) {
  const north = input.northMeters ?? 0;
  const east = input.eastMeters ?? 0;
  const lat = target.lat + north / 111_111;
  const lng =
    target.lng + east / (111_111 * Math.cos((target.lat * Math.PI) / 180));
  return {
    lat,
    lng,
    accuracyMeters: input.accuracyMeters ?? 8,
    timestampMs: input.timestampMs,
  };
}

describe("PhysicalArrivalTracker", () => {
  it("uses real geodesic distance", () => {
    expect(haversineMeters(target, sampleAtMeters({ eastMeters: 100, timestampMs: 0 })))
      .toBeGreaterThan(95);
    expect(haversineMeters(target, sampleAtMeters({ eastMeters: 100, timestampMs: 0 })))
      .toBeLessThan(105);
  });

  it("does not turn a drive-by into an arrival", () => {
    const tracker = new PhysicalArrivalTracker(target);
    tracker.ingest(sampleAtMeters({ eastMeters: 30, timestampMs: 0 }));
    tracker.ingest(sampleAtMeters({ eastMeters: 25, timestampMs: 3_000 }));
    const afterLeaving = tracker.ingest(
      sampleAtMeters({ eastMeters: 120, timestampMs: 6_000 })
    );
    expect(afterLeaving.phase).toBe("searching");
    expect(afterLeaving.arrivedAtMs).toBeNull();
  });

  it("requires sustained, accurate proximity before arrival", () => {
    const tracker = new PhysicalArrivalTracker(target);
    tracker.ingest(sampleAtMeters({ eastMeters: 20, timestampMs: 0 }));
    tracker.ingest(sampleAtMeters({ eastMeters: 18, timestampMs: 6_000 }));
    const arrived = tracker.ingest(
      sampleAtMeters({ eastMeters: 16, timestampMs: PHYSICAL_ARRIVAL.enterDwellMs })
    );
    expect(arrived.phase).toBe("arrived");
    expect(arrived.dwellProgress).toBe(1);
    expect(arrived.arrivedAtMs).toBe(PHYSICAL_ARRIVAL.enterDwellMs);
  });

  it("fails closed when GPS accuracy is too weak", () => {
    const tracker = new PhysicalArrivalTracker(target);
    tracker.ingest(
      sampleAtMeters({ eastMeters: 5, accuracyMeters: 120, timestampMs: 0 })
    );
    tracker.ingest(
      sampleAtMeters({
        eastMeters: 5,
        accuracyMeters: 120,
        timestampMs: PHYSICAL_ARRIVAL.enterDwellMs + 1,
      })
    );
    expect(tracker.getSnapshot().phase).toBe("searching");
  });

  it("does not flicker arrival on ordinary GPS jitter", () => {
    const tracker = new PhysicalArrivalTracker(target);
    tracker.ingest(sampleAtMeters({ eastMeters: 15, timestampMs: 0 }));
    tracker.ingest(sampleAtMeters({ eastMeters: 15, timestampMs: 6_000 }));
    tracker.ingest(
      sampleAtMeters({ eastMeters: 15, timestampMs: PHYSICAL_ARRIVAL.enterDwellMs })
    );
    const jitter = tracker.ingest(
      sampleAtMeters({ eastMeters: 105, accuracyMeters: 30, timestampMs: 14_000 })
    );
    expect(jitter.phase).toBe("arrived");
  });

  it("clears arrival only after sustained confident exit", () => {
    const tracker = new PhysicalArrivalTracker(target);
    tracker.ingest(sampleAtMeters({ eastMeters: 15, timestampMs: 0 }));
    tracker.ingest(sampleAtMeters({ eastMeters: 15, timestampMs: 6_000 }));
    tracker.ingest(
      sampleAtMeters({ eastMeters: 15, timestampMs: PHYSICAL_ARRIVAL.enterDwellMs })
    );
    tracker.ingest(
      sampleAtMeters({ eastMeters: 130, accuracyMeters: 8, timestampMs: 20_000 })
    );
    const cleared = tracker.ingest(
      sampleAtMeters({
        eastMeters: 135,
        accuracyMeters: 8,
        timestampMs: 20_000 + PHYSICAL_ARRIVAL.exitDwellMs,
      })
    );
    expect(cleared.phase).toBe("searching");
    expect(cleared.arrivedAtMs).toBeNull();
  });

  it("ignores out-of-order samples", () => {
    const tracker = new PhysicalArrivalTracker(target);
    tracker.ingest(sampleAtMeters({ eastMeters: 20, timestampMs: 10_000 }));
    const stale = tracker.ingest(sampleAtMeters({ eastMeters: 20, timestampMs: 9_000 }));
    expect(stale.phase).toBe("dwelling");
    expect(stale.dwellProgress).toBe(0);
  });
});
