import { z } from "zod";
import { dayforgeTenantMemberProcedure, router } from "../_core/trpc";
import {
  acceptProposal,
  getDayDirectorState,
  proposeCommitment,
  setPromptState,
} from "./dayDirectorService";
import { dayDirectorActorId } from "./dayDirectorActor";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const proposal = z.object({
  promptKey: z.string().min(1).max(191),
  title: z.string().min(1).max(255),
  kind: z.enum(["growth", "prep", "operations"]),
  quantity: z.number().int().positive().nullable(),
  sourceText: z.string().min(1).max(2000),
  prerequisites: z.array(z.string().max(255)).max(3),
  question: z.string().max(500).nullable(),
  intelligence: z.enum(["anthropic", "manual_fallback"]),
});
export const dayDirectorRouter = router({
  state: dayforgeTenantMemberProcedure
    .input(z.object({ businessDate: date }))
    .query(({ ctx, input }) =>
      getDayDirectorState({
        tenantId: ctx.tenantId,
        actorId: dayDirectorActorId(ctx),
        ...input,
      })
    ),
  propose: dayforgeTenantMemberProcedure
    .input(z.object({ sourceText: z.string().trim().min(1).max(2000) }))
    .mutation(({ ctx, input }) =>
      proposeCommitment({ tenantId: ctx.tenantId, ...input })
    ),
  accept: dayforgeTenantMemberProcedure
    .input(z.object({ businessDate: date, proposal }))
    .mutation(({ ctx, input }) =>
      acceptProposal({
        tenantId: ctx.tenantId,
        actorId: dayDirectorActorId(ctx),
        ...input,
      })
    ),
  dismiss: dayforgeTenantMemberProcedure
    .input(
      z.object({ businessDate: date, promptKey: z.string().min(1).max(191) })
    )
    .mutation(({ ctx, input }) =>
      setPromptState({
        tenantId: ctx.tenantId,
        actorId: dayDirectorActorId(ctx),
        state: "dismissed",
        ...input,
      })
    ),
});
