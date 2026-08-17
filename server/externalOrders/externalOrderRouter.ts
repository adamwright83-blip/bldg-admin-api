import { z } from "zod";
import { dayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { extractExternalDayFromScreenshots } from "./externalOrderExtraction";
import {
  completeExternalOrder,
  confirmExternalImport,
  createManualExternalOrder,
  listExternalOrders,
  reconcileExternalOrder,
} from "./externalOrderService";
import {
  EXTERNAL_JOB_KINDS,
  EXTERNAL_SOURCE_SYSTEMS,
} from "../../shared/externalOperationalOrder";

const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clockTime = z.string().regex(/^\d{2}:\d{2}$/);
/** Screenshots arrive as data URLs — the same shape the vision path expects. */
const dataUrl = z
  .string()
  .regex(/^data:image\/(png|jpe?g|gif|webp);base64,/, "Expected an image data URL");

const extractedJob = z.object({
  jobKind: z.enum(EXTERNAL_JOB_KINDS),
  customerName: z.string().trim().min(1).max(191),
  address: z.string().trim().max(512).nullable(),
  scheduledDate: businessDate.nullable(),
  windowStart: clockTime.nullable(),
  windowEnd: clockTime.nullable(),
  notes: z.string().trim().max(2000).nullable(),
  externalOrderId: z.string().trim().max(191).nullable(),
});

export const externalOrderRouter = router({
  /**
   * Reads screenshots into a PROPOSAL. Deliberately a mutation rather than a
   * query — it calls a vision model and costs money, so it must be an explicit
   * act, never something a cache refetch can trigger. It writes nothing.
   */
  extractFromScreenshots: dayforgeTenantMemberProcedure
    .input(z.object({ images: z.array(dataUrl).min(1).max(6) }))
    .mutation(({ input }) => extractExternalDayFromScreenshots(input)),

  /**
   * Persists what the operator actually approved. The jobs come from the
   * review screen, so any correction they made is what lands — the model's
   * original reading is never written.
   */
  confirmImport: dayforgeTenantMemberProcedure
    .input(
      z.object({
        batchId: z.string().uuid(),
        sourceSystem: z.enum(EXTERNAL_SOURCE_SYSTEMS),
        jobs: z.array(extractedJob).min(1).max(60),
      })
    )
    .mutation(({ ctx, input }) =>
      confirmExternalImport({ ...input, tenantId: ctx.tenantId })
    ),

  /** One hand-entered job — the text/call/DM path. */
  createManual: dayforgeTenantMemberProcedure
    .input(
      extractedJob.extend({
        sourceSystem: z.enum(EXTERNAL_SOURCE_SYSTEMS),
        ingestionMethod: z.enum(["manual", "voice"]),
      })
    )
    .mutation(({ ctx, input }) =>
      createManualExternalOrder({ ...input, tenantId: ctx.tenantId })
    ),

  list: dayforgeTenantMemberProcedure
    .input(z.object({ scheduledDate: businessDate.optional() }))
    .query(({ ctx, input }) =>
      listExternalOrders({ tenantId: ctx.tenantId, ...input })
    ),

  /**
   * The physical work happened. Leaves reconciliation at `update_required`,
   * because this app cannot tell CleanCloud anything.
   */
  complete: dayforgeTenantMemberProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      completeExternalOrder({ tenantId: ctx.tenantId, id: input.id })
    ),

  /** The operator states they updated CleanCloud. Not a verification. */
  reconcile: dayforgeTenantMemberProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      reconcileExternalOrder({ tenantId: ctx.tenantId, id: input.id })
    ),
});
