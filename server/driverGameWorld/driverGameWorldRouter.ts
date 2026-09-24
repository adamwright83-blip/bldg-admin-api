/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { legacyLegacyDayforgeMissionFieldProcedure, router } from "../_core/trpc";
import {
  beginDriverRekindle,
  listDriverGameWorld,
} from "./driverGameWorldService";
import {
  evaluateAndPersistMutation,
  evidenceFromWorldNode,
  getLatestMutation,
} from "./missionMutationService";
import {
  breakColdCallCombo,
  completeColdCallTarget,
  createColdCallBatch,
  getColdCallBurstState,
  getColdCallRollingCall,
  rollColdCallTarget,
  selectColdCallChainTarget,
} from "./coldCallBurstService";
import { ColdCallCallerIdUnverifiedError } from "../salesCalls";
import { ProspectLegNotConnectedError } from "../../shared/coldCallBurst";
import { COMMERCIAL_MISSION_CALL_OUTCOMES } from "../commercialMissions/commercialMissionCallService";
import { evaluateExpansionScoutForIdentity } from "../capabilities/expansionScoutCapability";
import {
  getLatestScoutReport,
  runExpansionScout,
} from "./expansionScoutService";
import { GooglePlacesTerritoryProvider } from "../territory/googlePlacesTerritoryProvider";
import { projectGoldlineProgressionForIdentity } from "./progressionProjectionService";

function scoutProvider() {
  const key =
    process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY ?? "";
  if (!key)
    throw new Error("Google Places is not configured for Expansion Scout");
  return new GooglePlacesTerritoryProvider(key);
}

export const driverGameWorldRouter = router({
  current: legacyLegacyDayforgeMissionFieldProcedure.query(({ ctx }) =>
    listDriverGameWorld({
      tenantId: ctx.tenantId,
      actorId: ctx.user.openId,
    })
  ),
  progression: legacyLegacyDayforgeMissionFieldProcedure.query(({ ctx }) =>
    projectGoldlineProgressionForIdentity({
      tenantId: ctx.tenantId,
      actorId: ctx.user.openId,
    })
  ),
  /**
   * Evaluates the mission mutation library against the same authoritative
   * evidence the world read path already computes. Idempotent — calling this
   * repeatedly against unchanged evidence never creates a duplicate mutation
   * or a different world outcome.
   */
  evaluateMutation: legacyLegacyDayforgeMissionFieldProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        hasDecisionMakerContact: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const world = await listDriverGameWorld({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      });
      const node = world.find(item => item.missionId === input.missionId);
      if (!node)
        throw new Error("Commercial mission not found in this field world");
      return evaluateAndPersistMutation({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        missionId: input.missionId,
        evidence: evidenceFromWorldNode(node, input.hasDecisionMakerContact),
        businessReferences: node.lossReason ? [node.lossReason] : [],
      });
    }),
  latestMutation: legacyLegacyDayforgeMissionFieldProcedure
    .input(z.object({ missionId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      getLatestMutation({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        missionId: input.missionId,
      })
    ),
  beginRekindle: legacyLegacyDayforgeMissionFieldProcedure
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
  coldCall: legacyLegacyDayforgeMissionFieldProcedure.query(({ ctx }) =>
    getColdCallBurstState({
      tenantId: ctx.tenantId,
      actorId: ctx.user.openId,
    })
  ),
  createColdCallBatch: legacyLegacyDayforgeMissionFieldProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      createColdCallBatch({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        requestId: input.requestId,
      })
    ),
  startColdCallTarget: legacyLegacyDayforgeMissionFieldProcedure
    .input(
      z.object({
        batchId: z.string().uuid(),
        targetId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await rollColdCallTarget({
          ...input,
          tenantId: ctx.tenantId,
          actorId: ctx.user.openId,
        });
      } catch (error) {
        if (error instanceof ColdCallCallerIdUnverifiedError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error.message,
          });
        }
        throw error;
      }
    }),
  coldCallRollingCall: legacyLegacyDayforgeMissionFieldProcedure
    .input(
      z.object({
        batchId: z.string().uuid(),
        targetId: z.string().uuid(),
      })
    )
    .query(({ ctx, input }) =>
      getColdCallRollingCall({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),
  completeColdCallTarget: legacyLegacyDayforgeMissionFieldProcedure
    .input(
      z.object({
        batchId: z.string().uuid(),
        targetId: z.string().uuid(),
        requestId: z.string().uuid(),
        outcome: z.enum(COMMERCIAL_MISSION_CALL_OUTCOMES),
        notes: z.string().trim().min(1).max(2_000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await completeColdCallTarget({
          ...input,
          tenantId: ctx.tenantId,
          actorId: ctx.user.openId,
        });
      } catch (error) {
        if (error instanceof ProspectLegNotConnectedError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    }),
  selectColdCallChainTarget: legacyLegacyDayforgeMissionFieldProcedure
    .input(
      z.object({
        batchId: z.string().uuid(),
        targetId: z.string().uuid(),
      })
    )
    .mutation(({ ctx, input }) =>
      selectColdCallChainTarget({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),
  breakColdCallCombo: legacyLegacyDayforgeMissionFieldProcedure
    .input(z.object({ batchId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      breakColdCallCombo({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),
  scoutCapability: legacyLegacyDayforgeMissionFieldProcedure.query(({ ctx }) =>
    evaluateExpansionScoutForIdentity({
      tenantId: ctx.tenantId,
      actorId: ctx.user.openId,
    })
  ),
  latestScoutReport: legacyLegacyDayforgeMissionFieldProcedure.query(({ ctx }) =>
    getLatestScoutReport({
      tenantId: ctx.tenantId,
      actorId: ctx.user.openId,
    })
  ),
  runScout: legacyLegacyDayforgeMissionFieldProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      runExpansionScout({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        requestId: input.requestId,
        provider: scoutProvider(),
      })
    ),
});
