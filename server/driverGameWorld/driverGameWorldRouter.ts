import { z } from "zod";
import { dayforgeMissionFieldProcedure, router } from "../_core/trpc";
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
  selectColdCallChainTarget,
  startColdCallTarget,
} from "./coldCallBurstService";
import { COMMERCIAL_MISSION_CALL_OUTCOMES } from "../commercialMissions/commercialMissionCallService";
import { evaluateAndPersistExpansionScout } from "../capabilities/expansionScoutCapability";
import {
  getLatestScoutReport,
  runExpansionScout,
} from "./expansionScoutService";
import { GooglePlacesTerritoryProvider } from "../territory/googlePlacesTerritoryProvider";

function scoutProvider() {
  const key =
    process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY ?? "";
  if (!key) throw new Error("Google Places is not configured for Expansion Scout");
  return new GooglePlacesTerritoryProvider(key);
}

export const driverGameWorldRouter = router({
  current: dayforgeMissionFieldProcedure.query(({ ctx }) =>
    listDriverGameWorld({
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
  evaluateMutation: dayforgeMissionFieldProcedure
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
      if (!node) throw new Error("Commercial mission not found in this field world");
      return evaluateAndPersistMutation({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        missionId: input.missionId,
        evidence: evidenceFromWorldNode(node, input.hasDecisionMakerContact),
        businessReferences: node.lossReason ? [node.lossReason] : [],
      });
    }),
  latestMutation: dayforgeMissionFieldProcedure
    .input(z.object({ missionId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      getLatestMutation({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        missionId: input.missionId,
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
  coldCall: dayforgeMissionFieldProcedure.query(({ ctx }) =>
    getColdCallBurstState({
      tenantId: ctx.tenantId,
      actorId: ctx.user.openId,
    })
  ),
  createColdCallBatch: dayforgeMissionFieldProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      createColdCallBatch({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        requestId: input.requestId,
      })
    ),
  startColdCallTarget: dayforgeMissionFieldProcedure
    .input(
      z.object({
        batchId: z.string().uuid(),
        targetId: z.string().uuid(),
      })
    )
    .mutation(({ ctx, input }) =>
      startColdCallTarget({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),
  completeColdCallTarget: dayforgeMissionFieldProcedure
    .input(
      z.object({
        batchId: z.string().uuid(),
        targetId: z.string().uuid(),
        requestId: z.string().uuid(),
        outcome: z.enum(COMMERCIAL_MISSION_CALL_OUTCOMES),
        notes: z.string().trim().min(1).max(2_000),
      })
    )
    .mutation(({ ctx, input }) =>
      completeColdCallTarget({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),
  selectColdCallChainTarget: dayforgeMissionFieldProcedure
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
  breakColdCallCombo: dayforgeMissionFieldProcedure
    .input(z.object({ batchId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      breakColdCallCombo({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),
  scoutCapability: dayforgeMissionFieldProcedure.mutation(({ ctx }) =>
    evaluateAndPersistExpansionScout({
      tenantId: ctx.tenantId,
      actorId: ctx.user.openId,
    })
  ),
  latestScoutReport: dayforgeMissionFieldProcedure.query(({ ctx }) =>
    getLatestScoutReport({
      tenantId: ctx.tenantId,
      actorId: ctx.user.openId,
    })
  ),
  runScout: dayforgeMissionFieldProcedure
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
