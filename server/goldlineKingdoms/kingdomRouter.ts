/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { z } from "zod";
import { adminProcedure, legacyDayforgeTenantMemberProcedure, router } from "../_core/trpc";
import {
  getKingdom,
  selectKingdomCampaign,
  setKingdomCompanion,
  setKingdomStatus,
} from "./kingdomService";
import { seedGoldlineKingdoms } from "./seedKingdoms";
import { deriveKingdomStatuses } from "./kingdomUnlocks";
import { LANTERN_CITY_STATUSES } from "./kingdomTypes";
import { dayDirectorActorId } from "../dayDirector/dayDirectorActor";

export const kingdomRouter = router({
  /** Self-healing: derives real Kingdom-completion status on every read. */
  list: legacyDayforgeTenantMemberProcedure.query(({ ctx }) =>
    deriveKingdomStatuses({ tenantId: ctx.tenantId, operatorId: dayDirectorActorId(ctx) })
  ),
  get: legacyDayforgeTenantMemberProcedure
    .input(z.object({ kingdomId: z.string() }))
    .query(({ ctx, input }) => getKingdom({ tenantId: ctx.tenantId, ...input })),
  seedDefaults: adminProcedure.mutation(async ({ ctx }) => {
    await seedGoldlineKingdoms(ctx.tenantId ?? "default");
    return deriveKingdomStatuses({
      tenantId: ctx.tenantId ?? "default",
      operatorId: dayDirectorActorId(ctx),
    });
  }),
  selectCampaign: adminProcedure
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
  setCompanion: adminProcedure
    .input(z.object({ kingdomId: z.string(), companionEarnedId: z.string() }))
    .mutation(({ ctx, input }) =>
      setKingdomCompanion({ tenantId: ctx.tenantId ?? "default", ...input })
    ),
  setStatus: adminProcedure
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
