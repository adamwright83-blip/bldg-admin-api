/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
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
  legacyDayforgeTenantMemberProcedure,
  router,
} from "../_core/trpc";
import { PLACEMENT_POINTS, TARGET_SOURCE_CLASSES } from "../../shared/campaignRun";
import { listFictionPacks } from "../fictionPacks/fictionPackRegistry";
import { getDb } from "../db";
import { requireCanonicalOperatorIdentityForUser } from "../persistentOperator/identity";
import { recordPersistentOperatorDiagnosticEvent } from "../persistentOperator/observability";
import {
  freezeTargetSet,
  getRunProjection,
  listOperatorRunsForIdentities,
  listRunSlots,
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

async function campaignIdentity(ctx: {
  tenantId: string;
  user: {
    id?: unknown;
    openId: string;
    role: "admin" | "driver" | "user";
  };
}, subsystem: string) {
  return requireCanonicalOperatorIdentityForUser({
    tenantId: ctx.tenantId,
    user: ctx.user,
    subsystem,
  });
}

function authorizedCampaignOperatorIds(identity: Awaited<ReturnType<typeof campaignIdentity>>) {
  return [...new Set([
    identity.canonicalOpenId,
    identity.sourceOpenId,
    ...identity.aliases.map(alias => alias.openId),
  ])];
}

export const campaignRunRouter = router({
  listPacks: legacyDayforgeTenantMemberProcedure
    .input(z.object({}).optional())
    .query(() =>
      listFictionPacks().map(pack => ({
        id: pack.id,
        version: pack.version,
        role: pack.role,
        premise: pack.premise,
      }))
    ),

  listMine: legacyDayforgeTenantMemberProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      const identity = await campaignIdentity(ctx, "campaign_runs.list");
      const storeAvailable = Boolean(await getDb());
      const runs = await listOperatorRunsForIdentities({
        tenantId: identity.tenantId,
        operatorUserIds: authorizedCampaignOperatorIds(identity),
      });
      await recordPersistentOperatorDiagnosticEvent({
        tenantId: identity.tenantId,
        canonicalOperatorId: identity.canonicalOperatorId,
        operatorUserId: identity.canonicalOpenId,
        subsystem: "campaign_runs.list",
        eventKind: "selection_attempt",
        reason: !storeAvailable ? "source_unavailable" : runs.length === 0 ? "legitimate_no_work" : null,
      }).catch(() => undefined);
      return runs;
    }),

  listRunSlots: legacyDayforgeTenantMemberProcedure
    .input(z.object({ campaignRunId: z.string() }))
    .query(({ ctx, input }) =>
      listRunSlots({ tenantId: ctx.tenantId, ...input })
    ),

  listTargets: legacyDayforgeTenantMemberProcedure
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
        tenantId: ctx.tenantId,
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
    .mutation(async ({ ctx, input }) => {
      const identity = await campaignIdentity(ctx, "campaign_runs.start");
      const run = await startCampaignRun({
        tenantId: identity.tenantId,
        operatorUserId: identity.campaignOperatorUserId,
        ...input,
      });
      if (run) {
        await Promise.all([
          recordPersistentOperatorDiagnosticEvent({
            tenantId: identity.tenantId,
            canonicalOperatorId: identity.canonicalOperatorId,
            operatorUserId: identity.canonicalOpenId,
            subsystem: "campaign_runs.start",
            eventKind: "objective_created",
            objectiveId: run.campaignId,
          }).catch(() => undefined),
          recordPersistentOperatorDiagnosticEvent({
            tenantId: identity.tenantId,
            canonicalOperatorId: identity.canonicalOperatorId,
            operatorUserId: identity.canonicalOpenId,
            subsystem: "campaign_runs.start",
            eventKind: "objective_started",
            objectiveId: run.campaignId,
          }).catch(() => undefined),
        ]);
      }
      return run;
    }),

  projection: legacyDayforgeTenantMemberProcedure
    .input(z.object({ campaignRunId: z.string() }))
    .query(({ ctx, input }) =>
      getRunProjection({ tenantId: ctx.tenantId, ...input })
    ),

  recordPresence: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        campaignRunId: z.string(),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracyMeters: z.number().nonnegative().max(100_000).nullable().optional(),
        note: z.string().max(512).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const identity = await campaignIdentity(ctx, "campaign_runs.presence");
      return recordTerritoryPresence({
        tenantId: identity.tenantId,
        operatorUserId: identity.campaignOperatorUserId,
        authorizedOperatorUserIds: authorizedCampaignOperatorIds(identity),
        ...input,
      });
    }),

  recordPlacement: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        campaignRunId: z.string(),
        targetId: z.string().min(1).max(64),
        supportingPresenceEventId: z.string().min(1),
        note: z.string().max(512).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const identity = await campaignIdentity(ctx, "campaign_runs.placement");
      const result = await recordPlacement({
        tenantId: identity.tenantId,
        operatorUserId: identity.campaignOperatorUserId,
        authorizedOperatorUserIds: authorizedCampaignOperatorIds(identity),
        ...input,
      });
      if (result) {
        const projection = await getRunProjection({
          tenantId: identity.tenantId,
          campaignRunId: input.campaignRunId,
        });
        if (projection?.progress.complete) {
          await recordPersistentOperatorDiagnosticEvent({
            tenantId: identity.tenantId,
            canonicalOperatorId: identity.canonicalOperatorId,
            operatorUserId: identity.canonicalOpenId,
            subsystem: "campaign_runs.placement",
            eventKind: "objective_verified",
            objectiveId: projection.run.campaignId,
          }).catch(() => undefined);
        }
      }
      return result;
    }),

  replaceTarget: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        campaignRunId: z.string(),
        targetId: z.string().min(1).max(64),
        replacementTargetId: z.string().min(1).max(64),
        note: z.string().min(1).max(512),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const identity = await campaignIdentity(ctx, "campaign_runs.replace");
      return replaceTarget({
        tenantId: identity.tenantId,
        operatorUserId: identity.campaignOperatorUserId,
        authorizedOperatorUserIds: authorizedCampaignOperatorIds(identity),
        ...input,
      });
    }),
});
