/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { getSessionCookieOptions } from "../_core/cookies";
import { createContext } from "../_core/context";
import { sdk } from "../_core/sdk";
import { claireRouter } from "../claire/claireRouter";
import { claireRelationshipOffboardingRouter } from "../claire/relationshipOffboardingRouter";
import { resolveDayforgeMembership } from "../saas/tenantAccess";
import {
  authorizeJoystickClaireDesk,
  claireOperatorScope,
  isLegacySharedPasswordOpenId,
  sharedPasswordLoginSelection,
  tenantForAuthenticatedUser,
} from "./tenantIdentity";

vi.mock("../_core/sdk", () => ({
  sdk: {
    authenticateRequest: vi.fn(),
    authenticateSessionToken: vi.fn(),
  },
}));

const member = {
  openId: "dayforge:member-a",
  role: "user" as const,
  tenantId: "tenant-a",
};

describe("JOYSTICK tenant identity", () => {
  it("keeps the same member tenant on Admin and Driver hosts", () => {
    const admin = tenantForAuthenticatedUser({
      user: member,
      hostTenantId: "default",
    });
    const driver = tenantForAuthenticatedUser({
      user: member,
      hostTenantId: "laundry_farm",
    });
    expect(admin).toEqual({
      tenantId: "tenant-a",
      authority: "membership",
      denial: null,
    });
    expect(driver.tenantId).toBe(admin.tenantId);
    expect(driver.authority).toBe("membership");
  });

  it("gives Claire the same tenant and operator on both surfaces", () => {
    const bound = tenantForAuthenticatedUser({
      user: member,
      hostTenantId: "default",
    });
    const admin = claireOperatorScope({
      tenantId: bound.tenantId,
      operatorUserId: member.openId,
    });
    const driver = claireOperatorScope({
      tenantId: bound.tenantId,
      operatorUserId: member.openId,
    });
    expect(driver).toEqual(admin);
    expect(driver).toEqual({
      tenantId: "tenant-a",
      operatorUserId: "dayforge:member-a",
    });
  });

  it("authorizes the same member for Claire on their own tenant", async () => {
    const decision = await authorizeJoystickClaireDesk(
      {
        tenantId: "tenant-a",
        user: { openId: member.openId, role: "user" },
      },
      vi.fn().mockResolvedValue({
        tenantId: "tenant-a",
        userOpenId: member.openId,
        role: "field",
      })
    );
    expect(decision).toEqual({
      ok: true,
      tenantId: "tenant-a",
      operatorUserId: member.openId,
      authority: "membership",
    });
    if (decision.ok) {
      expect(
        claireOperatorScope({
          tenantId: decision.tenantId,
          operatorUserId: decision.operatorUserId,
        })
      ).toEqual({ tenantId: "tenant-a", operatorUserId: member.openId });
    }
  });

  it("denies a missing membership for a non-legacy tenant", async () => {
    expect(
      await resolveDayforgeMembership({
        tenantId: "tenant-missing",
        userOpenId: "dayforge:nobody",
        platformRole: "user",
      })
    ).toBeNull();
    const decision = await authorizeJoystickClaireDesk(
      {
        tenantId: "tenant-missing",
        user: { openId: "dayforge:nobody", role: "user" },
      },
      vi.fn().mockResolvedValue(null)
    );
    expect(decision).toEqual({ ok: false, reason: "missing_membership" });
  });

  it("denies a member who asks for a different tenant", () => {
    const bound = tenantForAuthenticatedUser({
      user: member,
      hostTenantId: "default",
      requestedTenantId: "tenant-b",
    });
    expect(bound.tenantId).toBe("tenant-a");
    expect(bound.denial).toBe("cross_tenant");
  });

  it("refuses a non-admin when the membership lookup fails", async () => {
    const decision = await authorizeJoystickClaireDesk(
      {
        tenantId: "tenant-1",
        user: { openId: "operator-105", role: "user" },
      },
      async () => {
        throw new Error("Failed query: select `tenantId` from memberships");
      }
    );
    expect(decision).toEqual({ ok: false, reason: "missing_membership" });
  });

  it("does not let the shared driver password select a SaaS tenant", async () => {
    const lookup = vi.fn();
    const bound = tenantForAuthenticatedUser({
      user: {
        openId: "driver-primary",
        role: "driver",
        tenantId: "tenant-victim",
      },
      hostTenantId: "default",
      requestedTenantId: "tenant-victim",
    });
    expect(bound.tenantId).toBe("default");
    expect(bound.authority).toBe("legacy_platform");
    expect(bound.denial).toBe("legacy_password_not_saas");
    expect(
      await authorizeJoystickClaireDesk(
        {
          tenantId: "tenant-victim",
          user: { openId: "driver-primary", role: "driver" },
        },
        lookup
      )
    ).toEqual({ ok: false, reason: "legacy_password_not_saas" });
    expect(lookup).not.toHaveBeenCalled();
    expect(
      await resolveDayforgeMembership({
        tenantId: "tenant-victim",
        userOpenId: "driver-primary",
        platformRole: "driver",
      })
    ).toBeNull();
  });

  it("reads only the shared-password role and ignores tenant selectors", () => {
    expect(
      sharedPasswordLoginSelection({
        password: "secret",
        role: "driver",
        tenantId: "tenant-victim",
        slug: "victim",
        email: "ada@victim.example",
        operatorUserId: "dayforge:ada",
      })
    ).toEqual({ role: "driver" });
    expect(isLegacySharedPasswordOpenId("dayforge:ada")).toBe(false);
    expect(isLegacySharedPasswordOpenId("driver-primary")).toBe(true);
  });

  it("keeps the session cookie host-only", () => {
    const driver = getSessionCookieOptions({
      hostname: "driver.bldg.chat",
      protocol: "https",
      headers: {},
    } as Request);
    const admin = getSessionCookieOptions({
      hostname: "admin.bldg.chat",
      protocol: "https",
      headers: {},
    } as Request);
    expect(driver.domain).toBeUndefined();
    expect(admin.domain).toBeUndefined();
    expect(driver).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "none",
      secure: true,
    });
  });

  it("wires Driver to membership login and isolates the legacy password route", () => {
    const driver = readFileSync(
      new URL("../../client/src/pages/Driver.tsx", import.meta.url),
      "utf8"
    );
    const login = readFileSync(
      new URL("../../client/src/components/LoginForm.tsx", import.meta.url),
      "utf8"
    );
    const app = readFileSync(
      new URL("../../client/src/App.tsx", import.meta.url),
      "utf8"
    );
    const dayforge = readFileSync(
      new URL("../../client/src/pages/LegacyDayforgeLoginPage.tsx", import.meta.url),
      "utf8"
    );
    const claire = readFileSync(
      new URL("../claire/claireRouter.ts", import.meta.url),
      "utf8"
    );
    expect(driver).toContain('mode="membership"');
    expect(driver).not.toContain('mode="legacy-shared-password"');
    expect(login).toContain("/api/dayforge/auth/login");
    expect(dayforge).toContain("/api/dayforge/auth/login");
    expect(app).toContain('path === "/legacy-driver-login"');
    expect(app).toContain('mode="legacy-shared-password"');
    expect(claire).toContain("claireOperatorScope");
    expect(claire).toContain("joystickClaireDeskProcedure");
    expect(claire).not.toContain("previewPreDrive: adminProcedure");
  });
});

const legacyDriver = {
  id: 2,
  openId: "driver-primary",
  role: "driver" as const,
  name: "Driver",
  email: null,
  loginMethod: "password",
  tenantId: "tenant-victim",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function requestContext(input: {
  user: typeof legacyDriver | null;
  tenantId: string;
  host: string;
}) {
  return {
    req: { headers: { host: input.host }, protocol: "https" },
    res: {},
    user: input.user,
    vendorSession: null,
    tenantId: input.tenantId,
  } as never;
}

describe("Claire desk routes reject the shared driver password", () => {
  it("does not let the shared driver confirm tomorrow on a legacy tenant", async () => {
    const caller = claireRouter.createCaller(
      requestContext({
        user: legacyDriver,
        tenantId: "laundry_farm",
        host: "driver.bldg.chat",
      })
    );
    await expect(
      caller.confirmTomorrow({ timeZone: "America/Los_Angeles" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not let the shared driver open a capability gap", async () => {
    const caller = claireRouter.createCaller(
      requestContext({
        user: legacyDriver,
        tenantId: "default",
        host: "driver.bldg.chat",
      })
    );
    await expect(
      caller.capabilityGap({
        id: "00000000-0000-4000-8000-000000000001",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not let the shared driver preview a relationship closing", async () => {
    const caller = claireRelationshipOffboardingRouter.createCaller(
      requestContext({
        user: legacyDriver,
        tenantId: "laundry_farm",
        host: "laundryfarm.bldg.chat",
      })
    );
    await expect(caller.preview()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("request tenant bind", () => {
  it("keeps a membership session on the persisted tenant when the host differs", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({
      ...legacyDriver,
      id: 9,
      openId: "dayforge:member-a",
      role: "user",
      tenantId: "tenant-a",
    } as never);
    const ctx = await createContext({
      req: {
        headers: { host: "driver.bldg.chat", "x-forwarded-host": "laundryfarm.bldg.chat" },
        protocol: "https",
      } as never,
      res: {} as never,
    });
    expect(ctx.tenantId).toBe("tenant-a");
  });

  it("keeps a shared driver session on the host legacy tenant", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue(legacyDriver as never);
    const ctx = await createContext({
      req: {
        headers: {
          host: "driver.bldg.chat",
          "x-tenant-id": "tenant-victim",
        },
        protocol: "https",
      } as never,
      res: {} as never,
    });
    expect(ctx.tenantId).toBe("default");
    expect(ctx.tenantId).not.toBe("tenant-victim");
  });

  it("leaves a dayforge session with no persisted tenant invalid", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({
      ...legacyDriver,
      openId: "dayforge:nobody",
      role: "user",
      tenantId: "   ",
    } as never);
    const ctx = await createContext({
      req: {
        headers: { host: "driver.bldg.chat" },
        protocol: "https",
      } as never,
      res: {} as never,
    });
    expect(ctx.tenantId).toBe("__invalid_saas_session__");
  });
});
