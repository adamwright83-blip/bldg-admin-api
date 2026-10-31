import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getSessionCookieOptions } from "../_core/cookies";
import { JOURNEY_STAGES, type FirstTenAvailability } from "../../shared/firstTenMinutes";
import { assertFirstTenOpen, firstTenMode, firstTenOpenFor } from "./flag";
import { FIRST_TEN_PREVIEW_COOKIE, issuePreviewPass, previewCodeMatches } from "./previewPass";
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
import { changeDraft, chapterView, declineDraft, prepareDraft, recordChapterStep } from "./chapter/chapter";
import { activationView, beginActivation, sendDraft, verifyDraft } from "./activation/activation";
import { askClaire, firstChapterView, openFirstChapter } from "./firstChapter/firstChapter";
import { DRAFT_APPROACHES, LETTER_STEPS } from "../../shared/firstTenMinutesChapter";

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
    ({ ctx }): FirstTenAvailability => ({
      mode: firstTenMode(),
      // whether this browser may use it: always when `on`; in `preview`, only with the server-issued pass
      open: firstTenOpenFor(ctx.req),
      google: isGoogleConnectConfigured(),
      slack: isSlackConnectConfigured(),
    })
  ),

  /**
   * /joystick-start?crew=<code>: with the right JOYSTICK_FIRST_TEN_PREVIEW_CODE, this browser gets the preview pass, an
   * httpOnly cookie every first-ten call then checks. A wrong code gets nothing, and says nothing about why.
   */
  enterPreview: publicProcedure.input(z.object({ code: z.string().min(1).max(200) })).mutation(({ ctx, input }) => {
    if (firstTenMode() !== "preview" || !previewCodeMatches(input.code)) return { open: firstTenOpenFor(ctx.req) };
    const pass = issuePreviewPass();
    if (!pass) return { open: false };
    ctx.res.cookie(FIRST_TEN_PREVIEW_COOKIE, pass.value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: pass.maxAgeMs,
    });
    return { open: true };
  }),

  start: publicProcedure
    .input(z.object({ requestId: z.string().uuid(), kind: z.enum(["own", "example"]) }))
    .mutation(async ({ ctx, input }) => {
      assertFirstTenOpen(ctx.req);
      const started = await startJourney(input);
      return { credentials: started.credentials, journey: await journeyView(started.journey, started.session) };
    }),

  journey: publicProcedure.input(credentials).query(async ({ ctx, input }) => {
    assertFirstTenOpen(ctx.req);
    const { session, journey } = await requireJourney(input);
    return journeyView(journey, session);
  }),

  move: publicProcedure
    .input(credentials.extend({ stage: z.enum(JOURNEY_STAGES) }))
    .mutation(async ({ ctx, input }) => {
      assertFirstTenOpen(ctx.req);
      const { session, journey } = await requireJourney(input);
      await moveJourney(journey, input.stage);
      return journeyView({ ...journey, stage: input.stage }, session);
    }),

  /**
   * The provider's consent URL. The browser goes there; the provider sends it back to oauthRoutes.ts. `purpose: "send"`
   * asks Google for permission to send from the person's Gmail as well (the first time they send from JOYSTICK).
   */
  beginConnect: publicProcedure
    .input(credentials.extend({ provider, purpose: z.enum(["send"]).optional() }))
    .mutation(async ({ ctx, input }) => {
      assertFirstTenOpen(ctx.req);
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
      if (input.purpose === "send" && input.provider !== "google") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only Gmail sends from JOYSTICK." });
      }
      const { nonce, nonceHash } = newConnectNonce();
      const state = await signConnectState({ journeyId: journey.id, provider: input.provider, origin, nonceHash, purpose: input.purpose });
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
            ? googleAuthorizationUrl({ state, redirectUri, send: input.purpose === "send" })
            : slackAuthorizationUrl({ state, redirectUri }),
      };
    }),

  disconnect: publicProcedure
    .input(credentials.extend({ provider }))
    .mutation(async ({ ctx, input }) => {
      assertFirstTenOpen(ctx.req);
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
    .mutation(async ({ ctx, input }) => {
      assertFirstTenOpen(ctx.req);
      const { session, journey } = await requireJourney(input);
      const view = await journeyView(journey, session);
      if (journey.kind === "own" && !view.connections.length) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Connect Google or Slack first, so your crew has something to read." });
      }
      await beginReading(journey.id, () => readingDepsFor(journey), { again: input.again });
      if (journey.stage === "connect") await moveJourney(journey, "understanding");
      return understandingView(journey.id);
    }),

  understanding: publicProcedure.input(credentials).query(async ({ ctx, input }) => {
    assertFirstTenOpen(ctx.req);
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
    .mutation(async ({ ctx, input }) => {
      assertFirstTenOpen(ctx.req);
      const { journey } = await requireJourney(input);
      await answerFinding(journey, input.findingId, input.answer, input.correction ?? null);
      return understandingView(journey.id);
    }),

  /**
   * Claire's portrait. `preparePortrait` begins (or rejoins) the writing once the crew's reading is complete and
   * returns at once; `portrait` follows it. It is written again only while the person hasn't kept it and what it
   * rests on has changed.
   */
  preparePortrait: publicProcedure.input(credentials).mutation(async ({ ctx, input }) => {
    assertFirstTenOpen(ctx.req);
    const { journey } = await requireJourney(input);
    return (await preparePortrait(journey)).view;
  }),

  portrait: publicProcedure.input(credentials).query(async ({ ctx, input }) => {
    assertFirstTenOpen(ctx.req);
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
    .mutation(async ({ ctx, input }) => {
      assertFirstTenOpen(ctx.req);
      const { journey } = await requireJourney(input);
      if (input.answer === "keep") return keepPortraitFor(journey);
      if (input.answer === "restore") return restorePortraitLine(journey, input.key);
      return changePortraitLine(journey, input.key, input.to);
    }),

  /**
   * The first chapter: the opportunity the crew found and the findings it rests on, how far the person has played,
   * and the real draft at the writing table. Nothing here sends anything.
   */
  chapter: publicProcedure.input(credentials).query(async ({ ctx, input }) => {
    assertFirstTenOpen(ctx.req);
    const { journey } = await requireJourney(input);
    return chapterView(journey);
  }),

  /** A beat of the chapter, played: the revelation seen, a step of Hazel's errand, the letter written. */
  chapterStep: publicProcedure
    .input(credentials.extend({ step: z.enum(["revealed", ...LETTER_STEPS, "letter_written"]) }))
    .mutation(async ({ ctx, input }) => {
      assertFirstTenOpen(ctx.req);
      const { journey } = await requireJourney(input);
      return recordChapterStep(journey, input.step);
    }),

  /** "Now. Yours.": the draft at the writing table, composed from the findings. */
  prepareDraft: publicProcedure.input(credentials).mutation(async ({ ctx, input }) => {
    assertFirstTenOpen(ctx.req);
    const { journey } = await requireJourney(input);
    return prepareDraft(journey);
  }),

  /** Another approach, or the person's own words. */
  changeDraft: publicProcedure
    .input(credentials.extend({ approach: z.enum(DRAFT_APPROACHES).optional(), body: z.string().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      assertFirstTenOpen(ctx.req);
      const { journey } = await requireJourney(input);
      return changeDraft(journey, { approach: input.approach, body: input.body });
    }),

  /** "Not now": the person decided against it. */
  declineDraft: publicProcedure.input(credentials).mutation(async ({ ctx, input }) => {
    assertFirstTenOpen(ctx.req);
    const { journey } = await requireJourney(input);
    return declineDraft(journey);
  }),

  /**
   * Keeping the crew: the actual offer, what JOYSTICK knows of the person, and whether this journey is active. While
   * billing is open, a message leaves the table only once it is.
   */
  activation: publicProcedure.input(credentials).query(async ({ ctx, input }) => {
    assertFirstTenOpen(ctx.req);
    const { journey } = await requireJourney(input);
    return activationView(journey, input);
  }),

  /** "Continue with JOYSTICK": identity on the signup draft, then today's checkout, which returns here. */
  beginActivation: publicProcedure
    .input(
      credentials.extend({
        businessName: z.string().trim().min(1).max(255),
        contactName: z.string().trim().min(1).max(255),
        ownerEmail: z.string().trim().email().max(320),
        timeZone: z.string().trim().min(1).max(64),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertFirstTenOpen(ctx.req);
      const { journey } = await requireJourney(input);
      const { sessionId, resumeToken, ...identity } = input;
      return beginActivation(journey, { sessionId, resumeToken }, identity);
    }),

  /**
   * The person sends the message from JOYSTICK, from their own Gmail. `to`, `subject` and `body` are exactly what they
   * approved; anything else at the table is refused. Once per journey: a retry or a replay never sends it again. A send
   * Google never answered is sent again only with `resendUnconfirmed`, the person's choice after being told it may
   * already have gone. The outcome is what Google showed: sent (with its id), still being confirmed, refused, or
   * permission needed first.
   */
  sendDraft: publicProcedure
    .input(credentials.extend({ to: z.string().max(320), subject: z.string().max(500), body: z.string().max(2000), resendUnconfirmed: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      assertFirstTenOpen(ctx.req);
      const { journey } = await requireJourney(input);
      const outcome = await sendDraft(journey, input, { to: input.to, subject: input.subject, body: input.body }, { resendUnconfirmed: input.resendUnconfirmed });
      return { outcome, chapter: await chapterView(journey) };
    }),

  /** Settle a send whose answer was lost, or look in the person's own Sent folder for a message that left another way. */
  verifyDraft: publicProcedure.input(credentials).mutation(async ({ ctx, input }) => {
    assertFirstTenOpen(ctx.req);
    const { journey } = await requireJourney(input);
    await verifyDraft(journey);
    return chapterView(journey);
  }),

  /** "Your first chapter": the new entry on the person's portrait, and what Claire last said about it. */
  firstChapter: publicProcedure.input(credentials).query(async ({ ctx, input }) => {
    assertFirstTenOpen(ctx.req);
    const { journey } = await requireJourney(input);
    return firstChapterView(journey);
  }),

  /** The person returns to their portrait. */
  openFirstChapter: publicProcedure.input(credentials).mutation(async ({ ctx, input }) => {
    assertFirstTenOpen(ctx.req);
    const { journey } = await requireJourney(input);
    return openFirstChapter(journey);
  }),

  /** "Where did we leave things with Elena?", answered from the records, in the person's own time zone. */
  askClaire: publicProcedure
    .input(credentials.extend({ timeZone: z.string().trim().max(64).optional() }))
    .mutation(async ({ ctx, input }) => {
      assertFirstTenOpen(ctx.req);
      const { journey } = await requireJourney(input);
      return askClaire(journey, input.timeZone ?? null);
    }),

  /** Luma's photograph: the person's own image, shown only to them, fetched when asked and never stored. */
  findingPicture: publicProcedure
    .input(credentials.extend({ findingId: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      assertFirstTenOpen(ctx.req);
      const { journey } = await requireJourney(input);
      return findingPicture(journey, input.findingId);
    }),
});
