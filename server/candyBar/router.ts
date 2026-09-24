import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { CANDY_BAR_ALLOWED_REPOSITORY } from "../../shared/candyBar";
import { getCandyBarOrchestrator } from "./runtime";

export const candyBarRouter = router({
  getWorkflow: adminProcedure.query(async ({ ctx }) => {
    const orch = getCandyBarOrchestrator();
    return orch.storeGetWorkflow({
      tenantId: ctx.tenantId,
      operatorUserId: ctx.user.openId,
    });
  }),

  setCurrentGoal: adminProcedure
    .input(
      z.object({
        currentGoal: z.string().trim().min(8).max(8000),
        repository: z.literal(CANDY_BAR_ALLOWED_REPOSITORY).optional(),
        autoPlanNext: z.boolean().optional(),
        allowOpenAiForArchitect: z.boolean().optional(),
        allowOpenAiForReviewer: z.boolean().optional(),
        allowOpenAiForEngineer: z.boolean().optional(),
        roadmapContext: z.string().max(8000).nullable().optional(),
        protectedAreas: z.array(z.string().max(500)).max(50).optional(),
        knownParallelWork: z.array(z.string().max(500)).max(50).optional(),
        nonGoals: z.array(z.string().max(500)).max(50).optional(),
        budgetCents: z.number().int().positive().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const orch = getCandyBarOrchestrator();
      return orch.setCurrentGoal({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        actorUserId: ctx.user.openId,
        currentGoal: input.currentGoal,
        repository: input.repository,
        policy: {
          autoPlanNext: input.autoPlanNext,
          roadmapContext: input.roadmapContext ?? null,
          protectedAreas: input.protectedAreas,
          knownParallelWork: input.knownParallelWork,
          nonGoals: input.nonGoals,
          budgetCents: input.budgetCents ?? null,
          providerFallbackPolicy: {
            allowOpenAiForArchitect: input.allowOpenAiForArchitect ?? false,
            allowOpenAiForReviewer: input.allowOpenAiForReviewer ?? false,
            allowOpenAiForEngineer: input.allowOpenAiForEngineer ?? true,
          },
        },
      });
    }),

  createRun: adminProcedure
    .input(
      z.object({
        currentGoal: z.string().trim().min(8).max(8000).optional(),
        autoPlanNext: z.boolean().optional(),
        allowOpenAiForArchitect: z.boolean().optional(),
        allowOpenAiForReviewer: z.boolean().optional(),
        allowOpenAiForEngineer: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const orch = getCandyBarOrchestrator();
      return orch.createRun({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        currentGoal: input.currentGoal,
        policy: {
          autoPlanNext: input.autoPlanNext,
          providerFallbackPolicy: {
            allowOpenAiForArchitect: input.allowOpenAiForArchitect ?? false,
            allowOpenAiForReviewer: input.allowOpenAiForReviewer ?? false,
            allowOpenAiForEngineer: input.allowOpenAiForEngineer ?? true,
          },
        },
      });
    }),

  getRun: adminProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const orch = getCandyBarOrchestrator();
      return orch.getReadModel({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        runId: input.runId,
      });
    }),

  listRuns: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const orch = getCandyBarOrchestrator();
      return orch.storeListRuns({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        limit: input?.limit,
      });
    }),

  cancel: adminProcedure
    .input(z.object({ runId: z.string().uuid(), reason: z.string().max(1000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const orch = getCandyBarOrchestrator();
      return orch.cancelRun({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        runId: input.runId,
        actorUserId: ctx.user.openId,
        reason: input.reason,
      });
    }),

  approveContinuation: adminProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const orch = getCandyBarOrchestrator();
      return orch.approveContinuation({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        runId: input.runId,
        actorUserId: ctx.user.openId,
      });
    }),

  tick: adminProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const orch = getCandyBarOrchestrator();
      const run = await orch.getReadModel({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        runId: input.runId,
      });
      if (!run) return null;
      return orch.tickRun(input.runId);
    }),
});
