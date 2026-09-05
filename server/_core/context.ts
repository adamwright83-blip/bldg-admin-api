import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import type { VendorSession } from "./vendorAuth";
import { resolveTenantIdFromHeaders } from "@shared/tenantConfig";
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
  const tenantId = authenticatedTenantId
    ? authenticatedTenantId
    : user?.openId.startsWith("dayforge:")
      ? "__invalid_saas_session__"
      : tenantResolution.tenantId;

  return {
    req: opts.req,
    res: opts.res,
    user,
    vendorSession,
    // An authenticated user's persisted tenant always wins over untrusted Host
    // headers. Membership-aware tRPC procedures perform the second check.
    tenantId,
  };
}
