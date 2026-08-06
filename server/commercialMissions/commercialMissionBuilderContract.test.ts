import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync(
  new URL("./commercialMissionBuilderService.ts", import.meta.url),
  "utf8"
);
const router = readFileSync(
  new URL("./commercialMissionRouter.ts", import.meta.url),
  "utf8"
);
const driver = readFileSync(
  new URL("../../client/src/pages/Driver.tsx", import.meta.url),
  "utf8"
);
const commandCenter = readFileSync(
  new URL("../../client/src/components/driver/CommandCenter.tsx", import.meta.url),
  "utf8"
);
const builder = readFileSync(
  new URL("../../client/src/components/driver/BuildMissionSheet.tsx", import.meta.url),
  "utf8"
);

describe("driver mission builder contract", () => {
  it("exposes only field-authorized build and route-list procedures", () => {
    expect(router).toContain("myBuiltMissions: dayforgeMissionFieldProcedure");
    expect(router).toContain("buildForDriver: dayforgeMissionFieldProcedure");
    expect(router).toContain("driverId: ctx.user.openId");
  });

  it("deduplicates active venues and requires public phones for call missions", () => {
    expect(service).toContain("activeProviderIds");
    expect(service).toContain('input.missionType !== "cold_call" || Boolean(opportunity.account.phone)');
    expect(service).toContain("activateCommercialMissionForField");
    expect(service).toContain("generateCommercialProposal");
    expect(service).toContain("approveCommercialProposal");
    expect(service).toContain('source: "driver_mission_builder"');
  });

  it("keeps mission stops separate from operational order records", () => {
    expect(driver).toContain("salesMissions={builtMissions.data}");
    expect(commandCenter).toContain("salesMissions.map");
    expect(commandCenter).toContain("orders.map");
    expect(commandCenter).toContain("Sales missions");
    expect(commandCenter).toContain("Build mission");
  });

  it("asks for mission type then venue and never claims automated outreach", () => {
    expect(builder).toContain("Cold-call mission");
    expect(builder).toContain("In-person mission");
    expect(builder).toContain("Luxury living");
    expect(builder).toContain("Nothing is called or messaged automatically.");
  });
});
