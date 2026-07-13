import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COMMERCIAL_MISSION_STATUSES } from "@shared/commercialMission";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import {
  assertDriverCanReadMission,
  assertDriverTransitionAllowed,
} from "./commercialMissionAuthorization";
import {
  createCommercialMission,
  getCommercialMission,
  listCommercialMissionEvents,
  listCommercialMissions,
  transitionCommercialMission,
} from "./commercialMissionStore";
import {
  abandonCommercialMissionGame,
  completeCommercialMissionGame,
  getCommercialMissionGameState,
  startCommercialMissionGame,
} from "./commercialMissionGameService";

const accountSchema = z.object({
  name: z.string().trim().min(1).max(255),
  accountType: z.string().trim().min(1).max(96),
  address: z.string().trim().min(1).max(512),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  locationCount: z.number().int().positive(),
  decisionMaker: z.object({
    name: z.string().trim().min(1).max(255).nullable(),
    title: z.string().trim().min(1).max(255).nullable(),
  }),
});

const opportunitySchema = z.object({
  estimatedAnnualValueCents: z.number().int().nonnegative(),
  estimateConfidence: z.enum(["low", "medium", "high"]),
  score: z.number().int().min(0).max(100),
  primarySignal: z.string().trim().min(1).max(2000),
  reasons: z.array(z.string().trim().min(1).max(1000)).max(25),
  risks: z.array(z.string().trim().min(1).max(1000)).max(25),
});

const briefSchema = z.object({
  laundryOpportunity: z.string().trim().min(1).max(4000),
  salesAngle: z.string().trim().min(1).max(4000),
  openingLine: z.string().trim().min(1).max(2000),
  discoveryQuestions: z.array(z.string().trim().min(1).max(1000)).max(25),
  objections: z.array(z.string().trim().min(1).max(1000)).max(25),
});

const stepSchema = z.object({
  key: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(255),
  detail: z.string().trim().min(1).max(4000),
  status: z.enum(["locked", "ready", "active", "completed", "skipped"]),
  position: z.number().int().nonnegative(),
});

function notFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "Commercial mission not found" });
}

export const commercialMissionRouter = router({
  create: adminProcedure
    .input(z.object({
      assignedTo: z.string().trim().min(1).max(128).nullable().optional(),
      account: accountSchema,
      opportunity: opportunitySchema,
      brief: briefSchema,
      steps: z.array(stepSchema).max(50),
      idempotencyKey: z.string().trim().min(8).max(191),
    }))
    .mutation(({ ctx, input }) => createCommercialMission({
      ...input,
      tenantId: ctx.tenantId,
      actor: { type: "operator", id: ctx.user.openId },
    })),

  list: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(250).default(100) }).default({ limit: 100 }))
    .query(({ ctx, input }) => listCommercialMissions({ tenantId: ctx.tenantId, limit: input.limit })),

  get: protectedProcedure
    .input(z.object({ missionId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const mission = await getCommercialMission({ tenantId: ctx.tenantId, missionId: input.missionId });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({
          mission,
          userId: ctx.user.openId,
          isAdmin: ctx.user.role === "admin",
        });
      } catch (error) {
        throw new TRPCError({ code: "FORBIDDEN", message: (error as Error).message });
      }
      return mission;
    }),

  events: protectedProcedure
    .input(z.object({ missionId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const mission = await getCommercialMission({ tenantId: ctx.tenantId, missionId: input.missionId });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({ mission, userId: ctx.user.openId, isAdmin: ctx.user.role === "admin" });
      } catch (error) {
        throw new TRPCError({ code: "FORBIDDEN", message: (error as Error).message });
      }
      return listCommercialMissionEvents({ tenantId: ctx.tenantId, missionId: input.missionId });
    }),

  transition: adminProcedure
    .input(z.object({
      missionId: z.number().int().positive(),
      expectedVersion: z.number().int().positive(),
      toStatus: z.enum(COMMERCIAL_MISSION_STATUSES),
      idempotencyKey: z.string().trim().min(8).max(191),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(({ ctx, input }) => transitionCommercialMission({
      ...input,
      tenantId: ctx.tenantId,
      actor: { type: "operator", id: ctx.user.openId },
    })),

  fieldTransition: protectedProcedure
    .input(z.object({
      missionId: z.number().int().positive(),
      expectedVersion: z.number().int().positive(),
      toStatus: z.enum(COMMERCIAL_MISSION_STATUSES),
      idempotencyKey: z.string().trim().min(8).max(191),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const mission = await getCommercialMission({ tenantId: ctx.tenantId, missionId: input.missionId });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({ mission, userId: ctx.user.openId, isAdmin: ctx.user.role === "admin" });
        if (ctx.user.role !== "admin") assertDriverTransitionAllowed(input.toStatus);
      } catch (error) {
        throw new TRPCError({ code: "FORBIDDEN", message: (error as Error).message });
      }
      return transitionCommercialMission({
        ...input,
        tenantId: ctx.tenantId,
        actor: { type: ctx.user.role === "admin" ? "operator" : "driver", id: ctx.user.openId },
      });
    }),

  gameStart: protectedProcedure
    .input(z.object({
      missionId: z.number().int().positive(),
      expectedVersion: z.number().int().positive(),
      gameAttemptId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const mission = await getCommercialMission({ tenantId: ctx.tenantId, missionId: input.missionId });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({ mission, userId: ctx.user.openId, isAdmin: ctx.user.role === "admin" });
      } catch (error) {
        throw new TRPCError({ code: "FORBIDDEN", message: (error as Error).message });
      }
      return startCommercialMissionGame({ ...input, tenantId: ctx.tenantId, playerId: ctx.user.openId });
    }),

  gameState: protectedProcedure
    .input(z.object({ missionId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const mission = await getCommercialMission({ tenantId: ctx.tenantId, missionId: input.missionId });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({ mission, userId: ctx.user.openId, isAdmin: ctx.user.role === "admin" });
      } catch (error) {
        throw new TRPCError({ code: "FORBIDDEN", message: (error as Error).message });
      }
      return getCommercialMissionGameState({ tenantId: ctx.tenantId, missionId: input.missionId });
    }),

  gameAbandon: protectedProcedure
    .input(z.object({
      missionId: z.number().int().positive(),
      expectedVersion: z.number().int().positive(),
      gameAttemptId: z.string().uuid(),
      reason: z.enum(["defeat", "quit", "restart"]),
      durationMs: z.number().int().nonnegative().max(3_600_000),
      telemetry: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const mission = await getCommercialMission({ tenantId: ctx.tenantId, missionId: input.missionId });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({ mission, userId: ctx.user.openId, isAdmin: ctx.user.role === "admin" });
      } catch (error) {
        throw new TRPCError({ code: "FORBIDDEN", message: (error as Error).message });
      }
      return abandonCommercialMissionGame({ ...input, tenantId: ctx.tenantId, playerId: ctx.user.openId });
    }),

  gameComplete: protectedProcedure
    .input(z.object({
      missionId: z.number().int().positive(),
      expectedVersion: z.number().int().positive(),
      gameAttemptId: z.string().uuid(),
      telemetry: z.object({
        sparkScore: z.number().int().min(5).max(99),
        clockheadScore: z.number().int().min(0).max(99),
        durationMs: z.number().int().positive().max(3_600_000),
        replay: z.record(z.string(), z.unknown()).refine(value => JSON.stringify(value).length <= 250_000, "Replay is too large"),
      }),
    }))
    .mutation(async ({ ctx, input }) => {
      const mission = await getCommercialMission({ tenantId: ctx.tenantId, missionId: input.missionId });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({ mission, userId: ctx.user.openId, isAdmin: ctx.user.role === "admin" });
      } catch (error) {
        throw new TRPCError({ code: "FORBIDDEN", message: (error as Error).message });
      }
      return completeCommercialMissionGame({ ...input, tenantId: ctx.tenantId, playerId: ctx.user.openId });
    }),
});
