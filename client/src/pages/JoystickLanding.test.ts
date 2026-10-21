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

  it("does not use the unapproved monsters line", () => {
    expect(source).not.toContain("THE MONSTERS ARE FAKE");
    expect(source).not.toContain("THE MONEY ISN");
  });

  it("labels the gameplay as sample data, and the example check-in as never sent", () => {
    expect(source).toContain("Actual gameplay. Sample data. Your decisions.");
    expect(source).toContain("Example game");
    expect(source).toContain("Sample customer · Nothing is sent");
    expect(source).toContain("Demo only. No message was sent.");
    expect(source).not.toContain("REAL MISSIONS. REAL REVENUE.");
    expect(source).not.toContain("<strong>Result:</strong>");
  });

  it("keeps the approved hero line", () => {
    expect(source).toContain('aria-label="Joystick — Your business. A game you can actually win."');
    expect(source).toContain("Your business.<br />A game you can<br />actually win.");
  });

  it("never says the banned marketing lines", () => {
    expect(source).not.toMatch(/save file/i);
    expect(source).not.toMatch(/monsters are fake/i);
  });

  it("advertises $49/month with a seven-day trial and a card required at signup", () => {
    expect(source).toContain("7-day trial");
    expect(source).toContain("$49/month");
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
    // each event's own payload, not the page copy after it ("No message was sent" is fine)
    const payloads = [...source.matchAll(/captureProductEvent\(([^)]*)\)/g)].map(m => m[1]);
    expect(payloads.length).toBeGreaterThan(0);
    for (const payload of payloads) expect(payload).not.toMatch(/\b(message|body|answer|draft)\b/);
  });
});
