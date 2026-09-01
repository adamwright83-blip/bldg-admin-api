import { describe, expect, it, vi } from "vitest";
import { LATERAL_TO_PROGRESS } from "./ruinbound";
import {
  SETTLE_MS,
  SURVEY_COOLDOWN_SECONDS,
  SURVEY_DEADZONE,
  SURVEY_MAX_REVEALS,
  SURVEY_RADIUS,
  SURVEY_REVEAL_SECONDS,
  SurveyPulse,
  resolveSurveyReveals,
  stepSurveyReveals,
  type SurveyCandidate,
} from "./surveyPulse";

describe("SURVEY settle gesture", () => {
  it("fires a pulse once the thumb has rested near centre for the settle time", () => {
    const onPulse = vi.fn();
    const pulse = new SurveyPulse({ onPulse });
    pulse.pointerDown(1000, 0);
    expect(pulse.pointerUpdate(1000 + SETTLE_MS - 1, 0)).toBe(false);
    expect(onPulse).not.toHaveBeenCalled();
    expect(pulse.pointerUpdate(1000 + SETTLE_MS, 0)).toBe(true);
    expect(onPulse).toHaveBeenCalledTimes(1);
  });

  it("fires exactly once per settle, not every frame the thumb stays down", () => {
    const pulse = new SurveyPulse();
    pulse.pointerDown(0, 0);
    expect(pulse.pointerUpdate(SETTLE_MS, 0)).toBe(true);
    expect(pulse.pointerUpdate(SETTLE_MS + 16, 0)).toBe(false);
    expect(pulse.pointerUpdate(SETTLE_MS + 32, 0)).toBe(false);
  });

  it("abandons the settle the moment the player deflects into movement", () => {
    const onSettleAbort = vi.fn();
    const onPulse = vi.fn();
    const pulse = new SurveyPulse({ onSettleAbort, onPulse });
    pulse.pointerDown(0, 0);
    expect(pulse.pointerUpdate(100, SURVEY_DEADZONE + 0.01)).toBe(false);
    expect(onSettleAbort).toHaveBeenCalledTimes(1);
    // ...and holding still again does not resurrect it without a new press.
    expect(pulse.pointerUpdate(SETTLE_MS + 500, 0)).toBe(false);
    expect(onPulse).not.toHaveBeenCalled();
  });

  it("never begins a settle when the press starts as a deflection", () => {
    const onSettleBegin = vi.fn();
    const pulse = new SurveyPulse({ onSettleBegin });
    pulse.pointerDown(0, 0.9);
    expect(pulse.getPhase()).toBe("spent");
    expect(onSettleBegin).not.toHaveBeenCalled();
    expect(pulse.pointerUpdate(SETTLE_MS, 0)).toBe(false);
  });

  it("tolerates resting thumb jitter below the deadzone", () => {
    const pulse = new SurveyPulse();
    pulse.pointerDown(0, 0);
    expect(pulse.pointerUpdate(80, SURVEY_DEADZONE - 0.01)).toBe(false);
    expect(pulse.pointerUpdate(SETTLE_MS, SURVEY_DEADZONE - 0.02)).toBe(true);
  });

  it("treats an early release as abandoned, never as a shortened settle", () => {
    const onPulse = vi.fn();
    const pulse = new SurveyPulse({ onPulse });
    pulse.pointerDown(0, 0);
    pulse.pointerUpdate(SETTLE_MS - 10, 0);
    pulse.pointerUp();
    expect(onPulse).not.toHaveBeenCalled();
    expect(pulse.getPhase()).toBe("idle");
  });

  it("reports settle progress against real time, and nothing when idle", () => {
    const pulse = new SurveyPulse();
    expect(pulse.getSettleProgress(0)).toBe(0);
    pulse.pointerDown(1000, 0);
    expect(pulse.getSettleProgress(1000 + SETTLE_MS / 2)).toBeCloseTo(0.5, 5);
    expect(pulse.getSettleProgress(1000 + SETTLE_MS * 4)).toBe(1);
  });

  it("cancel clears an in-flight settle without firing", () => {
    const onPulse = vi.fn();
    const onSettleAbort = vi.fn();
    const pulse = new SurveyPulse({ onPulse, onSettleAbort });
    pulse.pointerDown(0, 0);
    pulse.cancel();
    expect(onSettleAbort).toHaveBeenCalledTimes(1);
    expect(onPulse).not.toHaveBeenCalled();
    expect(pulse.getPhase()).toBe("idle");
  });
});

describe("SURVEY cooldown", () => {
  it("refuses to begin a settle while cooling, so no ring promises a pulse that cannot fire", () => {
    const onSettleBegin = vi.fn();
    const pulse = new SurveyPulse({ onSettleBegin });
    pulse.pointerDown(0, 0);
    expect(pulse.pointerUpdate(SETTLE_MS, 0)).toBe(true);
    pulse.pointerUp();
    expect(pulse.isReady()).toBe(false);

    onSettleBegin.mockClear();
    pulse.pointerDown(5000, 0);
    expect(onSettleBegin).not.toHaveBeenCalled();
    expect(pulse.pointerUpdate(5000 + SETTLE_MS, 0)).toBe(false);
  });

  it("becomes available again after the cooldown is stepped out in simulation seconds", () => {
    const pulse = new SurveyPulse();
    pulse.pointerDown(0, 0);
    pulse.pointerUpdate(SETTLE_MS, 0);
    pulse.pointerUp();
    pulse.step(SURVEY_COOLDOWN_SECONDS - 0.1);
    expect(pulse.isReady()).toBe(false);
    pulse.step(0.1);
    expect(pulse.isReady()).toBe(true);

    pulse.pointerDown(10_000, 0);
    expect(pulse.pointerUpdate(10_000 + SETTLE_MS, 0)).toBe(true);
  });

  it("never drives the cooldown below zero", () => {
    const pulse = new SurveyPulse();
    pulse.step(999);
    expect(pulse.getCooldownSeconds()).toBe(0);
  });
});

describe("SURVEY reveals", () => {
  const at = (
    id: string,
    x: number,
    y: number,
    extra: Partial<SurveyCandidate> = {}
  ): SurveyCandidate => ({ id, kind: "hostile", x, y, ...extra });

  it("returns nearest-first and never more than the cap", () => {
    const candidates = Array.from({ length: SURVEY_MAX_REVEALS + 4 }, (_, i) =>
      at(`h${i}`, (i + 1) * 0.01, 0)
    );
    const reveals = resolveSurveyReveals(candidates, 0, 0);
    expect(reveals).toHaveLength(SURVEY_MAX_REVEALS);
    expect(reveals.map(r => r.id)).toEqual(["h0", "h1", "h2", "h3", "h4", "h5"]);
    expect(reveals[0].distance).toBeLessThan(reveals[1].distance);
  });

  it("normalizes authored lateral into the same metric as route progress", () => {
    const sameProgressDistance = 0.04;
    const reveals = resolveSurveyReveals(
      [
        at("ahead", sameProgressDistance, 0),
        at("side", 0, sameProgressDistance / LATERAL_TO_PROGRESS),
      ],
      0,
      0
    );
    expect(reveals).toHaveLength(2);
    expect(reveals[0].distance).toBeCloseTo(reveals[1].distance, 6);
  });

  it("drops subjects beyond the pulse radius", () => {
    const reveals = resolveSurveyReveals(
      [at("near", 0.03, 0), at("far", SURVEY_RADIUS + 0.01, 0)],
      0,
      0
    );
    expect(reveals.map(r => r.id)).toEqual(["near"]);
  });

  it("skips what the player can already see, so the pulse is for finding", () => {
    const reveals = resolveSurveyReveals(
      [at("seen", 0.01, 0, { alreadyVisible: true }), at("hidden", 0.06, 0)],
      0,
      0
    );
    expect(reveals.map(r => r.id)).toEqual(["hidden"]);
  });

  it("is deterministic when subjects are equidistant", () => {
    const a = resolveSurveyReveals([at("b", 0, 0.03 / LATERAL_TO_PROGRESS), at("a", 0.03, 0)], 0, 0);
    const b = resolveSurveyReveals([at("a", 0.03, 0), at("b", 0, 0.03 / LATERAL_TO_PROGRESS)], 0, 0);
    expect(a.map(r => r.id)).toEqual(b.map(r => r.id));
    expect(a.map(r => r.id)).toEqual(["a", "b"]);
  });

  it("ages reveals out in simulation seconds", () => {
    let reveals = resolveSurveyReveals([at("h", 0.02, 0)], 0, 0);
    expect(reveals[0].remaining).toBe(SURVEY_REVEAL_SECONDS);
    reveals = stepSurveyReveals(reveals, SURVEY_REVEAL_SECONDS - 0.1);
    expect(reveals).toHaveLength(1);
    reveals = stepSurveyReveals(reveals, 0.2);
    expect(reveals).toEqual([]);
  });
});

describe("SURVEY firewall", () => {
  /**
   * The structural half of the guarantee: a reveal has nowhere to put a
   * business identity. Asserted on the value rather than the type so it
   * survives a future edit that widens the type without widening the test.
   */
  it("carries only fictional corridor data — no field can hold business truth", () => {
    const reveals = resolveSurveyReveals(
      [{ id: "hostile-7", kind: "hostile", x: 0.02, y: 4 }],
      0,
      0
    );
    expect(Object.keys(reveals[0]).sort()).toEqual([
      "distance",
      "id",
      "kind",
      "remaining",
      "x",
      "y",
    ]);
  });

  it("cannot express a customer, order, building or visit as a subject kind", () => {
    const reveals = resolveSurveyReveals(
      [
        { id: "a", kind: "hostile", x: 0.01, y: 0 },
        { id: "b", kind: "hazard", x: 0.02, y: 0 },
        { id: "c", kind: "anchor", x: 0.03, y: 0 },
        { id: "d", kind: "opening", x: 0.04, y: 0 },
      ],
      0,
      0
    );
    const kinds = new Set(reveals.map(r => r.kind));
    for (const forbidden of [
      "customer",
      "order",
      "building",
      "visit",
      "prospect",
      "delivery",
      "pickup",
    ]) {
      expect(kinds.has(forbidden as never)).toBe(false);
    }
  });

  it("firing a pulse produces no return value a caller could treat as evidence", () => {
    const pulse = new SurveyPulse();
    pulse.pointerDown(0, 0);
    // The gesture yields a boolean "fire now" and nothing else — there is no
    // payload to promote into a visit, an arrival, or an opportunity.
    expect(pulse.pointerUpdate(SETTLE_MS, 0)).toBe(true);
  });
});
