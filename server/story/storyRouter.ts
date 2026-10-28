import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { STORY_OUTCOMES } from "../../shared/story";
import { requireCanonicalOperatorIdentityForUser } from "../agents/persistentOperator/identity";
import { legacyDayforgeTenantOperatorProcedure, router } from "../_core/trpc";
import { getDashboardTimeZone } from "../dashboardZoned";
import { activeStorySeasonSlug, isStoryEnabledForTenant } from "./storyFlag";
import { createStoryService, StoryAccessError, type StoryAccessReason, type StoryWho } from "./storyService";
import { drizzleStoryStore, StoryStoreUnavailableError } from "./storyStore";

/**
 * system.story.*: the only procedures a story request may reach (see storyIsolation.ts). Signed-in operators only;
 * each login plays its own season, keyed by the canonical operator id.
 */

const service = createStoryService({
  store: drizzleStoryStore,
  now: () => new Date(),
  timeZone: getDashboardTimeZone,
  isEnabled: tenantId => isStoryEnabledForTenant(tenantId),
  seasonSlug: () => activeStorySeasonSlug(),
});

const CODE: Record<StoryAccessReason, TRPCError["code"]> = {
  not_enabled: "FORBIDDEN",
  no_season: "NOT_FOUND",
  chapter_locked: "FORBIDDEN",
  unknown_question: "NOT_FOUND",
  question_locked: "FORBIDDEN",
  unknown_option: "BAD_REQUEST",
  already_answered: "CONFLICT",
};

async function who(ctx: { tenantId: string; user: { id?: unknown; openId: string; role: any } }): Promise<StoryWho> {
  const identity = await requireCanonicalOperatorIdentityForUser({ tenantId: ctx.tenantId, user: ctx.user, subsystem: "story" });
  return { tenantId: ctx.tenantId, operatorId: identity.canonicalOperatorId };
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof StoryAccessError) throw new TRPCError({ code: CODE[error.reason], message: error.reason });
    if (error instanceof StoryStoreUnavailableError) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "story storage unavailable" });
    throw error;
  }
}

const chapterNumber = z.number().int().min(1).max(99);
const key = z.string().trim().min(1).max(64);

export const storyRouter = router({
  /** Tonight's chapter as this operator should see it, or `{ enabled: false }`. Never throws for a disabled tenant. */
  tonight: legacyDayforgeTenantOperatorProcedure.query(({ ctx }) => guarded(async () => service.tonight(await who(ctx)))),

  /** Open tonight's chapter. Refused for any chapter that is not the next one on a night it is open. */
  start: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ chapterNumber }))
    .mutation(({ ctx, input }) => guarded(async () => service.start(await who(ctx), input.chapterNumber))),

  /** Report how the game ended. Only a win on the open chapter advances; a retried win returns the same ending. */
  finish: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ chapterNumber, outcome: z.enum(STORY_OUTCOMES), durationMs: z.number().int().min(0).max(86_400_000).nullable().optional() }))
    .mutation(({ ctx, input }) => guarded(async () => service.finish(await who(ctx), input))),

  /** Record the answer to a won chapter's question. Final: the same answer again is accepted, a different one refused. */
  answer: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ questionKey: key, optionKey: key }))
    .mutation(({ ctx, input }) => guarded(async () => service.answer(await who(ctx), input))),
});
