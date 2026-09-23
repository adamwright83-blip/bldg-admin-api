import {
  isLegacyDayforgeTenant,
  resolveDayforgeMembership,
  roleAllows,
} from "../saas/tenantAccess";

/**
 * Host-only session cookies stay host-only. Admin and Driver each sign in
 * with the same membership and keep a separate cookie. Do not set
 * Domain=.bldg.chat: that would share the operator session with preview and
 * vendor hosts.
 */
export const JOYSTICK_SESSION_COOKIE_DOMAIN = undefined;

const FIELD_ROLES = ["owner", "admin", "operator", "field"] as const;

type PlatformRole = "admin" | "driver" | "user";

export type JoystickUser = {
  openId: string;
  role: PlatformRole;
  tenantId?: string | null;
};

export type TenantBind = {
  tenantId: string;
  authority: "anonymous_host" | "membership" | "legacy_platform" | "persisted_user";
  denial: "cross_tenant" | "legacy_password_not_saas" | "invalid_saas_session" | null;
};

type OpenIdEnv = {
  DRIVER_OPEN_ID?: string;
  OWNER_OPEN_ID?: string;
};

export function legacySharedPasswordOpenIds(env?: OpenIdEnv): ReadonlySet<string> {
  const source = env ?? {
    DRIVER_OPEN_ID: process.env.DRIVER_OPEN_ID,
    OWNER_OPEN_ID: process.env.OWNER_OPEN_ID,
  };
  return new Set(
    [
      source.DRIVER_OPEN_ID?.trim() || "driver-primary",
      "driver-primary",
      source.OWNER_OPEN_ID?.trim() || "admin-owner",
      "admin-owner",
    ].filter(Boolean)
  );
}

/** Shared DRIVER_PASSWORD / ADMIN_PASSWORD identities. Never a dayforge member openId. */
export function isLegacySharedPasswordOpenId(
  openId: string,
  env?: OpenIdEnv
): boolean {
  if (openId.startsWith("dayforge:")) return false;
  return legacySharedPasswordOpenIds(env).has(openId);
}

/**
 * The shared-password route accepts a password and admin|driver role only.
 * Tenant, slug, email, and operator ids in the body are not part of the decision.
 */
export function sharedPasswordLoginSelection(body: unknown): {
  role: "admin" | "driver";
} {
  const requested =
    body && typeof body === "object"
      ? (body as { role?: unknown }).role
      : undefined;
  return { role: requested === "driver" ? "driver" : "admin" };
}

/**
 * Bind the request tenant from the authenticated user. A browser-supplied
 * tenant id never wins. The shared password cannot adopt a SaaS tenant.
 */
export function tenantForAuthenticatedUser(input: {
  user: JoystickUser | null;
  hostTenantId: string;
  requestedTenantId?: string | null;
}): TenantBind {
  if (!input.user) {
    return {
      tenantId: input.hostTenantId,
      authority: "anonymous_host",
      denial: null,
    };
  }

  const requested = input.requestedTenantId?.trim() || null;

  if (
    isLegacySharedPasswordOpenId(input.user.openId) &&
    (input.user.role === "admin" || input.user.role === "driver")
  ) {
    const tenantId = input.hostTenantId;
    const persisted = input.user.tenantId?.trim() || null;
    if (
      (requested && !isLegacyDayforgeTenant(requested)) ||
      (persisted && !isLegacyDayforgeTenant(persisted))
    ) {
      return {
        tenantId,
        authority: "legacy_platform",
        denial: "legacy_password_not_saas",
      };
    }
    return { tenantId, authority: "legacy_platform", denial: null };
  }

  if (input.user.openId.startsWith("dayforge:")) {
    const persisted = input.user.tenantId?.trim() || "";
    if (!persisted) {
      return {
        tenantId: "__invalid_saas_session__",
        authority: "membership",
        denial: "invalid_saas_session",
      };
    }
    if (requested && requested !== persisted) {
      return {
        tenantId: persisted,
        authority: "membership",
        denial: "cross_tenant",
      };
    }
    return { tenantId: persisted, authority: "membership", denial: null };
  }

  const persisted = input.user.tenantId?.trim() || "";
  if (persisted) {
    if (requested && requested !== persisted) {
      return {
        tenantId: persisted,
        authority: "persisted_user",
        denial: "cross_tenant",
      };
    }
    return { tenantId: persisted, authority: "persisted_user", denial: null };
  }

  return {
    tenantId: input.hostTenantId,
    authority: "anonymous_host",
    denial: null,
  };
}

export type ClaireOperatorScope = {
  tenantId: string;
  operatorUserId: string;
};

/** Claire on Admin and Driver uses this scope. It does not read a client operator id. */
export function claireOperatorScope(input: {
  tenantId: string;
  operatorUserId: string;
}): ClaireOperatorScope {
  return {
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
  };
}

export type ClaireDeskDecision =
  | {
      ok: true;
      tenantId: string;
      operatorUserId: string;
      authority: "platform_admin" | "membership";
    }
  | {
      ok: false;
      reason:
        | "unauthenticated"
        | "missing_membership"
        | "legacy_password_not_saas";
    };

type MembershipLookup = typeof resolveDayforgeMembership;

/**
 * Driver Claire desk: a real member is allowed from their membership.
 * Platform admin keeps the existing desk. The shared driver password is not
 * SaaS Claire authority, including on a legacy tenant.
 */
export async function authorizeJoystickClaireDesk(
  input: {
    tenantId: string;
    user: { openId: string; role: PlatformRole } | null;
  },
  resolveMembership: MembershipLookup = resolveDayforgeMembership
): Promise<ClaireDeskDecision> {
  if (!input.user) return { ok: false, reason: "unauthenticated" };

  if (isLegacySharedPasswordOpenId(input.user.openId)) {
    if (
      input.user.role === "admin" &&
      isLegacyDayforgeTenant(input.tenantId)
    ) {
      return {
        ok: true,
        tenantId: input.tenantId,
        operatorUserId: input.user.openId,
        authority: "platform_admin",
      };
    }
    return { ok: false, reason: "legacy_password_not_saas" };
  }

  if (input.user.role === "admin") {
    return {
      ok: true,
      tenantId: input.tenantId,
      operatorUserId: input.user.openId,
      authority: "platform_admin",
    };
  }

  const membership = await resolveMembership({
    tenantId: input.tenantId,
    userOpenId: input.user.openId,
    platformRole: input.user.role,
  });
  if (!membership || !roleAllows(membership.role, FIELD_ROLES)) {
    return { ok: false, reason: "missing_membership" };
  }
  if (membership.tenantId !== input.tenantId) {
    return { ok: false, reason: "missing_membership" };
  }
  return {
    ok: true,
    tenantId: membership.tenantId,
    operatorUserId: membership.userOpenId,
    authority: "membership",
  };
}
