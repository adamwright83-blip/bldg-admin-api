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

  it("sends the static homepage into the funnel on the origin Stripe returns to", () => {
    const app = source("client/public/joystick-home/app.js");
    const billing = source("server/saas/saasBilling.ts");
    // The funnel's resume token lives in the starting origin's storage, so the
    // homepage must enter the funnel on the same origin as the Stripe return.
    expect(billing).toContain('"https://admin.bldg.chat"');
    expect(app).toContain("const FUNNEL_ORIGIN = 'https://admin.bldg.chat';");
    expect(app).toContain("'/joystick-start?world='");
    expect(source("client/public/joystick-home/index.html")).toContain("data-bring");
  });
});
