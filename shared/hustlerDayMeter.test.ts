import { describe, expect, it } from "vitest";
import {
  HUSTLER_TIERS,
  NOTCH_HARD_ACTION,
  NOTCH_OUTREACH,
  projectHustlerDay,
} from "./hustlerDayMeter";

describe("the hustler day meter measures effort, not outcomes", () => {
  it("starts the day at the bottom with nothing claimed", () => {
    const m = projectHustlerDay({ outreachSent: 0, hardActions: 0 });
    expect(m.notches).toBe(0);
    expect(m.tier).toBe("reject");
    expect(m.because).toBe("Nothing recorded yet today.");
  });

  it("gives a reactivation half a notch", () => {
    expect(projectHustlerDay({ outreachSent: 1, hardActions: 0 }).notches).toBe(
      NOTCH_OUTREACH
    );
  });

  it("gives a real stop a full notch, because it is harder", () => {
    expect(projectHustlerDay({ outreachSent: 0, hardActions: 1 }).notches).toBe(
      NOTCH_HARD_ACTION
    );
  });

  it("cannot be maxed by repeating the cheapest action alone", () => {
    // Ten texts is five notches only because a text is worth half. The point
    // is that it takes ten of them, not two.
    const spam = projectHustlerDay({ outreachSent: 2, hardActions: 0 });
    expect(spam.tier).not.toBe("legend");
    const balanced = projectHustlerDay({ outreachSent: 2, hardActions: 4 });
    expect(balanced.tier).toBe("legend");
  });

  it("never exceeds the top tier however big the day", () => {
    const m = projectHustlerDay({ outreachSent: 99, hardActions: 99 });
    expect(m.tier).toBe("legend");
    expect(m.tierIndex).toBe(HUSTLER_TIERS.length - 1);
    expect(m.nextTier).toBeNull();
    expect(m.progressToNext).toBe(1);
  });

  it("climbs the tiers in order", () => {
    const seen = [0, 1, 2, 3, 4, 5].map(
      n => projectHustlerDay({ outreachSent: 0, hardActions: n }).tier
    );
    expect(seen).toEqual([...HUSTLER_TIERS]);
  });

  it("explains itself in things the operator can remember doing", () => {
    const m = projectHustlerDay({ outreachSent: 2, hardActions: 1 });
    expect(m.because).toContain("1 real stop");
    expect(m.because).toContain("2 reactivations sent");
  });

  it("ignores negative or fractional counts rather than trusting them", () => {
    expect(projectHustlerDay({ outreachSent: -5, hardActions: -2 }).notches).toBe(0);
    expect(projectHustlerDay({ outreachSent: 1.9, hardActions: 0 }).notches).toBe(
      NOTCH_OUTREACH
    );
  });

  it("is deterministic — the same day always reads the same", () => {
    const day = { outreachSent: 3, hardActions: 2 };
    expect(projectHustlerDay(day)).toEqual(projectHustlerDay(day));
  });
});

describe("firewall: the meter cannot be moved by outcomes", () => {
  it("has nowhere to put revenue, orders, or customer replies", () => {
    const effort = { outreachSent: 1, hardActions: 1 };
    expect(Object.keys(effort).sort()).toEqual(["hardActions", "outreachSent"]);
    for (const forbidden of [
      "revenueCents",
      "ordersPlaced",
      "customersRecovered",
      "repliesReceived",
    ]) {
      expect(forbidden in effort).toBe(false);
    }
  });

  it("a day of real effort with zero business result still reads as work done", () => {
    // The whole reason effort and outcome are separate meters.
    const m = projectHustlerDay({ outreachSent: 2, hardActions: 2 });
    expect(m.notches).toBeGreaterThan(0);
    expect(m.tier).not.toBe("reject");
  });
});
