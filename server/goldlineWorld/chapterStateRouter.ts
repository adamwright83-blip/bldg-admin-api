import { z } from "zod";
import { dayforgeTenantOperatorProcedure, router } from "../_core/trpc";
import { goldlineChapterFictionStateSchema } from "../../shared/goldlineChapterState";
import {
  ChapterStateRevisionConflictError,
  getChapterState,
  saveChapterState,
} from "./chapterStateService";

const chapterIdInput = z.object({ chapterId: z.string().min(1).max(64) });

export const chapterStateRouter = router({
  get: dayforgeTenantOperatorProcedure
    .input(chapterIdInput)
    .query(async ({ ctx, input }) =>
      getChapterState({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        chapterId: input.chapterId,
      })
    ),
  save: dayforgeTenantOperatorProcedure
    .input(
      z.object({
        chapterId: z.string().min(1).max(64),
        expectedRevision: z.number().int().min(0),
        state: goldlineChapterFictionStateSchema,
        requestId: z.string().min(1).max(80),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return {
          ok: true as const,
          ...(await saveChapterState({
            tenantId: ctx.tenantId,
            operatorId: ctx.user.openId,
            chapterId: input.chapterId,
            expectedRevision: input.expectedRevision,
            state: input.state,
            requestId: input.requestId,
          })),
        };
      } catch (error) {
        if (error instanceof ChapterStateRevisionConflictError) {
          return { ok: false as const, latest: error.latest };
        }
        throw error;
      }
    }),
});
