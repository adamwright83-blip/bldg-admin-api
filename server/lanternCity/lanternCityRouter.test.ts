import { describe, expect, it } from "vitest";
import { lanternObjectiveMarksScope } from "./lanternCityRouter";

describe("lanternCityRouter identity mapping", () => {
  it("uses the canonical Day Director actor id and every authorized Campaign Run identity", () => {
    expect(
      lanternObjectiveMarksScope({
        tenantId: "tenant-a",
        dayDirectorActorId: "7",
        dayDirectorActorIds: ["7", "22", "7"],
        campaignOperatorUserIds: [
          "canonical-owner",
          "driver-primary",
          "canonical-owner",
        ],
      })
    ).toEqual({
      tenantId: "tenant-a",
      operatorId: "7",
      operatorIds: ["7", "22"],
      viewerOpenIds: ["canonical-owner", "driver-primary"],
    });
  });
});
