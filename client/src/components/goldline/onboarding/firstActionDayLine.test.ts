import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) =>
  fs.readFileSync(path.resolve(import.meta.dirname, ...parts), "utf8");

const reveal = read("DesignPartnerWorld.tsx");
const driver = read("..", "..", "..", "pages", "Driver.tsx");
const dayPlan = read("..", "..", "..", "pages", "goldline", "GoldlineDayPlan.tsx");
const firstMission = read("FirstMissionDriver.tsx");

describe("First Action Experience & Day Line Connection", () => {
  it("routes active first mission from reveal directly to Driver with mission=first query param", () => {
    expect(reveal).toContain('href={mission.gameplayCompletedAt?"/driver":"/driver?mission=first"}');
    expect(reveal).toContain("BEGIN MISSION");
  });

  it("initializes Driver with sideQuestOpen when mission=first is requested", () => {
    expect(driver).toContain('params.get("mission") === "first"');
    expect(driver).toContain("firstSparkAvailable");
    expect(driver).toContain("FirstMissionDriver");
  });

  it("surfaces the first mission in Day Plan empty state and Next Up bar when onOpenFirstMission is passed", () => {
    expect(dayPlan).toContain("props.onOpenFirstMission");
    expect(dayPlan).toContain("BEGIN FIRST MISSION · THE FIRST SPARK");
    expect(dayPlan).toContain("THE FIRST SPARK");
    expect(dayPlan).toContain("START MISSION");
  });

  it("unconditionally captures first real action and guardian defeat telemetry", () => {
    expect(firstMission).toContain('captureProductEvent("joystick_first_real_action_completed"');
    expect(firstMission).toContain('captureProductEvent("guardian_defeated"');
  });
});
