import { z } from "zod";
import { dayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { extractImpactSignals } from "./impactSignalExtraction";
import {
  confirmImpactSignals,
  ensureTrackedDefinition,
  impactLedgerTally,
  listImpactSignals,
  listTrackedDefinitions,
  promoteTrackedDefinition,
} from "./impactSignalService";
import {
  IMPACT_CLASSES,
  OPERATOR_STOP_KINDS,
  SIGNAL_VALUE_TYPES,
} from "../../shared/impactSignal";

const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const proposedSignal = z.object({
  signalKey: z.string().trim().min(1).max(96),
  label: z.string().trim().min(1).max(191),
  valueType: z.enum(SIGNAL_VALUE_TYPES),
  value: z.string().max(4000),
  unit: z.string().trim().max(32).nullable(),
  impactClass: z.enum(IMPACT_CLASSES),
  entityType: z.string().trim().max(64).nullable(),
  entityLabel: z.string().trim().max(191).nullable(),
  notes: z.string().trim().max(4000).nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  startsTracking: z.boolean(),
});

export const impactSignalRouter = router({
  /**
   * Speech -> proposed structure. A mutation because it calls a model and
   * costs money, so it must be an explicit act rather than something a cache
   * refetch can trigger. Writes nothing.
   */
  propose: dayforgeTenantMemberProcedure
    .input(
      z.object({
        speech: z.string().trim().min(2).max(4000),
        /**
         * The stop the operator arrived at. The kind is a closed enum on the
         * wire so a caller cannot describe an order stop as a building — the
         * one lie that would later read as canonical linkage.
         */
        entityHint: z
          .object({
            entityType: z.enum(OPERATOR_STOP_KINDS),
            entityId: z.string().trim().min(1).max(64),
            entityLabel: z.string().trim().min(1).max(191),
          })
          .nullable()
          .optional(),
      })
    )
    .mutation(({ input }) => extractImpactSignals(input)),

  /**
   * Records what the operator confirmed. Provenance is deliberately limited to
   * the two a human can legitimately assert — `system_verified` is not on the
   * wire at all, because a typed sentence is never the system observing
   * something itself.
   */
  confirm: dayforgeTenantMemberProcedure
    .input(
      z.object({
        businessDate,
        campaignId: z.string().trim().max(64).nullable(),
        signals: z.array(proposedSignal).min(1).max(20),
        provenance: z
          .enum(["operator_confirmed", "external_record"])
          .optional(),
        /**
         * Namespace-qualified stop identity. Unparseable values are dropped
         * rather than stored — see confirmImpactSignals.
         */
        entityId: z.string().trim().max(64).nullable().optional(),
        location: z.string().trim().max(512).nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      confirmImpactSignals({ ...input, tenantId: ctx.tenantId })
    ),

  list: dayforgeTenantMemberProcedure
    .input(
      z.object({
        campaignId: z.string().trim().max(64).nullable().optional(),
        businessDate: businessDate.optional(),
      })
    )
    .query(({ ctx, input }) =>
      listImpactSignals({ tenantId: ctx.tenantId, ...input })
    ),

  /** The Impact Ledger: counts per class, never collapsed into one score. */
  ledger: dayforgeTenantMemberProcedure
    .input(z.object({ campaignId: z.string().trim().max(64).nullable().optional() }))
    .query(({ ctx, input }) =>
      impactLedgerTally({ tenantId: ctx.tenantId, ...input })
    ),

  trackedDefinitions: dayforgeTenantMemberProcedure.query(({ ctx }) =>
    listTrackedDefinitions({ tenantId: ctx.tenantId })
  ),

  /** Declares a novel signal worth asking about repeatedly. */
  track: dayforgeTenantMemberProcedure
    .input(
      z.object({
        signalKey: z.string().trim().min(1).max(96),
        label: z.string().trim().min(1).max(191),
        valueType: z.enum(SIGNAL_VALUE_TYPES),
        impactClass: z.enum(IMPACT_CLASSES),
        appliesTo: z.string().trim().max(64).nullable(),
        unit: z.string().trim().max(32).nullable(),
        options: z.array(z.string().trim().min(1).max(96)).max(20).nullable(),
      })
    )
    .mutation(({ ctx, input }) =>
      ensureTrackedDefinition({
        ...input,
        tenantId: ctx.tenantId,
        createIfMissing: true,
      })
    ),

  /** Promotion is an editorial act, taken by a person. */
  promote: dayforgeTenantMemberProcedure
    .input(z.object({ signalKey: z.string().trim().min(1).max(96) }))
    .mutation(({ ctx, input }) =>
      promoteTrackedDefinition({ tenantId: ctx.tenantId, signalKey: input.signalKey })
    ),
});
