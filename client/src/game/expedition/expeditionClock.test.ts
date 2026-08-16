import { describe, expect, it } from "vitest";
import { AIM_TIME_SCALE, ExpeditionClock } from "./expeditionClock";

/**
 * §62 two-clock rule. The central assertion of this file: no fictional
 * manipulation — dilation, hit-stop, pause, or all three at once — may move
 * the authoritative clock off real time by even one millisecond.
 */

function controllableClock() {
  let realMs = 1_760_000_000_000;
  const clock = new ExpeditionClock(() => realMs);
  return {
    clock,
    /**
     * Advance REAL time by a whole number of milliseconds and feed that
     * frame to the clock. Integer ms keeps the harness's own bookkeeping
     * exact, so the authoritative assertions below can be strict equality
     * rather than approximate — which is the whole point of this file.
     */
    frame(realMs_: number) {
      realMs += realMs_;
      return clock.advance(realMs_ / 1000);
    },
    realNow: () => realMs,
  };
}

describe("authoritative clock is untouchable", () => {
  it("advances at exactly 1x while fiction runs at 0.2x aim dilation", () => {
    const { clock, frame, realNow } = controllableClock();
    const startedAt = clock.authoritativeNowMs();

    clock.setTimeScale(AIM_TIME_SCALE);
    for (let i = 0; i < 100; i += 1) frame(10);

    // One real second passed, exactly.
    expect(clock.authoritativeNowMs() - startedAt).toBe(1000);
    expect(clock.authoritativeNowMs()).toBe(realNow());
    // Fiction only advanced a fifth of it.
    expect(clock.fictionalElapsedSeconds()).toBeCloseTo(0.2, 6);
  });

  it("advances during hit-stop even though fiction is frozen", () => {
    const { clock, frame } = controllableClock();
    const startedAt = clock.authoritativeNowMs();

    clock.hitStop(120);
    let fictionalAccumulated = 0;
    for (let i = 0; i < 10; i += 1) fictionalAccumulated += frame(10);

    expect(clock.authoritativeNowMs() - startedAt).toBe(100);
    expect(fictionalAccumulated).toBe(0);
    expect(clock.fictionalElapsedSeconds()).toBe(0);
  });

  it("advances while the expedition is paused", () => {
    const { clock, frame } = controllableClock();
    const startedAt = clock.authoritativeNowMs();

    clock.setPaused(true);
    for (let i = 0; i < 200; i += 1) frame(10);

    expect(clock.authoritativeNowMs() - startedAt).toBe(2000);
    expect(clock.fictionalElapsedSeconds()).toBe(0);
  });

  it("advances under dilation, hit-stop and pause combined", () => {
    const { clock, frame } = controllableClock();
    const startedAt = clock.authoritativeNowMs();

    clock.setTimeScale(AIM_TIME_SCALE);
    clock.hitStop(80);
    clock.setPaused(true);
    for (let i = 0; i < 50; i += 1) frame(10);

    expect(clock.authoritativeNowMs() - startedAt).toBe(500);
    expect(clock.fictionalElapsedSeconds()).toBe(0);
  });

  it("reads real time even when no frame has ever been advanced", () => {
    const { clock, realNow } = controllableClock();
    expect(clock.authoritativeNowMs()).toBe(realNow());
  });

  it("defaults to Date.now() in production construction", () => {
    const clock = new ExpeditionClock();
    const before = Date.now();
    const reading = clock.authoritativeNowMs();
    const after = Date.now();
    expect(reading).toBeGreaterThanOrEqual(before);
    expect(reading).toBeLessThanOrEqual(after);
  });
});

describe("fictional clock behaviour", () => {
  it("integrates at 1x by default", () => {
    const { clock, frame } = controllableClock();
    for (let i = 0; i < 100; i += 1) frame(10);
    expect(clock.fictionalElapsedSeconds()).toBeCloseTo(1, 6);
  });

  it("reports an effective scale of zero while frozen", () => {
    const { clock } = controllableClock();
    clock.setTimeScale(1);

    clock.hitStop(50);
    expect(clock.getTimeScale()).toBe(0);
    expect(clock.isHitStopped()).toBe(true);

    clock.setPaused(true);
    expect(clock.getTimeScale()).toBe(0);
  });

  it("measures hit-stop in real time so dilation cannot stretch it", () => {
    const { clock, frame } = controllableClock();

    clock.setTimeScale(AIM_TIME_SCALE);
    clock.hitStop(100);

    // 100ms of REAL time clears it regardless of the 0.2x fiction scale.
    for (let i = 0; i < 10; i += 1) frame(10);
    expect(clock.isHitStopped()).toBe(false);
  });

  it("resumes fiction after a hit-stop expires", () => {
    const { clock, frame } = controllableClock();
    clock.hitStop(50);
    for (let i = 0; i < 3; i += 1) frame(10);
    expect(clock.fictionalElapsedSeconds()).toBe(0);

    for (let i = 0; i < 100; i += 1) frame(10);
    expect(clock.fictionalElapsedSeconds()).toBeGreaterThan(0.9);
  });

  it("takes the longest of overlapping hit-stops rather than shortening one", () => {
    const { clock } = controllableClock();
    clock.hitStop(200);
    clock.hitStop(50);
    expect(clock.isHitStopped()).toBe(true);
    clock.advance(0.1);
    expect(clock.isHitStopped()).toBe(true);
  });
});
