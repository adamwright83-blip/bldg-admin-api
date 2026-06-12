import type { OpsTask } from "../drizzle/schema";
import type { InsertOrder } from "../drizzle/schema";

/**
 * Resident post-order follow-up loop (admin side).
 *
 * createOrderFollowupTaskTool (S2S, resident-triggered) creates ops_tasks rows
 * with taskType "vendor_followup" and metadataJson.source
 * "resident_post_order_followup". This module turns those rows into:
 *   1. the list the flashing-red banner polls (admin.bldg.chat + driver.bldg.chat)
 *   2. the order patch applied when the operator APPROVES a time change
 *   3. the payload written back to the resident app so the courier can return
 *
 * All functions are pure (testable without a DB).
 */

export type ResidentFollowupListItem = {
  taskId: number;
  orderId: number | null;
  followupType: "cancel_request" | "return_by_time" | "pickup_time_change" | "timing_constraint";
  requestText: string;
  requestedWindow: string | null;
  deadline: string | null;
  residentName: string | null;
  phone: string | null;
  bldgUserId: number | null;
  clientRequestId: string | null;
  createdAt: string;
};

function metaOf(task: Pick<OpsTask, "metadataJson">): Record<string, unknown> {
  const raw = task.metadataJson;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function textOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Map an ops task to a banner list item — or null if it isn't a resident follow-up. */
export function mapOpsTaskToResidentFollowup(
  task: Pick<OpsTask, "id" | "taskType" | "orderId" | "metadataJson" | "createdAt" | "status">
): ResidentFollowupListItem | null {
  if (task.taskType !== "vendor_followup") return null;
  const meta = metaOf(task);
  if (meta.source !== "resident_post_order_followup") return null;
  const followupType = textOrNull(meta.followupType) as ResidentFollowupListItem["followupType"] | null;
  if (!followupType) return null;
  return {
    taskId: task.id,
    orderId: task.orderId ?? numOrNull(meta.orderId),
    followupType,
    requestText: textOrNull(meta.requestText) ?? "(no message text)",
    requestedWindow: textOrNull(meta.requestedWindow),
    deadline: textOrNull(meta.deadline),
    residentName: textOrNull(meta.residentName),
    phone: textOrNull(meta.residentPhone),
    bldgUserId: numOrNull(meta.bldgUserId),
    clientRequestId: textOrNull(meta.clientRequestId),
    createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : String(task.createdAt),
  };
}

/** Normalize a bare time ("5pm") to a window label ("by 5pm"). Pass-through otherwise. */
export function normalizeWindowLabel(value: string): string {
  const v = value.trim();
  if (!v) return v;
  return /^(by|before|after|at)\b/i.test(v) ? v : `by ${v}`;
}

/**
 * The REAL order revision. Only an APPROVED reply mutates the order:
 *  - return_by_time / timing_constraint → deliveryTimeWindow
 *  - pickup_time_change                 → pickupTimeWindow
 * Declined / plain replies never touch the order.
 */
export function buildOrderPatchFromReply(
  followupType: ResidentFollowupListItem["followupType"],
  decision: "approved" | "declined" | undefined,
  newTime: string | undefined
): Partial<InsertOrder> | null {
  if (decision !== "approved") return null;
  const value = textOrNull(newTime ?? "");
  if (!value) return null;
  const label = normalizeWindowLabel(value);
  if (followupType === "pickup_time_change") {
    return { pickupTimeWindow: label };
  }
  if (followupType === "return_by_time" || followupType === "timing_constraint") {
    return { deliveryTimeWindow: label };
  }
  // cancel_request never patches windows from this path.
  return null;
}

export type ResidentReplyPayload = {
  bldgUserId: number | null;
  orderId: number | null;
  operatorTaskId: string;
  followupType: ResidentFollowupListItem["followupType"];
  requestedWindow: string | null;
  message: string;
  decision: "approved" | "declined" | null;
  newPickupTimeWindow: string | null;
  newDeliveryTimeWindow: string | null;
  repliedAt: string;
};

/** The S2S body posted back to the resident app (drives the returning courier). */
export function buildResidentReplyPayload(
  item: ResidentFollowupListItem,
  input: { message: string; decision?: "approved" | "declined"; newTime?: string },
  appliedPatch: Partial<InsertOrder> | null
): ResidentReplyPayload {
  return {
    bldgUserId: item.bldgUserId,
    orderId: item.orderId,
    operatorTaskId: String(item.taskId),
    followupType: item.followupType,
    requestedWindow: item.requestedWindow,
    message: input.message,
    decision: input.decision ?? null,
    newPickupTimeWindow: (appliedPatch?.pickupTimeWindow as string | undefined) ?? null,
    newDeliveryTimeWindow: (appliedPatch?.deliveryTimeWindow as string | undefined) ?? null,
    repliedAt: new Date().toISOString(),
  };
}

/**
 * POST the reply to the resident app (shared-secret S2S). Default base is the
 * public resident API host; override with RESIDENT_API_URL. Non-fatal — the
 * caller reports residentNotified so the operator UI can surface a failure.
 */
export async function postReplyToResident(payload: ResidentReplyPayload): Promise<boolean> {
  const base = (process.env.RESIDENT_API_URL || "https://api.bldg.chat").replace(/\/$/, "");
  const secret = process.env.APP_SHARED_API_SECRET || "";
  if (!secret) {
    console.warn("[ResidentFollowup] APP_SHARED_API_SECRET missing; cannot notify resident app");
    return false;
  }
  try {
    const res = await fetch(`${base}/api/held/followup-reply`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-app-shared-secret": secret,
      },
      body: JSON.stringify(payload),
    });
    const ok = res.ok;
    console.log(`[ResidentFollowup] write-back to resident: status=${res.status}`);
    return ok;
  } catch (err) {
    console.error("[ResidentFollowup] write-back failed:", err);
    return false;
  }
}

/** SMS body for the resident's phone (tap-link to the app). */
export function buildResidentReplySms(item: ResidentFollowupListItem, message: string): string {
  const snippet = message.length > 90 ? `${message.slice(0, 87)}…` : message;
  return `HELD — LAUNDRY BUTLER replied about your order: "${snippet}" Open https://app.bldg.chat to see it.`;
}
