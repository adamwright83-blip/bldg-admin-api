import { describe, expect, it } from "vitest";
import { AdaptiveQualityMonitor } from "./adaptiveQuality";

function feed(monitor: AdaptiveQualityMonitor, deltaMs: number, count: number) {
  let changed: ReturnType<AdaptiveQualityMonitor["sample"]> = null;
  for (let i = 0; i < count; i += 1) {
    const result = monitor.sample(deltaMs);
    if (result) changed = result;
  }
  return changed;
}

describe("AdaptiveQualityMonitor", () => {
  it("stays premium under a steady healthy frame rate", () => {
    const monitor = new AdaptiveQualityMonitor();
    feed(monitor, 16.6, 200);
    expect(monitor.currentTier()).toBe("premium");
  });

  it("degrades to reduced after sustained slow frames", () => {
    const monitor = new AdaptiveQualityMonitor();
    const changed = feed(monitor, 30, 200);
    expect(monitor.currentTier()).toBe("reduced");
    expect(changed).toBe("reduced");
  });

  it("does not degrade from a single hitch inside an otherwise healthy window", () => {
    const monitor = new AdaptiveQualityMonitor();
    feed(monitor, 16.6, 89);
    monitor.sample(200);
    feed(monitor, 16.6, 60);
    expect(monitor.currentTier()).toBe("premium");
  });

  it("recovers to premium after sustained fast frames again", () => {
    const monitor = new AdaptiveQualityMonitor();
    feed(monitor, 30, 200);
    expect(monitor.currentTier()).toBe("reduced");
    feed(monitor, 12, 200);
    expect(monitor.currentTier()).toBe("premium");
  });

  it("reports a real measured average, not a synthesized value", () => {
    const monitor = new AdaptiveQualityMonitor();
    feed(monitor, 20, 90);
    expect(monitor.averageFrameMs()).toBeCloseTo(20, 5);
  });
});
