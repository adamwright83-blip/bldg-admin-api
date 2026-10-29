import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getSessionCookieOptions } from "../_core/cookies";
import { JOURNEY_STAGES, type FirstTenAvailability } from "../../shared/firstTenMinutes";
import { assertFirstTenOpen, firstTenMode } from "./flag";
import { googleAuthorizationUrl, isGoogleConnectConfigured } from "./google";
import { isSlackConnectConfigured, slackAuthorizationUrl } from "./slack";
import { firstTenConnectOrigin, firstTenRedirectUri } from "./origins";
import { FIRST_TEN_NONCE_COOKIE, newConnectNonce, signConnectState } from "./oauthState";
import { disconnectProvider, journeyView, moveJourney, requireJourney, startJourney } from "./journeys";

const credentials = z.object({
  sessionId: z.string().uuid(),
  resumeToken: z.string().min(32).max(128),
});
const provider = z.enum(["google", "slack"]);

/**
 * system.firstTenMinutes: the public, draft-scoped procedures of JOYSTICK's first ten minutes. Every call but
 * `availability` refuses while JOYSTICK_FIRST_TEN_MINUTES is off, and every call that reads or changes a journey
 * needs that draft's resume token.
 */
export const firstTenMinutesRouter = router({
  availability: publicProcedure.query(
    (): FirstTenAvailability => ({
      mode: firstTenMode(),
      google: isGoogleConnectConfigured(),
      slack: isSlackConnectConfigured(),
    })
  ),

  start: publicProcedure
    .input(z.object({ requestId: z.string().uuid(), kind: z.enum(["own", "example"]) }))
    .mutation(async ({ input }) => {
      assertFirstTenOpen();
      const started = await startJourney(input);
      return { credentials: started.credentials, journey: await journeyView(started.journey, started.session) };
    }),

  journey: publicProcedure.input(credentials).query(async ({ input }) => {
    assertFirstTenOpen();
    const { session, journey } = await requireJourney(input);
    return journeyView(journey, session);
  }),

  move: publicProcedure
    .input(credentials.extend({ stage: z.enum(JOURNEY_STAGES) }))
    .mutation(async ({ input }) => {
      assertFirstTenOpen();
      const { session, journey } = await requireJourney(input);
      await moveJourney(journey, input.stage);
      return journeyView({ ...journey, stage: input.stage }, session);
    }),

  /** The provider's consent URL. The browser goes there; the provider sends it back to oauthRoutes.ts. */
  beginConnect: publicProcedure
    .input(credentials.extend({ provider }))
    .mutation(async ({ ctx, input }) => {
      assertFirstTenOpen();
      const { journey } = await requireJourney(input);
      if (journey.kind !== "own") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The example can't connect accounts. Bring your own world to connect." });
      }
      const configured = input.provider === "google" ? isGoogleConnectConfigured() : isSlackConnectConfigured();
      if (!configured) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${input.provider === "google" ? "Google" : "Slack"} isn't connected to JOYSTICK yet.` });
      }
      const origin = firstTenConnectOrigin(ctx.req?.headers?.origin as string | undefined);
      if (!origin) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Connecting isn't available from this address." });
      }
      const { nonce, nonceHash } = newConnectNonce();
      const state = await signConnectState({ journeyId: journey.id, provider: input.provider, origin, nonceHash });
      ctx.res?.cookie(FIRST_TEN_NONCE_COOKIE, nonce, {
        httpOnly: true,
        sameSite: "lax",
        secure: ctx.req ? getSessionCookieOptions(ctx.req).secure : true,
        path: "/api/first-ten/oauth",
        maxAge: 10 * 60 * 1000,
      });
      const redirectUri = firstTenRedirectUri(origin, input.provider);
      return {
        url:
          input.provider === "google"
            ? googleAuthorizationUrl({ state, redirectUri })
            : slackAuthorizationUrl({ state, redirectUri }),
      };
    }),

  disconnect: publicProcedure
    .input(credentials.extend({ provider }))
    .mutation(async ({ input }) => {
      assertFirstTenOpen();
      const { session, journey } = await requireJourney(input);
      await disconnectProvider(journey, input.provider);
      return journeyView(journey, session);
    }),
});
