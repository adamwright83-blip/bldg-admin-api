export type PhysicalArrivalTarget = {
  id: string;
  lat: number;
  lng: number;
};

export type PhysicalArrivalSample = {
  lat: number;
  lng: number;
  accuracyMeters: number;
  timestampMs: number;
};

export type PhysicalArrivalPhase =
  | "searching"
  | "dwelling"
  | "arrived";

export type PhysicalArrivalSnapshot = {
  targetId: string;
  phase: PhysicalArrivalPhase;
  distanceMeters: number | null;
  accuracyMeters: number | null;
  dwellProgress: number;
  arrivedAtMs: number | null;
};

export const PHYSICAL_ARRIVAL = {
  /** Accuracy worse than this is not strong enough to establish proximity. */
  maxAccuracyMeters: 75,
  /** Conservative inner radius. We require distance + accuracy <= this. */
  enterRadiusMeters: 55,
  /** Hysteresis outer radius used only after arrival has been established. */
  exitRadiusMeters: 90,
  /** A drive-by cannot satisfy arrival: the device must remain inside. */
  enterDwellMs: 12_000,
  minEnterSamples: 3,
  /** Jitter cannot instantly revoke arrival once it is established. */
  exitDwellMs: 8_000,
  minExitSamples: 2,
} as const;

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const earthRadiusMeters = 6_371_008.8;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(h)));
}

function finiteCoordinate(value: number): boolean {
  return Number.isFinite(value);
}

export function validPhysicalArrivalTarget(
  target: PhysicalArrivalTarget | null | undefined
): target is PhysicalArrivalTarget {
  return Boolean(
    target &&
      target.id &&
      finiteCoordinate(target.lat) &&
      finiteCoordinate(target.lng) &&
      target.lat >= -90 &&
      target.lat <= 90 &&
      target.lng >= -180 &&
      target.lng <= 180
  );
}

/**
 * Pure GPS truth gate for Real Workday.
 *
 * This class can establish one fact only: the device remained physically near
 * a known coordinate long enough, with sufficient GPS accuracy, to call the
 * operator "arrived". It cannot claim that a pitch happened, that a delivery
 * happened, that a visit was completed, or that any business outcome occurred.
 *
 * The conservative boundary uses `distance + accuracy` on entry so a sloppy
 * fix cannot promote mere possible proximity into arrival. Once arrival is
 * established, `distance - accuracy` plus a wider radius and dwell time is
 * used to clear it, preventing ordinary GPS jitter from flickering the world.
 */
export class PhysicalArrivalTracker {
  private target: PhysicalArrivalTarget;
  private phase: PhysicalArrivalPhase = "searching";
  private insideSinceMs: number | null = null;
  private insideSamples = 0;
  private outsideSinceMs: number | null = null;
  private outsideSamples = 0;
  private arrivedAtMs: number | null = null;
  private lastTimestampMs = -Infinity;
  private distanceMeters: number | null = null;
  private accuracyMeters: number | null = null;

  constructor(target: PhysicalArrivalTarget) {
    if (!validPhysicalArrivalTarget(target)) {
      throw new Error("PhysicalArrivalTracker requires a valid target");
    }
    this.target = target;
  }

  getSnapshot(nowMs = this.lastTimestampMs): PhysicalArrivalSnapshot {
    const dwellProgress =
      this.phase === "dwelling" && this.insideSinceMs != null && Number.isFinite(nowMs)
        ? Math.max(
            0,
            Math.min(1, (nowMs - this.insideSinceMs) / PHYSICAL_ARRIVAL.enterDwellMs)
          )
        : this.phase === "arrived"
          ? 1
          : 0;
    return {
      targetId: this.target.id,
      phase: this.phase,
      distanceMeters: this.distanceMeters,
      accuracyMeters: this.accuracyMeters,
      dwellProgress,
      arrivedAtMs: this.arrivedAtMs,
    };
  }

  reset(target = this.target): PhysicalArrivalSnapshot {
    if (!validPhysicalArrivalTarget(target)) {
      throw new Error("PhysicalArrivalTracker requires a valid target");
    }
    this.target = target;
    this.phase = "searching";
    this.insideSinceMs = null;
    this.insideSamples = 0;
    this.outsideSinceMs = null;
    this.outsideSamples = 0;
    this.arrivedAtMs = null;
    this.lastTimestampMs = -Infinity;
    this.distanceMeters = null;
    this.accuracyMeters = null;
    return this.getSnapshot();
  }

  ingest(sample: PhysicalArrivalSample): PhysicalArrivalSnapshot {
    if (
      !finiteCoordinate(sample.lat) ||
      !finiteCoordinate(sample.lng) ||
      !Number.isFinite(sample.accuracyMeters) ||
      !Number.isFinite(sample.timestampMs) ||
      sample.accuracyMeters < 0 ||
      sample.timestampMs < this.lastTimestampMs
    ) {
      return this.getSnapshot();
    }

    this.lastTimestampMs = sample.timestampMs;
    const distance = haversineMeters(this.target, sample);
    this.distanceMeters = distance;
    this.accuracyMeters = sample.accuracyMeters;

    if (sample.accuracyMeters > PHYSICAL_ARRIVAL.maxAccuracyMeters) {
      if (this.phase !== "arrived") this.clearEntryCandidate();
      return this.getSnapshot(sample.timestampMs);
    }

    const confidentlyInside =
      distance + sample.accuracyMeters <= PHYSICAL_ARRIVAL.enterRadiusMeters;
    const confidentlyOutside =
      Math.max(0, distance - sample.accuracyMeters) >=
      PHYSICAL_ARRIVAL.exitRadiusMeters;

    if (this.phase !== "arrived") {
      if (!confidentlyInside) {
        this.clearEntryCandidate();
        return this.getSnapshot(sample.timestampMs);
      }

      if (this.insideSinceMs == null) this.insideSinceMs = sample.timestampMs;
      this.insideSamples += 1;
      this.phase = "dwelling";

      if (
        this.insideSamples >= PHYSICAL_ARRIVAL.minEnterSamples &&
        sample.timestampMs - this.insideSinceMs >= PHYSICAL_ARRIVAL.enterDwellMs
      ) {
        this.phase = "arrived";
        this.arrivedAtMs = sample.timestampMs;
        this.outsideSinceMs = null;
        this.outsideSamples = 0;
      }
      return this.getSnapshot(sample.timestampMs);
    }

    if (!confidentlyOutside) {
      this.outsideSinceMs = null;
      this.outsideSamples = 0;
      return this.getSnapshot(sample.timestampMs);
    }

    if (this.outsideSinceMs == null) this.outsideSinceMs = sample.timestampMs;
    this.outsideSamples += 1;
    if (
      this.outsideSamples >= PHYSICAL_ARRIVAL.minExitSamples &&
      sample.timestampMs - this.outsideSinceMs >= PHYSICAL_ARRIVAL.exitDwellMs
    ) {
      this.phase = "searching";
      this.arrivedAtMs = null;
      this.clearEntryCandidate();
      this.outsideSinceMs = null;
      this.outsideSamples = 0;
    }
    return this.getSnapshot(sample.timestampMs);
  }

  private clearEntryCandidate() {
    this.insideSinceMs = null;
    this.insideSamples = 0;
    if (this.phase !== "arrived") this.phase = "searching";
  }
}
