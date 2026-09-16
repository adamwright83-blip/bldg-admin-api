import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  getStrategyActiveCustomers,
  getStrategyGrowthMetrics,
} from "./growthMetrics";
import {
  getActivePlaygroundRules,
  setPlaygroundRules,
} from "./playgroundRulesService";
import {
  getMonthToDateSpend,
} from "./spendClearance";
import { getActiveMacroGoal } from "../claire/macroGoalService";
import {
  buildStrategySnapshot,
  getLatestStrategySnapshot,
  getSnapshotProvenance,
  getStrategySnapshotById,
} from "./snapshotBuilder";
import { getTodayFeaturedOperation } from "./todayFeaturedService";
import { getOrCreatePathOffer, getStrategyPlayById } from "./playGenerator";
import { chooseStrategicPath, getActiveStrategicPath } from "./pathChoiceService";
import { sequenceDailyMissions, getSequencedMissionsForDate } from "./missionSequencer";
import {
  checkCommunicationPermission,
  recordCommunicationPermission,
  recordOutreachAttempt,
} from "./communicationPermissionService";

export const strategyRouter = router({

  activeCustomers: adminProcedure.query(async ({ ctx }) => {
    return getStrategyActiveCustomers({ tenantId: ctx.tenantId });
  }),

  growthMetrics: adminProcedure
    .input(
      z.object({
        startYmd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endYmd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        inactivityDays: z.number().int().positive().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return getStrategyGrowthMetrics({
        tenantId: ctx.tenantId,
        period: {
          startYmd: input.startYmd,
          endYmd: input.endYmd,
        },
        inactivityDays: input.inactivityDays,
      });
    }),

  playground: router({
    get: adminProcedure.query(async ({ ctx }) => {
      const rules = await getActivePlaygroundRules(ctx.tenantId);
      const macroGoal = await getActiveMacroGoal({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user?.openId ?? "owner",
      });
      const spend = await getMonthToDateSpend(ctx.tenantId);
      return {
        rules,
        macroGoal,
        spend,
      };
    }),

    set: adminProcedure
      .input(
        z.object({
          monthlySpendCeilingCents: z.number().int().nonnegative(),
          currency: z.string().max(8).optional(),
          approvalCategories: z.array(z.string()).optional(),
          source: z.enum(["operator_attested", "admin"]).optional(),
          macroGoalId: z.string().nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return setPlaygroundRules({
          tenantId: ctx.tenantId,
          monthlySpendCeilingCents: input.monthlySpendCeilingCents,
          currency: input.currency,
          approvalCategories: input.approvalCategories,
          source: input.source,
          macroGoalId: input.macroGoalId,
        });
      }),
  }),

  spend: router({
    monthToDate: adminProcedure
      .input(
        z.object({
          businessMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        return getMonthToDateSpend(ctx.tenantId, input?.businessMonth);
      }),
  }),

  snapshot: router({
    latest: adminProcedure.query(async ({ ctx }) => {
      let snapshot = await getLatestStrategySnapshot(ctx.tenantId);
      if (!snapshot) {
        snapshot = await buildStrategySnapshot(ctx.tenantId);
      }
      return snapshot;
    }),

    byId: adminProcedure
      .input(z.object({ snapshotId: z.string() }))
      .query(async ({ ctx, input }) => {
        return getStrategySnapshotById(ctx.tenantId, input.snapshotId);
      }),

    provenance: adminProcedure
      .input(z.object({ snapshotId: z.string(), path: z.string() }))
      .query(async ({ ctx, input }) => {
        return getSnapshotProvenance(ctx.tenantId, input.snapshotId, input.path);
      }),
  }),

  today: router({
    featured: adminProcedure.query(async ({ ctx }) => {
      return getTodayFeaturedOperation(ctx.tenantId);
    }),
  }),

  plays: router({
    offer: adminProcedure.query(async ({ ctx }) => {
      return getOrCreatePathOffer(ctx.tenantId);
    }),

    choose: adminProcedure
      .input(
        z.object({
          playId: z.string(),
          surface: z.enum(["map", "voice", "admin"]),
          offerId: z.string().optional(),
          readbackConfirmed: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return chooseStrategicPath({
          tenantId: ctx.tenantId,
          playId: input.playId,
          surface: input.surface,
          offerId: input.offerId,
          readbackConfirmed: input.readbackConfirmed,
        });
      }),

    active: adminProcedure.query(async ({ ctx }) => {
      const activeState = await getActiveStrategicPath(ctx.tenantId);
      return activeState.activePlay;
    }),
  }),

  missions: router({
    sequence: adminProcedure
      .input(
        z.object({
          businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          forceReplan: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        let snapshot = await getLatestStrategySnapshot(ctx.tenantId);
        if (!snapshot) {
          snapshot = await buildStrategySnapshot(ctx.tenantId);
        }
        return sequenceDailyMissions({
          tenantId: ctx.tenantId,
          actorId: ctx.user?.id ? String(ctx.user.id) : "admin",
          businessDate: input.businessDate,
          snapshot,
          forceReplan: input.forceReplan,
        });
      }),

    forDate: adminProcedure
      .input(
        z.object({
          businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
      )
      .query(async ({ ctx, input }) => {
        return getSequencedMissionsForDate(ctx.tenantId, input.businessDate);
      }),
  }),

  permissions: router({
    check: adminProcedure
      .input(
        z.object({
          subjectType: z.enum(["lead", "contact", "customer", "property"]),
          subjectId: z.string(),
          channel: z.enum(["sms", "email", "call", "visit", "any"]).optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        return checkCommunicationPermission({
          tenantId: ctx.tenantId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          channel: input.channel,
        });
      }),

    record: adminProcedure
      .input(
        z.object({
          subjectType: z.enum(["lead", "contact", "customer", "property"]),
          subjectId: z.string(),
          channel: z.enum(["sms", "email", "call", "visit", "any"]).optional(),
          status: z.enum(["opted_in", "opted_out", "refused", "unspecified"]),
          reason: z.string().optional(),
          frequencyCapDays: z.number().int().positive().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await recordCommunicationPermission({
          tenantId: ctx.tenantId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          channel: input.channel,
          status: input.status,
          reason: input.reason,
          frequencyCapDays: input.frequencyCapDays,
        });
        return { success: true };
      }),

    recordOutreach: adminProcedure
      .input(
        z.object({
          subjectType: z.enum(["lead", "contact", "customer", "property"]),
          subjectId: z.string(),
          channel: z.enum(["sms", "email", "call", "visit", "any"]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await recordOutreachAttempt({
          tenantId: ctx.tenantId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          channel: input.channel,
        });
        return { success: true };
      }),
  }),
});

