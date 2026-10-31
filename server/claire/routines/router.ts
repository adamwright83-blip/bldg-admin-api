import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { legacyDayforgeTenantOperatorProcedure, router } from "../../_core/trpc";
import { isValidTimeZone, MAX_ROUTINE_INSTRUCTION, parseRoutineInstruction } from "../../../shared/claireRoutines";
import { runRoutineNow } from "./runner";
import { changeRoutineStatus, createRoutine, listRoutineViews, type RoutineChangeResult } from "./service";

const timeZone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, { message: "Unknown time zone" });
const instruction = z.string().max(MAX_ROUTINE_INSTRUCTION * 2);
const routineId = z.object({ id: z.string().uuid() });

const changed = (result: RoutineChangeResult) => {
  if ("notFound" in result) throw new TRPCError({ code: "NOT_FOUND", message: "No such routine in this workspace." });
  if ("refused" in result) throw new TRPCError({ code: "PRECONDITION_FAILED", message: result.refused });
  return result.routine;
};

/**
 * system.claireRoutines: the workspace's recurring checks, in the operator's words. Only the members who run the
 * business, and only this workspace's routines: every read and change is scoped to ctx.tenantId. Routines only read
 * and report; nothing here sends or changes anything outside JOYSTICK.
 */
export const claireRoutinesRouter = router({
  /** Each routine with its latest five runs. */
  list: legacyDayforgeTenantOperatorProcedure.query(({ ctx }) => listRoutineViews(ctx.tenantId)),

  /** What Claire would make of these words, without saving anything. */
  preview: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ instruction, timeZone }))
    .query(({ input }) => parseRoutineInstruction(input.instruction, input.timeZone)),

  /** Saved only when Claire can run it; otherwise the honest refusal comes back, with what she can do. */
  create: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ instruction, timeZone }))
    .mutation(({ ctx, input }) => createRoutine({ tenantId: ctx.tenantId, operatorOpenId: ctx.user.openId, instruction: input.instruction, timeZone: input.timeZone })),

  pause: legacyDayforgeTenantOperatorProcedure.input(routineId).mutation(async ({ ctx, input }) => changed(await changeRoutineStatus(ctx.tenantId, input.id, "pause"))),
  resume: legacyDayforgeTenantOperatorProcedure.input(routineId).mutation(async ({ ctx, input }) => changed(await changeRoutineStatus(ctx.tenantId, input.id, "resume"))),
  stop: legacyDayforgeTenantOperatorProcedure.input(routineId).mutation(async ({ ctx, input }) => changed(await changeRoutineStatus(ctx.tenantId, input.id, "stop"))),

  /** Runs it once now (at most once a minute) and returns that run; its schedule is unchanged. */
  runNow: legacyDayforgeTenantOperatorProcedure.input(routineId).mutation(async ({ ctx, input }) => {
    const result = await runRoutineNow(ctx.tenantId, input.id);
    if ("notFound" in result) throw new TRPCError({ code: "NOT_FOUND", message: "No such routine in this workspace." });
    if ("refused" in result) throw new TRPCError({ code: "PRECONDITION_FAILED", message: result.refused });
    return result.run;
  }),
});
