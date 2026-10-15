/* LEGACY DAYFORGE COMPATIBILITY: route literal retained for the existing tenant-provisioning endpoint; customer-facing product is JOYSTICK. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, "JoystickLanding.tsx"),
  "utf8"
);

describe("JOYSTICK public start", () => {
  it("routes a fresh customer through tenant provisioning, not tenant-bound Goldline onboarding", () => {
    expect(source).toContain('const START_PATH = "/joystick-start";');
    expect(source).not.toContain('const START_PATH = "/onboarding";');
  });

  it("keeps the approved hero line", () => {
    expect(source).toContain('aria-label="Joystick — Play the work you hate"');
    expect(source).toContain("PLAY THE");
    expect(source).toContain("WORK YOU HATE.");
  });

  it("advertises $49/month with a seven-day trial and a card required at signup", () => {
    expect(source).toContain("7-day trial");
    expect(source).toContain("$49/month");
    expect(source).toContain("7-Day Free Trial, Then $49/Month");
    expect(source).toContain("Card required at signup");
  });

  it("does not advertise a live charge while checkout is unverified", () => {
    expect(source).toContain("Checkout is not open. This does not charge a card.");
    expect(source).toContain('data-testid="landing-checkout-unavailable"');
    expect(source).not.toContain("START 7-DAY TRIAL");
    expect(source).not.toContain("joystick-pricing-cta");
    expect(source).toContain('captureProductEvent("landing_checkout_unavailable"');
    expect(source).toContain("checkout_live: false");
  });

  it("does not show an annual price other than $468/year", () => {
    const annual = [...source.matchAll(/\$\s*([0-9][0-9,]*)\s*(?:\/\s*year|per year)/gi)];
    expect(annual.every(match => match[1].replace(/,/g, "") === "468")).toBe(true);
  });

  it("does not advertise XP, coins, gold, or streaks", () => {
    expect(source).not.toMatch(/\bXP\b|\bcoins?\b|\bgold\b|\bstreaks?\b/i);
  });

  it("records pricing and closed-checkout events without message bodies", () => {
    expect(source).toContain('captureProductEvent("landing_pricing_viewed"');
    expect(source).toContain("monthly_usd: 49");
    expect(source).toContain("trial_days: 7");
    expect(source).toContain("card_required_at_signup: true");
    expect(source).not.toMatch(/captureProductEvent\([\s\S]*\b(message|body|answer)\b/);
  });
});
