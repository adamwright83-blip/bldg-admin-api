import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { COOKIE_NAME, VENDOR_COOKIE_NAME } from "@shared/const";
import {
  ADMIN_ALLOWED_ORIGINS,
  isAllowedAdminOrigin,
} from "../_core/corsConfig";

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type SecurityEnvironment = {
  [key: string]: string | undefined;
  NODE_ENV?: string;
  DAYFORGE_ALLOWED_ORIGINS?: string;
  DAYFORGE_FRAME_ORIGINS?: string;
  DAYFORGE_SCRIPT_ORIGINS?: string;
  DAYFORGE_CONNECT_ORIGINS?: string;
  VITE_SCHEDULER_URL?: string;
  VITE_API_URL?: string;
  VITE_FRONTEND_FORGE_API_URL?: string;
  VITE_POSTHOG_HOST?: string;
  DAYFORGE_TRUST_PROXY_HOPS?: string;
  DAYFORGE_TRUST_PROXY_CIDRS?: string;
  APP_SHARED_API_SECRET?: string;
  ADMIN_AGENT_SHARED_SECRET?: string;
  AGENT_SHARED_SECRET?: string;
};

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizedOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password || parsed.pathname !== "/") return null;
    if (parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function configuredFrameOrigin(value: string, production: boolean): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && !production)) {
      return null;
    }
    if (parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Exact, configurable DayForge browser origins. The existing first-party list
 * remains valid so this guard can be installed globally without stranding an
 * existing admin, driver, vendor, or public-form client.
 */
export function configuredDayforgeOrigins(
  env: SecurityEnvironment = process.env
): ReadonlySet<string> {
  const configured = splitList(env.DAYFORGE_ALLOWED_ORIGINS)
    .map(normalizedOrigin)
    .filter(
      (value): value is string =>
        value !== null &&
        (env.NODE_ENV !== "production" || value.startsWith("https://"))
    );
  return new Set([...ADMIN_ALLOWED_ORIGINS, ...configured]);
}

export function isAllowedDayforgeOrigin(
  origin: string | undefined,
  env: SecurityEnvironment = process.env
): boolean {
  if (!origin) return false;
  const normalized = normalizedOrigin(origin);
  if (!normalized || normalized !== origin) return false;
  if (configuredDayforgeOrigins(env).has(normalized)) return true;
  // Keep existing bldg.chat tenant subdomains working. This is deliberately
  // delegated to the central CORS rule rather than trusting suffix-like input.
  if (
    normalized.startsWith("https://") &&
    normalized.endsWith(".bldg.chat") &&
    isAllowedAdminOrigin(normalized)
  ) {
    return true;
  }
  return env.NODE_ENV !== "production" && LOCAL_ORIGIN.test(normalized);
}

function header(req: Pick<Request, "headers">, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function secretMatches(candidate: string | undefined, expected: string | undefined) {
  if (!candidate || !expected) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function hasAuthenticatedCookie(req: Pick<Request, "headers">): boolean {
  const cookie = header(req, "cookie") ?? "";
  return cookie
    .split(";")
    .some(part => {
      const name = part.trim().split("=", 1)[0];
      return name === COOKIE_NAME || name === VENDOR_COOKIE_NAME;
    });
}

function hasInternalCredential(
  req: Pick<Request, "headers">,
  env: SecurityEnvironment
): boolean {
  return (
    secretMatches(header(req, "x-app-shared-secret"), env.APP_SHARED_API_SECRET) ||
    secretMatches(
      header(req, "x-agent-shared-secret"),
      env.ADMIN_AGENT_SHARED_SECRET ?? env.AGENT_SHARED_SECRET
    )
  );
}

export type MutationOriginDecision =
  | { allowed: true; reason: "safe_method" | "no_cookie" | "internal" | "allowed_origin" | "development_no_origin" }
  | { allowed: false; reason: "missing_origin" | "disallowed_origin" };

/**
 * Origin/CSRF decision for cookie-authenticated writes. Header-authenticated
 * internal requests and anonymous public writes remain usable; browsers with
 * an authenticated cookie must prove an allowlisted Origin.
 */
export function evaluateMutationOrigin(input: {
  req: Pick<Request, "headers" | "method">;
  isMutation?: boolean;
  env?: SecurityEnvironment;
}): MutationOriginDecision {
  const env = input.env ?? process.env;
  const mutating = input.isMutation ?? MUTATING_METHODS.has(input.req.method.toUpperCase());
  if (!mutating) return { allowed: true, reason: "safe_method" };
  if (hasInternalCredential(input.req, env)) {
    return { allowed: true, reason: "internal" };
  }
  if (!hasAuthenticatedCookie(input.req)) {
    return { allowed: true, reason: "no_cookie" };
  }
  const origin = header(input.req, "origin");
  if (!origin) {
    return env.NODE_ENV === "production"
      ? { allowed: false, reason: "missing_origin" }
      : { allowed: true, reason: "development_no_origin" };
  }
  return isAllowedDayforgeOrigin(origin, env)
    ? { allowed: true, reason: "allowed_origin" }
    : { allowed: false, reason: "disallowed_origin" };
}

export function assertTrpcMutationOrigin(input: {
  req: Pick<Request, "headers" | "method">;
  isMutation: boolean;
  env?: SecurityEnvironment;
}): MutationOriginDecision {
  return evaluateMutationOrigin(input);
}

/** Express trust-proxy input. `false` is the secure default. */
export function configuredTrustProxy(
  env: SecurityEnvironment = process.env
): false | number | string[] {
  const cidrs = splitList(env.DAYFORGE_TRUST_PROXY_CIDRS);
  if (cidrs.length > 0) return cidrs;
  const hops = Number(env.DAYFORGE_TRUST_PROXY_HOPS ?? "");
  return Number.isInteger(hops) && hops >= 1 && hops <= 3 ? hops : false;
}

/**
 * Read the client address after Express has applied its configured trust proxy
 * policy. Raw X-Forwarded-For is never parsed here.
 */
export function resolveTrustedClientIp(
  req: Pick<Request, "ip" | "socket">
): string {
  const resolved = req.ip?.trim() || req.socket.remoteAddress?.trim();
  return resolved || "unknown";
}

export function dayforgeSecurityHeaders(
  env: SecurityEnvironment = process.env
): RequestHandler {
  const configuredFrames = [
    ...splitList(env.DAYFORGE_FRAME_ORIGINS),
    ...(env.VITE_SCHEDULER_URL ? [env.VITE_SCHEDULER_URL] : []),
  ]
    .map(value => configuredFrameOrigin(value, env.NODE_ENV === "production"))
    .filter((value): value is string => Boolean(value));
  const frameSources = [
    "https://js.stripe.com",
    "https://hooks.stripe.com",
    "https://checkout.stripe.com",
    ...configuredFrames,
  ];
  const configuredScripts = [
    ...splitList(env.DAYFORGE_SCRIPT_ORIGINS),
    env.VITE_FRONTEND_FORGE_API_URL ?? "",
  ]
    .filter(Boolean)
    .map(value => configuredFrameOrigin(value, env.NODE_ENV === "production"))
    .filter((value): value is string => Boolean(value));
  const configuredConnections = [
    ...splitList(env.DAYFORGE_CONNECT_ORIGINS),
    env.VITE_API_URL ?? "",
    env.VITE_FRONTEND_FORGE_API_URL ?? "",
    env.VITE_POSTHOG_HOST ?? "",
  ]
    .filter(Boolean)
    .map(value => configuredFrameOrigin(value, env.NODE_ENV === "production"))
    .filter((value): value is string => Boolean(value));
  const scriptSources = [
    "'self'",
    "https://js.stripe.com",
    "https://forge.butterfly-effect.dev",
    "https://maps.googleapis.com",
    "https://maps.gstatic.com",
    // Maps 3D renders through a WebAssembly renderer (map3d.wasm). Production
    // deliberately omits 'unsafe-eval', which also blocks WASM compilation, so
    // without this the 3D geographic layer works locally and dies in
    // production. 'wasm-unsafe-eval' permits WASM only — it does not restore
    // eval() for scripts.
    "'wasm-unsafe-eval'",
    ...configuredScripts,
    // Vite's dev-only inline react-refresh preamble and esbuild transform
    // require 'unsafe-inline'/'unsafe-eval' locally; production serves
    // prebuilt static bundles with no inline scripts, so this never widens
    // the production policy.
    ...(env.NODE_ENV === "production" ? [] : ["'unsafe-inline'", "'unsafe-eval'"]),
  ];
  const connectSources = [
    "'self'",
    "https://api.stripe.com",
    "https://forge.butterfly-effect.dev",
    "https://maps.googleapis.com",
    // Maps 3D streams its actual Earth geometry from keyhole-pa, NOT from
    // maps.googleapis.com: PlanetoidMetadata, BulkMetadata and NodeData carry
    // the mesh and imagery, and Copyrights carries the attribution Google
    // requires us to display. With this host absent the renderer loaded, the
    // journey phases advanced, and the map painted pure black behind the
    // authored tower — every callback fired while nothing geographic existed.
    "https://keyhole-pa.googleapis.com",
    // Map style/legend resources fetched by the 3D renderer.
    "https://www.gstatic.com",
    "https://*.posthog.com",
    "https://*.i.posthog.com",
    ...configuredConnections,
    ...(env.NODE_ENV === "production" ? [] : ["wss:"]),
  ];
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src ${connectSources.join(" ")}`,
    `frame-src ${frameSources.join(" ")}`,
    "worker-src 'self' blob:",
    ...(env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Content-Security-Policy", csp);
    // OAuth and other explicitly opened first-party windows retain an opener;
    // unrelated cross-origin documents remain isolated.
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    if (env.NODE_ENV === "production") {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains"
      );
    }
    next();
  };
}
