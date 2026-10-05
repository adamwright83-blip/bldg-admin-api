import { describe, expect, it, vi } from "vitest";
import {
  operatorUserCanResolveOnTenant,
  requireEffectiveOperatorIdentityForTenant,
  resolveCanonicalOperatorIdentity,
  type OperatorIdentityBinding,
  type OperatorIdentityResolverDeps,
  type OperatorIdentityUser,
} from "./identity";

type Fixture = {
  users: OperatorIdentityUser[];
  bindings?: OperatorIdentityBinding[];
};

function deps(fixture: Fixture): OperatorIdentityResolverDeps {
  const bindings = fixture.bindings ?? [];
  return {
    findUserByOpenId: async (tenantId, openId) =>
      fixture.users.find(
        user => user.tenantId === tenantId && user.openId === openId
      ) ?? null,
    findUserById: async (tenantId, userId) =>
      fixture.users.find(
        user => user.tenantId === tenantId && user.id === userId
      ) ?? null,
    listBindingsForAlias: async (tenantId, aliasOpenId) =>
      bindings.filter(
        binding =>
          binding.tenantId === tenantId &&
          binding.aliasOpenId === aliasOpenId &&
          binding.active
      ),
    listBindingsForCanonical: async (tenantId, canonicalOpenId) =>
      bindings.filter(
        binding =>
          binding.tenantId === tenantId &&
          binding.canonicalOpenId === canonicalOpenId &&
          binding.active
      ),
    resolveMembership: async input => {
      const user = fixture.users.find(
        candidate =>
          candidate.tenantId === input.tenantId &&
          candidate.openId === input.userOpenId
      );
      if (!user) return null;
      return {
        tenantId: input.tenantId,
        userOpenId: input.userOpenId,
        role:
          user.role === "admin"
            ? "owner"
            : user.role === "driver"
              ? "field"
              : "operator",
      };
    },
    recordFailure: vi.fn(async () => undefined),
  };
}

function binding(
  canonicalOpenId: string,
  aliasOpenId: string,
  surface = "driver"
): OperatorIdentityBinding {
  return {
    id: `binding-${aliasOpenId}`,
    tenantId: "tenant-a",
    canonicalOpenId,
    aliasOpenId,
    surface,
    active: true,
    createdByOpenId: "admin-owner",
    revokedAt: null,
  };
}

describe("canonical operator identity", () => {
  it("never treats numeric user id and openId as interchangeable", async () => {
    const fixture = deps({
      users: [
        {
          id: 42,
          tenantId: "tenant-a",
          openId: "admin-owner",
          role: "admin",
        },
        {
          id: 7,
          tenantId: "tenant-a",
          openId: "42",
          role: "driver",
        },
      ],
    });

    const byOpenId = await resolveCanonicalOperatorIdentity(
      {
        tenantId: "tenant-a",
        source: { type: "open_id", value: "42" },
        subsystem: "test",
      },
      fixture
    );
    const byUserId = await resolveCanonicalOperatorIdentity(
      {
        tenantId: "tenant-a",
        source: { type: "user_id", value: 42 },
        subsystem: "test",
      },
      fixture
    );

    expect(byOpenId.ok && byOpenId.identity.sourceUserId).toBe(7);
    expect(byOpenId.ok && byOpenId.identity.dayDirectorActorId).toBe("7");
    expect(byUserId.ok && byUserId.identity.sourceOpenId).toBe("admin-owner");
    expect(byUserId.ok && byUserId.identity.dayDirectorActorId).toBe("42");
  });

  it("resolves explicitly bound Admin and Driver logins to one canonical operator", async () => {
    const fixture = deps({
      users: [
        {
          id: 11,
          tenantId: "tenant-a",
          openId: "admin-owner",
          role: "admin",
        },
        {
          id: 22,
          tenantId: "tenant-a",
          openId: "driver-primary",
          role: "driver",
        },
      ],
      bindings: [binding("admin-owner", "driver-primary")],
    });

    const admin = await resolveCanonicalOperatorIdentity(
      {
        tenantId: "tenant-a",
        source: { type: "open_id", value: "admin-owner" },
        subsystem: "admin",
      },
      fixture
    );
    const driver = await resolveCanonicalOperatorIdentity(
      {
        tenantId: "tenant-a",
        source: { type: "open_id", value: "driver-primary" },
        subsystem: "driver",
      },
      fixture
    );

    expect(admin.ok).toBe(true);
    expect(driver.ok).toBe(true);
    if (!admin.ok || !driver.ok) return;
    expect(driver.identity.canonicalOperatorId).toBe(
      admin.identity.canonicalOperatorId
    );
    expect(driver.identity.canonicalOpenId).toBe("admin-owner");
    expect(driver.identity.dayDirectorActorId).toBe("11");
    expect(driver.identity.dayDirectorActorIds.sort()).toEqual(["11", "22"]);
    expect(driver.identity.weeklyOperatorId).toBe("admin-owner");
    expect(driver.identity.campaignOperatorUserId).toBe("admin-owner");
    expect(driver.identity.aliases.map(alias => alias.openId).sort()).toEqual([
      "admin-owner",
      "driver-primary",
    ]);
  });

  it("fails closed when the source identity belongs to another tenant", async () => {
    const fixture = deps({
      users: [
        {
          id: 11,
          tenantId: "tenant-a",
          openId: "admin-owner",
          role: "admin",
        },
      ],
    });
    const result = await resolveCanonicalOperatorIdentity(
      {
        tenantId: "tenant-b",
        source: { type: "open_id", value: "admin-owner" },
        subsystem: "test",
      },
      fixture
    );
    expect(result).toEqual({ ok: false, reason: "identity_unresolved" });
  });

  it("fails closed when one alias has multiple active canonical bindings", async () => {
    const fixture = deps({
      users: [
        {
          id: 11,
          tenantId: "tenant-a",
          openId: "admin-owner",
          role: "admin",
        },
        {
          id: 12,
          tenantId: "tenant-a",
          openId: "other-owner",
          role: "admin",
        },
        {
          id: 22,
          tenantId: "tenant-a",
          openId: "driver-primary",
          role: "driver",
        },
      ],
      bindings: [
        binding("admin-owner", "driver-primary"),
        { ...binding("other-owner", "driver-primary"), id: "binding-two" },
      ],
    });
    const result = await resolveCanonicalOperatorIdentity(
      {
        tenantId: "tenant-a",
        source: { type: "open_id", value: "driver-primary" },
        subsystem: "test",
      },
      fixture
    );
    expect(result).toEqual({ ok: false, reason: "identity_ambiguous" });
  });

  it("rejects an authenticated openId/user-id pair that does not match", async () => {
    const fixture = deps({
      users: [
        {
          id: 11,
          tenantId: "tenant-a",
          openId: "admin-owner",
          role: "admin",
        },
      ],
    });
    const result = await resolveCanonicalOperatorIdentity(
      {
        tenantId: "tenant-a",
        source: {
          type: "open_id",
          value: "admin-owner",
          expectedUserId: 999,
        },
        subsystem: "test",
      },
      fixture
    );
    expect(result).toEqual({ ok: false, reason: "identity_unresolved" });
  });

  it("allows only recognized shared-password identities to use a legacy host tenant", () => {
    expect(
      operatorUserCanResolveOnTenant(
        {
          id: 1,
          tenantId: "default",
          openId: "admin-owner",
          role: "admin",
        },
        "laundry_farm"
      )
    ).toBe(true);
    expect(
      operatorUserCanResolveOnTenant(
        {
          id: 2,
          tenantId: "default",
          openId: "driver-primary",
          role: "driver",
        },
        "laundry_farm"
      )
    ).toBe(true);
    expect(
      operatorUserCanResolveOnTenant(
        {
          id: 3,
          tenantId: "tenant-a",
          openId: "ordinary-user",
          role: "admin",
        },
        "laundry_farm"
      )
    ).toBe(false);
    expect(
      operatorUserCanResolveOnTenant(
        {
          id: 1,
          tenantId: "default",
          openId: "admin-owner",
          role: "admin",
        },
        "saas-tenant-b"
      )
    ).toBe(false);
  });

  it("rejects shared-password admin before any cross-tenant operator lookup", async () => {
    await expect(
      requireEffectiveOperatorIdentityForTenant({
        callerUser: {
          id: 1,
          openId: "admin-owner",
          role: "admin",
          tenantId: "default",
        },
        callerTenantId: "default",
        targetTenantId: "tenant-b",
        subsystem: "test.cross_tenant",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("records only typed join metadata on failure, not raw identity values", async () => {
    const fixture = deps({ users: [] });
    await resolveCanonicalOperatorIdentity(
      {
        tenantId: "tenant-a",
        source: { type: "open_id", value: "private-open-id" },
        subsystem: "lantern_city",
      },
      fixture
    );
    expect(fixture.recordFailure).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      subsystem: "lantern_city",
      reason: "identity_unresolved",
      sourceIdentityType: "open_id",
      targetIdentityType: "canonical_operator",
    });
  });
});
