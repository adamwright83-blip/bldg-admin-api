import { VENDOR_COOKIE_NAME } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { jwtVerify } from "jose";
import { ENV } from "./env";

export type VendorSession = { vendorId: number };

export function parseVendorCookie(req: Request): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const parsed = parseCookieHeader(cookieHeader);
  return parsed[VENDOR_COOKIE_NAME] ?? null;
}

export async function verifyVendorSession(
  cookieValue: string | null | undefined
): Promise<VendorSession | null> {
  if (!cookieValue || cookieValue.length < 10) return null;

  try {
    const secret = new TextEncoder().encode(ENV.cookieSecret || process.env.JWT_SECRET);
    if (!secret.length) return null;
    const { payload } = await jwtVerify(cookieValue, secret, { algorithms: ["HS256"] });
    const vendorId = payload.vendorId;
    if (typeof vendorId !== "number" || vendorId < 1) return null;
    return { vendorId };
  } catch {
    return null;
  }
}
