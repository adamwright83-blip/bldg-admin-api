import { describe, expect, it } from "vitest";
import { DEMO_MISSION } from "@shared/commercialMission";
import {
  decodeCommercialMissionMetadata,
  encodeCommercialMissionMetadata,
  opsStatusForCommercialMission,
} from "./opsTaskCommercialMissionStore";

describe("opsTaskCommercialMissionStore", () => {
  it("round-trips the canonical mission snapshot", () => {
    const encoded = encodeCommercialMissionMetadata(DEMO_MISSION);
    const decoded = decodeCommercialMissionMetadata(encoded);

    expect(decoded?.mission.code).toBe("MISSION 042");
    expect(decoded?.mission.accountName).toBe("Westview Property Management");
    expect(decoded?.mission.estimatedAnnualValueCents).toBe(2_480_000);
  });

  it("rejects unrelated ops-task metadata", () => {
    expect(decodeCommercialMissionMetadata({ residentReply: true })).toBeNull();
    expect(decodeCommercialMissionMetadata(null)).toBeNull();
  });

  it("maps mission lifecycle states onto existing durable ops statuses", () => {
    expect(opsStatusForCommercialMission("candidate")).toBe("open");
    expect(opsStatusForCommercialMission("game_active")).toBe("in_progress");
    expect(opsStatusForCommercialMission("phone_ready")).toBe("in_progress");
    expect(opsStatusForCommercialMission("won")).toBe("completed");
    expect(opsStatusForCommercialMission("lost")).toBe("completed");
  });
});
