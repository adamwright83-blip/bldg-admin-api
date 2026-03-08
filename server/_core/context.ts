import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import type { VendorSession } from "./vendorAuth";
import { sdk } from "./sdk";
import { parseVendorCookie, verifyVendorSession } from "./vendorAuth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  vendorSession: VendorSession | null;
};

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

  return {
    req: opts.req,
    res: opts.res,
    user,
    vendorSession,
  };
}
