/* LEGACY DAYFORGE COMPATIBILITY: retained historical route literals only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
/**
 * Additive host contract for JOYSTICK front doors.
 * Legacy bldg.chat hosts stay. There is no wildcard gojoystick origin.
 */

export const JOYSTICK_APEX_HOST = "gojoystick.com";
export const JOYSTICK_WWW_HOST = "www.gojoystick.com";
export const JOYSTICK_APP_HOST = "app.gojoystick.com";
export const JOYSTICK_ADMIN_HOST = "admin.gojoystick.com";
export const JOYSTICK_DRIVER_HOST = "driver.gojoystick.com";
export const JOYSTICK_API_HOST = "api.gojoystick.com";

export const LEGACY_ADMIN_HOST = "admin.bldg.chat";
export const LEGACY_DRIVER_HOST = "driver.bldg.chat";
/** Historical SPA alias. Live DNS for this host is the resident service. */
export const LEGACY_API_SPA_HOST = "api.bldg.chat";
export const LAUNDRY_BUTLER_HOST = "laundrybutler.bldg.chat";
export const LAUNDRY_FARM_HOST = "laundryfarm.bldg.chat";

/** Exact browser origins. Do not widen to *.gojoystick.com. */
export const JOYSTICK_EXACT_BROWSER_ORIGINS = [
  "https://gojoystick.com",
  "https://www.gojoystick.com",
  "https://app.gojoystick.com",
  "https://admin.gojoystick.com",
  "https://driver.gojoystick.com",
  "https://api.gojoystick.com",
] as const;

/**
 * Frontend hosts that must call /api on themselves so the Vercel rewrite
 * reaches the main Railway API and the session cookie stays host-only.
 * api.gojoystick.com is the API host, not a frontend. Resident and laundry
 * hosts are intentionally absent.
 */
export const JOYSTICK_SAME_ORIGIN_API_HOSTS = [
  "admin.bldg.chat",
  "gojoystick.com",
  "app.gojoystick.com",
  "admin.gojoystick.com",
  "driver.gojoystick.com",
] as const;

export const JOYSTICK_MAIN_API_SERVICE_NAME = "bldg-admin-api";
export const JOYSTICK_MAIN_API_RAILWAY_HOST =
  "bldg-admin-api-production.up.railway.app";
export const RESIDENT_API_HOST = "api.bldg.chat";
export const RESIDENT_API_RAILWAY_SERVICE_NAME = "bldg-resident";

export const MAIN_API_REWRITE = {
  source: "/api/:path*",
  destination: `https://${JOYSTICK_MAIN_API_RAILWAY_HOST}/api/:path*`,
} as const;

export const RESIDENT_API_REWRITE = {
  source: "/resident-api/:path*",
  destination: `https://${RESIDENT_API_HOST}/api/:path*`,
} as const;

export type JoystickHostView =
  | "www-redirect"
  | "marketing-root"
  | "admin-shell"
  | "driver-shell"
  | "customer-root"
  | "customer-product"
  | "customer-play"
  | "customer-onboarding"
  | "customer-acquisition"
  | "customer-claire"
  | "customer-lantern"
  | "customer-chapter"
  | "customer-operator"
  | "customer-settings"
  | "customer-invite"
  | "customer-legacy-onboarding"
  | "customer-forbidden"
  | "laundry-butler"
  | "laundry-farm"
  | "api-host-refused"
  | "continue";

const CUSTOMER_VIEWS: ReadonlySet<JoystickHostView> = new Set([
  "customer-root",
  "customer-product",
  "customer-play",
  "customer-onboarding",
  "customer-acquisition",
  "customer-claire",
  "customer-lantern",
  "customer-chapter",
  "customer-operator",
  "customer-settings",
  "customer-invite",
  "customer-legacy-onboarding",
  "customer-forbidden",
]);

export function isCustomerHostView(view: JoystickHostView): boolean {
  return CUSTOMER_VIEWS.has(view);
}

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

export function normalizePath(pathname: string): string {
  const trimmed = pathname.split("?")[0]?.split("#")[0] ?? "/";
  const stripped = trimmed.replace(/\/+$/, "");
  return stripped || "/";
}

/** Matches the live www → apex 308, including path and query. */
export function wwwGojoystickRedirectTarget(
  pathname: string,
  search = "",
  hash = ""
): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `https://${JOYSTICK_APEX_HOST}${path}${search}${hash}`;
}

export function isPlatformAdminPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  if (path === "/home" || path.startsWith("/home/")) return true;
  if (path === "/admin" || path.startsWith("/admin/")) return true;
  if (path === "/pnl" || path === "/war-room" || path === "/president") return true;
  if (path === "/driver/cockpit" || path === "/franchise") return true;
  if (path === "/legacy-driver-login") return true;
  if (path.startsWith("/claire/")) return true;
  if (path === "/growth" || (path.startsWith("/growth/") && path !== "/growth/lantern-city")) {
    return true;
  }
  if (
    path === "/money" ||
    path === "/settings" ||
    path === "/customers" ||
    path === "/new-order" ||
    path === "/operations" ||
    path.startsWith("/operations/")
  ) {
    return true;
  }
  return false;
}

function customerView(pathname: string): JoystickHostView {
  const path = normalizePath(pathname);
  if (isPlatformAdminPath(path)) return "customer-forbidden";
  if (path === "/") return "customer-root";
  if (path === "/dayforge-login") return "customer-root";
  if (path === "/product" || path.startsWith("/product/") || path.startsWith("/receipt/")) {
    return "customer-product";
  }
  if (path === "/play") return "customer-play";
  if (path === "/onboarding" || path === "/goldline/start") return "customer-onboarding";
  if (path === "/joystick-start") return "customer-acquisition";
  if (path === "/claire") return "customer-claire";
  if (path === "/growth/lantern-city") return "customer-lantern";
  if (path === "/goldline-chapter") return "customer-chapter";
  if (path === "/operator") return "customer-operator";
  if (path === "/dayforge-settings" || path === "/billing") return "customer-settings";
  if (path === "/dayforge-invite") return "customer-invite";
  if (path === "/dayforge-onboarding") return "customer-legacy-onboarding";
  return "customer-forbidden";
}

export function resolveJoystickHostView(
  hostname: string,
  pathname: string
): JoystickHostView {
  const host = normalizeHostname(hostname);
  const path = normalizePath(pathname);

  if (host === JOYSTICK_WWW_HOST) return "www-redirect";
  if (host === JOYSTICK_API_HOST) return "api-host-refused";
  if (host === LAUNDRY_BUTLER_HOST) return "laundry-butler";
  if (host === LAUNDRY_FARM_HOST) return "laundry-farm";
  if (host === JOYSTICK_APEX_HOST && path === "/") return "marketing-root";
  if (host === JOYSTICK_APP_HOST) return customerView(path);
  if (
    host === JOYSTICK_ADMIN_HOST ||
    host === LEGACY_ADMIN_HOST ||
    host === LEGACY_API_SPA_HOST
  ) {
    return "admin-shell";
  }
  if (host === JOYSTICK_DRIVER_HOST || host === LEGACY_DRIVER_HOST) return "driver-shell";
  return "continue";
}

export function isExactJoystickBrowserOrigin(origin: string): boolean {
  return (JOYSTICK_EXACT_BROWSER_ORIGINS as readonly string[]).includes(origin);
}
