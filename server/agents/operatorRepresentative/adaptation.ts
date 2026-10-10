import { isClaireOperatorContextAdaptationEnabled } from "../../claire/operatorAdaptationContext";
import { resolveCanonicalOperatorIdentity } from "../persistentOperator/identity";
import {
  listActiveOperatorRepresentativeDirectives,
  type OperatorRepresentativeDirectiveRecord,
} from "./directives";
import {
  DAPHNE_STAGE3B_BEHAVIOR_CLASS,
  DAPHNE_STAGE3B_TARGET_KEY,
  type DaphneAdaptationLifecycleState,
  type OperatorAdaptationDecision,
} from "./adaptationContract";
import type { DaphneAdaptationUseReceipt } from "./adaptationReceipts";
import { loadDaphneMetaPreferences, daphneAdaptationAllowed } from "../daphne/goalsPreferences";

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

export const WIRED_EXPLICIT_TARGETS = new Set<string>([
  DAPHNE_STAGE3B_TARGET_KEY,
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
      status:
        enabled && WIRED_EXPLICIT_TARGETS.has(directive.targetKey)
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

export function buildOperatorAdaptationDecision(input: {
  tenantId: string;
  canonicalOperatorId: string;
  enabled: boolean;
  directives: OperatorRepresentativeDirectiveRecord[];
}): OperatorAdaptationDecision | null {
  if (!input.enabled) return null;
  const directive = input.directives.find(
    item =>
      item.status === "active" &&
      item.directiveKind === "ask_instead" &&
      item.targetKey === DAPHNE_STAGE3B_TARGET_KEY
  );
  if (!directive) return null;
  return {
    tenantId: input.tenantId,
    canonicalOperatorId: input.canonicalOperatorId,
    directiveId: directive.id,
    targetKey: DAPHNE_STAGE3B_TARGET_KEY,
    behaviorClass: DAPHNE_STAGE3B_BEHAVIOR_CLASS,
    status: "applicable",
  };
}

export async function loadOperatorAdaptationDecisionForUser(input: {
  tenantId: string;
  operatorUserId: string;
}): Promise<OperatorAdaptationDecision | null> {
  if (!isClaireOperatorContextAdaptationEnabled(input.tenantId)) return null;
  const operatorUserId = input.operatorUserId.trim();
  if (!operatorUserId) return null;
  const source = /^\d+$/.test(operatorUserId)
    ? { type: "user_id" as const, value: Number(operatorUserId) }
    : { type: "open_id" as const, value: operatorUserId };
  const resolution = await resolveCanonicalOperatorIdentity({
    tenantId: input.tenantId,
    source,
    subsystem: "daphne_stage3b",
  });
  if (!resolution.ok) return null;
  if(!daphneAdaptationAllowed(await loadDaphneMetaPreferences({
    tenantId:input.tenantId,canonicalOperatorId:resolution.identity.canonicalOperatorId,
  }))) return null;
  const directives = await listActiveOperatorRepresentativeDirectives({
    tenantId: input.tenantId,
    canonicalOperatorId: resolution.identity.canonicalOperatorId,
  });
  return buildOperatorAdaptationDecision({
    tenantId: input.tenantId,
    canonicalOperatorId: resolution.identity.canonicalOperatorId,
    enabled: true,
    directives,
  });
}

export type DaphneAdaptationLifecycleEntry = {
  directiveId: string;
  targetItemId: string;
  targetKey: string | null;
  directiveKind: OperatorRepresentativeDirectiveRecord["directiveKind"];
  directiveStatus: OperatorRepresentativeDirectiveRecord["status"];
  lifecycle: DaphneAdaptationLifecycleState;
  behaviorClass:
    | typeof DAPHNE_STAGE3B_BEHAVIOR_CLASS
    | null;
  useCount: number;
  lastUsedAt: string | null;
};

export function buildDaphneAdaptationLifecycle(input: {
  enabled: boolean;
  directives: OperatorRepresentativeDirectiveRecord[];
  receipts: DaphneAdaptationUseReceipt[];
}): DaphneAdaptationLifecycleEntry[] {
  const receiptsByDirective = new Map<string, DaphneAdaptationUseReceipt[]>();
  for (const receipt of input.receipts) {
    const existing = receiptsByDirective.get(receipt.directiveId) ?? [];
    existing.push(receipt);
    receiptsByDirective.set(receipt.directiveId, existing);
  }

  return input.directives.map(directive => {
    const receipts = receiptsByDirective.get(directive.id) ?? [];
    const wired =
      directive.targetKey != null &&
      WIRED_EXPLICIT_TARGETS.has(directive.targetKey) &&
      directive.directiveKind === "ask_instead";
    let lifecycle: DaphneAdaptationLifecycleState;
    if (!wired) {
      lifecycle = "unwired";
    } else if (directive.status === "revoked") {
      lifecycle = receipts.length ? "revoked_historical" : "revoked_unused";
    } else if (!input.enabled) {
      lifecycle = "disabled";
    } else if (receipts.length) {
      lifecycle = "used";
    } else {
      lifecycle = "wired_unused";
    }
    const latest = receipts
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return {
      directiveId: directive.id,
      targetItemId: directive.targetItemId,
      targetKey: directive.targetKey,
      directiveKind: directive.directiveKind,
      directiveStatus: directive.status,
      lifecycle,
      behaviorClass: wired ? DAPHNE_STAGE3B_BEHAVIOR_CLASS : null,
      useCount: receipts.length,
      lastUsedAt: latest?.createdAt ?? null,
    };
  });
}
