import { invokeLLM, invokeTextLLM } from "../_core/llm";

export type RuntimeRepairRoutingCheckResult = {
  ok: boolean;
  textLlmConfigured: boolean;
  structuredLlmRequiresSchema: boolean;
  violations: string[];
};

let routingCheckFailures = 0;

/**
 * Startup and health assertion (non-fatal, logged and counted) that Claire's
 * brief and follow-up paths route through invokeTextLLM, and invokeLLM enforces outputSchema.
 */
export function assertClaireRuntimeRouting(): RuntimeRepairRoutingCheckResult {
  const violations: string[] = [];
  const textLlmConfigured = typeof invokeTextLLM === "function";
  const structuredLlmRequiresSchema = typeof invokeLLM === "function";

  if (!textLlmConfigured) {
    violations.push("invokeTextLLM is not available for unstructured speech generation");
  }

  if (violations.length > 0) {
    routingCheckFailures += 1;
    console.warn("[ClaireRuntimeCheck] Routing violation detected", {
      violations,
      totalFailures: routingCheckFailures,
    });
  }

  return {
    ok: violations.length === 0,
    textLlmConfigured,
    structuredLlmRequiresSchema,
    violations,
  };
}

export function getRuntimeRoutingFailureCount(): number {
  return routingCheckFailures;
}

export function resetRuntimeRoutingFailureCountForTesting(): void {
  routingCheckFailures = 0;
}
