import { createHash } from "node:crypto";
import type { CanonicalOperatorIdentity } from "../persistentOperator/identity";
import type {
  OperatorContextPacket,
  OperatorContextEvidenceRef,
  OperatorExplicitFact,
  OperatorExplicitPreference,
  OperatorObservedPattern,
  OperatorLearnedSignal,
  OperatorContextUncertainty,
} from "../persistentOperator/operatorContext";
import type { OperatorRepresentativeDirectiveRecord } from "./directives";
import {
  isClaireOperatorContextAdaptationEnabled,
  isClaireOperatorContextShadowEnabled,
} from "../claire/operatorAdaptationContext";
import type {
  OperatorRepresentativeEvidence,
  OperatorRepresentativeHome,
  OperatorRepresentativeItem,
  OperatorRepresentativeItemDetail,
} from "./types";

type InternalItem = {
  item: OperatorRepresentativeItem;
  evidenceRefIds: string[];
  meaning: string;
  provenance: string;
  uncertaintyReasons: OperatorContextUncertainty["reason"][];
  canCorrect: boolean;
  canSuppress: boolean;
  canAskInstead: boolean;
};

export type OperatorRepresentativeSnapshot = {
  home: OperatorRepresentativeHome;
  details: Map<string, OperatorRepresentativeItemDetail>;
};

function stableItemId(...parts: string[]): string {
  return `or_${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 20)}`;
}

function words(value: string): string {
  return value.replace(/[_:-]+/g, " ").replace(/\s+/g, " ").trim();
}

function titleCase(value: string): string {
  return words(value).replace(/\b\w/g, letter => letter.toUpperCase());
}

const UNCERTAINTY_COPY: Record<OperatorContextUncertainty["reason"], string> = {
  no_records: "No qualifying records yet",
  source_unavailable: "A source needed for this is unavailable",
  insufficient_observations: "Not enough evidence yet",
  missing_paired_timestamps: "Timing evidence is incomplete",
  timezone_unavailable: "Your working timezone is not established",
  conflicting_signals: "Evidence disagrees",
  stale_evidence: "The available evidence is stale",
  no_verified_outcome: "No verified-class outcome row is visible here",
  proximal_outcome_window_unavailable: "The observation window is not established",
  evidence_window_truncated: "The evidence window was truncated",
  operator_binding_unavailable: "The source is not authoritatively bound to this operator",
  invalid_temporal_evidence: "The event sequence is not valid for this comparison",
};

function explicitFactItem(fact: OperatorExplicitFact): InternalItem {
  const item: OperatorRepresentativeItem = {
    id: stableItemId("fact", fact.kind, fact.field, fact.evidenceRefId ?? fact.statement),
    category: "known",
    title:
      fact.kind === "declared_trade"
        ? "Your daily work"
        : fact.kind === "declared_service_area"
          ? "Your service area"
          : fact.kind === "declared_avoided_task"
            ? "A task you explicitly named"
            : fact.kind === "canonical_identity"
              ? "Your operator identity"
              : titleCase(fact.field),
    summary: fact.statement,
    provenanceClass:
      fact.provenance === "canonical_identity" ? "canonical_identity" : "operator_declared",
    confidence: fact.provenance === "operator_declared" ? "declared" : undefined,
    sourceCount: 1,
    evidenceAvailable: Boolean(fact.evidenceRefId),
    createdAt: fact.observedAt,
    updatedAt: fact.observedAt,
    targetKey: `fact:${fact.field}`,
    adaptationState: "not_eligible",
    canAffectAdaptation: false,
  };
  return {
    item,
    evidenceRefIds: fact.evidenceRefId ? [fact.evidenceRefId] : [],
    meaning: "This comes from an explicit source tied to your operator identity.",
    provenance: fact.provenance === "operator_declared" ? "Declared by you" : "Canonical operator identity",
    uncertaintyReasons: [],
    canCorrect: fact.provenance === "operator_declared",
    canSuppress: false,
    canAskInstead: false,
  };
}

function explicitPreferenceItem(pref: OperatorExplicitPreference): InternalItem {
  const item: OperatorRepresentativeItem = {
    id: stableItemId("preference", pref.kind, pref.targetKey, pref.evidenceRefId ?? pref.preference),
    category: "known",
    title: titleCase(pref.kind),
    summary: pref.preference,
    provenanceClass: "operator_declared",
    confidence: "declared",
    sourceCount: 1,
    evidenceAvailable: Boolean(pref.evidenceRefId),
    createdAt: pref.observedAt,
    updatedAt: pref.observedAt,
    targetKey: pref.targetKey,
    adaptationState: "eligible_not_wired",
    canAffectAdaptation: true,
  };
  return {
    item,
    evidenceRefIds: pref.evidenceRefId ? [pref.evidenceRefId] : [],
    meaning: "This is an explicit preference you declared, not a preference inferred from behavior.",
    provenance: `Declared by you via ${pref.sourceSystem}`,
    uncertaintyReasons: [],
    canCorrect: true,
    canSuppress: true,
    canAskInstead: true,
  };
}

function observedPatternItem(pattern: OperatorObservedPattern): InternalItem {
  const id = stableItemId("pattern", pattern.kind, ...pattern.evidenceRefs);
  return {
    item: {
      id,
      category: "learning",
      title: titleCase(pattern.kind),
      summary: pattern.summary,
      provenanceClass: "descriptive_observation",
      confidence: "descriptive",
      sourceCount: pattern.distinctCorrelationCount || pattern.observationCount,
      evidenceAvailable: pattern.evidenceRefs.length > 0,
      targetKey: `pattern:${pattern.kind}`,
      adaptationState: "not_eligible",
      canAffectAdaptation: false,
    },
    evidenceRefIds: pattern.evidenceRefs,
    meaning: "This is a descriptive pattern in qualifying observations. It is not a trait, motive, diagnosis, or preference.",
    provenance: `${pattern.observationCount} observations across ${pattern.distinctDecisionPointCount} decision points`,
    uncertaintyReasons: [],
    canCorrect: false,
    canSuppress: true,
    canAskInstead: true,
  };
}

function learnedSignalItem(signal: OperatorLearnedSignal): InternalItem {
  return {
    item: {
      id: stableItemId("learned", signal.sourceDeltaId),
      category: "changed",
      title: `${titleCase(signal.learningKind)} updated`,
      summary: `${titleCase(signal.targetKey)}: ${signal.deltaType} (${signal.confidence} confidence)`,
      provenanceClass: "learned_delta",
      confidence: signal.confidence,
      sourceCount: 1,
      evidenceAvailable: Boolean(signal.evidenceRefId),
      createdAt: signal.createdAt,
      updatedAt: signal.createdAt,
      targetKey: signal.targetKey,
      learningKind: signal.learningKind,
      adaptationState: "eligible_not_wired",
      canAffectAdaptation: false,
    },
    evidenceRefIds: signal.evidenceRefId ? [signal.evidenceRefId] : [],
    meaning: "A stored learned delta changed an operational weighting. That does not by itself mean Claire is using it live.",
    provenance: `Learned delta ${signal.sourceDeltaId}; evidence ${signal.evidenceReference}`,
    uncertaintyReasons: [],
    canCorrect: false,
    canSuppress: true,
    canAskInstead: true,
  };
}

function uncertaintyItem(uncertainty: OperatorContextUncertainty, index: number): InternalItem {
  return {
    item: {
      id: stableItemId("uncertainty", uncertainty.reason, uncertainty.scope, String(index)),
      category: "uncertain",
      title: UNCERTAINTY_COPY[uncertainty.reason],
      summary: `Scope: ${words(uncertainty.scope)}`,
      provenanceClass: "uncertainty",
      sourceCount: uncertainty.relatedEvidenceRefs?.length ?? 0,
      evidenceAvailable: Boolean(uncertainty.relatedEvidenceRefs?.length),
      targetKey: `uncertainty:${uncertainty.scope}`,
      uncertaintyReason: uncertainty.reason,
      adaptationState: "not_eligible",
      canAffectAdaptation: false,
    },
    evidenceRefIds: uncertainty.relatedEvidenceRefs ?? [],
    meaning: UNCERTAINTY_COPY[uncertainty.reason],
    provenance: "Operator Context uncertainty guard",
    uncertaintyReasons: [uncertainty.reason],
    canCorrect: false,
    canSuppress: false,
    canAskInstead: false,
  };
}

function directiveItem(directive: OperatorRepresentativeDirectiveRecord): InternalItem {
  const value =
    directive.operatorDeclaredValue && typeof directive.operatorDeclaredValue.value === "string"
      ? directive.operatorDeclaredValue.value
      : null;
  const isActive = directive.status === "active";
  const title =
    directive.directiveKind === "correction"
      ? "Your correction"
      : directive.directiveKind === "suppress"
        ? "You told JOYSTICK not to use this"
        : "You told JOYSTICK to ask first";
  const summary =
    directive.directiveKind === "correction"
      ? value || "An explicit correction is recorded."
      : directive.directiveKind === "suppress"
        ? "This signal is suppressed from Operator adaptation."
        : "JOYSTICK must ask before relying on this signal.";
  return {
    item: {
      id: stableItemId("directive", directive.id),
      category: "changed",
      title,
      summary: isActive ? summary : `${summary} (revoked)`,
      provenanceClass: "operator_directive",
      confidence: "declared",
      sourceCount: 1,
      evidenceAvailable: true,
      createdAt: directive.createdAt.toISOString(),
      updatedAt: directive.updatedAt.toISOString(),
      targetKey: directive.targetKey ?? directive.targetItemId,
      adaptationState: !isActive
        ? "not_eligible"
        : directive.directiveKind === "suppress"
          ? "suppressed"
          : directive.directiveKind === "ask_instead"
            ? "ask_instead"
            : "eligible_not_wired",
      canAffectAdaptation: isActive,
      activeDirectiveId: isActive ? directive.id : undefined,
    },
    evidenceRefIds: [],
    meaning: "This exists because you explicitly instructed JOYSTICK.",
    provenance: `Operator directive recorded ${directive.createdAt.toISOString()}`,
    uncertaintyReasons: [],
    canCorrect: false,
    canSuppress: false,
    canAskInstead: false,
  };
}

function evidenceFor(
  refs: string[],
  lookup: Map<string, OperatorContextEvidenceRef>
): OperatorRepresentativeEvidence[] {
  return refs
    .map(id => lookup.get(id))
    .filter((item): item is OperatorContextEvidenceRef => Boolean(item))
    .map(item => ({
      id: item.id,
      sourceSystem: item.sourceSystem,
      sourceRecordId: item.sourceRecordId,
      timestamp: item.timestamp,
      verificationClass: item.verificationClass,
      evidenceReference: item.evidenceReference,
      decisionPointId: item.decisionPointId,
      correlationId: item.correlationId,
      businessTruthSupport: false as const,
    }));
}

export function buildOperatorRepresentativeSnapshot(input: {
  identity: CanonicalOperatorIdentity;
  packet: OperatorContextPacket;
  directives: OperatorRepresentativeDirectiveRecord[];
  displayName?: string | null;
}): OperatorRepresentativeSnapshot {
  if (input.packet.tenantId !== input.identity.tenantId) {
    throw new Error("Operator Representative tenant mismatch");
  }
  if (input.packet.canonicalOperatorId !== input.identity.canonicalOperatorId) {
    throw new Error("Operator Representative identity mismatch");
  }

  const internals: InternalItem[] = [
    ...input.packet.card.explicitFacts.map(explicitFactItem),
    ...input.packet.card.explicitPreferences.map(explicitPreferenceItem),
    ...input.packet.observedPatterns.map(observedPatternItem),
    ...input.packet.uncertainty.map(uncertaintyItem),
    ...input.packet.learnedSignals.map(learnedSignalItem),
    ...input.directives.map(directiveItem),
  ];

  const activeByTarget = new Map<string, OperatorRepresentativeDirectiveRecord[]>();
  for (const directive of input.directives.filter(item => item.status === "active")) {
    const current = activeByTarget.get(directive.targetItemId) ?? [];
    current.push(directive);
    activeByTarget.set(directive.targetItemId, current);
  }

  for (const internal of internals) {
    const directivesForItem = activeByTarget.get(internal.item.id) ?? [];
    const correction = directivesForItem.find(item => item.directiveKind === "correction");
    const control = directivesForItem.find(
      item => item.directiveKind === "suppress" || item.directiveKind === "ask_instead"
    );

    if (correction) {
      const corrected =
        correction.operatorDeclaredValue &&
        typeof correction.operatorDeclaredValue.value === "string"
          ? correction.operatorDeclaredValue.value.trim()
          : "";
      if (corrected) {
        internal.item.summary = corrected;
        internal.item.provenanceClass = "operator_directive";
        internal.item.confidence = "declared";
        internal.provenance = "Explicit correction declared by you";
        internal.meaning =
          "Your explicit correction overrides this value for Operator Context. The original source remains visible in the evidence trail.";
      }
    }

    if (control) {
      internal.item.activeDirectiveId = control.id;
      if (control.directiveKind === "suppress") {
        internal.item.adaptationState = "suppressed";
        internal.item.canAffectAdaptation = false;
      } else {
        internal.item.adaptationState = "ask_instead";
        internal.item.canAffectAdaptation = false;
      }
    }
  }

  const evidenceLookup = new Map(input.packet.evidenceRefs.map(ref => [ref.id, ref] as const));
  const details = new Map<string, OperatorRepresentativeItemDetail>();
  for (const internal of internals) {
    details.set(internal.item.id, {
      item: internal.item,
      meaning: internal.meaning,
      provenance: internal.provenance,
      evidence: evidenceFor(internal.evidenceRefIds, evidenceLookup),
      uncertaintyReasons: internal.uncertaintyReasons,
      allowedUse: internal.item.canAffectAdaptation
        ? "This may constrain how JOYSTICK works with you when the live adaptation canary is enabled."
        : "This may be shown and explained as Operator Context. It does not automatically steer Claire.",
      forbiddenUse:
        "Operator Representative cannot use this item to prove revenue, payment, a call, a visit, a reply, an order state, or any other business event.",
      canCorrect: internal.canCorrect,
      canSuppress: internal.canSuppress,
      canAskInstead: internal.canAskInstead,
      businessTruthSupport: false,
    });
  }

  const items = internals.map(internal => internal.item);
  const byCategory = <T extends OperatorRepresentativeItem["category"]>(category: T) =>
    items.filter(item => item.category === category);

  const known = byCategory("known");
  const learning = byCategory("learning");
  const uncertain = byCategory("uncertain");
  const changed = byCategory("changed");
  const activeDirectiveCount = input.directives.filter(item => item.status === "active").length;

  return {
    home: {
      operator: {
        canonicalOperatorId: input.identity.canonicalOperatorId,
        displayName: input.displayName ?? null,
      },
      generatedAt: input.packet.generatedAt,
      known,
      learning,
      uncertain,
      changed,
      counts: {
        known: known.length,
        learning: learning.length,
        uncertain: uncertain.length,
        changed: changed.length,
      },
      adaptation: {
        shadowEnabled: isClaireOperatorContextShadowEnabled(input.identity.tenantId),
        liveEnabled: isClaireOperatorContextAdaptationEnabled(input.identity.tenantId),
        canaryMode: isClaireOperatorContextAdaptationEnabled(input.identity.tenantId),
        activeDirectiveCount,
      },
    },
    details,
  };
}
