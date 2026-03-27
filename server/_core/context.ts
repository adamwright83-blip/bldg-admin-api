import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import type { VendorSession } from "./vendorAuth";
import type { TenantId } from "@shared/tenantConfig";
import { resolveTenantIdFromHeaders } from "@shared/tenantConfig";
import { sdk } from "./sdk";
import { parseVendorCookie, verifyVendorSession } from "./vendorAuth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  vendorSession: VendorSession | null;
  tenantId: TenantId;
};

const warnedHosts = new Set<string>();

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let vendorSession: VendorSession | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
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
      console.warn(`[TenantResolver] Unknown host "${unknownHost}", falling back to default.`);
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    vendorSession,
    tenantId: tenantResolution.tenantId,
  };
}
