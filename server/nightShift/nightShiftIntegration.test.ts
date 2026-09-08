import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const controller = readFileSync(
  new URL("../../client/src/pages/driver/GoldlineDriverController.tsx", import.meta.url),
  "utf8"
);
const dayPlan = readFileSync(
  new URL("../../client/src/pages/goldline/GoldlineDayPlan.tsx", import.meta.url),
  "utf8"
);
const overview = readFileSync(
  new URL("../goldlineWorld/lanternCityOverviewService.ts", import.meta.url),
  "utf8"
);

describe("Night Shift integrations", () => {
  it("Driver dawn reads the authoritative authored day", () => {
    expect(controller).toContain("trpc.system.nightShift.today.useQuery");
    expect(controller).toContain("authoredDay={");
    expect(dayPlan).toContain("authoredDay:");
    expect(dayPlan).toContain("authored-day-framing");
  });

  it("Launch Operation commits the same authored-day context", () => {
    expect(overview).toContain("commitAuthoredDayForOperation");
  });

  it("does not create a parallel mission/day subsystem", () => {
    expect(controller).not.toContain("nightShiftMission");
    expect(dayPlan).not.toContain("parallelDayPlan");
  });
});
