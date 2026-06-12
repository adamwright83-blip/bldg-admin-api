import { createOpsTask, mapLegacyLevelToOps } from "../../opsTasks";
import type { AgentTool } from "../toolRegistry";

/**
 * Resident post-order follow-up → a REAL operator-facing task.
 *
 * After a laundry order is booked, the resident may ask to cancel it or change
 * the pickup/return timing. The resident app cannot mutate the admin order
 * directly (no resident-facing order-cancel/reschedule endpoint exists, and we
 * must not), so this tool records the ask as an ops task the operator works.
 *
 * This is what makes the post-order courier ("horse") honest: it rides only
 * when a real operator task is created here. The admin order is left untouched
 * — the operator decides and acts. We therefore NEVER claim the change is done;
 * the resident copy says "request sent" / "asking the vendor", never "canceled"
 * or "confirmed".
 *
 * Uses the existing createOpsTask infrastructure + existing enum values
 * (taskType "vendor_followup", source "agent_suggested") — no schema migration.
 */

type FollowupType =
  | "cancel_request"
  | "return_by_time"
  | "pickup_time_change"
  | "timing_constraint";

type CreateOrderFollowupTaskInput = {
  followupType: FollowupType;
  requestText: string;
  orderId?: number | string | null;
  clientRequestId?: string | null;
  bldgUserId?: number | string | null;
  customerId?: number | string | null;
  residentName?: string | null;
  phone?: string | null;
  serviceLabel?: string | null;
  requestedWindow?: string | null;
  deadline?: string | null;
};

function toNumberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

const FOLLOWUP_LABEL: Record<FollowupType, string> = {
  cancel_request: "cancellation request",
  return_by_time: "return-by-time request",
  pickup_time_change: "pickup-time change",
  timing_constraint: "timing constraint",
};

export const createOrderFollowupTaskTool: AgentTool<CreateOrderFollowupTaskInput, {
  opsTaskId: number;
  followupType: FollowupType;
  status: "open";
  orderId: number | null;
  customerCharged: false;
  orderMutated: false;
}> = {
  name: "createOrderFollowupTaskTool",
  description:
    "Record a resident post-order follow-up (cancel / return-by / pickup-time change / timing constraint) as an operator task against an existing order. Does NOT mutate the order or charge the customer — the operator acts on it.",
  async execute(input, ctx) {
    const followupType = input.followupType;
    if (!followupType || !FOLLOWUP_LABEL[followupType]) {
      throw new Error("followupType must be one of cancel_request | return_by_time | pickup_time_change | timing_constraint");
    }
    const requestText = text(input.requestText);
    if (!requestText) {
      throw new Error("requestText is required");
    }

    const orderId = toNumberOrNull(input.orderId);
    const serviceLabel = text(input.serviceLabel) ?? "Laundry";
    const requestedWindow = text(input.requestedWindow);
    const deadline = text(input.deadline);
    const residentName = text(input.residentName);

    const orderRef = orderId ? `order #${orderId}` : "their open order";
    const title =
      followupType === "cancel_request"
        ? `${serviceLabel} cancellation request — ${orderRef}`
        : followupType === "return_by_time"
          ? `${serviceLabel} return-by request — ${orderRef}`
          : followupType === "pickup_time_change"
            ? `${serviceLabel} pickup-time change — ${orderRef}`
            : `${serviceLabel} timing constraint — ${orderRef}`;

    const descriptionLines = [
      residentName ? `Resident: ${residentName}` : null,
      requestedWindow ? `Requested: ${requestedWindow}` : null,
      deadline ? `Deadline/why: ${deadline}` : null,
      `Resident said: "${requestText}"`,
      `Action: contact the vendor / operator to ${
        followupType === "cancel_request" ? "stand down this order" : "confirm whether this timing is possible"
      }. The order has NOT been changed; resident was told it is being requested, not confirmed.`,
    ].filter(Boolean);

    const mapped = mapLegacyLevelToOps("level_2");
    const opsTask = await createOpsTask({
      tenantId: ctx.tenantId,
      lane: mapped.lane,
      level: mapped.level,
      taskType: "vendor_followup",
      title: title.slice(0, 255),
      description: descriptionLines.join("\n"),
      source: "agent_suggested",
      status: "open",
      priority: followupType === "cancel_request" ? "high" : "normal",
      createdBy: ctx.actorId ?? null,
      customerId: toNumberOrNull(input.customerId),
      orderId,
      metadataJson: {
        followupType,
        source: "resident_post_order_followup",
        orderId,
        clientRequestId: text(input.clientRequestId),
        bldgUserId: toNumberOrNull(input.bldgUserId),
        requestedWindow,
        deadline,
        residentPhone: text(input.phone),
        residentName,
        requestText,
      },
    });

    return {
      entityType: "ops_task",
      entityId: opsTask.id,
      output: {
        opsTaskId: opsTask.id,
        followupType,
        status: "open",
        orderId,
        customerCharged: false,
        orderMutated: false,
      },
    };
  },
};
