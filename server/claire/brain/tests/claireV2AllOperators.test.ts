import { describe, expect, it } from "vitest";
import {
  claireV2OpenToAllOperators,
  isAuthorizedClaireOperatorIdentity,
  resolveClaireOperatorAuthority,
  type ClaireOperatorMembership,
} from "../live/operatorAuthority";

// Launch: without this, every customer but the owner is answered by legacy Claire.
describe("CLAIRE_BRAIN_V2_OPERATOR_IDS=* opens Brain V2 to every verified operator", () => {
  const open = { CLAIRE_BRAIN_V2_OPERATOR_IDS: "*", OWNER_OPEN_ID: "adam-admin" } as NodeJS.ProcessEnv;
  const closed = { OWNER_OPEN_ID: "adam-admin" } as NodeJS.ProcessEnv;
  const member = (tenantId: string, userOpenId: string, role: ClaireOperatorMembership["role"]) =>
    async () => ({ tenantId, userOpenId, role }) as ClaireOperatorMembership;

  it("default is unchanged: the owner and historical ids only", () => {
    expect(claireV2OpenToAllOperators(closed)).toBe(false);
    expect(isAuthorizedClaireOperatorIdentity("adam-admin", closed)).toBe(true);
    expect(isAuthorizedClaireOperatorIdentity("daisy-new-customer", closed)).toBe(false);
  });

  it("with *, a new customer's verified owner membership gets Brain V2", async () => {
    expect(isAuthorizedClaireOperatorIdentity("daisy-new-customer", open)).toBe(true);
    const authority = await resolveClaireOperatorAuthority(
      { tenantId: "daisy-cleaning", operatorUserId: "daisy-new-customer" },
      { env: open, resolveMembership: member("daisy-cleaning", "daisy-new-customer", "owner") }
    );
    expect(authority).toMatchObject({ authorized: true, tenantId: "daisy-cleaning", basis: "verified_membership" });
  });

  it("with *, membership still decides: no membership, another tenant, or a non-operator role is refused", async () => {
    const none = await resolveClaireOperatorAuthority(
      { tenantId: "daisy-cleaning", operatorUserId: "stranger" },
      { env: open, resolveMembership: async () => null }
    );
    expect(none).toEqual({ authorized: false, reason: "membership_unverified" });
    const elsewhere = await resolveClaireOperatorAuthority(
      { tenantId: "daisy-cleaning", operatorUserId: "tj" },
      { env: open, resolveMembership: member("tj-door-hangers", "tj", "owner") }
    );
    expect(elsewhere).toEqual({ authorized: false, reason: "membership_unverified" });
    const viewer = await resolveClaireOperatorAuthority(
      { tenantId: "daisy-cleaning", operatorUserId: "viewer" },
      { env: open, resolveMembership: member("daisy-cleaning", "viewer", "viewer" as never) }
    );
    expect(viewer).toEqual({ authorized: false, reason: "role_not_authorized" });
  });

  it("an empty identity is never authorized", () => {
    expect(isAuthorizedClaireOperatorIdentity("  ", open)).toBe(false);
  });
});
