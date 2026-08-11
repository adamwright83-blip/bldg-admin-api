export type QualityTier = "premium" | "reduced";

const WINDOW_SIZE = 90;
/** ~45fps sustained — below this the scene is visibly stuttering. */
const DEGRADE_THRESHOLD_MS = 22;
/** ~55fps sustained — comfortably above the degrade line, avoids flapping. */
const RECOVER_THRESHOLD_MS = 18;
/** Frames to hold a verdict before switching tier, so one hitch doesn't flip quality. */
const HYSTERESIS_FRAMES = 45;

/**
 * Tracks a rolling window of real ticker deltaMS values and derives a
 * premium/reduced quality tier from measured frame time. Never estimates or
 * assumes an FPS — every sample is an actual frame duration reported by the
 * PixiJS ticker, and the reported tier only changes after it's held past
 * threshold for HYSTERESIS_FRAMES consecutive frames.
 */
export class AdaptiveQualityMonitor {
  private samples: number[] = [];
  private tier: QualityTier = "premium";
  private framesPastThreshold = 0;

  /** Feeds one real frame duration in ms. Returns the tier if it just changed, else null. */
  sample(deltaMs: number): QualityTier | null {
    this.samples.push(deltaMs);
    if (this.samples.length > WINDOW_SIZE) this.samples.shift();
    if (this.samples.length < WINDOW_SIZE) return null;

    const avg = this.averageFrameMs();
    const wantsDegrade = this.tier === "premium" && avg > DEGRADE_THRESHOLD_MS;
    const wantsRecover = this.tier === "reduced" && avg < RECOVER_THRESHOLD_MS;

    if (wantsDegrade || wantsRecover) {
      this.framesPastThreshold += 1;
    } else {
      this.framesPastThreshold = 0;
    }

    if (this.framesPastThreshold < HYSTERESIS_FRAMES) return null;

    this.framesPastThreshold = 0;
    this.tier = wantsDegrade ? "reduced" : "premium";
    return this.tier;
  }

  averageFrameMs(): number {
    if (this.samples.length === 0) return 0;
    const sum = this.samples.reduce((total, value) => total + value, 0);
    return sum / this.samples.length;
  }

  currentTier(): QualityTier {
    return this.tier;
  }
}
