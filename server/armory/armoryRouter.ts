import { z } from "zod";
import {
  dayforgeMissionFieldProcedure,
  dayforgeTenantMemberProcedure,
  router,
} from "../_core/trpc";
import {
  OBJECTION_ARCHETYPES,
  SALES_INTEL_CHANNELS,
} from "../../shared/salesIntel";
import { getArmory } from "./armoryService";
import { listArmoryWeapons } from "./armoryWeaponService";
import { recordArmoryWeaponUsage } from "./armoryEvidenceService";

/**
 * Gameplay-side Armory. Drivers CONSUME intelligence here; corpus
 * administration lives behind `adminProcedure` in `salesIntelRouter` and is
 * unreachable from these procedures.
 */
export const armoryRouter = router({
  get: dayforgeTenantMemberProcedure
    .input(
      z
        .object({ accountType: z.string().trim().min(1).max(96).optional() })
        .default({})
    )
    .query(({ ctx, input }) =>
      getArmory({ ...input, tenantId: ctx.tenantId, userId: ctx.user.openId })
    ),

  /**
   * Contextual loadout for one encounter. The same archetype on a different
   * channel legitimately returns a different set.
   */
  weapons: dayforgeMissionFieldProcedure
    .input(
      z.object({
        archetype: z.enum(OBJECTION_ARCHETYPES),
        channel: z.enum(SALES_INTEL_CHANNELS),
        missionId: z.number().int().positive().nullish(),
        limit: z.number().int().min(1).max(6).optional(),
      })
    )
    .query(({ ctx, input }) =>
      listArmoryWeapons({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        archetype: input.archetype,
        channel: input.channel,
        missionId: input.missionId ?? null,
        limit: input.limit,
      })
    ),

  /** Records that a weapon was chosen in a real encounter. */
  recordUsage: dayforgeMissionFieldProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        weaponId: z.string().trim().min(1).max(191),
        frameworkId: z.string().uuid().nullish(),
        archetype: z.enum(OBJECTION_ARCHETYPES),
        channel: z.enum(SALES_INTEL_CHANNELS),
        provenanceKind: z.enum([
          "trainer_source",
          "personal_evidence",
          "foundation",
        ]),
        requestId: z.string().uuid(),
      })
    )
    .mutation(({ ctx, input }) =>
      recordArmoryWeaponUsage({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        missionId: input.missionId,
        weaponId: input.weaponId,
        frameworkId: input.frameworkId ?? null,
        archetype: input.archetype,
        channel: input.channel,
        provenanceKind: input.provenanceKind,
        requestId: input.requestId,
      })
    ),
});
