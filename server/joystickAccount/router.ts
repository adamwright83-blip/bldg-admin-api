import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import type { AccountView } from "../../shared/joystickAccount";
import { getSessionCookieOptions } from "../_core/cookies";
import { publicProcedure, router } from "../_core/trpc";
import { firstTenMode, firstTenOpenFor } from "../firstTenMinutes/flag";
import { isGoogleConnectConfigured } from "../firstTenMinutes/google";
import { firstTenConnectOrigin } from "../firstTenMinutes/origins";
import { beginGoogleSignIn } from "./googleSignIn";
import { requireJourney } from "../firstTenMinutes/journeys";
import { ACCOUNT_COOKIE, accountCookieFrom, isJourneyToken, journeyToken } from "./session";
import { accountById, latestJourneyFor, revokeAccountSessions } from "./store";

type Req = { headers: { cookie?: string; origin?: string }; ip?: string } | undefined;

/** The signed-in account on this browser: cookie signed and unexpired, and its sessions not revoked since. */
export async function currentAccount(req: Req) {
  const claim = accountCookieFrom(req?.headers.cookie);
  if (!claim) return null;
  const account = await accountById(claim.accountId);
  return account && account.sessionVersion === claim.version ? account : null;
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
  beginGoogle: publicProcedure
    .input(
      z.object({
        intent: z.enum(["signup", "login"]),
        // a journey this browser began before signing up (the crew link): adopted by a first sign-in, not orphaned
        journey: z.object({ sessionId: z.string().uuid(), resumeToken: z.string().min(32).max(128) }).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
    if (firstTenMode() === "off" || !isGoogleConnectConfigured()) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Signing in with Google isn't available yet." });
    }
    const origin = firstTenConnectOrigin(ctx.req?.headers?.origin as string | undefined);
    if (!origin) throw new TRPCError({ code: "BAD_REQUEST", message: "Signing in isn't available from this address." });
    let adopt: { journeyId: string; sessionId: string } | undefined;
    if (input.journey && !isJourneyToken(input.journey.resumeToken)) {
      const owned = await requireJourney(input.journey).catch(() => null);
      if (owned && owned.journey.kind === "own") adopt = { journeyId: owned.journey.id, sessionId: owned.session.id };
    }
    return { url: await beginGoogleSignIn({ origin, intent: input.intent, adopt, req: ctx.req, res: ctx.res }) };
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

  /**
   * Signs out: this browser's account cookie and workspace session, and on every device every account cookie and
   * journey token issued before now.
   */
  signOut: publicProcedure.mutation(async ({ ctx }) => {
    const account = await currentAccount(ctx.req as Req);
    if (account) await revokeAccountSessions(account.id);
    if (ctx.req) {
      ctx.res?.clearCookie(ACCOUNT_COOKIE, { ...getSessionCookieOptions(ctx.req), sameSite: "lax" });
      // and this browser's workspace session; one open on another device ends there (it isn't stored server-side)
      ctx.res?.clearCookie(COOKIE_NAME, getSessionCookieOptions(ctx.req));
    }
    return { ok: true };
  }),
});
