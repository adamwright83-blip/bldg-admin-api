/**
 * The Hustler Lever — the driver-facing door onto customer recovery.
 *
 * WHY A SECOND ROUTER AND NOT A SECOND SYSTEM
 *
 * Everything here delegates to the same functions `churnRadarRouter` calls.
 * There is no parallel lifecycle, no second intervention table, no duplicate
 * scoring. That is not tidiness — `customer_recovery_interventions` carries a
 * unique index on (tenantId, activeCustomerKeyHash), so a parallel writer would
 * collide, and a parallel non-writer would let the same customer be contacted
 * twice by two surfaces that cannot see each other.
 *
 * WHY IT EXISTS AT ALL
 *
 * `dayforgeChurnProcedure` is scoped to owner/admin/operator. The driver's role
 * is `field`, which is excluded — so today a driver can SEE recovery work
 * through `system.field.today` but every action deep-links into an admin
 * console they cannot open. That asymmetry is the whole blocker.
 *
 * The fix is a narrow field-role surface, not a widened admin one. Relaxing
 * `dayforgeChurnProcedure` would hand drivers the entire Churn Radar console
 * including scan control and tenant profile settings. This router exposes only
 * the five steps of one mission.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * No procedure here can mark a customer recovered. There is no such procedure
 * anywhere, by design: only `refreshCustomerRecoveryAttribution` may, and only
 * from a real paid order by the same identity created after contact. Sending a
 * text is an action. Recovery is an outcome. The lever moves the first and must
 * never claim the second.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { dayforgeTenantMemberProcedure, router } from "../_core/trpc";
import {
  approveCustomerRecoveryDraft,
  createCustomerRecoveryIntervention,
  getLatestChurnScan,
  getRecoveryInterventionDetail,
  listRecoveryInterventions,
  markCustomerRecoveryContacted,
  prepareCustomerRecoveryManualContact,
  reviseCustomerRecoveryDraft,
  setCustomerRecoveryPermission,
} from "./customerChurnService";
import {
  LEVER_PULLS,
  explainEmpty,
  selectLeverCandidate,
  type LeverCandidate,
} from "./hustlerLeverSelection";

const uuid = z.string().uuid();
const contentHash = z.string().regex(/^[a-f0-9]{64}$/);

/** Statuses that mean "this customer is already your mission". */
const OPEN_STATUSES = new Set(["draft_pending_review", "approved", "contacted"]);

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined)
    throw new TRPCError({ code: "NOT_FOUND", message });
  return value;
}

export const hustlerLeverRouter = router({
  /**
   * What the machine is holding right now.
   *
   * Also the place attribution gets refreshed: `listRecoveryInterventions`
   * runs `refreshCustomerRecoveryAttribution` as a side effect, so a mission
   * that has since been genuinely recovered stops showing as merely contacted.
   * A surface that never calls it shows stale state forever.
   */
  current: dayforgeTenantMemberProcedure.query(async ({ ctx }) => {
    const interventions = await listRecoveryInterventions(ctx.tenantId);
    const open = interventions.filter(item => OPEN_STATUSES.has(item.status));
    return {
      mission: open[0] ?? null,
      openCount: open.length,
      contactedToday: interventions.filter(
        item =>
          item.status === "contacted" &&
          item.contactedAt !== null &&
          isSameLocalDay(new Date(item.contactedAt), new Date())
      ).length,
    };
  }),

  /**
   * Pull the lever.
   *
   * Deterministic, and idempotent in the way that matters: if a mission is
   * already open it is returned rather than a new customer being dealt. Pulling
   * again is resuming, never rerolling — the machine does not change its mind
   * because you looked away.
   */
  pull: dayforgeTenantMemberProcedure
    .input(z.object({ pull: z.enum(LEVER_PULLS), requestId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const interventions = await listRecoveryInterventions(ctx.tenantId);
      const open = interventions.filter(item => OPEN_STATUSES.has(item.status));
      if (open[0]) return { mission: open[0], dealt: false as const, empty: null };

      const scan = await getLatestChurnScan(ctx.tenantId);
      const candidates: LeverCandidate[] = (scan?.customers ?? []).map(row => ({
        id: row.id,
        score: row.score,
        activeOrderCount: row.activeOrderCount,
        historyOrderCount: row.historyOrderCount,
        daysSinceLastOrder: row.daysSinceLastOrder,
        estimatedMonthlyImpactCents: row.estimatedMonthlyImpactCents,
      }));

      // Customers already carrying an intervention in ANY state — including
      // recovered — must not be re-dealt from this scan's snapshots.
      const taken = interventions.map(item => item.customer.id);
      const chosen = selectLeverCandidate(candidates, input.pull, taken);
      if (!chosen) {
        return {
          mission: null,
          dealt: false as const,
          empty: explainEmpty(candidates, taken),
        };
      }

      const mission = required(
        await createCustomerRecoveryIntervention({
          snapshotId: chosen.id,
          requestId: input.requestId,
          tenantId: ctx.tenantId,
          actorId: ctx.user.openId,
        }),
        "Recovery mission was not persisted"
      );
      return { mission, dealt: true as const, empty: null };
    }),

  /** MAKE IT HUMAN — the operator's rewrite. */
  humanize: dayforgeTenantMemberProcedure
    .input(
      z.object({
        interventionId: uuid,
        requestId: uuid,
        message: z.string().trim().min(1).max(320),
      })
    )
    .mutation(async ({ ctx, input }) =>
      required(
        await reviseCustomerRecoveryDraft({
          ...input,
          tenantId: ctx.tenantId,
          actorId: ctx.user.openId,
        }),
        "Recovery mission not found"
      )
    ),

  approve: dayforgeTenantMemberProcedure
    .input(
      z.object({
        interventionId: uuid,
        draftId: uuid,
        requestId: uuid,
        confirmation: z.literal(
          "I reviewed this exact message and approve it for this customer"
        ),
      })
    )
    .mutation(({ ctx, input }) =>
      approveCustomerRecoveryDraft({
        interventionId: input.interventionId,
        draftId: input.draftId,
        requestId: input.requestId,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),

  /**
   * Record how permission to text this customer exists.
   *
   * Goldline never sends anything itself — `prepareManualContact` returns an
   * `sms:` URL that opens the operator's own messaging app, and the operator
   * sends from their own number. But the service still requires a recorded
   * basis before it will hand over that composer, and `sourceReference` is
   * where the operator says what that basis is.
   *
   * Exposed to the driver because they are the person who actually knows —
   * they took the order, or the customer asked them to follow up. Requiring a
   * trip to an admin console to record a fact only the driver holds is how that
   * fact ends up never recorded.
   */
  recordPermission: dayforgeTenantMemberProcedure
    .input(
      z.object({
        interventionId: uuid,
        requestId: uuid,
        status: z.enum(["opted_in", "opted_out"]),
        sourceReference: z.string().trim().min(3).max(512),
      })
    )
    .mutation(({ ctx, input }) =>
      setCustomerRecoveryPermission({
        interventionId: input.interventionId,
        requestId: input.requestId,
        status: input.status,
        sourceReference: input.sourceReference,
        // Captured now, by the person recording it. A driver cannot honestly
        // backdate consent, so the lever does not offer them the option.
        capturedAt: new Date(),
        expiresAt: null,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),

  /** Hands back an `sms:` URL. Opens the operator's messaging app; sends nothing. */
  openComposer: dayforgeTenantMemberProcedure
    .input(
      z.object({
        interventionId: uuid,
        draftId: uuid,
        contentHash,
        requestId: uuid,
      })
    )
    .mutation(({ ctx, input }) =>
      prepareCustomerRecoveryManualContact({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),

  /**
   * The operator attests they sent it. This is what moves the meter.
   *
   * Attested, not verified — the event metadata says so
   * (`operatorReported: true, providerDeliveryVerified: false`) and the world
   * event carries `doesNotMeanRecovered: true`. The meter is answering "did I
   * do the hard thing within my control today", which an attestation is exactly
   * the right evidence for.
   */
  confirmSent: dayforgeTenantMemberProcedure
    .input(
      z.object({
        interventionId: uuid,
        draftId: uuid,
        contentHash,
        requestId: uuid,
        confirmation: z.literal(
          "I manually sent this exact approved message to this customer"
        ),
      })
    )
    .mutation(({ ctx, input }) =>
      markCustomerRecoveryContacted({
        interventionId: input.interventionId,
        draftId: input.draftId,
        contentHash: input.contentHash,
        requestId: input.requestId,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),

  mission: dayforgeTenantMemberProcedure
    .input(z.object({ interventionId: uuid }))
    .query(async ({ ctx, input }) =>
      required(
        await getRecoveryInterventionDetail({
          tenantId: ctx.tenantId,
          interventionId: input.interventionId,
        }),
        "Recovery mission not found"
      )
    ),
});

/** Local-day comparison, so "today" means the operator's day, not UTC's. */
function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
