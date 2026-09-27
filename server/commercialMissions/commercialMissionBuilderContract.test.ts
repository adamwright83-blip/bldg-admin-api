/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canTransitionCommercialMission } from "../../shared/commercialMissionLifecycle";

const service = readFileSync(
  new URL("./commercialMissionBuilderService.ts", import.meta.url),
  "utf8"
);
const proposalService = readFileSync(
  new URL("../commercialProposals/commercialProposalService.ts", import.meta.url),
  "utf8"
);
const activation = readFileSync(
  new URL("./commercialMissionActivationService.ts", import.meta.url),
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
const driverController = readFileSync(
  new URL(
    "../../client/src/pages/driver/GoldlineDriverController.tsx",
    import.meta.url
  ),
  "utf8"
);
const goldline = readFileSync(
  new URL("../../client/src/pages/goldline/GoldlineHome.tsx", import.meta.url),
  "utf8"
);
const commandCenter = readFileSync(
  new URL(
    "../../client/src/components/driver/CommandCenter.tsx",
    import.meta.url
  ),
  "utf8"
);
const builder = readFileSync(
  new URL(
    "../../client/src/components/driver/BuildMissionSheet.tsx",
    import.meta.url
  ),
  "utf8"
);

describe("driver mission builder contract", () => {
  it("exposes only field-authorized build and route-list procedures", () => {
    expect(router).toContain("myBuiltMissions: legacyDayforgeMissionFieldProcedure");
    expect(router).toContain("buildForDriver: legacyDayforgeMissionFieldProcedure");
    expect(router).toContain("driverId: ctx.user.openId");
  });

  it("keeps activation eligibility aligned with the field-assignee list", () => {
    expect(activation).toContain("ACTIVE_FIELD_MEMBERSHIP_ROLES");
    expect(activation).toContain('"owner"');
    expect(activation).toContain('"admin"');
    expect(activation).toContain('"operator"');
    expect(activation).toContain('"field"');
    expect(activation.match(/ACTIVE_FIELD_MEMBERSHIP_ROLES/g)?.length).toBeGreaterThanOrEqual(3);
    expect(activation).toContain("eq(legacyDayforgeSaasMemberships.active, true)");
  });

  it("keeps the complete built-mission acceptance chain internally compatible", () => {
    expect(proposalService).toMatch(
      /PROPOSAL_READY_STATUSES[\s\S]*"game_ready"/
    );
    expect(service).toContain("ensureApprovedBuilderProposal");
    expect(service).toContain("reusableByProviderId");
    expect(service).toContain("getLatestCommercialProposalForMission");

    const path = [
      ["candidate", "selected"],
      ["selected", "game_ready"],
      ["game_ready", "game_active"],
      ["game_active", "game_completed"],
      ["game_completed", "phone_ready"],
      ["phone_ready", "preparing"],
      ["preparing", "en_route"],
      ["en_route", "arrived"],
      ["arrived", "visit_completed"],
    ] as const;
    for (const [from, to] of path) {
      expect(canTransitionCommercialMission(from, to)).toBe(true);
    }
  });

  it("treats a street address as one exact property instead of three nearby venues", () => {
    expect(service).toContain("looksLikeSpecificStreetAddress");
    expect(service).toContain("resolveBusiness(input.searchNear)");
    expect(service).toContain('targetMode: exactTarget ? "exact_property" : "nearby_discovery"');
    expect(service).toMatch(/exactTarget \? 1 : input\.count/);
    expect(builder).toContain("Target property or area");
    expect(builder).toMatch(/count: \/\^\\s\*\\d\{1,6\}/);
  });

  it("deduplicates active venues and requires public phones for call missions", () => {
    expect(service).toContain("activeProviderIds");
    expect(service).toContain(
      'input.missionType !== "cold_call" || Boolean(opportunity.account.phone)'
    );
    expect(service).toContain("activateCommercialMissionForField");
    expect(service).toContain("generateCommercialProposal");
    expect(service).toContain("approveCommercialProposal");
    expect(service).toContain('source: "driver_mission_builder"');
  });

  it("keeps mission stops separate from operational order records", () => {
    expect(driver).toMatch(/<GoldlineDriverController\b/);
    expect(driverController).toContain("salesMissions: builtMissions.data");
    expect(goldline).toContain("function toSalesStop");
    expect(goldline).toContain("function toRouteStop");
    expect(goldline).toContain("...(pickups ?? []).map");
    expect(goldline).toContain("(salesMissions ?? []).map(toSalesStop)");
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
