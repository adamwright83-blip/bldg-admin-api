/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import type { VendorSession } from "./vendorAuth";
import { resolveTenantIdFromHeaders } from "@shared/tenantConfig";
import { tenantForAuthenticatedUser } from "../joystick/tenantIdentity";
import { sdk } from "./sdk";
import { parseVendorCookie, verifyVendorSession } from "./vendorAuth";
import { authenticateGoldlineDemoRequest } from "../goldlineOnboarding/demoAccess";

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
