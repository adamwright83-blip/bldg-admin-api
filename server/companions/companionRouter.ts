/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { z } from "zod";
import { adminProcedure, legacyLegacyDayforgeTenantMemberProcedure, router } from "../_core/trpc";
import {
  earnCompanion,
  getCompanion,
  isCompanionEarned,
  listCompanions,
  listUnlocks,
  seedCompanionRoster,
} from "./companionService";

export const companionRouter = router({
  roster: legacyLegacyDayforgeTenantMemberProcedure.query(({ ctx }) =>
    listCompanions({ tenantId: ctx.tenantId })
  ),
  get: legacyLegacyDayforgeTenantMemberProcedure
    .input(z.object({ companionId: z.string() }))
    .query(({ ctx, input }) => getCompanion({ tenantId: ctx.tenantId, ...input })),
  seedDefaults: adminProcedure.mutation(async ({ ctx }) =>
    seedCompanionRoster({ tenantId: ctx.tenantId ?? "default" })
  ),
  myUnlocks: legacyLegacyDayforgeTenantMemberProcedure.query(({ ctx }) =>
    listUnlocks({ tenantId: ctx.tenantId, operatorId: String(ctx.user.id) })
  ),
  isEarned: legacyLegacyDayforgeTenantMemberProcedure
    .input(z.object({ companionId: z.string() }))
    .query(({ ctx, input }) =>
      isCompanionEarned({
        tenantId: ctx.tenantId,
        operatorId: String(ctx.user.id),
        ...input,
      })
    ),
  earn: legacyLegacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        companionId: z.string(),
        kingdomId: z.string(),
        campaignId: z.string(),
        evidenceOpsTaskId: z.number().int().positive(),
      })
    )
    .mutation(({ ctx, input }) =>
      earnCompanion({
        tenantId: ctx.tenantId,
        operatorId: String(ctx.user.id),
        ...input,
      })
    ),
});
