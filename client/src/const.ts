export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/** Base URL for resident-facing web (welcome handoff, SMS-safe links). Override with VITE_RESIDENT_WEB_ORIGIN. */
export const getResidentWebOrigin = (): string => {
  const raw = import.meta.env.VITE_RESIDENT_WEB_ORIGIN ?? "https://laundrybutler.bldg.chat";
  return String(raw).replace(/\/+$/, "");
};

const getAppHomeUrl = () => {
  if (typeof window === "undefined") return "/";
  return `${window.location.origin}/`;
};

const isAbsoluteHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

// Generate login URL at runtime so redirect URI reflects the current origin.
// This must never throw; admin/driver should fail safe if auth env is missing.
export const getLoginUrl = () => {
  if (typeof window === "undefined") return "/";

  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const fallback = getAppHomeUrl();

  if (!oauthPortalUrl || !appId || !isAbsoluteHttpUrl(redirectUri)) {
    console.warn("[Auth] Login URL fallback", {
      oauthPortalUrl,
      appId,
      redirectUri,
      reason: "missing_or_invalid_inputs",
    });
    return fallback;
  }

  try {
    const url = new URL("/app-auth", oauthPortalUrl);
    url.searchParams.set("appId", appId);
    url.searchParams.set("redirectUri", redirectUri);
    url.searchParams.set("state", btoa(redirectUri));
    url.searchParams.set("type", "signIn");
    return url.toString();
  } catch (error) {
    console.warn("[Auth] Login URL fallback", {
      oauthPortalUrl,
      appId,
      redirectUri,
      reason: "url_construction_failed",
      error: String(error),
    });
    return fallback;
  }
};

export const canRedirectToLoginUrl = (targetUrl: string) => {
  if (typeof window === "undefined") return false;
  if (!targetUrl) return false;
  try {
    const target = new URL(targetUrl, window.location.origin);
    const current = new URL(window.location.href);
    // Prevent reload loops (same page / same root fallback).
    if (target.href === current.href) return false;
    if (
      target.origin === current.origin &&
      (target.pathname === "/" || target.pathname === current.pathname)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
};
