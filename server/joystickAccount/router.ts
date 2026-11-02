import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { AccountView } from "../../shared/joystickAccount";
import { getSessionCookieOptions } from "../_core/cookies";
import { publicProcedure, router } from "../_core/trpc";
import { firstTenMode, firstTenOpenFor } from "../firstTenMinutes/flag";
import { isGoogleConnectConfigured } from "../firstTenMinutes/google";
import { firstTenConnectOrigin } from "../firstTenMinutes/origins";
import { beginGoogleSignIn } from "./googleSignIn";
import { ACCOUNT_COOKIE, accountCookieFrom, journeyToken } from "./session";
import { accountById, latestJourneyFor, revokeAccountSessions } from "./store";

type Req = { headers: { cookie?: string; origin?: string }; ip?: string } | undefined;

/** The signed-in account on this browser: cookie signed and unexpired, and its sessions not revoked since. */
export async function currentAccount(req: Req) {
  const claim = accountCookieFrom(req?.headers.cookie);
  if (!claim) return null;
  const account = await accountById(claim.accountId);
  return account && account.sessionVersion === claim.version ? account : null;
}

// a few sign-in starts per address per ten minutes: a person retrying is fine, a script is not
const STARTS = new Map<string, number[]>();
const START_LIMIT = 20;
const START_WINDOW_MS = 10 * 60_000;
export function allowSignInStart(address: string, now = Date.now()): boolean {
  const recent = (STARTS.get(address) ?? []).filter(at => now - at < START_WINDOW_MS);
  if (recent.length >= START_LIMIT) {
    STARTS.set(address, recent);
    return false;
  }
  recent.push(now);
  STARTS.set(address, recent);
  if (STARTS.size > 10_000) STARTS.clear();
  return true;
}

export const joystickAccountRouter = router({
  view: publicProcedure.query(async ({ ctx }): Promise<AccountView> => {
    const account = await currentAccount(ctx.req as Req).catch(() => null);
    return {
      open: firstTenOpenFor(ctx.req),
      googleReady: firstTenMode() !== "off" && isGoogleConnectConfigured(),
      signedIn: account ? { email: account.email, name: account.givenName ?? account.name } : null,
    };
  }),

  /** Google's sign-in URL; the browser goes there and Google sends it back to googleSignIn.ts. */
  beginGoogle: publicProcedure.input(z.object({ intent: z.enum(["signup", "login"]) })).mutation(async ({ ctx, input }) => {
    if (firstTenMode() === "off" || !isGoogleConnectConfigured()) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Signing in with Google isn't available yet." });
    }
    const origin = firstTenConnectOrigin(ctx.req?.headers?.origin as string | undefined);
    if (!origin) throw new TRPCError({ code: "BAD_REQUEST", message: "Signing in isn't available from this address." });
    if (!allowSignInStart(ctx.req?.ip ?? "unknown")) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many tries. Wait a few minutes." });
    return { url: await beginGoogleSignIn({ origin, intent: input.intent, req: ctx.req, res: ctx.res }) };
  }),

  /** For a signed-in browser: its journey, opened here (the same journey on every device). */
  resume: publicProcedure.mutation(async ({ ctx }) => {
    const account = await currentAccount(ctx.req as Req);
    if (!account) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in first." });
    const latest = await latestJourneyFor(account.id);
    if (!latest) return { credentials: null };
    const token = journeyToken({ accountId: account.id, version: account.sessionVersion, sessionId: latest.acquisitionSessionId });
    return { credentials: token ? { sessionId: latest.acquisitionSessionId, resumeToken: token } : null };
  }),

  /** Signs out everywhere: this cookie, every other device's, and every journey token issued to the account. */
  signOut: publicProcedure.mutation(async ({ ctx }) => {
    const account = await currentAccount(ctx.req as Req);
    if (account) await revokeAccountSessions(account.id);
    if (ctx.req) ctx.res?.clearCookie(ACCOUNT_COOKIE, { ...getSessionCookieOptions(ctx.req), sameSite: "lax" });
    return { ok: true };
  }),
});
