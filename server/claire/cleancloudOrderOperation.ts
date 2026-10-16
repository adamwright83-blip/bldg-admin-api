import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { logAgentEvent } from "../agents/agentEvents";
import type { AgentContext } from "../agents/permissions";
import {
  commandIntake,
  listIntake,
} from "../integrations/cleancloud/intake/service";
import type { PickupActor } from "../integrations/cleancloud/pickups/service";
import {
  validateIntakePlan,
  type IntakePlan,
  type IntakeProduct,
} from "../../shared/cleancloudIntake";

/**
 * Claire proposes a CleanCloud intake operation and queues it only after an
 * exact operator approval. The queue is the existing intake command. This
 * module does not log in to CleanCloud, open a browser, send SMS, place a
 * call, or charge a card.
 */
export type CleanCloudOrderAction = "prepare" | "approve_submit";

export type CleanCloudOrderOperationProposal = {
  status: "pending_approval";
  action: CleanCloudOrderAction;
  orderId: string;
  externalOrderId: string;
  customerName: string;
  revision: string | null;
  fingerprint: string;
  speech: string;
  providerContacted: false;
  charged: false;
};

export type CleanCloudOrderOperationReceipt = {
  status: "queued" | "already_queued";
  action: CleanCloudOrderAction;
  orderId: string;
  externalOrderId: string;
  state: string;
  revision: string | null;
  fingerprint: string;
  approvedByUserId: string;
  providerContacted: false;
  charged: false;
  smsSent: false;
  callPlaced: false;
  eventId: number | null;
};

type CapturedOrder = Awaited<ReturnType<typeof listIntake>>["orders"][number];

const fail = (message: string, code: "CONFLICT" | "FORBIDDEN" | "BAD_REQUEST" = "CONFLICT"): never => {
  throw new TRPCError({ code, message });
};

function observedIso(value: Date | string): string {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(time)) fail("Refresh CleanCloud Detail before preparing this order.");
  return new Date(time).toISOString();
}

function assertFresh(value: Date | string, maxMs: number) {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(time) || Math.abs(Date.now() - time) > maxMs) {
    fail("Refresh CleanCloud Detail before preparing this order.");
  }
}

function samePlan(left: IntakePlan | null | undefined, right: IntakePlan): boolean {
  if (!left || left.lines.length !== right.lines.length) return false;
  const a = [...left.lines].sort((x, y) => x.productId.localeCompare(y.productId));
  const b = [...right.lines].sort((x, y) => x.productId.localeCompare(y.productId));
  return a.every((line, index) => line.productId === b[index]!.productId && line.quantity === b[index]!.quantity);
}

function describePlan(plan: IntakePlan, catalog: IntakeProduct[]): string {
  return plan.lines
    .map(line => {
      const product = catalog.find(item => item.id === line.productId);
      const unit = product?.unit === "lb" ? "lb" : "pieces";
      return `${line.quantity} ${product?.label ?? line.productId} (${unit})`;
    })
    .join(", ");
}

export function prepareOperationFingerprint(input: {
  tenantId: string;
  orderId: string;
  externalOrderId: string;
  customerName: string;
  readyBy: string;
  observedAt: string;
  plan: IntakePlan;
}): string {
  const lines = [...input.plan.lines].sort((a, b) => a.productId.localeCompare(b.productId));
  return createHash("sha256")
    .update(JSON.stringify({
      action: "prepare",
      tenantId: input.tenantId,
      orderId: input.orderId,
      externalOrderId: input.externalOrderId,
      customerName: input.customerName,
      readyBy: input.readyBy,
      observedAt: input.observedAt,
      lines,
    }))
    .digest("hex");
}

async function capturedOrder(actor: PickupActor, orderId: string) {
  const current = await listIntake(actor);
  if (!current.enabled) fail("Connect the intake pilot in Gumball first.");
  const row = current.orders.find(order => order.id === orderId);
  if (!row || !row.sourcePresent) fail("Order unavailable or held.");
  return { catalog: current.catalog, row };
}

function preparePlan(row: CapturedOrder, catalog: IntakeProduct[], plan: IntakePlan | undefined) {
  assertFresh(row.observedAt, 300_000);
  if (!plan) fail("Enter the actual quantities before Claire can propose preparation.", "BAD_REQUEST");
  return validateIntakePlan(plan, catalog);
}

export async function proposeCleanCloudOrderOperation(input: {
  actor: PickupActor;
  orderId: string;
  action: CleanCloudOrderAction;
  plan?: IntakePlan;
}): Promise<CleanCloudOrderOperationProposal> {
  const { catalog, row } = await capturedOrder(input.actor, input.orderId);
  if (input.action === "prepare") {
    const plan = preparePlan(row, catalog, input.plan);
    const fingerprint = prepareOperationFingerprint({
      tenantId: input.actor.tenantId,
      orderId: row.id,
      externalOrderId: row.externalOrderId,
      customerName: row.sourceJson.customerName,
      readyBy: row.sourceJson.readyBy,
      observedAt: observedIso(row.observedAt),
      plan,
    });
    return {
      status: "pending_approval",
      action: "prepare",
      orderId: row.id,
      externalOrderId: row.externalOrderId,
      customerName: row.sourceJson.customerName,
      revision: row.revision,
      fingerprint,
      speech: `I'll queue preparation for CleanCloud order #${row.externalOrderId}, ${row.sourceJson.customerName}: ${describePlan(plan, catalog)}. This does not contact CleanCloud, submit the order, or charge a card. Approve this exact proposal to queue it.`,
      providerContacted: false,
      charged: false,
    };
  }
  if (input.action !== "approve_submit") fail("That CleanCloud order operation is not available.", "BAD_REQUEST");
  if (row.state !== "review" || !row.preparedJson || !row.preparedAt || !row.revision) {
    fail("No prepared draft is waiting for approval.");
  }
  assertFresh(row.preparedAt, 600_000);
  const draft = row.preparedJson;
  const dollars = `$${(draft.totalCents / 100).toFixed(2)}`;
  return {
    status: "pending_approval",
    action: "approve_submit",
    orderId: row.id,
    externalOrderId: row.externalOrderId,
    customerName: row.sourceJson.customerName,
    revision: row.revision,
    fingerprint: draft.fingerprint,
    speech: `The prepared CleanCloud draft for order #${row.externalOrderId}, ${row.sourceJson.customerName}, shows ${dollars}. Approving queues the existing submit command for the paired browser. This server does not contact CleanCloud and does not charge a card. Approve this exact fingerprint to queue it.`,
    providerContacted: false,
    charged: false,
  };
}

async function recordReceipt(input: {
  actor: PickupActor;
  approvedByUserId: string;
  receipt: Omit<CleanCloudOrderOperationReceipt, "eventId">;
}): Promise<number | null> {
  const ctx: AgentContext = {
    tenantId: input.actor.tenantId,
    agentType: "operator_voice_agent",
    actorType: "human",
    actorId: input.actor.actorId,
    approvedByUserId: input.approvedByUserId,
    authorityBasis: "explicit_approval",
    approvalBasis: "explicit_approval",
  };
  try {
    return await logAgentEvent({
      ctx,
      toolName: "commitCleanCloudOrderOperationTool",
      inputJson: {
        action: input.receipt.action,
        fingerprint: input.receipt.fingerprint,
        orderId: input.receipt.orderId,
      },
      outputJson: {
        status: input.receipt.status,
        state: input.receipt.state,
        providerContacted: false,
        charged: false,
      },
      status: "success",
      operationStatus: "success",
      requiresHumanApproval: true,
      entityType: "cleancloud_intake_order",
      entityId: input.receipt.orderId,
    });
  } catch {
    return null;
  }
}

export async function commitCleanCloudOrderOperation(input: {
  actor: PickupActor;
  approvedByUserId?: string | null;
  orderId: string;
  action: CleanCloudOrderAction;
  plan?: IntakePlan;
  fingerprint: string;
  revision: string | null;
  reviewed: true;
}): Promise<CleanCloudOrderOperationReceipt> {
  const approvedByUserId = input.approvedByUserId?.trim() ?? "";
  if (!approvedByUserId) {
    fail("Human approval is required before this CleanCloud order operation can queue.", "FORBIDDEN");
  }
  if (input.reviewed !== true) fail("Review the captured order before approving it.", "BAD_REQUEST");
  const { catalog, row } = await capturedOrder(input.actor, input.orderId);

  if (input.action === "prepare") {
    const plan = preparePlan(row, catalog, input.plan);
    const fingerprint = prepareOperationFingerprint({
      tenantId: input.actor.tenantId,
      orderId: row.id,
      externalOrderId: row.externalOrderId,
      customerName: row.sourceJson.customerName,
      readyBy: row.sourceJson.readyBy,
      observedAt: observedIso(row.observedAt),
      plan,
    });
    if (fingerprint !== input.fingerprint) {
      fail("This proposal does not match the captured order. Nothing was queued.");
    }
    const queued = row.state === "prepare_pending" || row.state === "preparing";
    if (queued && samePlan(row.planJson, plan)) {
      return finishReceipt(input.actor, approvedByUserId, {
        status: "already_queued",
        action: "prepare",
        orderId: row.id,
        externalOrderId: row.externalOrderId,
        state: row.state,
        revision: row.revision,
        fingerprint,
        approvedByUserId,
        providerContacted: false,
        charged: false,
        smsSent: false,
        callPlaced: false,
      });
    }
    if (row.revision !== input.revision) {
      fail("This proposal does not match the captured order. Nothing was queued.");
    }
    await commandIntake(input.actor, { id: row.id, action: "prepare", plan });
    const after = (await capturedOrder(input.actor, row.id)).row;
    return finishReceipt(input.actor, approvedByUserId, {
      status: "queued",
      action: "prepare",
      orderId: after.id,
      externalOrderId: after.externalOrderId,
      state: after.state,
      revision: after.revision,
      fingerprint,
      approvedByUserId,
      providerContacted: false,
      charged: false,
      smsSent: false,
      callPlaced: false,
    });
  }

  if (input.action !== "approve_submit") fail("That CleanCloud order operation is not available.", "BAD_REQUEST");
  const draft = row.preparedJson;
  if (!draft || draft.fingerprint !== input.fingerprint) {
    fail("This proposal does not match the captured order. Nothing was queued.");
  }
  const queued = row.state === "submit_pending" || row.state === "submitting";
  if (queued && row.revision === input.revision) {
    return finishReceipt(input.actor, approvedByUserId, {
      status: "already_queued",
      action: "approve_submit",
      orderId: row.id,
      externalOrderId: row.externalOrderId,
      state: row.state,
      revision: row.revision,
      fingerprint: draft.fingerprint,
      approvedByUserId,
      providerContacted: false,
      charged: false,
      smsSent: false,
      callPlaced: false,
    });
  }
  if (row.state !== "review" || row.revision !== input.revision) {
    fail("This proposal does not match the captured order. Nothing was queued.");
  }
  await commandIntake(input.actor, {
    id: row.id,
    action: "approve",
    revision: input.revision ?? undefined,
    fingerprint: input.fingerprint,
  });
  const after = (await capturedOrder(input.actor, row.id)).row;
  return finishReceipt(input.actor, approvedByUserId, {
    status: "queued",
    action: "approve_submit",
    orderId: after.id,
    externalOrderId: after.externalOrderId,
    state: after.state,
    revision: after.revision,
    fingerprint: draft.fingerprint,
    approvedByUserId,
    providerContacted: false,
    charged: false,
    smsSent: false,
    callPlaced: false,
  });
}

async function finishReceipt(
  actor: PickupActor,
  approvedByUserId: string,
  receipt: Omit<CleanCloudOrderOperationReceipt, "eventId">
): Promise<CleanCloudOrderOperationReceipt> {
  const eventId = await recordReceipt({ actor, approvedByUserId, receipt });
  return { ...receipt, eventId };
}
