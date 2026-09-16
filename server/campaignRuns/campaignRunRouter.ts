/**
 * Campaign Run router. docs/goldline/FICTION_PACKS.md section 2.
 *
 * Note what is missing and will stay missing: there is no endpoint that sets
 * progress, completes a run directly, or marks a target placed without naming
 * the territory-presence event behind it. Completion is computed from evidence
 * or it does not happen.
 */
import { z } from "zod";
import {
  adminProcedure,
  dayforgeTenantMemberProcedure,
  router,
} from "../_core/trpc";
import { PLACEMENT_POINTS, TARGET_SOURCE_CLASSES } from "../../shared/campaignRun";
import { listFictionPacks } from "../fictionPacks/fictionPackRegistry";
import {
  freezeTargetSet,
  getRunProjection,
  listTargets,
  recordPlacement,
  recordTerritoryPresence,
  replaceTarget,
  startCampaignRun,
} from "./campaignRunService";

const targetInput = z.object({
  targetId: z.string().min(1).max(64),
  label: z.string().min(1).max(191),
  address: z.string().min(1).max(512),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  placementPoint: z.enum(PLACEMENT_POINTS),
  sourceNote: z.string().min(1).max(512),
  provenance: z.enum(TARGET_SOURCE_CLASSES),
});

export const campaignRunRouter = router({
  listPacks: dayforgeTenantMemberProcedure
    .input(z.object({}).optional())
    .query(() =>
      listFictionPacks().map(pack => ({
        id: pack.id,
        version: pack.version,
        role: pack.role,
        premise: pack.premise,
      }))
    ),

  listTargets: dayforgeTenantMemberProcedure
    .input(z.object({ targetSetId: z.string() }))
    .query(({ ctx, input }) =>
      listTargets({ tenantId: ctx.tenantId, targetSetId: input.targetSetId })
    ),

  freezeTargets: adminProcedure
    .input(
      z.object({
        targetSetId: z.string().min(1).max(64),
        targets: z.array(targetInput).min(1),
      })
    )
    .mutation(({ ctx, input }) =>
      freezeTargetSet({
        tenantId: ctx.tenantId ?? "default",
        targetSetId: input.targetSetId,
        targets: input.targets,
      })
    ),

  start: adminProcedure
    .input(
      z.object({
        campaignId: z.string().min(1).max(64),
        campaignVersion: z.number().int().positive().optional(),
        targetSetId: z.string().min(1).max(64),
        fictionPackId: z.string().max(64).nullable().optional(),
        fictionPackVersion: z.number().int().positive().nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      startCampaignRun({
        tenantId: ctx.tenantId ?? "default",
        operatorUserId: ctx.user.openId,
        ...input,
      })
    ),

  projection: dayforgeTenantMemberProcedure
    .input(
      z.object({
        campaignRunId: z.string(),
        campaignHasFailureCondition: z.boolean().optional(),
        failureConditionMet: z.boolean().optional(),
      })
    )
    .query(({ ctx, input }) =>
      getRunProjection({ tenantId: ctx.tenantId, ...input })
    ),

  recordPresence: dayforgeTenantMemberProcedure
    .input(
      z.object({
        campaignRunId: z.string(),
        occurredAt: z.string().optional(),
        note: z.string().max(512).nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      recordTerritoryPresence({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        ...input,
      })
    ),

  recordPlacement: dayforgeTenantMemberProcedure
    .input(
      z.object({
        campaignRunId: z.string(),
        targetId: z.string().min(1).max(64),
        supportingPresenceEventId: z.string().min(1),
        occurredAt: z.string().optional(),
        note: z.string().max(512).nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      recordPlacement({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        ...input,
      })
    ),

  replaceTarget: dayforgeTenantMemberProcedure
    .input(
      z.object({
        campaignRunId: z.string(),
        targetId: z.string().min(1).max(64),
        replacementTargetId: z.string().min(1).max(64),
        note: z.string().min(1).max(512),
      })
    )
    .mutation(({ ctx, input }) =>
      replaceTarget({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        ...input,
      })
    ),
});
