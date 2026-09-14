import { z } from "zod";
import { dayforgeMissionFieldProcedure, router } from "../_core/trpc";
import {
  toFieldMissionSalesBrief,
} from "../../shared/missionSalesBrief";
import {
  ensureCurrentMissionSalesBrief,
  listMissionSalesBriefVersions,
} from "./missionSalesBriefService";

/**
 * The FIELD BRIEF surface's read of the same artifact Claire consumes.
 * Both call `ensureCurrentMissionSalesBrief` — this router never compiles
 * its own strategy.
 */
export const missionSalesBriefRouter = router({
  fieldBrief: dayforgeMissionFieldProcedure
    .input(z.object({ missionId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const brief = await ensureCurrentMissionSalesBrief({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      });
      return brief ? toFieldMissionSalesBrief(brief) : null;
    }),

  // Admin/developer review tooling (Slice 17): inspect every version to
  // confirm Claire and FIELD BRIEF converged on the same artifact and to
  // see why a strategy changed between versions.
  versions: dayforgeMissionFieldProcedure
    .input(z.object({ missionId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      listMissionSalesBriefVersions({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      })
    ),
});
