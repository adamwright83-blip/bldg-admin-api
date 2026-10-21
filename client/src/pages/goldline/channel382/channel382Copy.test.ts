import { describe, expect, it } from "vitest";
import { ACTION, CELEBRATE, CLAIMS, HOOKS, INTRO, STUDIO_WORDS, canExport, captionFor, claimsFor, hookById } from "./channel382Copy";

describe("CHANNEL 382: the ad says only what Laundry Farm already says, and only once approved", () => {
  it("every hook's claims are known public claims with a source", () => {
    for (const h of HOOKS) for (const id of h.claims) expect(CLAIMS[id]?.source).toMatch(/laundryfarm\.com/);
  });

  it("no hook promises a pickup day or same-day service the site never states", () => {
    for (const h of HOOKS) expect(`${h.headline} ${h.subline}`).not.toMatch(/\btoday\b|\btuesday\b|\bthursday\b|same[- ]day|guarantee/i);
  });

  it("export waits for every claim, including an offer the operator wrote, and a final read-through", () => {
    const speed = claimsFor("speed", "").map(c => c.id);
    expect(canExport("speed", "", new Set(), true)).toBe(false);
    expect(canExport("speed", "", new Set(speed), false)).toBe(false);
    expect(canExport("speed", "", new Set(speed), true)).toBe(true);
    expect(canExport("speed", "$10 off your first pickup", new Set(speed), true)).toBe(false);
    expect(canExport("speed", "$10 off your first pickup", new Set([...speed, "offer"]), true)).toBe(true);
  });

  it("the price in 'the offer' hook needs its own approval", () => {
    expect(claimsFor("offer", "").map(c => c.id)).toContain("service_wash");
  });

  it("the caption is plain and true: no studio, no Bertrand, the real site and phone", () => {
    for (const h of HOOKS) {
      const caption = captionFor(h.headline, h.subline, "");
      expect(caption).not.toMatch(STUDIO_WORDS);
      expect(caption).toContain("laundryfarm.com");
      expect(caption).toContain("(424) 394-0344");
    }
    expect(captionFor(hookById("relief").headline, hookById("relief").subline, "First pickup: $10 off")).toContain("First pickup: $10 off");
  });

  it("the ad copy itself never mentions the studio", () => {
    for (const h of HOOKS) expect(`${h.headline} ${h.subline}`).not.toMatch(STUDIO_WORDS);
  });

  it("Bertrand never claims reach, ratings or results he doesn't have", () => {
    const lines = [...INTRO, ...Object.values(ACTION).flat(), ...Object.values(CELEBRATE).flat()].map(l => l.text);
    for (const l of lines) expect(l).not.toMatch(/\b\d[\d,]*\s*(views|impressions|people saw|reached|clicks|customers)\b/i);
    expect(CELEBRATE.posted_feed.map(l => l.text).join(" ")).toMatch(/real numbers/);
  });
});
