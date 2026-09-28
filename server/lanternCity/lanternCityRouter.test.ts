import { describe, expect, it } from "vitest";
import { lanternObjectiveMarksScope } from "./lanternCityRouter";

describe("lanternCityRouter identity mapping", () => {
  it("uses the canonical Day Director actor id and canonical Campaign Run identity", () => {
    expect(
      lanternObjectiveMarksScope({
        tenantId: "tenant-a",
        dayDirectorActorId: "7",
        campaignOperatorUserId: "canonical-owner",
      })
    ).toEqual({
      tenantId: "tenant-a",
      operatorId: "7",
      viewerOpenId: "canonical-owner",
    });
  });
});
