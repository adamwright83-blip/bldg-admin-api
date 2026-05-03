import { getTenantAiUsage, incrementTenantAiUsage } from "../db";
import { logAgentEvent } from "./agentEvents";
import type { AgentContext } from "./permissions";

const DEFAULT_WARNING_LIMIT_CENTS = Number(process.env.AI_WARNING_LIMIT_CENTS ?? 5000);
const DEFAULT_HARD_LIMIT_CENTS = Number(process.env.AI_HARD_LIMIT_CENTS ?? 10000);

export function estimateModelCostCents(inputTokens: number, outputTokens: number): number {
  const inputPerMillionCents = Number(process.env.AI_INPUT_CENTS_PER_MILLION ?? 300);
  const outputPerMillionCents = Number(process.env.AI_OUTPUT_CENTS_PER_MILLION ?? 1500);
  return Math.ceil((inputTokens * inputPerMillionCents + outputTokens * outputPerMillionCents) / 1_000_000);
}

export async function getTenantAiLimitState(tenantId = "default") {
  const usage = await getTenantAiUsage(tenantId);
  const warningLimitCents = usage?.warningLimitCents ?? DEFAULT_WARNING_LIMIT_CENTS;
  const hardLimitCents = usage?.hardLimitCents ?? DEFAULT_HARD_LIMIT_CENTS;
  const estimatedCostCents = usage?.estimatedCostCents ?? 0;
  return {
    usage,
    warningLimitCents,
    hardLimitCents,
    estimatedCostCents,
    warning: estimatedCostCents >= warningLimitCents,
    hardLimitReached: estimatedCostCents >= hardLimitCents,
  };
}

export async function assertAiSpendAvailable(tenantId = "default"): Promise<void> {
  const state = await getTenantAiLimitState(tenantId);
  if (state.hardLimitReached) {
    throw new Error("AI hard limit reached; deterministic rules-only mode is active.");
  }
}

export async function trackModelUsage(input: {
  tenantId?: string;
  agentContext?: AgentContext;
  modelUsed?: string | null;
  inputTokens: number;
  outputTokens: number;
}) {
  const tenantId = input.tenantId ?? input.agentContext?.tenantId ?? "default";
  const estimatedCostCents = estimateModelCostCents(input.inputTokens, input.outputTokens);
  const usage = await incrementTenantAiUsage({
    tenantId,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    estimatedCostCents,
    warningLimitCents: DEFAULT_WARNING_LIMIT_CENTS,
    hardLimitCents: DEFAULT_HARD_LIMIT_CENTS,
  });

  if (usage && usage.estimatedCostCents >= usage.warningLimitCents) {
    await logAgentEvent({
      ctx: input.agentContext ?? {
        tenantId,
        agentType: "gm_agent",
        actorType: "system",
      },
      toolName: "ai_usage_warning",
      status: usage.estimatedCostCents >= usage.hardLimitCents ? "blocked" : "success",
      entityType: "tenant_ai_usage",
      entityId: usage.id,
      outputJson: {
        tenantId,
        month: usage.month,
        estimatedCostCents: usage.estimatedCostCents,
        warningLimitCents: usage.warningLimitCents,
        hardLimitCents: usage.hardLimitCents,
        hardLimitReached: usage.estimatedCostCents >= usage.hardLimitCents,
      },
      modelUsed: input.modelUsed ?? null,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      estimatedCostCents,
    });
  }

  return { usage, estimatedCostCents };
}
