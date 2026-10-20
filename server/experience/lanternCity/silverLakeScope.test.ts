import { describe, expect, it } from "vitest";
import { silverLakeOperatorId } from "./silverLakeScope";

const user = { id: 1, openId: "adam-admin", role: "admin" as const };

describe("silverLakeOperatorId", () => {
  it("reads the objective under the canonical operator identity of the selected business, never the login id", async () => {
    const seen: string[] = [];
    const id = await silverLakeOperatorId({ tenantId: "laundry_farm", user }, async ({ tenantId, user: u }) => {
      seen.push(tenantId);
      return `tenant:${tenantId}:operator:${u.openId}`;
    });
    expect(id).toBe("tenant:laundry_farm:operator:adam-admin");
    // the selected business is the only tenant consulted: owning another never redirects to it
    expect(seen).toEqual(["laundry_farm"]);
  });

  it("falls back to the login id when the identity cannot be resolved, as before", async () => {
    const id = await silverLakeOperatorId({ tenantId: "default", user }, async () => {
      throw new Error("identity_unresolved");
    });
    expect(id).toBe("adam-admin");
  });
});
