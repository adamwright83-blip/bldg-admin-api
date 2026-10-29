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
import { beginReading } from "./understanding/run";
import { readingDepsFor } from "./understanding/deps";
import { understandingView } from "./understanding/view";
import { answerFinding, findingPicture } from "./crew";
import { changePortraitLine, keepPortraitFor, portraitView, preparePortrait, restorePortraitLine } from "./portrait/portrait";

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

  /**
   * The crew begins reading what the person connected (or Nina's example). Returns at once; the reading reports its
   * own progress through `understanding`. `again` reads afresh, keeping whatever the person already said about a finding.
   */
  understand: publicProcedure
    .input(credentials.extend({ again: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      assertFirstTenOpen();
      const { session, journey } = await requireJourney(input);
      const view = await journeyView(journey, session);
      if (journey.kind === "own" && !view.connections.length) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Connect Google or Slack first, so your crew has something to read." });
      }
      await beginReading(journey.id, () => readingDepsFor(journey), { again: input.again });
      if (journey.stage === "connect") await moveJourney(journey, "understanding");
      return understandingView(journey.id);
    }),

  understanding: publicProcedure.input(credentials).query(async ({ input }) => {
    assertFirstTenOpen();
    const { journey } = await requireJourney(input);
    return understandingView(journey.id);
  }),

  /**
   * The person's answer to something the crew found: it's right (confirm), it was true and isn't now (change, with
   * their words), or it's wrong (dismiss). Kept, and never shown as true again once changed or dismissed.
   */
  answerFinding: publicProcedure
    .input(
      credentials.extend({
        findingId: z.string().min(1).max(64),
        answer: z.enum(["confirm", "change", "dismiss"]),
        correction: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      assertFirstTenOpen();
      const { journey } = await requireJourney(input);
      await answerFinding(journey, input.findingId, input.answer, input.correction ?? null);
      return understandingView(journey.id);
    }),

  /**
   * Claire's portrait. `preparePortrait` begins (or rejoins) the writing once the crew's reading is complete and
   * returns at once; `portrait` follows it. It is written again only while the person hasn't kept it and what it
   * rests on has changed.
   */
  preparePortrait: publicProcedure.input(credentials).mutation(async ({ input }) => {
    assertFirstTenOpen();
    const { journey } = await requireJourney(input);
    return (await preparePortrait(journey)).view;
  }),

  portrait: publicProcedure.input(credentials).query(async ({ input }) => {
    assertFirstTenOpen();
    const { journey } = await requireJourney(input);
    return portraitView(journey.id);
  }),

  /**
   * "That sounds like me" keeps the page as it stands. "Let me change something" puts the person's own words in place
   * of one line (`to`), takes it out (`to: null`), or puts Claire's line back (restore).
   */
  answerPortrait: publicProcedure
    .input(
      z.discriminatedUnion("answer", [
        credentials.extend({ answer: z.literal("keep") }),
        credentials.extend({ answer: z.literal("change"), key: z.string().regex(/^p[1-3]\.s[1-3]$/), to: z.string().trim().max(400).nullable() }),
        credentials.extend({ answer: z.literal("restore"), key: z.string().regex(/^p[1-3]\.s[1-3]$/) }),
      ])
    )
    .mutation(async ({ input }) => {
      assertFirstTenOpen();
      const { journey } = await requireJourney(input);
      if (input.answer === "keep") return keepPortraitFor(journey);
      if (input.answer === "restore") return restorePortraitLine(journey, input.key);
      return changePortraitLine(journey, input.key, input.to);
    }),

  /** Luma's photograph: the person's own image, shown only to them, fetched when asked and never stored. */
  findingPicture: publicProcedure
    .input(credentials.extend({ findingId: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      assertFirstTenOpen();
      const { journey } = await requireJourney(input);
      return findingPicture(journey, input.findingId);
    }),
});
