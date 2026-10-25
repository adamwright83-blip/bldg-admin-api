import { describe, expect, it } from "vitest";
import { EARLY, GRAB_PENALTY, KNOT, PULL, PULL_DUR, REST_AFTER, grabbed, isResting, plannedHeight, press, startClimb, tick, type ClimbState } from "./climbMachine";

const run = (s: ClimbState, seconds: number, step = 1 / 60) => {
  for (let t = 0; t < seconds; t += step) s = tick(s, step);
  return s;
};

describe("the rope (Jusant hands)", () => {
  it("alternating hands climbs a full pull each; the same hand twice climbs half", () => {
    let s = startClimb(0);
    s = run(press(s, "R"), PULL_DUR + 0.01);
    expect(s.h).toBeCloseTo(PULL, 3);
    s = run(press(s, "L"), PULL_DUR + 0.01);
    expect(s.h).toBeCloseTo(PULL * 2, 3);
    s = run(press(s, "L"), PULL_DUR + 0.01);
    expect(s.h).toBeCloseTo(PULL * 2.5, 3);
  });

  it("'next' presses alternate on their own (one-button play)", () => {
    let s = startClimb(0);
    s = run(press(s, "next"), PULL_DUR + 0.01);
    s = run(press(s, "next"), PULL_DUR + 0.01);
    expect(s.h).toBeCloseTo(PULL * 2, 3);
  });

  it("mashing is not climbing: presses early in a pull queue once and the rest are dropped", () => {
    let s = startClimb(0);
    for (let i = 0; i < 8; i++) s = press(s, "next");
    expect(s.target).toBeCloseTo(PULL, 3); // one pull running, one queued; the target is the running one
    s = run(s, PULL_DUR * 2 + 0.05);
    expect(s.h).toBeCloseTo(PULL * 2, 3); // the queued pull happened, nothing else
  });

  it("the planned height counts the queued pull, and never goes down while she hangs", () => {
    let s = startClimb(0.15);
    for (let i = 0; i < 4; i++) s = press(s, "next");
    expect(plannedHeight(s)).toBeCloseTo(0.15 + PULL * 2, 3);
    const planned = plannedHeight(s);
    s = run(s, 3);
    expect(s.h).toBeCloseTo(planned, 3);
    expect(plannedHeight(s)).toBeCloseTo(planned, 3);
  });

  it("a press late enough in a pull chains straight into the next one", () => {
    let s = startClimb(0);
    s = press(s, "R");
    s = run(s, PULL_DUR * (EARLY + 0.05));
    s = press(s, "L");
    expect(s.pull?.hand).toBe("L");
    expect(s.target).toBeCloseTo(PULL * 2, 3);
  });

  it("pulling costs stamina; hanging still rests and refills it", () => {
    let s = startClimb(0);
    for (let i = 0; i < 6; i++) s = run(press(s, "next"), PULL_DUR + 0.02);
    const tired = s.stamina;
    expect(tired).toBeLessThan(0.7);
    s = run(s, REST_AFTER + 1.5);
    expect(isResting(s)).toBe(true);
    expect(s.stamina).toBeGreaterThan(tired + 0.25);
  });

  it("with no stamina a press does nothing; she hangs until some comes back", () => {
    let s = { ...startClimb(0), stamina: 0 };
    s = press(s, "R");
    expect(s.pull).toBeNull();
    s = run(s, 1.2);
    expect(s.stamina).toBeGreaterThan(0.1);
    s = press(s, "R");
    expect(s.pull).not.toBeNull();
  });

  it("grabbed at the ankle drops her to the last knot, never to the floor, and costs her", () => {
    let s = startClimb(0);
    for (let i = 0; i < 5; i++) s = run(press(s, "next"), PULL_DUR + 0.02);
    const before = s;
    s = grabbed(s);
    expect(s.h).toBeCloseTo(Math.floor(before.h / KNOT) * KNOT, 3);
    expect(s.h).toBeGreaterThan(0.15);
    expect(s.stamina).toBeCloseTo(before.stamina - GRAB_PENALTY, 3);
  });

  it("the climb is deterministic: the same presses give the same height", () => {
    const go = () => {
      let s = startClimb(0);
      for (let i = 0; i < 4; i++) s = run(press(s, "next"), 0.2);
      return run(s, 1).h;
    };
    expect(go()).toBe(go());
  });
});
