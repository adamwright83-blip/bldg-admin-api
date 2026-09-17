/**
 * Slice 6 — bounded Claire relationship-history assembly.
 *
 * Reuses existing Claire relationship events, optional operator-declared
 * statements, observational ledger counts, and Slice 5 experiment
 * observations. Does not create a second memory table. Epistemic classes
 * stay distinct. Diagnosis, trait inference, and "works better" claims
 * are not assemblable as relationship knowledge.
 */
import { DIAGNOSIS_FORBIDDEN_PATTERNS } from "./behavioralInterventionMapping";

export const CLAIRE_HISTORY_ITEM_BUDGET = 8;
export const CLAIRE_HISTORY_PROMPT_BUDGET = 5;
export const CLAIRE_HISTORY_POLICY_VERSION = "claire-history-slice6-v1";

export type ClaireHistoryEpistemicClass =
  | "operator-declared"
  | "behavior-observed"
  | "verified-shared"
  | "claire-inference"
  | "historical-model-inference"
  | "experiment-observation";

export type ClaireHistoryKind =
  | "relationship_event"
  | "operator_declared"
  | "observed_pattern"
  | "experiment_observation"
  | "inference";

export type ClaireHistoryTemporalFrame = "historical" | "standing" | "current_unverified";

export type ClaireHistoryItem = {
  id: string;
  kind: ClaireHistoryKind;
  epistemicClass: ClaireHistoryEpistemicClass;
  occurredAt: string;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  evidenceSource: string | null;
  statement: string;
  provenance: string;
  policyVersion: string | null;
  topicKeys: string[];
  relationshipEventId: number | null;
  claimedState: string | null;
  temporalFrame: ClaireHistoryTemporalFrame;
};

export type ClaireRelationshipEventLike = {
  id: number;
  tenantId: string;
  operatorUserId: string;
  eventType: string;
  summary: string;
  provenance: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  evidenceSource: string | null;
  occurredAt: string;
};

export type ClaireDeclaredPreference = {
  id?: string;
  statement: string;
  occurredAt: string;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  evidenceSource?: string | null;
  provenance?: string;
  topicKeys?: string[];
};

export type ClaireObservedPattern = {
  id?: string;
  subjectLabel: string;
  occurredAt: string;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  evidenceSource?: string | null;
  provenance?: string;
  delivered?: number;
  deferred?: number;
  started?: number;
  completed?: number;
  topicKeys?: string[];
};

export type ClaireExperimentObservation = {
  id?: string;
  occurredAt: string;
  decisionPointId: string;
  assignedOption: string;
  followedEvent?: string | null;
  assignmentCount?: number;
  provenance?: string;
  policyVersion?: string | null;
};

export type ClaireInferenceRecord = {
  id?: string;
  statement: string;
  occurredAt: string;
  topicKeys?: string[];
  provenance?: string;
  policyVersion?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  epistemicClass?: "claire-inference" | "historical-model-inference";
};

export type CurrentTruthLookup = {
  supportsCurrentClaim(claimedState: string, entityRef: string): boolean;
};

export type ClaireAssembledRelationshipHistory = {
  tenantId: string;
  operatorUserId: string;
  failClosed: boolean;
  policyVersion: typeof CLAIRE_HISTORY_POLICY_VERSION;
  items: ClaireHistoryItem[];
  promptItems: ClaireHistoryItem[];
};

export const CLAIRE_INTERPRETIVE_MODULES = [
  "executive_function",
  "cbt",
  "recovery",
] as const;

export type ClaireInterpretiveModule = (typeof CLAIRE_INTERPRETIVE_MODULES)[number];

export const CLAIRE_CONSCIOUSNESS_FORBIDDEN_PATTERNS = [
  /\bclaire feels\b/i,
  /\bi feel\b/i,
  /\bi miss (you|this|our)\b/i,
  /\bmy (feelings|emotions|heart)\b/i,
  /\bconsciousness\b/i,
  /\bi am (sad|lonely|hurt|alive)\b/i,
];

const EPISTEMIC_RANK: Record<ClaireHistoryEpistemicClass, number> = {
  "verified-shared": 5,
  "operator-declared": 4,
  "behavior-observed": 3,
  "experiment-observation": 2,
  "claire-inference": 1,
  "historical-model-inference": 0,
};

export function claireInterpretiveModuleEnabled(input: {
  module: ClaireInterpretiveModule;
  explicitOperatorEnabled: boolean;
  observedBehaviorCount?: number;
}): boolean {
  void input.observedBehaviorCount;
  void input.module;
  return input.explicitOperatorEnabled === true;
}

export function describeObservedWorkPattern(input: {
  subjectLabel: string;
  delivered?: number;
  deferred?: number;
  started?: number;
  completed?: number;
}): string {
  const parts: string[] = [];
  if ((input.delivered ?? 0) > 0) {
    parts.push(`${input.subjectLabel} came up ${input.delivered} time(s)`);
  }
  if ((input.deferred ?? 0) > 0) {
    parts.push(`it was deferred ${input.deferred} time(s)`);
  }
  if ((input.started ?? 0) > 0) {
    parts.push(`work started ${input.started} time(s)`);
  }
  if ((input.completed ?? 0) > 0) {
    parts.push(`${input.completed} visit(s) were completed`);
  }
  return parts.join(" and ") || `${input.subjectLabel} has no counted events yet`;
}

export function containsForbiddenHistoryClaim(text: string): boolean {
  return (
    DIAGNOSIS_FORBIDDEN_PATTERNS.some(pattern => pattern.test(text)) ||
    CLAIRE_CONSCIOUSNESS_FORBIDDEN_PATTERNS.some(pattern => pattern.test(text))
  );
}

export function traitClaimFromExperimentHistory(
  _observations: readonly ClaireExperimentObservation[]
): null {
  return null;
}

function topicKeysFromText(text: string, extras: string[] = []): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(word => word.length >= 4);
  return [...new Set([...extras.map(key => key.toLowerCase()), ...words])];
}

function normalizeStatement(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function isDisabledRelationshipEvent(eventType: string): boolean {
  return eventType === "operator_avoidance";
}

function itemFromRelationshipEvent(
  tenantId: string,
  operatorUserId: string,
  event: ClaireRelationshipEventLike
): ClaireHistoryItem | null {
  if (event.tenantId !== tenantId || event.operatorUserId !== operatorUserId) {
    return null;
  }
  if (isDisabledRelationshipEvent(event.eventType)) return null;
  if (containsForbiddenHistoryClaim(event.summary)) return null;
  return {
    id: `relationship:${event.id}`,
    kind: "relationship_event",
    epistemicClass: "verified-shared",
    occurredAt: event.occurredAt,
    sourceEntityType: event.relatedEntityType,
    sourceEntityId: event.relatedEntityId,
    evidenceSource: event.evidenceSource,
    statement: event.summary,
    provenance: event.provenance,
    policyVersion: null,
    topicKeys: topicKeysFromText(event.summary, [event.eventType]),
    relationshipEventId: event.id,
    claimedState: claimedStateFromStatement(event.summary),
    temporalFrame: "historical",
  };
}

function claimedStateFromStatement(statement: string): string | null {
  const lower = statement.toLowerCase();
  if (/\bscheduled\b/.test(lower)) return "scheduled";
  if (/\bsent\b/.test(lower)) return "sent";
  if (/\bqueued\b/.test(lower)) return "queued";
  return null;
}

function itemFromDeclared(pref: ClaireDeclaredPreference, index: number): ClaireHistoryItem | null {
  if (containsForbiddenHistoryClaim(pref.statement)) return null;
  return {
    id: pref.id ?? `declared:${index}:${pref.occurredAt}`,
    kind: "operator_declared",
    epistemicClass: "operator-declared",
    occurredAt: pref.occurredAt,
    sourceEntityType: pref.sourceEntityType ?? null,
    sourceEntityId: pref.sourceEntityId ?? null,
    evidenceSource: pref.evidenceSource ?? null,
    statement: pref.statement,
    provenance: pref.provenance ?? "operator_declared",
    policyVersion: null,
    topicKeys: topicKeysFromText(pref.statement, pref.topicKeys ?? []),
    relationshipEventId: null,
    claimedState: null,
    temporalFrame: "standing",
  };
}

function itemFromObserved(pattern: ClaireObservedPattern, index: number): ClaireHistoryItem | null {
  const statement = describeObservedWorkPattern(pattern);
  if (containsForbiddenHistoryClaim(statement)) return null;
  return {
    id: pattern.id ?? `observed:${index}:${pattern.occurredAt}`,
    kind: "observed_pattern",
    epistemicClass: "behavior-observed",
    occurredAt: pattern.occurredAt,
    sourceEntityType: pattern.sourceEntityType ?? null,
    sourceEntityId: pattern.sourceEntityId ?? null,
    evidenceSource: pattern.evidenceSource ?? "behavioral_ledger",
    statement,
    provenance: pattern.provenance ?? "ledger_counts",
    policyVersion: null,
    topicKeys: topicKeysFromText(statement, pattern.topicKeys ?? [pattern.subjectLabel]),
    relationshipEventId: null,
    claimedState: null,
    temporalFrame: "historical",
  };
}

function itemFromExperiment(
  observation: ClaireExperimentObservation,
  index: number
): ClaireHistoryItem | null {
  const followed = observation.followedEvent
    ? ` A later observed event was ${observation.followedEvent}.`
    : "";
  const count =
    observation.assignmentCount != null
      ? ` Randomized occasions counted for this arm: ${observation.assignmentCount}.`
      : "";
  const statement = `Presentation ${observation.assignedOption} was assigned at decision point ${observation.decisionPointId}.${followed}${count}`;
  if (containsForbiddenHistoryClaim(statement)) return null;
  return {
    id: observation.id ?? `experiment:${index}:${observation.decisionPointId}`,
    kind: "experiment_observation",
    epistemicClass: "experiment-observation",
    occurredAt: observation.occurredAt,
    sourceEntityType: "decision_point",
    sourceEntityId: observation.decisionPointId,
    evidenceSource: "behavioral_ledger",
    statement,
    provenance: observation.provenance ?? "randomized_assignment",
    policyVersion: observation.policyVersion ?? "presentation_mrt_v1",
    topicKeys: topicKeysFromText(statement, [observation.assignedOption, observation.decisionPointId]),
    relationshipEventId: null,
    claimedState: null,
    temporalFrame: "historical",
  };
}

function itemFromInference(record: ClaireInferenceRecord, index: number): ClaireHistoryItem | null {
  if (containsForbiddenHistoryClaim(record.statement)) return null;
  return {
    id: record.id ?? `inference:${index}:${record.occurredAt}`,
    kind: "inference",
    epistemicClass: record.epistemicClass ?? "claire-inference",
    occurredAt: record.occurredAt,
    sourceEntityType: record.sourceEntityType ?? null,
    sourceEntityId: record.sourceEntityId ?? null,
    evidenceSource: "inference",
    statement: record.statement,
    provenance: record.provenance ?? "claire_inference",
    policyVersion: record.policyVersion ?? CLAIRE_HISTORY_POLICY_VERSION,
    topicKeys: topicKeysFromText(record.statement, record.topicKeys ?? []),
    relationshipEventId: null,
    claimedState: null,
    temporalFrame: "historical",
  };
}

function topicsOverlap(left: string[], right: string[]): boolean {
  const rightSet = new Set(right);
  return left.some(key => rightSet.has(key));
}

function dropSupersededInferences(items: ClaireHistoryItem[]): ClaireHistoryItem[] {
  const declared = items.filter(item => item.epistemicClass === "operator-declared");
  return items.filter(item => {
    if (item.kind !== "inference") return true;
    return !declared.some(pref => {
      if (!topicsOverlap(pref.topicKeys, item.topicKeys)) return false;
      return new Date(pref.occurredAt).getTime() >= new Date(item.occurredAt).getTime();
    });
  });
}

function dedupeHistoryItems(items: ClaireHistoryItem[]): ClaireHistoryItem[] {
  const seen = new Set<string>();
  const result: ClaireHistoryItem[] = [];
  for (const item of items) {
    const key = [
      item.kind,
      item.sourceEntityId ?? "",
      item.relationshipEventId ?? "",
      normalizeStatement(item.statement),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function relevanceScore(item: ClaireHistoryItem, topic?: string): number {
  if (!topic) return 0;
  const needle = topic.toLowerCase();
  if (item.statement.toLowerCase().includes(needle)) return 8;
  if (item.topicKeys.some(key => key.includes(needle) || needle.includes(key))) return 5;
  return 0;
}

function rankHistoryItems(
  items: ClaireHistoryItem[],
  topic: string | undefined,
  nowMs: number
): ClaireHistoryItem[] {
  return [...items].sort((left, right) => {
    const relevanceDiff = relevanceScore(right, topic) - relevanceScore(left, topic);
    if (relevanceDiff !== 0) return relevanceDiff;
    const epistemicDiff = EPISTEMIC_RANK[right.epistemicClass] - EPISTEMIC_RANK[left.epistemicClass];
    if (epistemicDiff !== 0) return epistemicDiff;
    const recencyDiff =
      new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime();
    if (recencyDiff !== 0) return recencyDiff;
    return nowMs ? 0 : 0;
  });
}

export function reconcileHistoryWithCurrentTruth(
  items: readonly ClaireHistoryItem[],
  lookup: CurrentTruthLookup | null | undefined
): ClaireHistoryItem[] {
  if (!lookup) return [...items];
  return items.map(item => {
    if (!item.claimedState || !item.sourceEntityId) return item;
    if (lookup.supportsCurrentClaim(item.claimedState, item.sourceEntityId)) {
      return { ...item, temporalFrame: "standing" };
    }
    return {
      ...item,
      temporalFrame: "current_unverified",
      statement: `Previously recorded, not current verified state: ${item.statement}`,
    };
  });
}

export function assembleClaireRelationshipHistory(input: {
  tenantId: string;
  operatorUserId: string | null | undefined;
  relationshipEvents?: readonly ClaireRelationshipEventLike[];
  declaredPreferences?: readonly ClaireDeclaredPreference[];
  observedPatterns?: readonly ClaireObservedPattern[];
  experimentObservations?: readonly ClaireExperimentObservation[];
  inferences?: readonly ClaireInferenceRecord[];
  topic?: string;
  now?: Date;
  truthLookup?: CurrentTruthLookup | null;
}): ClaireAssembledRelationshipHistory {
  const operatorUserId = input.operatorUserId;
  if (!operatorUserId) {
    return {
      tenantId: input.tenantId,
      operatorUserId: "unresolved",
      failClosed: true,
      policyVersion: CLAIRE_HISTORY_POLICY_VERSION,
      items: [],
      promptItems: [],
    };
  }

  const raw: ClaireHistoryItem[] = [];
  for (const event of input.relationshipEvents ?? []) {
    const item = itemFromRelationshipEvent(input.tenantId, operatorUserId, event);
    if (item) raw.push(item);
  }
  (input.declaredPreferences ?? []).forEach((pref, index) => {
    const item = itemFromDeclared(pref, index);
    if (item) raw.push(item);
  });
  (input.observedPatterns ?? []).forEach((pattern, index) => {
    const item = itemFromObserved(pattern, index);
    if (item) raw.push(item);
  });
  (input.experimentObservations ?? []).forEach((observation, index) => {
    const item = itemFromExperiment(observation, index);
    if (item) raw.push(item);
  });
  (input.inferences ?? []).forEach((record, index) => {
    const item = itemFromInference(record, index);
    if (item) raw.push(item);
  });

  const reconciled = reconcileHistoryWithCurrentTruth(raw, input.truthLookup);
  const ranked = rankHistoryItems(
    dropSupersededInferences(dedupeHistoryItems(reconciled)),
    input.topic,
    (input.now ?? new Date()).getTime()
  );
  const items = ranked.slice(0, CLAIRE_HISTORY_ITEM_BUDGET);
  return {
    tenantId: input.tenantId,
    operatorUserId,
    failClosed: false,
    policyVersion: CLAIRE_HISTORY_POLICY_VERSION,
    items,
    promptItems: items.slice(0, CLAIRE_HISTORY_PROMPT_BUDGET),
  };
}

export function formatClaireHistoryPromptLines(
  history: ClaireAssembledRelationshipHistory
): string[] {
  return history.promptItems.map(item => {
    const when = item.occurredAt.slice(0, 10);
    return `[${item.epistemicClass} ${when}] ${item.statement}`;
  });
}
