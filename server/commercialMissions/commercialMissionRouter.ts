import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COMMERCIAL_MISSION_STATUSES } from "@shared/commercialMission";
import { FIELD_OUTCOME_REASONS } from "@shared/commercialMissionField";
import {
  dayforgeMissionFieldProcedure,
  dayforgeMissionOperatorProcedure,
  dayforgeTenantAdminProcedure,
  router,
} from "../_core/trpc";
import { listDayforgeTimeline } from "../dayforgeEvents/dayforgeTimeline";
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
import {
  arriveCommercialMissionField,
  consumeCommercialMissionPhoneHandoff,
  createCommercialMissionPhoneHandoff,
  departCommercialMissionField,
  getCommercialMissionFieldState,
  recordCommercialMissionVisitOutcome,
  saveCommercialMissionFieldNotes,
  saveTenantFieldChecklistTemplates,
  startCommercialMissionFieldPreparation,
  updateCommercialMissionFieldChecklist,
} from "./commercialMissionFieldService";

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
  throw new TRPCError({
    code: "NOT_FOUND",
    message: "Commercial mission not found",
  });
}

export const commercialMissionRouter = router({
  timeline: dayforgeTenantAdminProcedure
    .input(
      z
        .object({
          missionId: z.number().int().positive().optional(),
          accountId: z.number().int().positive().optional(),
          correlationId: z.string().trim().min(1).max(191).optional(),
          cursor: z
            .object({
              createdAt: z.coerce.date(),
              id: z.number().int().positive(),
            })
            .optional(),
          limit: z.number().int().min(1).max(250).default(100),
        })
        .default({ limit: 100 })
    )
    .query(({ ctx, input }) =>
      listDayforgeTimeline({
        tenantId: ctx.tenantId,
        filter: {
          missionId: input.missionId,
          accountId: input.accountId,
          correlationId: input.correlationId,
        },
        cursor: input.cursor,
        limit: input.limit,
      })
    ),

  create: dayforgeMissionOperatorProcedure
    .input(
      z.object({
        assignedTo: z.string().trim().min(1).max(128).nullable().optional(),
        account: accountSchema,
        opportunity: opportunitySchema,
        brief: briefSchema,
        steps: z.array(stepSchema).max(50),
        idempotencyKey: z.string().trim().min(8).max(191),
      })
    )
    .mutation(({ ctx, input }) =>
      createCommercialMission({
        ...input,
        tenantId: ctx.tenantId,
        actor: { type: "operator", id: ctx.user.openId },
      })
    ),

  list: dayforgeMissionOperatorProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(250).default(100) })
        .default({ limit: 100 })
    )
    .query(({ ctx, input }) =>
      listCommercialMissions({ tenantId: ctx.tenantId, limit: input.limit })
    ),

  get: dayforgeMissionFieldProcedure
    .input(z.object({ missionId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const mission = await getCommercialMission({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({
          mission,
          userId: ctx.user.openId,
          isAdmin: ctx.dayforgeMembership.role !== "field",
        });
      } catch (error) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: (error as Error).message,
        });
      }
      return mission;
    }),

  events: dayforgeMissionFieldProcedure
    .input(z.object({ missionId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const mission = await getCommercialMission({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({
          mission,
          userId: ctx.user.openId,
          isAdmin: ctx.dayforgeMembership.role !== "field",
        });
      } catch (error) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: (error as Error).message,
        });
      }
      return listCommercialMissionEvents({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      });
    }),

  transition: dayforgeMissionOperatorProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        expectedVersion: z.number().int().positive(),
        toStatus: z.enum(COMMERCIAL_MISSION_STATUSES),
        idempotencyKey: z.string().trim().min(8).max(191),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      transitionCommercialMission({
        ...input,
        tenantId: ctx.tenantId,
        actor: { type: "operator", id: ctx.user.openId },
      })
    ),

  fieldTransition: dayforgeMissionFieldProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        expectedVersion: z.number().int().positive(),
        toStatus: z.enum(COMMERCIAL_MISSION_STATUSES),
        idempotencyKey: z.string().trim().min(8).max(191),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const mission = await getCommercialMission({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({
          mission,
          userId: ctx.user.openId,
          isAdmin: ctx.dayforgeMembership.role !== "field",
        });
        if (ctx.dayforgeMembership.role === "field")
          assertDriverTransitionAllowed(input.toStatus);
      } catch (error) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: (error as Error).message,
        });
      }
      return transitionCommercialMission({
        ...input,
        tenantId: ctx.tenantId,
        actor: {
          type: ctx.dayforgeMembership.role === "field" ? "driver" : "operator",
          id: ctx.user.openId,
        },
      });
    }),

  gameStart: dayforgeMissionFieldProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        expectedVersion: z.number().int().positive(),
        gameAttemptId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const mission = await getCommercialMission({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({
          mission,
          userId: ctx.user.openId,
          isAdmin: ctx.dayforgeMembership.role !== "field",
        });
      } catch (error) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: (error as Error).message,
        });
      }
      return startCommercialMissionGame({
        ...input,
        tenantId: ctx.tenantId,
        playerId: ctx.user.openId,
      });
    }),

  gameState: dayforgeMissionFieldProcedure
    .input(z.object({ missionId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const mission = await getCommercialMission({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({
          mission,
          userId: ctx.user.openId,
          isAdmin: ctx.dayforgeMembership.role !== "field",
        });
      } catch (error) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: (error as Error).message,
        });
      }
      return getCommercialMissionGameState({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      });
    }),

  gameAbandon: dayforgeMissionFieldProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        expectedVersion: z.number().int().positive(),
        gameAttemptId: z.string().uuid(),
        reason: z.enum(["defeat", "quit", "restart"]),
        durationMs: z.number().int().nonnegative().max(3_600_000),
        telemetry: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const mission = await getCommercialMission({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({
          mission,
          userId: ctx.user.openId,
          isAdmin: ctx.dayforgeMembership.role !== "field",
        });
      } catch (error) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: (error as Error).message,
        });
      }
      return abandonCommercialMissionGame({
        ...input,
        tenantId: ctx.tenantId,
        playerId: ctx.user.openId,
      });
    }),

  gameComplete: dayforgeMissionFieldProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        expectedVersion: z.number().int().positive(),
        gameAttemptId: z.string().uuid(),
        telemetry: z.object({
          sparkScore: z.number().int().min(5).max(99),
          clockheadScore: z.number().int().min(0).max(99),
          durationMs: z.number().int().positive().max(3_600_000),
          replay: z
            .record(z.string(), z.unknown())
            .refine(
              value => JSON.stringify(value).length <= 250_000,
              "Replay is too large"
            ),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const mission = await getCommercialMission({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({
          mission,
          userId: ctx.user.openId,
          isAdmin: ctx.dayforgeMembership.role !== "field",
        });
      } catch (error) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: (error as Error).message,
        });
      }
      return completeCommercialMissionGame({
        ...input,
        tenantId: ctx.tenantId,
        playerId: ctx.user.openId,
      });
    }),

  fieldState: dayforgeMissionFieldProcedure
    .input(z.object({ missionId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const mission = await getCommercialMission({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({
          mission,
          userId: ctx.user.openId,
          isAdmin: ctx.dayforgeMembership.role !== "field",
        });
      } catch (error) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: (error as Error).message,
        });
      }
      return getCommercialMissionFieldState({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      });
    }),

  fieldStartPreparation: dayforgeMissionFieldProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        expectedMissionVersion: z.number().int().positive(),
        requestId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const mission = await getCommercialMission({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({
          mission,
          userId: ctx.user.openId,
          isAdmin: ctx.dayforgeMembership.role !== "field",
        });
      } catch (error) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: (error as Error).message,
        });
      }
      return startCommercialMissionFieldPreparation({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      });
    }),

  fieldChecklist: dayforgeMissionFieldProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        expectedFieldVersion: z.number().int().positive(),
        itemKey: z.string().trim().min(1).max(64),
        status: z.enum(["pending", "completed", "skipped"]),
        requestId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const mission = await getCommercialMission({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({
          mission,
          userId: ctx.user.openId,
          isAdmin: ctx.dayforgeMembership.role !== "field",
        });
      } catch (error) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: (error as Error).message,
        });
      }
      return updateCommercialMissionFieldChecklist({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      });
    }),

  fieldDepart: dayforgeMissionFieldProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        expectedMissionVersion: z.number().int().positive(),
        expectedFieldVersion: z.number().int().positive(),
        requestId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const mission = await getCommercialMission({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({
          mission,
          userId: ctx.user.openId,
          isAdmin: ctx.dayforgeMembership.role !== "field",
        });
      } catch (error) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: (error as Error).message,
        });
      }
      return departCommercialMissionField({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      });
    }),

  fieldArrive: dayforgeMissionFieldProcedure
    .input(
      z
        .object({
          missionId: z.number().int().positive(),
          expectedMissionVersion: z.number().int().positive(),
          expectedFieldVersion: z.number().int().positive(),
          requestId: z.string().uuid(),
          checkInMethod: z.enum(["manual", "location"]),
          latitude: z.number().min(-90).max(90).optional(),
          longitude: z.number().min(-180).max(180).optional(),
          locationAccuracyMeters: z
            .number()
            .int()
            .nonnegative()
            .max(100_000)
            .optional(),
        })
        .superRefine((value, ctx) => {
          if (
            value.checkInMethod === "location" &&
            (value.latitude === undefined || value.longitude === undefined)
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Location check-in requires latitude and longitude",
            });
          }
        })
    )
    .mutation(async ({ ctx, input }) => {
      const mission = await getCommercialMission({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({
          mission,
          userId: ctx.user.openId,
          isAdmin: ctx.dayforgeMembership.role !== "field",
        });
      } catch (error) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: (error as Error).message,
        });
      }
      return arriveCommercialMissionField({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      });
    }),

  fieldSaveNotes: dayforgeMissionFieldProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        expectedFieldVersion: z.number().int().positive(),
        notes: z.string().trim().max(20_000),
        requestId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const mission = await getCommercialMission({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({
          mission,
          userId: ctx.user.openId,
          isAdmin: ctx.dayforgeMembership.role !== "field",
        });
      } catch (error) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: (error as Error).message,
        });
      }
      return saveCommercialMissionFieldNotes({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      });
    }),

  fieldOutcome: dayforgeMissionFieldProcedure
    .input(
      z
        .object({
          missionId: z.number().int().positive(),
          expectedMissionVersion: z.number().int().positive(),
          expectedFieldVersion: z.number().int().positive(),
          requestId: z.string().uuid(),
          outcome: z.enum(["follow_up", "won", "lost"]),
          notes: z.string().trim().min(1).max(20_000),
          followUpAt: z.coerce.date().optional(),
          decisionMakerStatus: z.enum(["met", "unavailable", "not_recorded"]),
          collateralDelivered: z.boolean(),
          quoteRequested: z.boolean(),
          pilotRequested: z.boolean(),
          followUpRequested: z.boolean(),
          reason: z.enum(FIELD_OUTCOME_REASONS).optional(),
        })
        .superRefine((value, ctx) => {
          if (value.outcome === "follow_up" && !value.followUpAt) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Follow-up outcomes require a follow-up date",
            });
          }
          if (
            value.outcome === "follow_up" &&
            value.followUpAt &&
            value.followUpAt.getTime() <= Date.now()
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Follow-up date must be in the future",
            });
          }
          if (value.outcome === "lost" && !value.reason) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Lost outcomes require a reason",
            });
          }
        })
    )
    .mutation(async ({ ctx, input }) => {
      const mission = await getCommercialMission({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      });
      if (!mission) return notFound();
      try {
        assertDriverCanReadMission({
          mission,
          userId: ctx.user.openId,
          isAdmin: ctx.dayforgeMembership.role !== "field",
        });
      } catch (error) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: (error as Error).message,
        });
      }
      return recordCommercialMissionVisitOutcome({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      });
    }),

  createPhoneHandoff: dayforgeMissionOperatorProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        requestId: z.string().uuid(),
      })
    )
    .mutation(({ ctx, input }) =>
      createCommercialMissionPhoneHandoff({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),

  consumePhoneHandoff: dayforgeMissionFieldProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        token: z.string().min(32).max(512),
      })
    )
    .mutation(({ ctx, input }) =>
      consumeCommercialMissionPhoneHandoff({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),

  saveFieldChecklistTemplates: dayforgeMissionOperatorProcedure
    .input(
      z.object({
        items: z
          .array(
            z.object({
              itemKey: z.string().trim().min(1).max(64),
              label: z.string().trim().min(1).max(255),
              detail: z.string().trim().min(1).max(2000),
              required: z.boolean(),
              position: z.number().int().nonnegative().max(1000),
              active: z.boolean(),
            })
          )
          .min(1)
          .max(50),
      })
    )
    .mutation(({ ctx, input }) =>
      saveTenantFieldChecklistTemplates({
        tenantId: ctx.tenantId,
        items: input.items,
      })
    ),
});
