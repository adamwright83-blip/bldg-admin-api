import { describe, expect, it } from "vitest";
import { lanternObjectiveMarksScope } from "./lanternCityRouter";

describe("lanternCityRouter identity mapping", () => {
  it("keeps Day Director actor id separate from Campaign Run viewer openId", () => {
    expect(
      lanternObjectiveMarksScope({
        tenantId: "tenant-a",
        user: { id: 7, openId: "driver-primary" },
      })
    ).toEqual({
      tenantId: "tenant-a",
      operatorId: "7",
      viewerOpenId: "driver-primary",
    });
  });
});
