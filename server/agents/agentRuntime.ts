import { logAgentEvent } from "./agentEvents";
import { evaluateHumanApproval } from "./humanApproval";
import { assertToolPermission, type AgentContext } from "./permissions";
import { getAgentTool } from "./toolRegistry";
import type { AgentEventWrite } from "./agentEvents";

async function safeLogAgentEvent(event: AgentEventWrite): Promise<void> {
  try {
    await logAgentEvent(event);
  } catch (error) {
    console.warn("[AgentEvents] Failed to persist event:", error);
  }
}

export async function runAgentTool<TOutput = unknown>(
  toolName: string,
  input: unknown,
  ctx: AgentContext
): Promise<TOutput> {
  const started = Date.now();
  let requiresHumanApproval = false;

  try {
    assertToolPermission(ctx, toolName);
    const tool = getAgentTool(toolName);
    const approval = evaluateHumanApproval(ctx, toolName);
    requiresHumanApproval = tool.requiresHumanApproval === true || approval.requiresHumanApproval;

    if (!approval.allowed) {
      const output = {
        approvalRequired: true,
        toolName,
        reason: "Human approval is required before this action can run.",
      };
      await safeLogAgentEvent({
        ctx,
        toolName,
        inputJson: input,
        outputJson: output,
        status: "approval_required",
        latencyMs: Date.now() - started,
        requiresHumanApproval,
      });
      return output as TOutput;
    }

    const result = await tool.execute(input, ctx);
    await safeLogAgentEvent({
      ctx,
      toolName,
      inputJson: input,
      outputJson: result.output,
      status: "success",
      latencyMs: Date.now() - started,
      entityType: result.entityType ?? null,
      entityId: result.entityId ?? null,
      requiresHumanApproval,
    });
    return result.output as TOutput;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await safeLogAgentEvent({
      ctx,
      toolName,
      inputJson: input,
      status: "failed",
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
