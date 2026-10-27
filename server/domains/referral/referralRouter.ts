import { z } from "zod";
import { legacyDayforgeTenantOperatorProcedure, router } from "../../_core/trpc";
import {
  ensureReferralCode,
  getReferralActivity,
  getReferralProgram,
  importCleanCloudReferralUsage,
  markReferrerCreditApplied,
  recordReferral,
  saveReferralProgram,
} from "./referralService";

const operator = legacyDayforgeTenantOperatorProcedure;
const cents = z.number().int().min(0).max(50_000);
const actorOf = (ctx: { user?: { openId?: string | null } | null }) => ctx.user?.openId ?? "owner";

export const referralRouter = router({
  program: operator.query(({ ctx }) => getReferralProgram(ctx.tenantId)),

  saveProgram: operator
    .input(
      z.object({
        source: z.enum(["cleancloud", "joystick"]),
        mode: z.enum(["off", "one_time_credit"]),
        referrerCreditCents: cents,
        newCustomerCreditCents: cents,
        cleancloudSetupConfirmed: z.boolean().optional(),
      })
    )
    .mutation(({ ctx, input }) => saveReferralProgram({ ...input, tenantId: ctx.tenantId, actor: actorOf(ctx) })),

  activity: operator.query(({ ctx }) => getReferralActivity(ctx.tenantId)),

  /** Native tier: a customer's code for a bag card or a text. */
  ensureCode: operator
    .input(
      z.object({
        customerName: z.string().trim().min(1).max(191),
        customerPhone: z.string().trim().max(32).optional(),
        customerEmail: z.string().trim().email().max(191).optional(),
      })
    )
    .mutation(({ ctx, input }) => ensureReferralCode({ ...input, tenantId: ctx.tenantId })),

  /** Native tier: a new customer gave a code. The resident app's signup will call the same service later. */
  recordReferral: operator
    .input(
      z.object({
        code: z.string().trim().min(3).max(32),
        referredName: z.string().trim().min(1).max(191),
        referredPhone: z.string().trim().max(32).optional(),
        referredEmail: z.string().trim().email().max(191).optional(),
      })
    )
    .mutation(({ ctx, input }) => recordReferral({ ...input, tenantId: ctx.tenantId })),

  markCreditApplied: operator
    .input(z.object({ referralId: z.string().min(1).max(64) }))
    .mutation(({ ctx, input }) => markReferrerCreditApplied({ ...input, tenantId: ctx.tenantId, actor: actorOf(ctx) })),

  /** CleanCloud tier: a copy of the Referral Code Usage window, pasted or (later) read by GumballPals/Jawbreaker. */
  importCleanCloudUsage: operator
    .input(z.object({ text: z.string().min(1).max(200_000) }))
    .mutation(({ ctx, input }) => importCleanCloudReferralUsage({ tenantId: ctx.tenantId, rows: input.text })),
});
