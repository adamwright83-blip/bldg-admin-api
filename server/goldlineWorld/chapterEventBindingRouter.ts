import { z } from "zod";
import { dayforgeTenantOperatorProcedure, router } from "../_core/trpc";
import { getTowerWarsToday } from "../towerWars/towerWarsService";
import {
  armChapterEventBinding,
  getChapterEventBinding,
  reconcileChapterEventBinding,
} from "./chapterEventBindingService";

const bindingInput = z.object({
  chapterId: z.string().min(1).max(64),
  buildingId: z.enum(["opus_la", "century_park_east"]),
});

export const chapterEventBindingRouter = router({
  get: dayforgeTenantOperatorProcedure
    .input(bindingInput)
    .query(({ ctx, input }) =>
      getChapterEventBinding({ tenantId: ctx.tenantId, chapterId: input.chapterId, buildingId: input.buildingId })
    ),
  arm: dayforgeTenantOperatorProcedure
    .input(bindingInput)
    .mutation(({ ctx, input }) =>
      armChapterEventBinding({ tenantId: ctx.tenantId, chapterId: input.chapterId, buildingId: input.buildingId })
    ),
  /**
   * Safe to call on every load, including after the player was offline: it
   * re-fetches today's real canonical ledger and reconciles at most once.
   */
  reconcile: dayforgeTenantOperatorProcedure
    .input(bindingInput)
    .mutation(async ({ ctx, input }) => {
      const today = await getTowerWarsToday({ tenantId: ctx.tenantId });
      return reconcileChapterEventBinding({
        tenantId: ctx.tenantId,
        chapterId: input.chapterId,
        buildingId: input.buildingId,
        candidateEvents: today.ledger,
      });
    }),
});
