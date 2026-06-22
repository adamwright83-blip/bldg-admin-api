import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { createProcurementPool } from "./migrations";
import { PostConsentActionPlanStore } from "./postConsentActionPlanStore";

type PlanStore = Pick<PostConsentActionPlanStore, "runPlan" | "getPlanByConsentId" | "getDraftByPlanId" | "listPlans">;
let lazyStore: PostConsentActionPlanStore | null = null;

function resolveStore(injected?: PlanStore): PlanStore {
  if (injected) return injected;
  if (!lazyStore) lazyStore = new PostConsentActionPlanStore(createProcurementPool());
  return lazyStore;
}

/**
 * Admin read/run surface for the post-consent planner. No send button --
 * this slice creates an internal draft at most, never a send-review gate
 * or a send attempt. `run` is the only mutation, and it only evaluates the
 * deterministic planner and, when safe, persists a draft -- it never sends,
 * contacts, books, pays, dispatches, or completes anything.
 */
export function createPostConsentActionPlanRouter(injectedStore?: PlanStore) {
  return router({
    list: adminProcedure.input(z.object({
      limit: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).max(1000).default(0),
    }).default({ limit: 20, offset: 0 })).query(({ input }) => resolveStore(injectedStore).listPlans(input)),

    get: adminProcedure.input(z.object({ consentId: z.string().min(1).max(191) })).query(async ({ input }) => {
      const plan = await resolveStore(injectedStore).getPlanByConsentId(input.consentId);
      if (!plan) return { plan: null, draft: null };
      const draft = await resolveStore(injectedStore).getDraftByPlanId(plan.id);
      return { plan, draft };
    }),

    run: adminProcedure.input(z.object({ consentId: z.string().min(1).max(191) })).mutation(async ({ input, ctx }) => {
      try {
        const { decision, plan, draft } = await resolveStore(injectedStore).runPlan({
          id: crypto.randomUUID(), consentId: input.consentId, createdBy: `admin:${ctx.user?.id ?? "unknown"}`,
        });
        return { decision, plan, draft };
      } catch (error) {
        if (error instanceof Error && error.message === "Resident proposal consent not found") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Resident proposal consent not found" });
        }
        throw error;
      }
    }),
  });
}

export const postConsentActionPlanRouter = createPostConsentActionPlanRouter();
