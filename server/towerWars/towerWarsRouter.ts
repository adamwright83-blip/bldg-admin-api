import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  activateTowerWarsPromise,
  fulfillTowerWarsPromise,
  getTowerWarsSettlement,
  getTowerWarsToday,
  recordTowerWarsPromise,
} from "./towerWarsService";
import { dayDirectorActorId } from "../dayDirector/dayDirectorActor";
import { sandboxFixture, SANDBOX_SCENARIOS } from "@shared/sandboxScenarios";
import { settleTowerWars } from "@shared/towerWarsSettlement";
import { isCompletedReplayDate, requireSandboxEnabled, sandboxEnabled } from "./sandboxGate";
import { getDashboardTimeZone } from "../dashboardZoned";

const buildingId = z.enum(["opus_la", "century_park_east"]);

export const towerWarsRouter = router({
  sandboxCapability: adminProcedure.query(() => ({ enabled: sandboxEnabled() })),
  sandbox: adminProcedure.query(() => {
    requireSandboxEnabled();
    return {
      banner: "SANDBOX — NO BUSINESS DATA WILL BE WRITTEN",
      scenarios: SANDBOX_SCENARIOS.map(scenario => {
        const fixture = sandboxFixture(scenario);
        return {
          scenario,
          description: fixture.description,
          fixture,
          settlement: settleTowerWars({ events: fixture.events, todayBusinessDate: fixture.todayBusinessDate }),
        };
      }),
    };
  }),
  sandboxReplay: adminProcedure
    .input(z.object({ businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ ctx, input }) => {
      requireSandboxEnabled();
      const now = new Date();
      if (!isCompletedReplayDate(input.businessDate, now, getDashboardTimeZone())) {
        throw new Error("REAL_DAY_REPLAY accepts completed past business dates only.");
      }
      const replay = await getTowerWarsSettlement({ tenantId: ctx.tenantId, now: new Date(`${input.businessDate}T19:00:00.000Z`) });
      return { ...replay, readOnly: true as const, cursorScope: `sandbox:replay:${input.businessDate}` };
    }),
  today: adminProcedure.query(({ ctx }) =>
    getTowerWarsToday({ tenantId: ctx.tenantId })
  ),
  /** Today's legible match plus the permanent strata beneath it. */
  settlement: adminProcedure
    .input(
      z
        .object({ historyDays: z.number().int().min(1).max(3650).optional() })
        .optional()
    )
    .query(({ ctx, input }) =>
      getTowerWarsSettlement({
        tenantId: ctx.tenantId,
        historyDays: input?.historyDays,
      })
    ),
  recordPromise: adminProcedure
    .input(
      z.object({
        buildingId,
        customerIdentity: z.string().max(191).nullable().optional(),
        promiseType: z.enum([
          "offer_insert",
          "referral_card",
          "loyalty_reward",
          "thank_you_presentation",
          "other",
        ]),
        sourceText: z.string().trim().min(1).max(10_000),
        quantity: z.number().int().positive().max(10_000).nullable().optional(),
        permissionStatus: z.enum([
          "not_required_physical_fulfillment",
          "recorded",
          "not_recorded",
          "revoked",
        ]),
        permissionChannel: z.enum([
          "physical_delivery",
          "sms",
          "email",
          "phone",
          "none",
        ]),
        permissionEvidence: z
          .string()
          .trim()
          .min(1)
          .max(10_000)
          .nullable()
          .optional(),
        sourceReference: z.string().trim().min(1).max(512),
        idempotencyKey: z.string().trim().min(8).max(191),
      })
    )
    .mutation(({ ctx, input }) =>
      recordTowerWarsPromise({ ...input, tenantId: ctx.tenantId })
    ),
  fulfillPromise: adminProcedure
    .input(
      z.object({
        promiseId: z.string().uuid(),
        fulfillmentEvidence: z.string().trim().min(1).max(10_000),
      })
    )
    .mutation(({ ctx, input }) =>
      fulfillTowerWarsPromise({
        ...input,
        tenantId: ctx.tenantId,
        actorId: dayDirectorActorId(ctx),
      })
    ),
  activatePromise: adminProcedure
    .input(z.object({ promiseId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      activateTowerWarsPromise({
        ...input,
        tenantId: ctx.tenantId,
        actorId: dayDirectorActorId(ctx),
      })
    ),
});
