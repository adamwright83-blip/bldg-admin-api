import { GOOGLE_PRODUCT_SCOPES, GOOGLE_SCOPES, GOOGLE_SEND_SCOPE } from "../../shared/firstTenMinutes";
import { providerJson, ProviderError, providerUrl, type FetchLike } from "./providerFetch";

/**
 * Google OAuth for the first ten minutes: read-only Gmail, Calendar and Drive, plus who the account is. Sending
 * (gmail.send) is asked for only when the person first sends from JOYSTICK, on top of what they already granted.
 * Client: JOYSTICK_GOOGLE_CLIENT_ID / JOYSTICK_GOOGLE_CLIENT_SECRET (a "Web application" OAuth client whose
 * authorised redirect URIs list each origin's /api/first-ten/oauth/google/callback).
 */
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

type Deps = { fetch?: FetchLike; env?: NodeJS.ProcessEnv };

function client(env: NodeJS.ProcessEnv) {
  return {
    id: env.JOYSTICK_GOOGLE_CLIENT_ID?.trim() || "",
    secret: env.JOYSTICK_GOOGLE_CLIENT_SECRET?.trim() || "",
  };
}

export function isGoogleConnectConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const c = client(env);
  return Boolean(c.id && c.secret);
}

export function googleAuthorizationUrl(input: { state: string; redirectUri: string; send?: boolean }, env: NodeJS.ProcessEnv = process.env): string {
  const c = client(env);
  if (!c.id) throw new Error("Google connection is not configured");
  const params = new URLSearchParams({
    client_id: c.id,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: [...GOOGLE_SCOPES, ...(input.send ? [GOOGLE_SEND_SCOPE] : [])].join(" "),
    // a refresh token, so the crew can keep reading while the visitor plays, and after activation
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: input.state,
  });
  return providerUrl(`${AUTH_URL}?${params.toString()}`, env);
}

export type GoogleTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  grantedScopes: string[];
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

function tokensFrom(body: TokenResponse, now: Date): GoogleTokens {
  if (!body.access_token) throw new ProviderError("google", 502, "Google returned no access token");
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: new Date(now.getTime() + Math.max(60, body.expires_in ?? 3600) * 1000),
    grantedScopes: (body.scope ?? "").split(/\s+/).filter(Boolean),
  };
}

export async function exchangeGoogleCode(
  input: { code: string; redirectUri: string; now?: Date },
  deps: Deps = {}
): Promise<GoogleTokens> {
  const c = client(deps.env ?? process.env);
  const body = await providerJson<TokenResponse>(
    "google",
    TOKEN_URL,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: input.code,
        client_id: c.id,
        client_secret: c.secret,
        redirect_uri: input.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    },
    deps
  );
  return tokensFrom(body, input.now ?? new Date());
}

export async function refreshGoogleAccess(
  input: { refreshToken: string; now?: Date },
  deps: Deps = {}
): Promise<GoogleTokens> {
  const c = client(deps.env ?? process.env);
  const body = await providerJson<TokenResponse>(
    "google",
    TOKEN_URL,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: input.refreshToken,
        client_id: c.id,
        client_secret: c.secret,
        grant_type: "refresh_token",
      }).toString(),
    },
    deps
  );
  const tokens = tokensFrom(body, input.now ?? new Date());
  return { ...tokens, refreshToken: tokens.refreshToken ?? input.refreshToken };
}

export type GoogleAccount = { subject: string; email: string; name: string | null; givenName: string | null };

export async function googleAccount(accessToken: string, deps: Deps = {}): Promise<GoogleAccount> {
  const body = await providerJson<{ sub?: string; email?: string; name?: string; given_name?: string }>(
    "google",
    USERINFO_URL,
    { headers: { authorization: `Bearer ${accessToken}` } },
    deps
  );
  if (!body.sub || !body.email) throw new ProviderError("google", 502, "Google returned no account");
  return { subject: body.sub, email: body.email, name: body.name ?? null, givenName: body.given_name ?? null };
}

/** Best effort: a failed revoke still deletes JOYSTICK's copy of the token. */
export async function revokeGoogleToken(token: string, deps: Deps = {}): Promise<boolean> {
  try {
    await providerJson<unknown>(
      "google",
      REVOKE_URL,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      },
      deps
    );
    return true;
  } catch {
    return false;
  }
}

/** The crew needs Gmail at minimum. Calendar and Drive are welcome; a person may untick either. */
export function googleGrantIsUsable(grantedScopes: readonly string[]): boolean {
  return grantedScopes.includes(GOOGLE_PRODUCT_SCOPES.gmail);
}
