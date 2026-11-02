import crypto, { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { parse as parseCookies } from "cookie";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import type { AccountIntent, SignInErrorCode } from "../../shared/joystickAccount";
import { getSessionCookieOptions } from "../_core/cookies";
import { firstTenMode, firstTenOpenFor } from "../firstTenMinutes/flag";
import { exchangeGoogleCode, googleAccount, googleSignInUrl } from "../firstTenMinutes/google";
import { startJourney } from "../firstTenMinutes/journeys";
import { hashNonce, newConnectNonce } from "../firstTenMinutes/oauthState";
import { ACCOUNT_COOKIE, issueAccountCookie, journeyToken } from "./session";
import { accountByGoogleSub, latestJourneyFor, linkJourney, signInAccount } from "./store";
import { openWorkspaceForOwner } from "./workspace";

/**
 * "Continue with Google" on /signup and /login. Google only proves who the person is (openid, email, profile); the
 * account is created on the first sign-in and found by Google's subject id after that. Then:
 *   an activated workspace     its owner's workspace session, as the password sign-in gives (workspace.ts) → /onboarding
 *   otherwise                  their journey (a new one the first time), opened on this browser → /joystick-start
 * The journey is handed over in the URL fragment the first-ten page already adopts (#first-ten=<draft>.<token>), with an
 * account journey token (session.ts) in place of the draft's own resume token.
 *
 * Who may create an account follows JOYSTICK_FIRST_TEN_MINUTES: `on`, anyone; `preview`, a browser holding the crew
 * link's preview pass. Someone who already has an account may always sign in.
 */
export const SIGNIN_CALLBACK_PATH = "/api/account/google/callback";
export const SIGNIN_NONCE_COOKIE = "joystick_signin";
const STATE_PURPOSE = "joystick_signin";
const STATE_TTL_SECONDS = 10 * 60;

function stateKey(env: NodeJS.ProcessEnv): Uint8Array {
  const secret = env.JWT_SECRET?.trim();
  if (!secret) throw new Error("JWT_SECRET is required to sign sign-in state");
  return new TextEncoder().encode(`joystick-signin-state:${secret}`);
}

export type SignInState = { origin: string; nonceHash: string; intent: AccountIntent };

export async function signSignInState(state: SignInState, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new SignJWT({ purpose: STATE_PURPOSE, org: state.origin, nh: state.nonceHash, int: state.intent })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .sign(stateKey(env));
}

export async function verifySignInState(token: string, nonce: string | undefined, env: NodeJS.ProcessEnv = process.env): Promise<{ ok: true; state: SignInState } | { ok: false; reason: "expired" | "invalid" }> {
  try {
    const { payload } = await jwtVerify(token, stateKey(env), { algorithms: ["HS256"] });
    if (payload.purpose !== STATE_PURPOSE || typeof payload.org !== "string" || typeof payload.nh !== "string") return { ok: false, reason: "invalid" };
    // the browser that returns must be the browser that left
    if (!nonce || !crypto.timingSafeEqual(Buffer.from(hashNonce(nonce)), Buffer.from(payload.nh))) return { ok: false, reason: "invalid" };
    return { ok: true, state: { origin: payload.org, nonceHash: payload.nh, intent: payload.int === "login" ? "login" : "signup" } };
  } catch (error) {
    return { ok: false, reason: error instanceof joseErrors.JWTExpired ? "expired" : "invalid" };
  }
}

/** Google's consent URL, and the nonce cookie that ties the return to this browser. */
export async function beginGoogleSignIn(input: { origin: string; intent: AccountIntent; req: Request | undefined; res: Response | undefined }, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const { nonce, nonceHash } = newConnectNonce();
  const state = await signSignInState({ origin: input.origin, nonceHash, intent: input.intent }, env);
  input.res?.cookie(SIGNIN_NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: input.req ? getSessionCookieOptions(input.req).secure : true,
    path: "/api/account/google",
    maxAge: STATE_TTL_SECONDS * 1000,
  });
  return googleSignInUrl({ state, redirectUri: `${input.origin}${SIGNIN_CALLBACK_PATH}` }, env);
}

type Dependencies = {
  exchange?: typeof exchangeGoogleCode;
  account?: typeof googleAccount;
  findAccount?: typeof accountByGoogleSub;
  signIn?: typeof signInAccount;
  latestJourney?: typeof latestJourneyFor;
  start?: typeof startJourney;
  link?: typeof linkJourney;
  openWorkspace?: typeof openWorkspaceForOwner;
  env?: NodeJS.ProcessEnv;
};

function to(res: Response, location: string) {
  res.setHeader("Cache-Control", "no-store");
  res.redirect(303, location);
}

export async function handleGoogleSignInCallback(req: Request, res: Response, deps: Dependencies = {}): Promise<void> {
  const env = deps.env ?? process.env;
  const query = req.query as Record<string, unknown>;
  const cookies = parseCookies(req.headers.cookie ?? "");
  const clearNonce = () => res.clearCookie(SIGNIN_NONCE_COOKIE, { path: "/api/account/google", httpOnly: true, sameSite: "lax" });
  const verdict = await verifySignInState(typeof query.state === "string" ? query.state : "", cookies[SIGNIN_NONCE_COOKIE], env);
  clearNonce();
  const page = verdict.ok && verdict.state.intent === "login" ? "/login" : "/signup";
  const fail = (code: SignInErrorCode) => to(res, `${page}?error=${code}`);
  if (firstTenMode(env) === "off") return fail("closed");
  if (!verdict.ok) return fail(verdict.reason === "expired" ? "expired" : "failed");
  if (typeof query.error === "string" || typeof query.code !== "string" || !query.code) return fail("cancelled");

  const redirectUri = `${verdict.state.origin}${SIGNIN_CALLBACK_PATH}`;
  const tokens = await (deps.exchange ?? exchangeGoogleCode)({ code: query.code, redirectUri }, { env });
  const identity = await (deps.account ?? googleAccount)(tokens.accessToken, { env });
  // A new account needs the experience to be open to this browser (in `preview`, the crew link's pass); an existing
  // account may always sign in.
  if (!(await (deps.findAccount ?? accountByGoogleSub)(identity.subject)) && !firstTenOpenFor(req, env)) return fail("invite_only");
  const { account } = await (deps.signIn ?? signInAccount)(identity);

  const cookie = issueAccountCookie({ accountId: account.id, version: account.sessionVersion }, env);
  if (!cookie) return fail("failed");
  res.cookie(ACCOUNT_COOKIE, cookie.value, { ...getSessionCookieOptions(req), sameSite: "lax", maxAge: cookie.maxAgeMs });

  let latest = await (deps.latestJourney ?? latestJourneyFor)(account.id);
  if (latest?.journey.tenantId && (await (deps.openWorkspace ?? openWorkspaceForOwner)(latest.journey.tenantId, req, res))) {
    return to(res, "/onboarding");
  }
  if (!latest) {
    const started = await (deps.start ?? startJourney)({ requestId: randomUUID(), kind: "own" });
    await (deps.link ?? linkJourney)({ accountId: account.id, journeyId: started.journey.id, acquisitionSessionId: started.session.id });
    latest = { journey: started.journey, acquisitionSessionId: started.session.id };
  }
  const token = journeyToken({ accountId: account.id, version: account.sessionVersion, sessionId: latest.acquisitionSessionId }, env);
  if (!token) return fail("failed");
  return to(res, `/joystick-start#first-ten=${latest.acquisitionSessionId}.${token}`);
}

export function registerGoogleSignInRoutes(app: Express): void {
  app.get(SIGNIN_CALLBACK_PATH, (req, res) => {
    void handleGoogleSignInCallback(req, res).catch(error => {
      console.warn("[Account] Google sign-in failed:", error instanceof Error ? error.name : "unknown");
      if (!res.headersSent) to(res, "/signup?error=failed");
    });
  });
}
