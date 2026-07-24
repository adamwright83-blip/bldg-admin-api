import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  COMMERCIAL_CONTACT_PREFERRED_CHANNELS,
  COMMERCIAL_CONTACT_RELATIONSHIP_TYPES,
  COMMERCIAL_CONTACT_SOURCES,
  COMMERCIAL_MISSION_STATUSES,
  COMMERCIAL_MISSION_STEP_TYPES,
} from "@shared/commercialMission";
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
import { logCommercialWalkIn } from "./commercialWalkInService";
import { advanceCommercialMissionIrlStep, applyLuxuryHotelIrlPlan } from "./commercialMissionIrlPlanService";
import { dispatchCommercialMission, listCommercialMissionDispatches, openCommercialMissionDispatch } from "./commercialMissionDispatchService";
import { listCommercialMissionProofs, reviewCommercialMissionProof, submitCommercialMissionProof } from "./commercialMissionProofService";
import { generateDayforgeMissionCoaching, getActiveDayforgeCoachingArtifact } from "../dayforgeCoaching/dayforgeCoachingRuntime";

function httpUrl(maxLength: number) {
  return z
    .string()
    .trim()
    .url()
    .max(maxLength)
    .refine(value => {
      const protocol = new URL(value).protocol;
      return protocol === "https:" || protocol === "http:";
    }, "Only HTTP(S) URLs are allowed");
}

export const commercialMissionAccountInputSchema = z.object({
  providerName: z.string().trim().min(1).max(64).nullable().optional(),
  providerAccountId: z.string().trim().min(1).max(191).nullable().optional(),
  name: z.string().trim().min(1).max(255),
  accountType: z.string().trim().min(1).max(96),
  website: httpUrl(512).nullable().optional(),
  address: z.string().trim().min(1).max(512),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  locationCount: z.number().int().positive(),
  decisionMaker: z.object({
    name: z.string().trim().min(1).max(255).nullable(),
    title: z.string().trim().min(1).max(255).nullable(),
    email: z.string().trim().email().max(320).nullable().optional(),
    phone: z.string().trim().min(7).max(64).nullable().optional(),
    relationshipType: z.enum(COMMERCIAL_CONTACT_RELATIONSHIP_TYPES).nullable().optional(),
    preferredChannel: z.enum(COMMERCIAL_CONTACT_PREFERRED_CHANNELS).nullable().optional(),
    source: z.enum(COMMERCIAL_CONTACT_SOURCES).nullable().optional(),
    sourceUrl: httpUrl(1024).nullable().optional(),
    sourcedAt: z.string().datetime().nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
  }).strict(),
}).strict().superRefine((account, ctx) => {
  if ((account.latitude === null) !== (account.longitude === null)) {
    ctx.addIssue({
      code: "custom",
      path: [account.latitude === null ? "latitude" : "longitude"],
      message: "Latitude and longitude must both be supplied or both be unknown",
    });
  }
});

export const commercialMissionOpportunityInputSchema = z.object({
  estimatedAnnualValueCents: z.number().int().nonnegative().nullable(),
  estimateConfidence: z.enum(["low", "medium", "high"]),
  score: z.number().int().min(0).max(100),
  primarySignal: z.string().trim().min(1).max(2000),
  reasons: z.array(z.string().trim().min(1).max(1000)).max(25),
  risks: z.array(z.string().trim().min(1).max(1000)).max(25),
  evidence: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
}).strict();

const briefSchema = z.object({
  laundryOpportunity: z.string().trim().min(1).max(4000),
  salesAngle: z.string().trim().min(1).max(4000),
  openingLine: z.string().trim().min(1).max(2000),
  discoveryQuestions: z.array(z.string().trim().min(1).max(1000)).max(25),
  objections: z.array(z.string().trim().min(1).max(1000)).max(25),
});

export const commercialMissionStepInputSchema = z.object({
  key: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(255),
  detail: z.string().trim().min(1).max(4000),
  type: z.enum(COMMERCIAL_MISSION_STEP_TYPES).optional(),
  status: z.enum(["locked", "ready", "active", "skipped", "cancelled"]),
  position: z.number().int().nonnegative(),
  instructionText: z.string().trim().max(4000).nullable().optional(),
  revealPolicy: z.enum(["sequential", "immediate", "admin_only"]).optional(),
  destinationName: z.string().trim().max(255).nullable().optional(),
  destinationAddress: z.string().trim().max(512).nullable().optional(),
  destinationLatitude: z.number().min(-90).max(90).nullable().optional(),
  destinationLongitude: z.number().min(-180).max(180).nullable().optional(),
  mapsUrl: httpUrl(2048).nullable().optional(),
  countdownDurationSeconds: z.number().int().min(0).max(86_400).nullable().optional(),
  proofRequirement: z.enum(["none", "confirmation", "photo", "photo_optional"]).optional(),
  referenceImageUrl: httpUrl(2048).nullable().optional(),
  instructionVideoUrl: httpUrl(2048).nullable().optional(),
  fulfillmentMode: z.enum([
    "not_applicable",
    "live_provider",
    "staged_demo",
    "manual_fulfillment",
  ]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const commercialMissionStepsInputSchema = z
  .array(commercialMissionStepInputSchema)
  .max(50)
  .superRefine((steps, ctx) => {
    const keys = new Set<string>();
    const positions = new Set<number>();
    steps.forEach((step, index) => {
      if (keys.has(step.key)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "key"],
          message: "Mission step keys must be unique",
        });
      }
      if (positions.has(step.position)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "position"],
          message: "Mission step positions must be unique",
        });
      }
      keys.add(step.key);
      positions.add(step.position);
    });
  });

function notFound(): never {
  throw new TRPCError({
    code: "NOT_FOUND",
    message: "Commercial mission not found",
  });
}

export const commercialMissionRouter = router({
  createLuxuryHotelIrlPlan: dayforgeMissionOperatorProcedure.input(z.object({
    missionId: z.number().int().positive(), requestId: z.string().uuid(),
    referenceImageUrl: httpUrl(2048).nullable().optional(), trainingVideoUrl: httpUrl(2048).nullable().optional(),
    printShopName: z.string().trim().min(1).max(255), printShopAddress: z.string().trim().min(1).max(512),
    convenienceStoreName: z.string().trim().min(1).max(255), convenienceStoreAddress: z.string().trim().min(1).max(512),
    hotelName: z.string().trim().max(255).nullable().optional(), hotelAddress: z.string().trim().max(512).nullable().optional(),
    printFulfillmentMode: z.enum(["staged_demo", "manual_fulfillment"]),
    printCreditDisplayCopy: z.string().trim().max(255).nullable().optional(),
  })).mutation(({ ctx, input }) => applyLuxuryHotelIrlPlan({ ...input, tenantId: ctx.tenantId, actorId: ctx.user.openId })),
  advanceIrlStep: dayforgeMissionFieldProcedure.input(z.object({
    missionId: z.number().int().positive(), stepKey: z.string().trim().min(1).max(64),
    requestId: z.string().uuid(), action: z.enum(["start", "complete"]),
  })).mutation(async ({ ctx, input }) => {
    const mission = await getCommercialMission({ tenantId: ctx.tenantId, missionId: input.missionId });
    if (!mission) return notFound();
    assertDriverCanReadMission({ mission, userId: ctx.user.openId, isAdmin: ctx.dayforgeMembership.role !== "field" });
    return advanceCommercialMissionIrlStep({ ...input, tenantId: ctx.tenantId, actorId: ctx.user.openId });
  }),
  submitProof: dayforgeMissionFieldProcedure.input(z.object({
    missionId: z.number().int().positive(), missionStepId: z.number().int().positive(),
    requestId: z.string().uuid(), mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]),
    dataBase64: z.string().min(4).max(14_000_000),
  })).mutation(({ ctx, input }) => submitCommercialMissionProof({
    tenantId: ctx.tenantId, missionId: input.missionId, missionStepId: input.missionStepId,
    actorId: ctx.user.openId, actorRole: ctx.dayforgeMembership.role,
    requestId: input.requestId, mimeType: input.mimeType,
    data: Buffer.from(input.dataBase64, "base64"),
  })),
  proofs: dayforgeMissionFieldProcedure.input(z.object({ missionId: z.number().int().positive() })).query(({ ctx, input }) =>
    listCommercialMissionProofs({ ...input, tenantId: ctx.tenantId, actorId: ctx.user.openId, actorRole: ctx.dayforgeMembership.role })
  ),
  reviewProof: dayforgeTenantAdminProcedure.input(z.object({
    proofId: z.string().uuid(), requestId: z.string().uuid(), decision: z.enum(["approve", "reject", "override"]),
    note: z.string().trim().max(2000).nullable().optional(),
  })).mutation(({ ctx, input }) => reviewCommercialMissionProof({
    ...input, tenantId: ctx.tenantId, actorId: ctx.user.openId, actorRole: ctx.dayforgeMembership.role,
  })),
  coaching: dayforgeMissionFieldProcedure.input(z.object({ missionId: z.number().int().positive(), stepId: z.number().int().positive().nullable() })).query(({ ctx, input }) =>
    getActiveDayforgeCoachingArtifact({ ...input, tenantId: ctx.tenantId, missionStepId: input.stepId })
  ),
  generateCoaching: dayforgeMissionFieldProcedure.input(z.object({
    missionId: z.number().int().positive(), stepId: z.number().int().positive().nullable(), requestId: z.string().uuid(), refresh: z.boolean().optional(),
  })).mutation(({ ctx, input }) => generateDayforgeMissionCoaching({ ...input, tenantId: ctx.tenantId, actorId: ctx.user.openId })),
  dispatchIrl: dayforgeMissionOperatorProcedure.input(z.object({
    missionId: z.number().int().positive(), requestId: z.string().uuid(),
    handoffId: z.string().uuid().nullable().optional(), includeSms: z.boolean().optional(),
    dispatchPolicy: z.enum(["manual", "on_game_complete"]).default("manual"),
  })).mutation(async ({ ctx, input }) => {
    const mission = await getCommercialMission({ tenantId: ctx.tenantId, missionId: input.missionId });
    if (!mission?.steps.some(step => step.type !== "generic")) throw new Error("Create an IRL step plan before dispatch");
    return dispatchCommercialMission({ ...input, tenantId: ctx.tenantId, actorId: ctx.user.openId });
  }),
  myDispatches: dayforgeMissionFieldProcedure.query(({ ctx }) => listCommercialMissionDispatches({
    tenantId: ctx.tenantId, assignedTo: ctx.dayforgeMembership.role === "field" ? ctx.user.openId : undefined,
  })),
  openDispatch: dayforgeMissionFieldProcedure.input(z.object({ dispatchId: z.string().uuid() })).mutation(({ ctx, input }) =>
    openCommercialMissionDispatch({ ...input, tenantId: ctx.tenantId, actorId: ctx.user.openId })
  ),
  logWalkIn: dayforgeMissionFieldProcedure
    .input(z.object({
      idempotencyKey: z.string().trim().min(8).max(191),
      requestId: z.string().uuid(),
      businessName: z.string().trim().min(1).max(255),
      businessType: z.string().trim().min(1).max(96),
      address: z.string().trim().min(1).max(512),
      website: httpUrl(512).nullable().optional(),
      contactName: z.string().trim().max(255).nullable().optional(),
      contactTitle: z.string().trim().max(255).nullable().optional(),
      contactEmail: z.string().trim().email().max(320).nullable().optional(),
      contactPhone: z.string().trim().min(7).max(64).nullable().optional(),
      relationshipType: z.enum(COMMERCIAL_CONTACT_RELATIONSHIP_TYPES).nullable().optional(),
      conversationNotes: z.string().trim().min(1).max(4000),
      visitResult: z.enum(["follow_up", "won", "lost", "no_contact"]),
      nextAction: z.string().trim().min(1).max(2000),
      followUpAt: z.coerce.date().nullable().optional(),
      assignedTo: z.string().trim().max(128).nullable().optional(),
      estimatedAnnualValueCents: z.number().int().positive().nullable().optional(),
      estimateConfidence: z.enum(["low", "medium", "high"]).optional(),
      campaign: z.string().trim().max(128).nullable().optional(),
      placement: z.string().trim().max(128).nullable().optional(),
      collateralDelivered: z.boolean().optional(),
      quoteRequested: z.boolean().optional(),
      pilotRequested: z.boolean().optional(),
    }))
    .mutation(({ ctx, input }) => logCommercialWalkIn({
      ...input,
      tenantId: ctx.tenantId,
      actorId: ctx.user.openId,
      assignedTo: input.assignedTo ?? ctx.user.openId,
    })),
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
        account: commercialMissionAccountInputSchema,
        opportunity: commercialMissionOpportunityInputSchema,
        brief: briefSchema,
        steps: commercialMissionStepsInputSchema,
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
