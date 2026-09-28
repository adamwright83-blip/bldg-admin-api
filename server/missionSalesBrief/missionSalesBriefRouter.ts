/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { z } from "zod";
import { legacyDayforgeMissionFieldProcedure, router } from "../_core/trpc";
import {
  toFieldMissionSalesBrief,
} from "../../shared/missionSalesBrief";
import {
  ensureCurrentMissionSalesBrief,
  listMissionSalesBriefVersions,
} from "./missionSalesBriefService";
import { getClairePreVisitIntel } from "./clairePreVisitIntel";

/**
 * The FIELD BRIEF surface's read of the same artifact Claire consumes.
 * Both call `ensureCurrentMissionSalesBrief` — this router never compiles
 * its own strategy.
 */
export const missionSalesBriefRouter = router({
  fieldBrief: legacyDayforgeMissionFieldProcedure
    .input(z.object({ missionId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const brief = await ensureCurrentMissionSalesBrief({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      });
      return brief ? toFieldMissionSalesBrief(brief) : null;
    }),

  /**
   * Claire's three pre-visit equips. This is a recommendation surface over the
   * same authoritative mission brief + accepted Sales Intel corpus; it cannot
   * create business truth or persist a visit outcome.
   */
  preVisitIntel: legacyDayforgeMissionFieldProcedure
    .input(z.object({ missionId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      getClairePreVisitIntel({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      })
    ),

  // Admin/developer review tooling (Slice 17): inspect every version to
  // confirm Claire and FIELD BRIEF converged on the same artifact and to
  // see why a strategy changed between versions.
  versions: legacyDayforgeMissionFieldProcedure
    .input(z.object({ missionId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      listMissionSalesBriefVersions({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      })
    ),
});
