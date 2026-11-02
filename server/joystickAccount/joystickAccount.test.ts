import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { firstTenOpenFor } from "../firstTenMinutes/flag";
import { newConnectNonce } from "../firstTenMinutes/oauthState";
import { currentPreviewVersion, FIRST_TEN_PREVIEW_COOKIE, issuePreviewPass } from "../firstTenMinutes/previewPass";
import { handleGoogleSignInCallback, signSignInState, SIGNIN_NONCE_COOKIE, verifySignInState } from "./googleSignIn";
import { ACCOUNT_COOKIE, accountCookieFrom, issueAccountCookie, journeyToken, readAccountCookie, readJourneyToken } from "./session";
import type { AccountRow } from "./schema";

const env = {
  JWT_SECRET: "joystick-account-test-secret-0000000000000000",
  JOYSTICK_FIRST_TEN_MINUTES: "preview",
  JOYSTICK_FIRST_TEN_PREVIEW_CODE: "joystick-account-preview-code-000",
} as NodeJS.ProcessEnv;
const ACCOUNT_ID = "6f1c1c1e-3a6b-4c43-9a4e-4a1f0c1f2b11";
const SESSION_ID = "0b6d2f5e-8f9b-4f2e-b8d1-6a0e0d5d7c22";

describe("account credentials", () => {
  it("signs the account cookie, refuses a tampered, expired or unsigned one", () => {
    const now = new Date("2026-11-02T10:00:00Z");
    const cookie = issueAccountCookie({ accountId: ACCOUNT_ID, version: 3 }, env, now)!;
    expect(readAccountCookie(cookie.value, env, now)).toEqual({ accountId: ACCOUNT_ID, version: 3, previewVersion: null });
    expect(readAccountCookie(cookie.value.replace(".3.", ".4."), env, now)).toBeNull();
    expect(readAccountCookie(cookie.value, { ...env, JWT_SECRET: "another-secret-entirely-0000000000000" }, now)).toBeNull();
    expect(readAccountCookie(cookie.value, env, new Date(now.getTime() + 31 * 86_400_000))).toBeNull();
    expect(issueAccountCookie({ accountId: ACCOUNT_ID, version: 1 }, {})).toBeNull();
    expect(accountCookieFrom(`other=1; ${ACCOUNT_COOKIE}=${encodeURIComponent(cookie.value)}`, env, now)).toEqual({ accountId: ACCOUNT_ID, version: 3, previewVersion: null });
  });

  it("derives a journey token that opens only the draft it was made for, and fits the first-ten handoff", () => {
    const token = journeyToken({ accountId: ACCOUNT_ID, version: 2, sessionId: SESSION_ID }, env)!;
    expect(token).toMatch(/^acct_[0-9a-f-]{36}_2_[0-9a-f]{64}$/);
    // the URL fragment the first-ten page adopts takes only [A-Za-z0-9_-]{32,128}
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(readJourneyToken(token, SESSION_ID, env)).toEqual({ accountId: ACCOUNT_ID, version: 2 });
    expect(readJourneyToken(token, "1b6d2f5e-8f9b-4f2e-b8d1-6a0e0d5d7c22", env)).toBeNull();
    expect(readJourneyToken(token.replace("_2_", "_3_"), SESSION_ID, env)).toBeNull();
    expect(readJourneyToken("a".repeat(48), SESSION_ID, env)).toBeNull();
  });

  it("lets an account admitted under the current crew code through the preview gate, and closes it with a new code", () => {
    const cookie = issueAccountCookie({ accountId: ACCOUNT_ID, version: 1, previewVersion: currentPreviewVersion(env) }, env)!;
    const header = { headers: { cookie: `${ACCOUNT_COOKIE}=${encodeURIComponent(cookie.value)}` } };
    expect(firstTenOpenFor({ headers: {} }, env)).toBe(false);
    expect(firstTenOpenFor(header, env)).toBe(true);
    // a new crew code revokes it, as it revokes every pass; so does removing the code
    expect(firstTenOpenFor(header, { ...env, JOYSTICK_FIRST_TEN_PREVIEW_CODE: "a-brand-new-crew-code-00000000" })).toBe(false);
    expect(firstTenOpenFor(header, { ...env, JOYSTICK_FIRST_TEN_PREVIEW_CODE: "" })).toBe(false);
    // an account never admitted in preview (made while it was `on`) is not a pass
    const unadmitted = issueAccountCookie({ accountId: ACCOUNT_ID, version: 1 }, env)!;
    expect(firstTenOpenFor({ headers: { cookie: `${ACCOUNT_COOKIE}=${encodeURIComponent(unadmitted.value)}` } }, env)).toBe(false);
    expect(firstTenOpenFor({ headers: { cookie: `${ACCOUNT_COOKIE}=forged.1.9999999999999.sig` } }, env)).toBe(false);
    // off stays off, whoever is signed in
    expect(firstTenOpenFor(header, { ...env, JOYSTICK_FIRST_TEN_MINUTES: "off" })).toBe(false);
  });
});

function fakeRes() {
  const res = {
    location: "",
    cookies: {} as Record<string, string>,
    cleared: [] as string[],
    headersSent: false,
    setHeader: vi.fn(),
    redirect(_status: number, location: string) {
      res.location = location;
      res.headersSent = true;
    },
    cookie(name: string, value: string) {
      res.cookies[name] = value;
    },
    clearCookie(name: string) {
      res.cleared.push(name);
    },
  };
  return res;
}

const account = (over: Partial<AccountRow> = {}): AccountRow => ({
  id: ACCOUNT_ID,
  googleSub: "google-sub-1",
  email: "sam@acme.example",
  name: "Sam Acme",
  givenName: "Sam",
  sessionVersion: 1,
  previewVersion: null,
  signedUpAt: new Date(),
  lastSignedInAt: new Date(),
  googleConnectedAt: null,
  firstLinesAt: null,
  portraitKeptAt: null,
  activatedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

async function callback(options: {
  intent?: "signup" | "login";
  pass?: boolean;
  accountCookie?: boolean;
  query?: Record<string, string>;
  existing?: Partial<AccountRow>;
  journey?: { tenantId: string | null } | null;
  workspace?: boolean;
  adopt?: { owner: boolean };
  draftLive?: boolean;
  env?: NodeJS.ProcessEnv;
}) {
  const e = options.env ?? env;
  const { nonce, nonceHash } = newConnectNonce();
  const adopt = options.adopt ? { journeyId: "journey-before", sessionId: SESSION_ID } : undefined;
  const state = await signSignInState({ origin: "https://gojoystick.com", nonceHash, intent: options.intent ?? "signup", adopt }, e);
  const pass = issuePreviewPass(e)!;
  const admitted = issueAccountCookie({ accountId: "7f1c1c1e-3a6b-4c43-9a4e-4a1f0c1f2b11", version: 1, previewVersion: currentPreviewVersion(e) }, e)!;
  const cookie = [
    `${SIGNIN_NONCE_COOKIE}=${nonce}`,
    ...(options.pass ? [`${FIRST_TEN_PREVIEW_COOKIE}=${encodeURIComponent(pass.value)}`] : []),
    ...(options.accountCookie ? [`${ACCOUNT_COOKIE}=${encodeURIComponent(admitted.value)}`] : []),
  ].join("; ");
  const req = { query: { state, code: "the-code", ...options.query }, headers: { cookie }, protocol: "https", get: () => "gojoystick.com" } as unknown as Request;
  const res = fakeRes();
  const deps = {
    env: e,
    exchange: vi.fn(async () => ({ accessToken: "a", refreshToken: null, expiresAt: new Date(), grantedScopes: ["openid", "email", "profile"] })),
    account: vi.fn(async () => ({ subject: "google-sub-1", email: "sam@acme.example", name: "Sam Acme", givenName: "Sam" })),
    findAccount: vi.fn(async () => (options.existing ? account(options.existing) : null)),
    signIn: vi.fn(async (_identity: unknown, opts?: { previewVersion?: string | null }) => ({
      account: account({ ...options.existing, ...(opts?.previewVersion ? { previewVersion: opts.previewVersion } : {}) }),
      created: !options.existing,
    })),
    latestJourney: vi.fn(async () => (options.journey ? { journey: { id: "journey-1", tenantId: options.journey.tenantId } as never, acquisitionSessionId: SESSION_ID } : null)),
    start: vi.fn(async () => ({ credentials: { sessionId: SESSION_ID, resumeToken: "r".repeat(43) }, journey: { id: "journey-new" } as never, session: { id: SESSION_ID } as never })),
    link: vi.fn(async () => undefined),
    openWorkspace: vi.fn(async () => Boolean(options.workspace)),
    ownerOf: vi.fn(async () => (options.adopt?.owner ? account({ id: "8f1c1c1e-3a6b-4c43-9a4e-4a1f0c1f2b11" }) : null)),
    loadJourney: vi.fn(async () => ({ id: "journey-before", kind: "own", acquisitionSessionId: SESSION_ID, tenantId: null }) as never),
    draftLive: vi.fn(async () => options.draftLive ?? true),
  };
  await handleGoogleSignInCallback(req, res as unknown as Response, deps);
  return { res, deps };
}

describe("Continue with Google", () => {
  it("creates the account on first sign-up through the crew link, starts a journey, and hands it to this browser", async () => {
    const { res, deps } = await callback({ pass: true });
    expect(deps.exchange).toHaveBeenCalledWith({ code: "the-code", redirectUri: "https://gojoystick.com/api/account/google/callback" }, { env });
    expect(deps.signIn).toHaveBeenCalled();
    expect(deps.link).toHaveBeenCalledWith({ accountId: ACCOUNT_ID, journeyId: "journey-new", acquisitionSessionId: SESSION_ID });
    // admitted under the current crew code: the cookie carries it to this account's other devices
    expect(readAccountCookie(res.cookies[ACCOUNT_COOKIE], env)).toEqual({ accountId: ACCOUNT_ID, version: 1, previewVersion: currentPreviewVersion(env) });
    expect(deps.signIn).toHaveBeenCalledWith(expect.anything(), { previewVersion: currentPreviewVersion(env) });
    const [, fragment] = res.location.split("#first-ten=");
    expect(res.location.startsWith("/joystick-start#first-ten=")).toBe(true);
    const [sessionId, token] = fragment.split(".");
    expect(sessionId).toBe(SESSION_ID);
    expect(readJourneyToken(token, SESSION_ID, env)).toEqual({ accountId: ACCOUNT_ID, version: 1 });
    expect(res.cleared).toContain(SIGNIN_NONCE_COOKIE);
  });

  it("in preview, only the crew link admits: never another account's cookie, never an account the code no longer covers", async () => {
    const refused = await callback({ pass: false });
    expect(refused.res.location).toBe("/signup?error=invite_only");
    expect(refused.deps.signIn).not.toHaveBeenCalled();
    // an admitted account's cookie in this browser doesn't let a different Google identity in
    const piggyback = await callback({ pass: false, accountCookie: true });
    expect(piggyback.res.location).toBe("/signup?error=invite_only");
    // an account admitted under an older code, or made while it was `on`, needs the current link
    const stale = await callback({ pass: false, existing: { previewVersion: "0000000000000000" }, intent: "login" });
    expect(stale.res.location).toBe("/login?error=invite_only");
    const returning = await callback({ pass: false, existing: { previewVersion: currentPreviewVersion(env) }, intent: "login", journey: { tenantId: null } });
    expect(returning.res.location.startsWith("/joystick-start#first-ten=")).toBe(true);
    expect(returning.deps.start).not.toHaveBeenCalled();
    // `on`: anyone may sign up
    const open = await callback({ pass: false, env: { ...env, JOYSTICK_FIRST_TEN_MINUTES: "on" } });
    expect(open.res.location.startsWith("/joystick-start#first-ten=")).toBe(true);
  });

  it("opens the workspace for an activated owner, and their journey when the workspace can't be opened yet", async () => {
    const opened = await callback({ existing: { previewVersion: currentPreviewVersion(env) }, intent: "login", journey: { tenantId: "df_123" }, workspace: true });
    expect(opened.deps.openWorkspace).toHaveBeenCalledWith("df_123", expect.anything(), expect.anything());
    expect(opened.res.location).toBe("/onboarding");
    const notYet = await callback({ existing: { previewVersion: currentPreviewVersion(env) }, intent: "login", journey: { tenantId: "df_123" }, workspace: false });
    expect(notYet.res.location.startsWith("/joystick-start#first-ten=")).toBe(true);
  });

  it("replaces a journey whose draft has expired instead of handing it back dead, and keeps it the account's", async () => {
    const returning = await callback({ existing: { previewVersion: currentPreviewVersion(env) }, intent: "login", journey: { tenantId: null }, draftLive: false });
    expect(returning.deps.start).toHaveBeenCalled();
    expect(returning.deps.link).toHaveBeenCalledWith({ accountId: ACCOUNT_ID, journeyId: "journey-new", acquisitionSessionId: SESSION_ID });
    expect(returning.res.location.startsWith("/joystick-start#first-ten=")).toBe(true);
    // a live one is handed back as it is
    const live = await callback({ existing: { previewVersion: currentPreviewVersion(env) }, intent: "login", journey: { tenantId: null } });
    expect(live.deps.start).not.toHaveBeenCalled();
  });

  it("makes the journey this browser already began the new account's, unless another account has it", async () => {
    const adopted = await callback({ pass: true, adopt: { owner: false } });
    expect(adopted.deps.link).toHaveBeenCalledWith({ accountId: ACCOUNT_ID, journeyId: "journey-before", acquisitionSessionId: SESSION_ID });
    expect(adopted.deps.start).not.toHaveBeenCalled();
    const taken = await callback({ pass: true, adopt: { owner: true } });
    expect(taken.deps.start).toHaveBeenCalled();
    expect(taken.deps.link).toHaveBeenCalledWith({ accountId: ACCOUNT_ID, journeyId: "journey-new", acquisitionSessionId: SESSION_ID });
  });

  it("refuses a return that didn't start in this browser, a cancelled consent, and a closed experience", async () => {
    const { nonceHash } = newConnectNonce();
    const state = await signSignInState({ origin: "https://gojoystick.com", nonceHash, intent: "login" }, env);
    expect(await verifySignInState(state, "a-different-nonce", env)).toEqual({ ok: false, reason: "invalid" });
    const cancelled = await callback({ pass: true, query: { error: "access_denied" } });
    expect(cancelled.res.location).toBe("/signup?error=cancelled");
    expect(cancelled.deps.exchange).not.toHaveBeenCalled();
    const loginCancelled = await callback({ intent: "login", query: { error: "access_denied" } });
    expect(loginCancelled.res.location).toBe("/login?error=cancelled");
    const closed = await callback({ pass: true, env: { ...env, JOYSTICK_FIRST_TEN_MINUTES: "off" } });
    expect(closed.res.location).toBe("/signup?error=closed");
  });
});
