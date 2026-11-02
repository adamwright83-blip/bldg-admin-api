import type { Express, Request, Response } from "express";
import { parse as parseCookies } from "cookie";
import type { ConnectErrorCode, ConnectionProvider } from "../../shared/firstTenMinutes";
import { firstTenOpenFor } from "./flag";
import { exchangeGoogleCode, googleAccount, googleGrantIsUsable, revokeGoogleToken } from "./google";
import { beginFirstRead } from "./firstRead/firstRead";
import { exchangeSlackCode, revokeSlackToken, slackGrantIsUsable } from "./slack";
import { firstTenCallbackPath, firstTenRedirectUri } from "./origins";
import { FIRST_TEN_NONCE_COOKIE, verifyConnectState } from "./oauthState";
import { GOOGLE_SEND_SCOPE } from "../../shared/firstTenMinutes";
import { connectionRows, journeyById, saveConnection } from "./store";
import { markFunnelStep } from "../joystickAccount/store";

/**
 * Google and Slack send the visitor back here. The callback is a top-level GET from the provider, so it is an
 * Express route, not a tRPC mutation (whose origin guard would rightly refuse it).
 *
 * It answers with a redirect to /joystick-start on the same origin (where the draft's credentials live in browser
 * storage), carrying `connected=<provider>` or `connect_error=<code>`. It never echoes a code, token or provider
 * message, and it logs only the failure's kind.
 */
type Dependencies = {
  exchangeGoogle?: typeof exchangeGoogleCode;
  beginFirstRead?: typeof beginFirstRead;
  account?: typeof googleAccount;
  revokeGoogle?: typeof revokeGoogleToken;
  exchangeSlack?: typeof exchangeSlackCode;
  revokeSlack?: typeof revokeSlackToken;
  loadJourney?: typeof journeyById;
  loadConnections?: typeof connectionRows;
  save?: typeof saveConnection;
  env?: NodeJS.ProcessEnv;
};

function back(res: Response, query: string) {
  res.setHeader("Cache-Control", "no-store");
  res.redirect(303, `/joystick-start?${query}`);
}

export async function handleFirstTenCallback(
  provider: ConnectionProvider,
  req: Request,
  res: Response,
  deps: Dependencies = {}
): Promise<void> {
  const env = deps.env ?? process.env;
  // the moment Google sent the person back: the first read's clock starts here
  const consentedAt = new Date();
  const fail = (code: ConnectErrorCode) => back(res, `connect_error=${code}&provider=${provider}`);
  const clearNonce = () =>
    res.clearCookie(FIRST_TEN_NONCE_COOKIE, { path: "/api/first-ten/oauth", httpOnly: true, sameSite: "lax" });

  const query = req.query as Record<string, unknown>;
  const code = typeof query.code === "string" ? query.code : "";
  const stateToken = typeof query.state === "string" ? query.state : "";
  // closed, or `preview` without this browser's preview pass: the callback does nothing
  if (!firstTenOpenFor(req, env)) return back(res, "");
  if (typeof query.error === "string" || !code) {
    clearNonce();
    return fail("cancelled");
  }

  const cookies = parseCookies(req.headers.cookie ?? "");
  const checked = await verifyConnectState(stateToken, { provider, nonce: cookies[FIRST_TEN_NONCE_COOKIE] }, env);
  clearNonce();
  if (!checked.ok) {
    console.warn("[FirstTen] connect refused:", provider, checked.reason);
    return fail(checked.reason === "expired" ? "expired" : "failed");
  }
  const journey = await (deps.loadJourney ?? journeyById)(checked.state.journeyId);
  if (!journey || journey.kind !== "own") return fail("failed");
  const redirectUri = firstTenRedirectUri(checked.state.origin, provider);

  try {
    if (provider === "google") {
      const tokens = await (deps.exchangeGoogle ?? exchangeGoogleCode)({ code, redirectUri }, { env });
      if (!googleGrantIsUsable(tokens.grantedScopes)) {
        await (deps.revokeGoogle ?? revokeGoogleToken)(tokens.refreshToken ?? tokens.accessToken, { env });
        return fail("scopes");
      }
      const account = await (deps.account ?? googleAccount)(tokens.accessToken, { env });
      if (checked.state.purpose === "send") {
        // permission to send is for the account the crew already read, never another one picked on the way
        const current = (await (deps.loadConnections ?? connectionRows)(journey.id)).find(row => row.provider === "google" && row.status === "connected");
        if (current?.accountSubject && current.accountSubject !== account.subject) {
          await (deps.revokeGoogle ?? revokeGoogleToken)(tokens.refreshToken ?? tokens.accessToken, { env });
          return fail("other_account");
        }
      }
      await (deps.save ?? saveConnection)({
        journeyId: journey.id,
        provider,
        accountLabel: account.email,
        accountSubject: account.subject,
        grantedScopes: tokens.grantedScopes,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessExpiresAt: tokens.expiresAt,
      });
      if (checked.state.purpose === "send") {
        return tokens.grantedScopes.includes(GOOGLE_SEND_SCOPE) ? back(res, "connected=google&for=send") : fail("send_permission");
      }
      void markFunnelStep(journey.id, "googleConnectedAt");
      // off unless JOYSTICK_FIRST_READ_REVEAL=on. Awaited only for its claim (one row), so the page that loads next
      // already finds it running; the read itself goes on in the background and never holds the redirect.
      await (deps.beginFirstRead ?? beginFirstRead)(journey, { startedAt: consentedAt, ownerName: account.name, ownerEmail: account.email }, env).catch(() => false);
    } else {
      const grant = await (deps.exchangeSlack ?? exchangeSlackCode)({ code, redirectUri }, { env });
      if (!slackGrantIsUsable(grant.grantedScopes)) {
        await (deps.revokeSlack ?? revokeSlackToken)(grant.accessToken, { env });
        return fail("failed");
      }
      await (deps.save ?? saveConnection)({
        journeyId: journey.id,
        provider,
        accountLabel: grant.teamName,
        accountSubject: grant.userId,
        grantedScopes: grant.grantedScopes,
        accessToken: grant.accessToken,
        refreshToken: grant.refreshToken,
        accessExpiresAt: grant.expiresAt,
      });
    }
  } catch (error) {
    console.warn("[FirstTen] connect failed:", provider, error instanceof Error ? error.name : "unknown");
    return fail("failed");
  }
  return back(res, `connected=${provider}`);
}

export function registerFirstTenOAuthRoutes(app: Express): void {
  for (const provider of ["google", "slack"] as const) {
    app.get(firstTenCallbackPath(provider), (req, res) => {
      void handleFirstTenCallback(provider, req, res).catch(() => {
        if (!res.headersSent) back(res, `connect_error=failed&provider=${provider}`);
      });
    });
  }
}
