import { z } from "zod";
import { dayforgeTenantMemberProcedure, router } from "../_core/trpc";
import {
  getOrCreateDay1TenDoorsMission,
  recordDay1TenDoorsOutcome,
} from "./day1TenDoorsService";

export const day1TenDoorsRouter = router({
  current: dayforgeTenantMemberProcedure.query(({ ctx }) =>
    getOrCreateDay1TenDoorsMission({
      tenantId: ctx.tenantId,
      driverId: ctx.user.openId,
    })
  ),
  recordOutcome: dayforgeTenantMemberProcedure
    .input(
      z.object({
        missionId: z.string().uuid(),
        targetId: z.string().trim().min(1).max(80),
        outcome: z.enum(["pitched", "couldnt_reach"]),
      })
    )
    .mutation(({ ctx, input }) =>
      recordDay1TenDoorsOutcome({
        ...input,
        tenantId: ctx.tenantId,
        driverId: ctx.user.openId,
      })
    ),
});
