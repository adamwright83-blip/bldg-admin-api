import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { GOOGLE_SCOPES, SLACK_USER_SCOPES } from "../../shared/firstTenMinutes";
import { firstTenMode, assertFirstTenOpen } from "./flag";
import { decryptConnectionToken, encryptConnectionToken } from "./tokens";
import { hashNonce, newConnectNonce, signConnectState, verifyConnectState, FIRST_TEN_NONCE_COOKIE } from "./oauthState";
import { firstTenConnectOrigin, firstTenRedirectUri } from "./origins";
import { providerUrl } from "./providerFetch";
import { exchangeGoogleCode, googleAuthorizationUrl, googleGrantIsUsable, refreshGoogleAccess } from "./google";
import { exchangeSlackCode, slackAuthorizationUrl, slackGrantIsUsable } from "./slack";
import { handleFirstTenCallback } from "./oauthRoutes";

const env = {
  NODE_ENV: "test",
  JWT_SECRET: "test-jwt-secret-for-first-ten-0000000000",
  JOYSTICK_FIRST_TEN_MINUTES: "on",
  JOYSTICK_GOOGLE_CLIENT_ID: "google-client",
  JOYSTICK_GOOGLE_CLIENT_SECRET: "google-secret",
  JOYSTICK_SLACK_CLIENT_ID: "slack-client",
  JOYSTICK_SLACK_CLIENT_SECRET: "slack-secret",
} as NodeJS.ProcessEnv;

const GMAIL = "https://www.googleapis.com/auth/gmail.readonly";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the flag", () => {
  it("is off unless set to on or preview", () => {
    expect(firstTenMode({} as NodeJS.ProcessEnv)).toBe("off");
    expect(firstTenMode({ JOYSTICK_FIRST_TEN_MINUTES: "true" } as NodeJS.ProcessEnv)).toBe("off");
    expect(firstTenMode({ JOYSTICK_FIRST_TEN_MINUTES: " ON " } as NodeJS.ProcessEnv)).toBe("on");
    expect(firstTenMode({ JOYSTICK_FIRST_TEN_MINUTES: "preview" } as NodeJS.ProcessEnv)).toBe("preview");
    expect(() => assertFirstTenOpen({} as NodeJS.ProcessEnv)).toThrow(/isn't open/);
    expect(() => assertFirstTenOpen({ JOYSTICK_FIRST_TEN_MINUTES: "preview" } as NodeJS.ProcessEnv)).not.toThrow();
  });
});

describe("stored tokens", () => {
  it("round-trip, never store the plain value, and refuse tampering or another key", () => {
    const stored = encryptConnectionToken("ya29.secret-access", env);
    expect(stored).not.toContain("ya29");
    expect(stored.startsWith("v1.")).toBe(true);
    expect(decryptConnectionToken(stored, env)).toBe("ya29.secret-access");
    const parts = stored.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptConnectionToken(parts.join("."), env)).toThrow();
    expect(() => decryptConnectionToken(stored, { ...env, JWT_SECRET: "another-secret-entirely-000000" })).toThrow();
    expect(() => encryptConnectionToken("x", {} as NodeJS.ProcessEnv)).toThrow(/required/);
  });

  it("prefer the dedicated key when it is set", () => {
    const dedicated = { ...env, JOYSTICK_CONNECTION_TOKEN_KEY: "dedicated-connection-key-000000000" };
    const stored = encryptConnectionToken("token", dedicated);
    expect(decryptConnectionToken(stored, dedicated)).toBe("token");
    expect(() => decryptConnectionToken(stored, env)).toThrow();
  });
});

describe("connection state", () => {
  it("binds the journey, provider, origin and browser", async () => {
    const { nonce, nonceHash } = newConnectNonce();
    const token = await signConnectState({ journeyId: "j-1", provider: "google", origin: "https://gojoystick.com", nonceHash }, env);
    await expect(verifyConnectState(token, { provider: "google", nonce }, env)).resolves.toEqual({
      ok: true,
      state: { journeyId: "j-1", provider: "google", origin: "https://gojoystick.com", nonceHash },
    });
    // another browser (no cookie, or a different one)
    await expect(verifyConnectState(token, { provider: "google", nonce: undefined }, env)).resolves.toEqual({ ok: false, reason: "invalid" });
    await expect(verifyConnectState(token, { provider: "google", nonce: newConnectNonce().nonce }, env)).resolves.toEqual({ ok: false, reason: "invalid" });
    // another provider
    await expect(verifyConnectState(token, { provider: "slack", nonce }, env)).resolves.toEqual({ ok: false, reason: "invalid" });
    // another signer
    await expect(verifyConnectState(token, { provider: "google", nonce }, { ...env, JWT_SECRET: "other-secret-000000000000000000" })).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(hashNonce(nonce)).toBe(nonceHash);
  });

  it("expires after ten minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
    const { nonce, nonceHash } = newConnectNonce();
    const token = await signConnectState({ journeyId: "j-1", provider: "slack", origin: "https://gojoystick.com", nonceHash }, env);
    vi.setSystemTime(new Date("2026-10-29T12:11:00Z"));
    await expect(verifyConnectState(token, { provider: "slack", nonce }, env)).resolves.toEqual({ ok: false, reason: "expired" });
  });
});

describe("where a connection may start", () => {
  it("accepts JOYSTICK's front doors, configured https origins, and local hosts outside production", () => {
    expect(firstTenConnectOrigin("https://gojoystick.com", env)).toBe("https://gojoystick.com");
    expect(firstTenConnectOrigin("https://admin.bldg.chat/", env)).toBe("https://admin.bldg.chat");
    expect(firstTenConnectOrigin("https://evil.example", env)).toBeNull();
    expect(firstTenConnectOrigin("https://driver.gojoystick.com", env)).toBeNull();
    expect(firstTenConnectOrigin(undefined, env)).toBeNull();
    expect(firstTenConnectOrigin("http://127.0.0.1:3300", env)).toBe("http://127.0.0.1:3300");
    expect(firstTenConnectOrigin("http://127.0.0.1:3300", { ...env, NODE_ENV: "production" })).toBeNull();
    const configured = { ...env, JOYSTICK_FIRST_TEN_ORIGINS: "https://try.gojoystick.com, http://insecure.example" };
    expect(firstTenConnectOrigin("https://try.gojoystick.com", configured)).toBe("https://try.gojoystick.com");
    expect(firstTenConnectOrigin("http://insecure.example", configured)).toBeNull();
    expect(firstTenRedirectUri("https://gojoystick.com", "google")).toBe("https://gojoystick.com/api/first-ten/oauth/google/callback");
  });

  it("never sends a provider call to a stand-in in production", () => {
    const local = { ...env, JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN: "http://127.0.0.1:4999" };
    expect(providerUrl("https://oauth2.googleapis.com/token", local)).toBe("http://127.0.0.1:4999/oauth2.googleapis.com/token");
    expect(providerUrl("https://oauth2.googleapis.com/token", { ...local, NODE_ENV: "production" })).toBe("https://oauth2.googleapis.com/token");
  });
});

describe("Google", () => {
  it("asks for read-only Gmail, Calendar and Drive, offline, on the registered redirect", () => {
    const url = new URL(googleAuthorizationUrl({ state: "s", redirectUri: "https://gojoystick.com/api/first-ten/oauth/google/callback" }, env));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_SCOPES.join(" "));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("s");
    expect(url.searchParams.get("client_id")).toBe("google-client");
    for (const scope of GOOGLE_SCOPES) expect(scope).not.toMatch(/\.(send|compose|modify|insert)$|auth\/drive$|auth\/calendar$/);
  });

  it("exchanges a code and keeps the refresh token across a refresh", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      if (body.get("grant_type") === "authorization_code") {
        expect(body.get("client_secret")).toBe("google-secret");
        return jsonResponse({ access_token: "a1", refresh_token: "r1", expires_in: 3599, scope: `openid ${GMAIL}` });
      }
      return jsonResponse({ access_token: "a2", expires_in: 3599, scope: GMAIL });
    });
    const now = new Date("2026-10-29T12:00:00Z");
    const tokens = await exchangeGoogleCode({ code: "c", redirectUri: "r", now }, { fetch, env });
    expect(tokens).toEqual({ accessToken: "a1", refreshToken: "r1", expiresAt: new Date("2026-10-29T12:59:59Z"), grantedScopes: ["openid", GMAIL] });
    const refreshed = await refreshGoogleAccess({ refreshToken: "r1", now }, { fetch, env });
    expect(refreshed.accessToken).toBe("a2");
    expect(refreshed.refreshToken).toBe("r1");
  });

  it("needs Gmail at least", () => {
    expect(googleGrantIsUsable(["openid", GMAIL])).toBe(true);
    expect(googleGrantIsUsable(["openid", "https://www.googleapis.com/auth/drive.readonly"])).toBe(false);
  });
});

describe("Slack", () => {
  it("asks only for user scopes that read", () => {
    const url = new URL(slackAuthorizationUrl({ state: "s", redirectUri: "https://gojoystick.com/api/first-ten/oauth/slack/callback" }, env));
    expect(url.searchParams.get("user_scope")).toBe(SLACK_USER_SCOPES.join(","));
    expect(url.searchParams.get("scope")).toBeNull();
    for (const scope of SLACK_USER_SCOPES) expect(scope).toMatch(/:read$|:history$/);
  });

  it("takes the user token from the v2 exchange", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ ok: true, authed_user: { id: "U1", scope: "channels:history,users:read", access_token: "xoxp-1" }, team: { id: "T1", name: "Wildroot" } })
    );
    const grant = await exchangeSlackCode({ code: "c", redirectUri: "r" }, { fetch, env });
    expect(grant).toMatchObject({ accessToken: "xoxp-1", userId: "U1", teamName: "Wildroot", grantedScopes: ["channels:history", "users:read"] });
    expect(slackGrantIsUsable(grant.grantedScopes)).toBe(true);
    expect(slackGrantIsUsable(["users:read"])).toBe(false);
    const refused = vi.fn(async () => jsonResponse({ ok: false, error: "invalid_code" }));
    await expect(exchangeSlackCode({ code: "c", redirectUri: "r" }, { fetch: refused, env })).rejects.toThrow(/no user token/);
  });
});

describe("the callback", () => {
  function fakeRes() {
    const res = {
      location: "",
      status: 0,
      cleared: [] as string[],
      headers: {} as Record<string, string>,
      headersSent: false,
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      redirect(status: number, location: string) {
        this.status = status;
        this.location = location;
      },
      clearCookie(name: string) {
        this.cleared.push(name);
      },
    };
    return res;
  }

  async function signedRequest(provider: "google" | "slack", query: Record<string, string> = {}, purpose?: "send") {
    const { nonce, nonceHash } = newConnectNonce();
    const state = await signConnectState({ journeyId: "journey-1", provider, origin: "https://gojoystick.com", nonceHash, purpose }, env);
    return {
      req: { query: { code: "the-code", state, ...query }, headers: { cookie: `${FIRST_TEN_NONCE_COOKIE}=${nonce}` } } as unknown as Request,
      nonce,
    };
  }

  const ownJourney = async () => ({ id: "journey-1", kind: "own" }) as never;

  it("saves a usable Google grant and returns to the same origin's page", async () => {
    const { req } = await signedRequest("google");
    const res = fakeRes();
    const save = vi.fn(async () => undefined);
    const exchangeGoogle = vi.fn(async () => ({ accessToken: "a", refreshToken: "r", expiresAt: new Date(), grantedScopes: ["openid", GMAIL] }));
    await handleFirstTenCallback("google", req, res as unknown as Response, {
      env,
      loadJourney: ownJourney,
      exchangeGoogle,
      account: async () => ({ subject: "sub-1", email: "nina@wildrootflowers.example", name: "Nina", givenName: "Nina" }),
      save,
    });
    expect(exchangeGoogle).toHaveBeenCalledWith(
      { code: "the-code", redirectUri: "https://gojoystick.com/api/first-ten/oauth/google/callback" },
      { env }
    );
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ journeyId: "journey-1", provider: "google", accountLabel: "nina@wildrootflowers.example", accessToken: "a", refreshToken: "r" }));
    expect(res.location).toBe("/joystick-start?connected=google");
    expect(res.cleared).toContain(FIRST_TEN_NONCE_COOKIE);
  });

  it("revokes and says so when Gmail was unticked", async () => {
    const { req } = await signedRequest("google");
    const res = fakeRes();
    const revokeGoogle = vi.fn(async () => true);
    const save = vi.fn();
    await handleFirstTenCallback("google", req, res as unknown as Response, {
      env,
      loadJourney: ownJourney,
      exchangeGoogle: async () => ({ accessToken: "a", refreshToken: "r", expiresAt: new Date(), grantedScopes: ["openid"] }),
      revokeGoogle,
      save,
    });
    expect(revokeGoogle).toHaveBeenCalledWith("r", { env });
    expect(save).not.toHaveBeenCalled();
    expect(res.location).toBe("/joystick-start?connect_error=scopes&provider=google");
  });

  it("asks for sending only when the person first sends, on the account the crew read, and says so when it's refused", async () => {
    const SEND = "https://www.googleapis.com/auth/gmail.send";
    expect(googleAuthorizationUrl({ state: "s", redirectUri: "https://gojoystick.com/cb" }, env)).not.toContain(encodeURIComponent(SEND));
    expect(new URL(googleAuthorizationUrl({ state: "s", redirectUri: "https://gojoystick.com/cb", send: true }, env)).searchParams.get("scope")).toContain(SEND);
    const connected = async () => [{ provider: "google", status: "connected", accountSubject: "sub-1" }] as never;
    const account = async () => ({ subject: "sub-1", email: "nina@wildrootflowers.example", name: "Nina", givenName: "Nina" });

    const allowed = await signedRequest("google", {}, "send");
    const res1 = fakeRes();
    const save = vi.fn(async () => undefined);
    await handleFirstTenCallback("google", allowed.req, res1 as unknown as Response, {
      env, loadJourney: ownJourney, loadConnections: connected, account, save,
      exchangeGoogle: async () => ({ accessToken: "a", refreshToken: "r", expiresAt: new Date(), grantedScopes: ["openid", GMAIL, SEND] }),
    });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ grantedScopes: ["openid", GMAIL, SEND] }));
    expect(res1.location).toBe("/joystick-start?connected=google&for=send");

    // sending unticked: what they granted is kept, nothing can send, and the page says so
    const unticked = await signedRequest("google", {}, "send");
    const res2 = fakeRes();
    await handleFirstTenCallback("google", unticked.req, res2 as unknown as Response, {
      env, loadJourney: ownJourney, loadConnections: connected, account, save: vi.fn(async () => undefined),
      exchangeGoogle: async () => ({ accessToken: "a", refreshToken: "r", expiresAt: new Date(), grantedScopes: ["openid", GMAIL] }),
    });
    expect(res2.location).toBe("/joystick-start?connect_error=send_permission&provider=google");

    // another Google account picked on the way: revoked, nothing saved
    const other = await signedRequest("google", {}, "send");
    const res3 = fakeRes();
    const revokeGoogle = vi.fn(async () => true);
    const saveOther = vi.fn();
    await handleFirstTenCallback("google", other.req, res3 as unknown as Response, {
      env, loadJourney: ownJourney, loadConnections: connected, revokeGoogle, save: saveOther,
      account: async () => ({ subject: "sub-2", email: "someone@else.example", name: null, givenName: null }),
      exchangeGoogle: async () => ({ accessToken: "a", refreshToken: "r", expiresAt: new Date(), grantedScopes: ["openid", GMAIL, SEND] }),
    });
    expect(revokeGoogle).toHaveBeenCalledWith("r", { env });
    expect(saveOther).not.toHaveBeenCalled();
    expect(res3.location).toBe("/joystick-start?connect_error=other_account&provider=google");
  });

  it("refuses another browser, a cancelled consent, the example, and a closed flag", async () => {
    const save = vi.fn();
    const exchangeGoogle = vi.fn();

    const stolen = await signedRequest("google");
    const res1 = fakeRes();
    await handleFirstTenCallback("google", { ...stolen.req, headers: {} } as unknown as Request, res1 as unknown as Response, { env, loadJourney: ownJourney, exchangeGoogle, save });
    expect(res1.location).toBe("/joystick-start?connect_error=failed&provider=google");

    const res2 = fakeRes();
    await handleFirstTenCallback("google", { query: { error: "access_denied" }, headers: {} } as unknown as Request, res2 as unknown as Response, { env, save });
    expect(res2.location).toBe("/joystick-start?connect_error=cancelled&provider=google");

    const example = await signedRequest("google");
    const res3 = fakeRes();
    await handleFirstTenCallback("google", example.req, res3 as unknown as Response, { env, loadJourney: async () => ({ id: "journey-1", kind: "example" }) as never, exchangeGoogle, save });
    expect(res3.location).toBe("/joystick-start?connect_error=failed&provider=google");

    const closed = await signedRequest("google");
    const res4 = fakeRes();
    await handleFirstTenCallback("google", closed.req, res4 as unknown as Response, { env: { ...env, JOYSTICK_FIRST_TEN_MINUTES: "" }, loadJourney: ownJourney, exchangeGoogle, save });
    expect(res4.location).toBe("/joystick-start?");

    expect(exchangeGoogle).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("never echoes the provider's failure", async () => {
    const { req } = await signedRequest("slack");
    const res = fakeRes();
    await handleFirstTenCallback("slack", req, res as unknown as Response, {
      env,
      loadJourney: ownJourney,
      exchangeSlack: async () => {
        throw new Error("invalid_code xoxp-should-not-leak");
      },
    });
    expect(res.location).toBe("/joystick-start?connect_error=failed&provider=slack");
  });
});
