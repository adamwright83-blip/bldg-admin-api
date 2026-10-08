/* LEGACY DAYFORGE COMPATIBILITY: this test intentionally verifies the retained legacy entitlement boundary; canonical product is JOYSTICK. */
import { describe, expect, it } from "vitest";
import {
  PERSISTENT_OPERATOR_ENTITLEMENT,
  SAAS_ENTITLEMENTS,
  DAYFORGE_ENTITLEMENTS,
} from "../../../shared/saasTenant";
import { assertPersistentOperatorTenantScope } from "./tenantScope";

describe("persistent operator tenant guards", () => {
  it("has an explicit persisted SaaS entitlement that is not a legacy default", () => {
    expect(SAAS_ENTITLEMENTS).toContain(PERSISTENT_OPERATOR_ENTITLEMENT);
    expect(DAYFORGE_ENTITLEMENTS).not.toContain(PERSISTENT_OPERATOR_ENTITLEMENT as never);
  });

  it("refuses tenant-less or operator-less background scope", () => {
    expect(() =>
      assertPersistentOperatorTenantScope({ tenantId: "", operatorUserId: "operator-a" })
    ).toThrow(/tenantId/);
    expect(() =>
      assertPersistentOperatorTenantScope({ tenantId: "tenant-a", operatorUserId: "" })
    ).toThrow(/operatorUserId/);
    expect(
      assertPersistentOperatorTenantScope({
        tenantId: " tenant-a ",
        operatorUserId: " operator-a ",
      })
    ).toEqual({ tenantId: "tenant-a", operatorUserId: "operator-a" });
  });
});
