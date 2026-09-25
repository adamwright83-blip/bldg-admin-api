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
    expect(capability?.allowedSurfaces).toEqual(["phone"]);
    expect(capabilityIsActionable("operator_sms.send")).toBe(true);
  });

  it("advertises SMS only on the phone capability briefing", () => {
    expect(formatCapabilityBriefing(undefined, "phone")).toContain("operator_sms.send");
    expect(formatCapabilityBriefing(undefined, "desktop")).not.toContain("operator_sms.send");
    expect(formatCapabilityBriefing(undefined, "mobile")).not.toContain("operator_sms.send");
  });
});
