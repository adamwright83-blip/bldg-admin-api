import { describe, expect, it } from "vitest";
import { getClaireRelationshipState } from "./relationshipState";

describe("G — fail closed: missing state/identity never increases disclosure", () => {
  it("returns Tier 0 when the database is unavailable (no DATABASE_URL in this environment)", async () => {
    const state = await getClaireRelationshipState({
      tenantId: "tenant-1",
      operatorUserId: "operator-1",
    });
    expect(state.disclosureTier).toBe(0);
    expect(state.professionalRespect).toBe(0);
  });

  it("returns Tier 0 when operator identity could not be resolved", async () => {
    const state = await getClaireRelationshipState({
      tenantId: "tenant-1",
      operatorUserId: null,
    });
    expect(state.disclosureTier).toBe(0);
    expect(state.operatorUserId).toBe("unresolved");
  });
});
