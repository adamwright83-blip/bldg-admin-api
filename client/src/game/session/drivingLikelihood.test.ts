import { describe, expect, it } from "vitest";
import { DrivingLikelihoodTracker, type DrivingLocationSample } from "./drivingLikelihood";

const at = (t: number, speed: number | null, lat = 34): DrivingLocationSample => ({
  lat, lng: -118.3, accuracyMeters: 12, timestampMs: t, speedMetersPerSecond: speed,
});

describe("conservative driving likelihood", () => {
  it("does not call walking or one speed spike driving", () => {
    const tracker = new DrivingLikelihoodTracker();
    tracker.ingest(at(0, 1.4));
    tracker.ingest(at(4_000, 14));
    expect(tracker.ingest(at(8_000, 1.1)).likely).toBe(false);
  });
  it("requires sustained vehicle speed", () => {
    const tracker = new DrivingLikelihoodTracker();
    tracker.ingest(at(0, 10)); tracker.ingest(at(3_500, 12));
    expect(tracker.ingest(at(7_000, 11)).likely).toBe(true);
  });
  it("does not clear driving from a single stoplight sample", () => {
    const tracker = new DrivingLikelihoodTracker();
    tracker.ingest(at(0, 10)); tracker.ingest(at(3_500, 12)); tracker.ingest(at(7_000, 11));
    expect(tracker.ingest(at(9_000, 0)).likely).toBe(true);
    expect(tracker.ingest(at(11_000, 10)).likely).toBe(true);
  });
  it("returns controls after sustained parked speed", () => {
    const tracker = new DrivingLikelihoodTracker();
    tracker.ingest(at(0, 10)); tracker.ingest(at(3_500, 12)); tracker.ingest(at(7_000, 11));
    tracker.ingest(at(10_000, 0)); tracker.ingest(at(14_500, 0));
    expect(tracker.ingest(at(19_000, 0)).likely).toBe(false);
  });
  it("ignores low-quality samples", () => {
    const tracker = new DrivingLikelihoodTracker();
    expect(tracker.ingest({ ...at(0, 20), accuracyMeters: 180 }).likely).toBe(false);
  });
});
