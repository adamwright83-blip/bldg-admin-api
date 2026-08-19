import { z } from "zod";
import { dayforgeTenantMemberProcedure, router } from "../_core/trpc";
import {
  getOrCreateDay1TenDoorsMission,
  recordDay1TenDoorsEvidence,
  recordDay1TenDoorsOutcome,
} from "./day1TenDoorsService";

const evidenceSource = z.enum([
  "gps",
  "operator_confirmed",
  "operator_backfill",
]);

export const day1TenDoorsRouter = router({
  current: dayforgeTenantMemberProcedure.query(({ ctx }) =>
    getOrCreateDay1TenDoorsMission({
      tenantId: ctx.tenantId,
      driverId: ctx.user.openId,
    })
  ),
  recordEvidence: dayforgeTenantMemberProcedure
    .input(
      z.object({
        missionId: z.string().uuid(),
        eventId: z.string().uuid(),
        targetId: z.string().trim().min(1).max(80),
        kind: z.enum([
          "navigation_opened",
          "arrived",
          "follow_up_sent",
          "reply_received",
          "meeting_booked",
          "account_won",
          "account_lost",
          "revenue_recorded",
        ]),
        source: evidenceSource,
        lat: z.number().finite().min(-90).max(90).nullable().optional(),
        lng: z.number().finite().min(-180).max(180).nullable().optional(),
        accuracyMeters: z.number().finite().min(0).max(10_000).nullable().optional(),
        amountCents: z.number().int().min(0).nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      recordDay1TenDoorsEvidence({
        ...input,
        tenantId: ctx.tenantId,
        driverId: ctx.user.openId,
      })
    ),
  recordOutcome: dayforgeTenantMemberProcedure
    .input(
      z.object({
        missionId: z.string().uuid(),
        targetId: z.string().trim().min(1).max(80),
        outcome: z.enum(["pitched", "couldnt_reach"]),
        requestId: z.string().uuid().optional(),
        decisionMaker: z
          .enum(["reached", "unavailable", "not_recorded"])
          .optional(),
        followUpNeeded: z.boolean().optional(),
        source: evidenceSource.optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      recordDay1TenDoorsOutcome({
        ...input,
        tenantId: ctx.tenantId,
        driverId: ctx.user.openId,
      })
    ),
});
