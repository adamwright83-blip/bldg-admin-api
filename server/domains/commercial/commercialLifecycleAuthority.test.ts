import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const core = readFileSync(
  new URL("./commercialPipelineCore.ts", import.meta.url),
  "utf8"
);
const missionStore = readFileSync(
  new URL("../../commercialMissions/commercialMissionStore.ts", import.meta.url),
  "utf8"
);
const walkIn = readFileSync(
  new URL("../../commercialMissions/commercialWalkInService.ts", import.meta.url),
  "utf8"
);

describe("commercial lifecycle authority", () => {
  it("routes walk-in commercial stage writes through the canonical Commercial pipeline port", () => {
    expect(walkIn).toContain("syncCommercialPipelineForMissionTransitionWith(tx");
    expect(walkIn).not.toContain("update(commercialPipelineRecords)");
    expect(walkIn).not.toContain("insert(commercialPipelineEvents)");
  });

  it("keeps customer activation and verbal-yes agreement inside the authoritative won conversion", () => {
    const start = core.indexOf("async function convertWonAccountWith");
    const end = core.indexOf(
      "export async function reconcileWonCommercialDownstreamEffects",
      start
    );
    const conversion = core.slice(start, end);
    expect(conversion).toContain("commercialCustomers");
    expect(conversion).toContain("commercialServiceExpectations");
    expect(conversion).toContain("commercialAgreements");
    expect(conversion).toContain('status: "verbal_yes"');
    expect(conversion).toContain("commercialCustomerId: customer.id");
    expect(conversion).not.toContain("commercialRouteAssignments");
    expect(conversion).not.toContain("commercialMissionFinalRewards");
  });

  it("keeps route assignment and XP reward post-commit and best-effort", () => {
    expect(core).toContain("reconcileWonCommercialDownstreamEffects");
    expect(core).toContain("commercialRouteAssignments");
    expect(core).toContain("commercialMissionFinalRewards");
    expect(missionStore).toContain(
      "[CommercialPipeline] won downstream reconciliation deferred"
    );
    expect(missionStore).toContain('if (input.toStatus === "won")');
  });

  it("does not make payment evidence part of won lifecycle admission", () => {
    expect(core).not.toContain("payment_verified");
    expect(core).not.toContain("stripe_payment_intent");
    expect(core).not.toContain("orders.paid");
  });
});
