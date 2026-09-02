export type DrivingLocationSample = {
  lat: number;
  lng: number;
  accuracyMeters: number;
  timestampMs: number;
  speedMetersPerSecond: number | null;
};

export type DrivingLikelihoodSnapshot = {
  likely: boolean;
  speedMetersPerSecond: number | null;
  goodSamples: number;
};

const MAX_ACCURACY_METERS = 80;
const ENTER_SPEED_MPS = 8;
const EXIT_SPEED_MPS = 2.5;
const ENTER_SAMPLES = 3;
const EXIT_SAMPLES = 3;
const ENTER_SPAN_MS = 6_000;
const EXIT_SPAN_MS = 8_000;

function radians(value: number) { return (value * Math.PI) / 180; }
function distanceMeters(a: DrivingLocationSample, b: DrivingLocationSample): number {
  const earth = 6_371_000;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)));
}

export class DrivingLikelihoodTracker {
  private likely = false;
  private high: Array<{ at: number; speed: number }> = [];
  private low: Array<{ at: number; speed: number }> = [];
  private previous: DrivingLocationSample | null = null;
  private speed: number | null = null;

  ingest(sample: DrivingLocationSample): DrivingLikelihoodSnapshot {
    if (!Number.isFinite(sample.lat) || !Number.isFinite(sample.lng) ||
        !Number.isFinite(sample.accuracyMeters) || sample.accuracyMeters <= 0 ||
        sample.accuracyMeters > MAX_ACCURACY_METERS) return this.snapshot();
    if (this.previous && sample.timestampMs <= this.previous.timestampMs) return this.snapshot();

    let speed = sample.speedMetersPerSecond != null && Number.isFinite(sample.speedMetersPerSecond)
      ? Math.max(0, sample.speedMetersPerSecond)
      : null;
    if (speed == null && this.previous) {
      const dt = sample.timestampMs - this.previous.timestampMs;
      if (dt >= 1_000 && dt <= 20_000 && this.previous.accuracyMeters <= MAX_ACCURACY_METERS) {
        speed = distanceMeters(this.previous, sample) / (dt / 1000);
      }
    }
    this.previous = sample;
    this.speed = speed;
    if (speed == null) return this.snapshot();

    if (!this.likely) {
      if (speed >= ENTER_SPEED_MPS) {
        this.high.push({ at: sample.timestampMs, speed });
        this.high = this.high.filter(item => sample.timestampMs - item.at <= 20_000);
        const span = this.high.length > 1 ? sample.timestampMs - this.high[0]!.at : 0;
        if (this.high.length >= ENTER_SAMPLES && span >= ENTER_SPAN_MS) {
          this.likely = true;
          this.low = [];
        }
      } else this.high = [];
    } else if (speed <= EXIT_SPEED_MPS) {
      this.low.push({ at: sample.timestampMs, speed });
      this.low = this.low.filter(item => sample.timestampMs - item.at <= 25_000);
      const span = this.low.length > 1 ? sample.timestampMs - this.low[0]!.at : 0;
      if (this.low.length >= EXIT_SAMPLES && span >= EXIT_SPAN_MS) {
        this.likely = false;
        this.high = [];
      }
    } else this.low = [];
    return this.snapshot();
  }

  snapshot(): DrivingLikelihoodSnapshot {
    return { likely: this.likely, speedMetersPerSecond: this.speed, goodSamples: this.likely ? this.low.length : this.high.length };
  }
}
