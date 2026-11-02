import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  experienceFromEntrySearch,
  parseJoystickExperience,
} from "./joystickSelectedExperience";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("selected JOYSTICK experience", () => {
  it("maps the homepage worlds and the SPA landing modes", () => {
    expect(parseJoystickExperience("cozy")).toBe("lantern_city");
    expect(parseJoystickExperience("road")).toBe("trailblazer");
    expect(parseJoystickExperience("Lantern City")).toBe("lantern_city");
    expect(parseJoystickExperience("lantern-city")).toBe("lantern_city");
    expect(parseJoystickExperience("TRAILBLAZER")).toBe("trailblazer");
  });

  it("refuses anything that is not one of the two offered worlds", () => {
    expect(parseJoystickExperience("I run a cleaning business")).toBeNull();
    expect(parseJoystickExperience("")).toBeNull();
    expect(parseJoystickExperience(null)).toBeNull();
    expect(parseJoystickExperience(4)).toBeNull();
  });

  it("prefers world, then mode, then game, and ignores free-text game", () => {
    expect(experienceFromEntrySearch("?world=road&mode=cozy")).toBe("trailblazer");
    expect(experienceFromEntrySearch("?mode=cozy")).toBe("lantern_city");
    expect(experienceFromEntrySearch("?game=window%20cleaning")).toBeNull();
    expect(experienceFromEntrySearch("?session=abc&checkout=success")).toBeNull();
  });
});

describe("first-ten-minutes entry wiring", () => {
  it("lets the apex serve the signup funnel", () => {
    const vercel = JSON.parse(source("vercel.json")) as {
      rewrites: Array<{ source: string; destination: string }>;
    };
    expect(vercel.rewrites).toContainEqual({ source: "/joystick-start", destination: "/index.html" });
  });

  it("sends the static homepage to sign-up on gojoystick.com; activation carries the journey to the Stripe origin", () => {
    const app = source("client/public/joystick-home/app.js");
    const home = source("client/public/joystick-home/index.html");
    // Sign-up (server/joystickAccount) starts here; before checkout the first ten minutes hand the journey to the
    // origin Stripe returns to (ActivationCard), so the homepage no longer has to enter on that origin.
    expect(app).toContain("window.location.href = '/signup'");
    expect(source("client/src/pages/firstTenMinutes/chapter/ActivationCard.tsx")).toContain("firstTenHandoffUrl(activation.returnOrigin");
    expect(home).toContain("data-bring");
    expect(home).toContain('href="/signup"');
    expect(home).toContain('href="/login"');
  });
});
