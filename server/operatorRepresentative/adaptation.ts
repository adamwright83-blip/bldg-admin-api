import { isClaireOperatorContextAdaptationEnabled } from "../claire/operatorAdaptationContext";
import type { OperatorRepresentativeDirectiveRecord } from "./directives";

export type OperatorRepresentativeAdaptationPolicy = {
  enabled: boolean;
  suppressedItemIds: string[];
  askInsteadItemIds: string[];
  correctionValuesByTargetKey: Record<string, string>;
  activeAdaptations: Array<{
    targetKey: string;
    status: "active" | "eligible_not_wired";
    value?: string;
  }>;
};

const WIRED_EXPLICIT_TARGETS = new Set<string>([
  // Intentionally tiny. New targets require a dedicated, truth-preserving
  // integration and tests; learned deltas never become live merely by existing.
]);

export function buildOperatorRepresentativeAdaptationPolicy(input: {
  tenantId: string;
  directives: OperatorRepresentativeDirectiveRecord[];
}): OperatorRepresentativeAdaptationPolicy {
  const enabled = isClaireOperatorContextAdaptationEnabled(input.tenantId);
  const active = input.directives.filter(item => item.status === "active");
  const suppressedItemIds = active
    .filter(item => item.directiveKind === "suppress")
    .map(item => item.targetItemId);
  const askInsteadItemIds = active
    .filter(item => item.directiveKind === "ask_instead")
    .map(item => item.targetItemId);
  const correctionValuesByTargetKey: Record<string, string> = {};
  const activeAdaptations: OperatorRepresentativeAdaptationPolicy["activeAdaptations"] = [];

  for (const directive of active) {
    if (directive.directiveKind !== "correction" || !directive.targetKey) continue;
    const value =
      directive.operatorDeclaredValue && typeof directive.operatorDeclaredValue.value === "string"
        ? directive.operatorDeclaredValue.value
        : undefined;
    if (value) correctionValuesByTargetKey[directive.targetKey] = value;
    activeAdaptations.push({
      targetKey: directive.targetKey,
      status: enabled && WIRED_EXPLICIT_TARGETS.has(directive.targetKey)
        ? "active"
        : "eligible_not_wired",
      value,
    });
  }

  return {
    enabled,
    suppressedItemIds,
    askInsteadItemIds,
    correctionValuesByTargetKey,
    activeAdaptations,
  };
}
