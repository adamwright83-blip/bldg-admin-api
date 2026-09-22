import { describe, expect, it } from "vitest";
import {
  capabilityIsActionable,
  formatCapabilityBriefing,
  getGoldlineCapability,
} from "./goldlineCapabilities";

describe("Goldline operator SMS capability", () => {
  it("declares authenticated operator SMS as supported on phone", () => {
    const capability = getGoldlineCapability("operator_sms.send");
    expect(capability).toMatchObject({
      status: "SUPPORTED",
      implementation: "sendOperatorArtifact",
      permissionLevel: "operator",
    });
    expect(capability?.allowedSurfaces).toContain("phone");
    expect(capabilityIsActionable("operator_sms.send")).toBe(true);
  });

  it("puts the SMS capability in Claire's authoritative capability briefing", () => {
    expect(formatCapabilityBriefing()).toContain("operator_sms.send");
  });
});
