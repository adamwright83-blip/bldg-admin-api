import { describe, expect, it } from "vitest";
import { resolveSilverLakeScope, type SilverLakeScopeDeps } from "./silverLakeScope";

const user = { id: 1, openId: "adam-admin", role: "admin" as const };
const deps = (memberships: Array<{ tenantId: string; role: string }>, canonical: string | Error): SilverLakeScopeDeps => ({
  memberships: async () => memberships,
  canonicalOperatorId: async () => {
    if (canonical instanceof Error) throw canonical;
    return canonical;
  },
});

describe("resolveSilverLakeScope", () => {
  it("an owner of Laundry Farm signed in to Laundry Butler meets Laundry Farm's customers, under their own objective", async () => {
    const scope = await resolveSilverLakeScope(
      { tenantId: "default", user },
      deps(
        [
          { tenantId: "default", role: "owner" },
          { tenantId: "laundry_farm", role: "owner" },
        ],
        "tenant:default:operator:adam-admin"
      )
    );
    expect(scope).toEqual({
      tenantId: "laundry_farm",
      operatorId: "adam-admin",
      objective: { tenantId: "default", canonicalOperatorId: "tenant:default:operator:adam-admin" },
    });
  });

  it("the objective is read under the canonical operator identity, never the login id", async () => {
    const scope = await resolveSilverLakeScope({ tenantId: "default", user }, deps([], "tenant:default:operator:adam-admin"));
    expect(scope.objective.canonicalOperatorId).toBe("tenant:default:operator:adam-admin");
  });

  it("nobody without an owner membership in Laundry Farm is given its book", async () => {
    for (const memberships of [[], [{ tenantId: "laundry_farm", role: "member" }], [{ tenantId: "default", role: "owner" }]]) {
      const scope = await resolveSilverLakeScope({ tenantId: "default", user }, deps(memberships, "op"));
      expect(scope.tenantId).toBe("default");
    }
    const other = await resolveSilverLakeScope(
      { tenantId: "goldline-dp-wright-contractors", user: { ...user, openId: "goldline-demo:wright-contractors" } },
      deps([{ tenantId: "goldline-dp-wright-contractors", role: "owner" }], "op")
    );
    expect(other.tenantId).toBe("goldline-dp-wright-contractors");
  });

  it("an unreadable membership or identity falls back to the signed-in tenant and login id, as before", async () => {
    const scope = await resolveSilverLakeScope(
      { tenantId: "default", user },
      {
        memberships: async () => {
          throw new Error("db down");
        },
        canonicalOperatorId: async () => {
          throw new Error("no identity");
        },
      }
    );
    expect(scope).toEqual({ tenantId: "default", operatorId: "adam-admin", objective: { tenantId: "default", canonicalOperatorId: "adam-admin" } });
  });
});
