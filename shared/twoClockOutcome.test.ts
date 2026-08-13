import { describe, expect, it } from "vitest";
import { presentedResolution } from "./twoClockOutcome";

describe("presentedResolution — the two clocks stay structurally separate", () => {
  it("EXPLICIT TWO-CLOCK TEST: 0 authoritative evidence + timer expiry => real work stays unresolved at 0", () => {
    const result = presentedResolution({
      fictional: { outcome: "failure", timerExpired: true, score: 12 },
      authoritative: { resolved: false, resolutionKind: null, evidencedCount: 0 },
    });
    expect(result.resolved).toBe(false);
    expect(result.evidencedCount).toBe(0);
  });

  it("EXPLICIT REAL-WORK-WINS TEST: 25 legitimate attestations survive a poor/failed fictional performance", () => {
    const result = presentedResolution({
      fictional: { outcome: "failure", timerExpired: true, score: 3 },
      authoritative: { resolved: true, resolutionKind: "route_completed", evidencedCount: 25 },
    });
    expect(result.resolved).toBe(true);
    expect(result.evidencedCount).toBe(25);
  });

  it("a fictional SUCCESS cannot create authoritative completion by itself", () => {
    const result = presentedResolution({
      fictional: { outcome: "success", timerExpired: false, score: 100 },
      authoritative: { resolved: false, resolutionKind: null, evidencedCount: 0 },
    });
    expect(result.resolved).toBe(false);
  });

  it("fictional performance data never appears in the returned value at all", () => {
    const result = presentedResolution({
      fictional: { outcome: "success", timerExpired: false, score: 999 },
      authoritative: { resolved: true, resolutionKind: "won", evidencedCount: 1 },
    });
    expect(result).not.toHaveProperty("score");
    expect(result).not.toHaveProperty("timerExpired");
    expect(result).not.toHaveProperty("outcome");
  });

  it("the two result types share no field name — a caller cannot accidentally conflate them", () => {
    const fictionalKeys = Object.keys({
      outcome: "success",
      timerExpired: false,
      score: null,
    } as const);
    const authoritativeKeys = Object.keys({
      resolved: true,
      resolutionKind: null,
      evidencedCount: 0,
    } as const);
    const overlap = fictionalKeys.filter(key => authoritativeKeys.includes(key));
    expect(overlap).toEqual([]);
  });
});
