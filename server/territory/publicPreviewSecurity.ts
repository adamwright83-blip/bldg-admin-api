import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { Request } from "express";

const TOKEN_PREFIX = "dfpv_";

function requireSecret(value: string | undefined, label: string): string {
  const secret = value?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(`${label} must contain at least 32 characters`);
  }
  return secret;
}
export function publicPreviewTokenSecret(): string {
  return requireSecret(
    process.env.DAYFORGE_PUBLIC_PREVIEW_TOKEN_SECRET ??
      process.env.APP_SHARED_API_SECRET,
    "DAYFORGE_PUBLIC_PREVIEW_TOKEN_SECRET"
  );
}

export function publicPreviewFingerprintSecret(): string {
  return requireSecret(
    process.env.DAYFORGE_PUBLIC_PREVIEW_FINGERPRINT_SECRET ??
      process.env.DAYFORGE_PUBLIC_PREVIEW_TOKEN_SECRET ??
      process.env.APP_SHARED_API_SECRET,
    "DAYFORGE_PUBLIC_PREVIEW_FINGERPRINT_SECRET"
  );
}

function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function createPublicPreviewToken(secret = publicPreviewTokenSecret()): {
  token: string;
  tokenHash: string;
} {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: hmac(token, secret) };
}

export function hashPublicPreviewToken(
  token: string,
  secret = publicPreviewTokenSecret()
): string {
  return hmac(token.trim(), secret);
}

export function hashPublicPreviewFingerprint(
  value: string,
  secret = publicPreviewFingerprintSecret()
): string {
  return hmac(value.trim().toLowerCase(), secret);
}

export function hashesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

/**
 * Express only derives req.ip from forwarding headers after `trust proxy` has
 * been explicitly configured. Reading x-forwarded-for ourselves would let an
 * attacker rotate the rate-limit identity by sending a forged header.
 */
export function resolvePublicPreviewClientIp(
  req: Pick<Request, "app" | "ip" | "socket">
): string {
  const trustProxy = req.app?.get("trust proxy");
  if (trustProxy) return req.ip || req.socket.remoteAddress || "unknown";
  return req.socket.remoteAddress || "unknown";
}

export function readPublicPreviewBearerToken(input: {
  explicitToken?: string | null;
  authorization?: string | string[];
}): string | null {
  const explicit = input.explicitToken?.trim();
  if (explicit) return explicit;
  const header = Array.isArray(input.authorization)
    ? input.authorization[0]
    : input.authorization;
  const match = header?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}
