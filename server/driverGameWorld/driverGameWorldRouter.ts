import { z } from "zod";
import { dayforgeMissionFieldProcedure, router } from "../_core/trpc";
import {
  beginDriverRekindle,
  listDriverGameWorld,
} from "./driverGameWorldService";

export const driverGameWorldRouter = router({
  current: dayforgeMissionFieldProcedure.query(({ ctx }) =>
    listDriverGameWorld({
      tenantId: ctx.tenantId,
      actorId: ctx.user.openId,
    })
  ),
  beginRekindle: dayforgeMissionFieldProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        requestId: z.string().uuid(),
      })
    )
    .mutation(({ ctx, input }) =>
      beginDriverRekindle({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        missionId: input.missionId,
      })
    ),
});
