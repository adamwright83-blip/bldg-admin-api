import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openMissionFromDayLine, openMissionFromOverworld } from "./openMissionExperience";

describe("mission experience entrances", () => {
  it("33 Overworld with no landmark resumes the same instance", () => {
    const seen: Array<{ instanceId: string; entrance: string }> = [];
    openMissionFromOverworld("instance-louise", input => {
      seen.push(input);
    });
    expect(seen).toEqual([{ instanceId: "instance-louise", entrance: "OVERWORLD" }]);
    expect(openMissionFromOverworld.length).toBe(2);
  });

  it("Day Line and Overworld call sites wrap the existing enters", () => {
    const controller = readFileSync(
      new URL("../../pages/driver/GoldlineDriverController.tsx", import.meta.url),
      "utf8"
    );
    expect(controller).toContain("openMissionFromDayLine");
    expect(controller).toContain("openMissionFromOverworld");
    expect(controller).toContain("onEnterCampaignHost={enterCampaignHost}");
    const dayLine = controller.slice(controller.indexOf("onEnterWorld={trackedStopId =>"));
    expect(dayLine.indexOf("openMissionFromDayLine")).toBeGreaterThan(-1);
    expect(dayLine.indexOf("openMissionFromDayLine")).toBeLessThan(dayLine.indexOf("commercial-"));
    openMissionFromDayLine("instance-louise", input => {
      expect(input).toEqual({ instanceId: "instance-louise", entrance: "DAY_LINE" });
    });
  });
});
