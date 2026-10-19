import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import type { VendorSession } from "./vendorAuth";
import { parse } from "cookie";
import { resolveTenantIdFromHeaders } from "@shared/tenantConfig";
import { tenantForAuthenticatedUser } from "../platform/tenancy/tenantIdentity";
import { listActiveTenantMemberships } from "../saas/tenantAccess";
import { sdk } from "./sdk";
import { parseVendorCookie, verifyVendorSession } from "./vendorAuth";
import { authenticateGoldlineDemoRequest } from "../goldlineOnboarding/demoAccess";

export const JOYSTICK_ACTIVE_TENANT_COOKIE = "joystick_active_tenant";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  vendorSession: VendorSession | null;
  tenantId: string;
};

const warnedHosts = new Set<string>();

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let vendorSession: VendorSession | null = null;

  try {
    user =
      (await authenticateGoldlineDemoRequest(opts.req)) ??
      (await sdk.authenticateRequest(opts.req));
  } catch {
    user = null;
  }

  const vendorCookie = parseVendorCookie(opts.req);
  if (vendorCookie) {
    vendorSession = await verifyVendorSession(vendorCookie);
  }

  const tenantResolution = resolveTenantIdFromHeaders(
    opts.req.headers as Record<string, string | string[] | undefined>
  );
  if (!tenantResolution.matched) {
    const unknownHost = tenantResolution.host || "(missing-host)";
    if (!warnedHosts.has(unknownHost)) {
      warnedHosts.add(unknownHost);
      console.warn(
        `[TenantResolver] Unknown host "${unknownHost}", falling back to default.`
      );
    }
  }

  const rawRequestedHeader = opts.req.headers["x-tenant-id"];
  const requestedHeader =
    typeof rawRequestedHeader === "string"
      ? rawRequestedHeader.trim()
      : Array.isArray(rawRequestedHeader)
        ? rawRequestedHeader[0]?.trim()
        : undefined;

  let requestedCookie: string | undefined;
  if (opts.req.headers.cookie) {
    try {
      const parsedCookies = parse(opts.req.headers.cookie);
      requestedCookie = parsedCookies[JOYSTICK_ACTIVE_TENANT_COOKIE]?.trim();
    } catch {
      // ignore malformed cookie
    }
  }

  const candidateTenantId = requestedHeader || requestedCookie || undefined;

  let authorizedTenantIds: string[] | undefined;
  if (user?.openId) {
    try {
      const memberships = await listActiveTenantMemberships(user.openId);
      authorizedTenantIds = memberships.map(m => m.tenantId);
    } catch {
      authorizedTenantIds = undefined;
    }
  }

  const authenticatedTenantId = user?.tenantId?.trim();
  const boundTenant = tenantForAuthenticatedUser({
    user: user
      ? {
          openId: user.openId,
          role: user.role,
          tenantId: authenticatedTenantId,
        }
      : null,
    hostTenantId: tenantResolution.tenantId,
    requestedTenantId: candidateTenantId,
    authorizedTenantIds,
  });

  const tenantId =
    user?.openId.startsWith("dayforge:") && !authenticatedTenantId
      ? "__invalid_saas_session__"
      : boundTenant.tenantId;

  return {
    req: opts.req,
    res: opts.res,
    user,
    vendorSession,
    // A membership session uses its persisted tenant, never the Host header.
    // A shared-password session stays on the host-mapped legacy tenant.
    tenantId,
  };
}
