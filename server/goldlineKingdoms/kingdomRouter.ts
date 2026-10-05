/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { z } from "zod";
import { legacyAdminRoleProcedure, legacyDayforgeTenantMemberProcedure, router } from "../_core/trpc";
import {
  getKingdom,
  selectKingdomCampaign,
  setKingdomCompanion,
  setKingdomStatus,
} from "./kingdomService";
import { seedGoldlineKingdoms } from "./seedKingdoms";
import { deriveKingdomStatuses } from "./kingdomUnlocks";
import { LANTERN_CITY_STATUSES } from "./kingdomTypes";

export const kingdomRouter = router({
  /** Uses the same durable openId key as Day 1 Ten Doors. */
  list: legacyDayforgeTenantMemberProcedure.query(({ ctx }) =>
    deriveKingdomStatuses({ tenantId: ctx.tenantId, operatorId: ctx.user.openId })
  ),
  get: legacyDayforgeTenantMemberProcedure
    .input(z.object({ kingdomId: z.string() }))
    .query(({ ctx, input }) => getKingdom({ tenantId: ctx.tenantId, ...input })),
  seedDefaults: legacyAdminRoleProcedure.mutation(async ({ ctx }) => {
    await seedGoldlineKingdoms(ctx.tenantId ?? "default");
    return deriveKingdomStatuses({
      tenantId: ctx.tenantId ?? "default",
      operatorId: ctx.user.openId,
    });
  }),
  selectCampaign: legacyAdminRoleProcedure
    .input(
      z.object({
        kingdomId: z.string(),
        realCampaignId: z.string(),
        capabilityRequirement: z.string().min(1).max(512),
      })
    )
    .mutation(({ ctx, input }) =>
      selectKingdomCampaign({ tenantId: ctx.tenantId ?? "default", ...input })
    ),
  setCompanion: legacyAdminRoleProcedure
    .input(z.object({ kingdomId: z.string(), companionEarnedId: z.string() }))
    .mutation(({ ctx, input }) =>
      setKingdomCompanion({ tenantId: ctx.tenantId ?? "default", ...input })
    ),
  setStatus: legacyAdminRoleProcedure
    .input(
      z.object({
        kingdomId: z.string(),
        lanternCityStatus: z.enum(LANTERN_CITY_STATUSES),
      })
    )
    .mutation(({ ctx, input }) =>
      setKingdomStatus({ tenantId: ctx.tenantId ?? "default", ...input })
    ),
});
