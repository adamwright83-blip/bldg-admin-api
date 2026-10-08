import { logAgentEvent } from "./agentEvents";
import { evaluateHumanApproval } from "./humanApproval";
import { assertToolPermission, type AgentContext } from "./permissions";
import { getAgentTool, getAgentToolPolicy } from "./toolRegistry";
import {
  evaluatePersistentActionPolicy,
  type PersistentActionPolicyDecision,
} from "./persistentOperator/actionPolicy";
import type { AgentEventWrite } from "./agentEvents";

export function validatedPersistentPolicyEventContext(
  ctx: AgentContext,
  policy: Extract<PersistentActionPolicyDecision, { allowed: true }>
): AgentContext {
  const standing =
    policy.authority === "standing_authorization"
      ? {
          standingAuthorizationId: policy.standingAuthorizationId,
          standingAuthorizationVersion: policy.standingAuthorizationVersion,
        }
      : {
          standingAuthorizationId: null,
          standingAuthorizationVersion: null,
        };
  return {
    ...ctx,
    approvedByUserId:
      policy.authority === "explicit_approval"
        ? ctx.approvedByUserId ?? null
        : null,
    authorityBasis: policy.authority,
    approvalBasis:
      policy.authority === "explicit_approval"
        ? "explicit_approval"
        : policy.authority === "standing_authorization"
          ? "standing_authorization"
          : "automatic",
    ...standing,
  };
}

export type ExternalCommunicationExecutionState =
  | "proved"
  | "not_sent"
  | "indeterminate";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function classifyExternalCommunicationExecution(
  output: unknown
): ExternalCommunicationExecutionState {
  if (!isRecord(output)) return "indeterminate";
  if (output.sendOutcome === "unknown") return "indeterminate";
  if (output.sendOutcome === "rejected") return "not_sent";
  if (output.sent === false || output.providerAccepted === false) return "not_sent";
  if (output.sent === true) {
    return nonEmptyString(output.communicationReceiptId) &&
      nonEmptyString(output.authorityReceiptId)
      ? "proved"
      : "indeterminate";
  }
  if (output.providerAccepted === true) {
    const receipt = isRecord(output.receipt) ? output.receipt : null;
    return receipt && nonEmptyString(receipt.id) ? "proved" : "indeterminate";
  }
  return "indeterminate";
}

export function requirePersistentExecutionEventId(
  eventId: number | null
): number {
  if (!Number.isSafeInteger(eventId) || (eventId ?? 0) <= 0) {
    throw new Error(
      "Persistent execution refused: durable execution-start authority event was not persisted"
    );
  }
  return eventId as number;
}

async function safeLogAgentEvent(
  event: AgentEventWrite
): Promise<number | null> {
  try {
    return await logAgentEvent(event);
  } catch (error) {
    console.warn("[AgentEvents] Failed to persist event:", error);
    return null;
  }
}

export async function runAgentTool<TOutput = unknown>(
  toolName: string,
  input: unknown,
  ctx: AgentContext
): Promise<TOutput> {
  const started = Date.now();
  let requiresHumanApproval = false;
  let eventCtx: AgentContext = {
    ...ctx,
    approvalBasis:
      ctx.approvalBasis ??
      (ctx.approvedByUserId?.trim() ? "explicit_approval" : null),
  };

  try {
    assertToolPermission(ctx, toolName);
    const tool = getAgentTool(toolName);
    const toolPolicy = getAgentToolPolicy(toolName);
    let approval = evaluateHumanApproval(ctx, toolName);

    if (ctx.agentType === "goal_cycle_agent") {
      await safeLogAgentEvent({
        ctx: eventCtx,
        toolName,
        inputJson: input,
        status: "proposed",
        operationStatus: "proposed",
        latencyMs: Date.now() - started,
        requiresHumanApproval: tool.requiresHumanApproval === true,
      });

      const persistentPolicy = await evaluatePersistentActionPolicy({
        tenantId: ctx.tenantId,
        canonicalOperatorId: ctx.canonicalOperatorId ?? "",
        operatorUserId: ctx.actorId ?? "",
        exactAction: toolName,
        riskClass: toolPolicy.riskClass,
        standingAuthorizationId: ctx.standingAuthorizationId,
        approvedByUserId: ctx.approvedByUserId,
      });
      if (!persistentPolicy.allowed) {
        const approvalRequired =
          persistentPolicy.reason === "explicit_approval_required" ||
          persistentPolicy.reason === "standing_authorization_required";
        const output = {
          approvalRequired,
          toolName,
          reason: `Persistent action policy denied: ${persistentPolicy.reason}`,
        };
        await safeLogAgentEvent({
          ctx: eventCtx,
          toolName,
          inputJson: input,
          outputJson: output,
          status: approvalRequired ? "approval_required" : "policy_denied",
          operationStatus: approvalRequired
            ? "approval_required"
            : "policy_denied",
          latencyMs: Date.now() - started,
          requiresHumanApproval: approvalRequired,
        });
        return output as TOutput;
      }

      eventCtx = validatedPersistentPolicyEventContext(
        eventCtx,
        persistentPolicy
      );
      if (
        toolPolicy.riskClass === "EXTERNAL_COMMUNICATION" &&
        persistentPolicy.authority === "standing_authorization"
      ) {
        approval = {
          allowed: true,
          requiresHumanApproval: false,
          approvedByUserId: null,
        };
      }
    }

    requiresHumanApproval =
      tool.requiresHumanApproval === true || approval.requiresHumanApproval;

    if (!approval.allowed) {
      const output = {
        approvalRequired: true,
        toolName,
        reason: "Human approval is required before this action can run.",
      };
      await safeLogAgentEvent({
        ctx: eventCtx,
        toolName,
        inputJson: input,
        outputJson: output,
        status: "approval_required",
        operationStatus: "approval_required",
        latencyMs: Date.now() - started,
        requiresHumanApproval,
      });
      return output as TOutput;
    }

    if (ctx.agentType === "goal_cycle_agent") {
      const executionEventId = requirePersistentExecutionEventId(
        await safeLogAgentEvent({
          ctx: eventCtx,
          toolName,
          inputJson: input,
          status: "execution_started",
          operationStatus: "execution_started",
          latencyMs: Date.now() - started,
          requiresHumanApproval,
        })
      );
      eventCtx = { ...eventCtx, agentEventId: executionEventId };
    }

    const result = await tool.execute(input, eventCtx);

    if (toolPolicy.riskClass === "EXTERNAL_COMMUNICATION") {
      const proofState = classifyExternalCommunicationExecution(result.output);
      if (proofState !== "proved") {
        await safeLogAgentEvent({
          ctx: eventCtx,
          toolName,
          inputJson: input,
          outputJson: result.output,
          status: proofState === "not_sent" ? "failed" : "write_withheld",
          operationStatus:
            proofState === "not_sent"
              ? "provider_rejected_or_not_sent"
              : "external_effect_unpersisted",
          errorMessage:
            proofState === "not_sent"
              ? "External communication was not accepted by the provider."
              : "External communication may have been accepted, but durable receipt proof is missing.",
          latencyMs: Date.now() - started,
          entityType: result.entityType ?? null,
          entityId: result.entityId ?? null,
          requiresHumanApproval,
        });
        return result.output as TOutput;
      }
    }

    await safeLogAgentEvent({
      ctx: eventCtx,
      toolName,
      inputJson: input,
      outputJson: result.output,
      status: "success",
      operationStatus: "succeeded",
      latencyMs: Date.now() - started,
      entityType: result.entityType ?? null,
      entityId: result.entityId ?? null,
      requiresHumanApproval,
    });
    return result.output as TOutput;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await safeLogAgentEvent({
      ctx: eventCtx,
      toolName,
      inputJson: input,
      status: "failed",
      operationStatus: "failed",
      errorMessage: message,
      latencyMs: Date.now() - started,
      requiresHumanApproval,
    });
    throw error;
  }
}

export function parseOperatorVoiceCommand(note: string) {
  const text = note.trim();
  const lower = text.toLowerCase();
  const today = new Date().toISOString().split("T")[0];

  if (lower.includes("bank deposit") || lower.includes("bank deposits")) {
    const leaveTime = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/)?.[0] ?? null;
    const from = lower.includes("huntington park") ? "Huntington Park" : null;
    const to = /\bback to la\b|\bto la\b|\blos angeles\b/.test(lower) ? "Los Angeles" : null;
    return {
      actions: [
        {
          toolName: "createScheduleExceptionTool",
          input: {
            date: today,
            reason: "bank_deposits",
            startsAtLocal: leaveTime,
            locationFrom: from,
            locationTo: to,
            note: text,
          },
        },
        {
          toolName: "updateOperatorAvailabilityTool",
          input: {
            date: today,
            unavailableFromLocal: leaveTime,
            unavailableReason: "bank_deposits",
            inferredAvailability: to ? "Possible LA pickup availability from approximately 4pm onward if route timing supports it." : null,
          },
        },
      ],
    };
  }

  if (lower.includes("dry cleaning") || lower.includes("dry clean")) {
    const customerName = text.match(/\bpicking up\s+([A-Z][a-z]+)/)?.[1] ?? null;
    const buildingName = lower.includes("century park east") ? "Century Park East" : null;
    return {
      actions: [
        {
          toolName: "createPendingDryCleaningOrderTool",
          input: {
            firstName: customerName ?? "Unknown",
            lastName: "Customer",
            phone: "unknown",
            pickupDate: today,
            pickupTimeWindow: "in about an hour",
            address: buildingName ?? "Unknown building",
            buildingName,
            specialInstructions: `${text}\nIntake pending: collect garment and pricing details after pickup.`,
          },
        },
        {
          toolName: "createDriverStopTool",
          input: {
            date: today,
            stopType: "pickup",
            buildingName,
            customerName,
            eta: "in about an hour",
            notes: "Dry cleaning intake pending. Collect garment/pricing details after pickup.",
          },
        },
      ],
    };
  }

  return { actions: [{ toolName: "draftCustomerMessageTool", input: { note: text, audience: "internal" } }] };
}

export async function runOperatorVoiceCommand(note: string, ctx: AgentContext) {
  const plan = parseOperatorVoiceCommand(note);
  const results = [];
  for (const action of plan.actions) {
    results.push({
      toolName: action.toolName,
      output: await runAgentTool(action.toolName, action.input, ctx),
    });
  }
  return { note, actions: results };
}
