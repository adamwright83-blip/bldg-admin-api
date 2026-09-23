import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { getSessionCookieOptions } from "../_core/cookies";
import { resolveDayforgeMembership } from "../saas/tenantAccess";
import {
  authorizeJoystickClaireDesk,
  claireOperatorScope,
  isLegacySharedPasswordOpenId,
  sharedPasswordLoginSelection,
  tenantForAuthenticatedUser,
} from "./tenantIdentity";

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
      new URL("../../client/src/pages/DayforgeLoginPage.tsx", import.meta.url),
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
