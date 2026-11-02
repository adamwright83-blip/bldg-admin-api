/**
 * Where a first-ten visitor may start a Google or Slack connection. The provider sends them back to
 * `<origin>/api/first-ten/oauth/<provider>/callback` on the same origin, so the signup draft kept in that origin's
 * browser storage is still there when they return. Each redirect URI must also be registered with the provider
 * (docs/goldline/FIRST_TEN_MINUTES_BUILD.md, "What Adam sets").
 */
export const FIRST_TEN_CONNECT_ORIGINS = [
  "https://gojoystick.com",
  "https://app.gojoystick.com",
  "https://admin.gojoystick.com",
  // admin.bldg.chat left on 2026-11-02: JOYSTICK lives on gojoystick.com, and Google's app no longer lists bldg.chat
] as const;

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function firstTenConnectOrigin(
  origin: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const candidate = (origin ?? "").trim().replace(/\/$/, "");
  if (!candidate) return null;
  if ((FIRST_TEN_CONNECT_ORIGINS as readonly string[]).includes(candidate)) return candidate;
  const configured = (env.JOYSTICK_FIRST_TEN_ORIGINS ?? "")
    .split(",")
    .map(value => value.trim().replace(/\/$/, ""))
    .filter(value => value.startsWith("https://"));
  if (configured.includes(candidate)) return candidate;
  if (env.NODE_ENV !== "production" && LOCAL_ORIGIN.test(candidate)) return candidate;
  return null;
}

export function firstTenCallbackPath(provider: "google" | "slack"): string {
  return `/api/first-ten/oauth/${provider}/callback`;
}

export function firstTenRedirectUri(origin: string, provider: "google" | "slack"): string {
  return `${origin}${firstTenCallbackPath(provider)}`;
}
