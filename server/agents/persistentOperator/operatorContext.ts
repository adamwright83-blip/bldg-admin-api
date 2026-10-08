/**
 * Stage 1 of JOYSTICK Operator Context.
 *
 * Deterministic, typed, read-only representation built strictly from existing
 * persisted evidence.
 *
 * PERMANENT TRUTH BOUNDARY (Non-negotiable):
 * Operator Context may affect how JOYSTICK handles the operator:
 * - channel
 * - timing
 * - length
 * - task sizing
 * - intervention presentation
 * - reminder burden
 * - escalation strategy
 *
 * It may NEVER become current_business_truth or proof of what happened in the business.
 * Business/action claims remain governed strictly by their authoritative readers.
 */

import { eq } from "drizzle-orm";
import { legacyDayforgeSaasTenants } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { DIAGNOSIS_FORBIDDEN_PATTERNS } from "../../../shared/behavioralInterventionMapping";
import type { LedgerEventType, LedgerSourceSystem } from "../../../shared/behavioralLedger";
import {
  listBehavioralLedgerEventsForOperatorBounded,
  type BoundedLedgerReadEvent,
  DEFAULT_BOUNDED_OPERATOR_LEDGER_LIMIT,
  MAX_BOUNDED_OPERATOR_LEDGER_LIMIT,
} from "../../behavioralLedger/behavioralLedger";
import {
  resolveCanonicalOperatorIdentity,
  type CanonicalOperatorIdentity,
} from "./identity";
import {
  listGoalCycleLearnedDeltas,
  type GoalCycleLearnedDeltaRecord,
  type LearningKind,
  type DeltaType,
} from "./learningStore";
import { readSession } from "../../goldlineOnboarding/store";
import type { GoldlineOnboardingSession } from "../../../shared/goldlineOnboarding";

// ---------------------------------------------------------------------------
// Operator Context Types (All new Stage 1 types declared in this file)
// ---------------------------------------------------------------------------

export type OperatorExplicitFact = {
  kind:
    | "canonical_identity"
    | "declared_trade"
    | "declared_service_area"
    | "declared_avoided_task"
    | "explicit_onboarding_fact";
  statement: string;
  sourceSystem: string;
  provenance: "operator_declared" | "canonical_identity";
  field: string;
  observedAt?: string;
  evidenceRefId?: string;
};

export type OperatorExplicitPreference = {
  kind: "contact_channel" | "working_hours" | "communication_frequency";
  targetKey: string;
  preference: string;
  sourceSystem: string;
  provenance: "operator_declared";
  observedAt?: string;
  evidenceRefId?: string;
};

export type OperatorContextCard = {
  explicitFacts: OperatorExplicitFact[];
  explicitPreferences: OperatorExplicitPreference[];
};

export type OperatorObservedPattern = {
  kind:
    | "intervention_start_sequence"
    | "action_completion_rate"
    | "explicit_deferral_dismissal";
  /**
   * Stable semantic scope for UI identity/directive targeting.
   * It must describe what population/domain the pattern summarizes and must
   * never be derived from mutable evidence IDs, counts, timestamps, or metrics.
   */
  scopeKey?: string;
  observationCount: number;
  distinctDecisionPointCount: number;
  distinctCorrelationCount: number;
  summary: string;
  confidence: "descriptive";
  metrics?: {
    totalEligiblePoints?: number;
    startedWithinWindowCount?: number;
    startedLatencyMeanSeconds?: number | null;
    completedCount?: number;
    verifiedCount?: number;
    dismissedCount?: number;
    deferredCount?: number;
  };
  evidenceRefs: string[];
};

export type OperatorLearnedSignal = {
  learningKind: LearningKind;
  targetKey: string;
  confidence: "high" | "medium" | "low";
  deltaType: DeltaType;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown>;
  evidenceReference: string;
  sourceDeltaId: string;
  createdAt: string;
  evidenceRefId: string;
};

export type OperatorInterventionEvidence = {
  decisionPointId: string;
  correlationId: string;
  sourceSystem: LedgerSourceSystem;
  assignmentMechanism: "randomized_assignment" | "deterministic_or_observational";
  assignedOption: string | null;
  assignmentProbability: number | null;
  policyVersion: number | null;
  definitionVersion: number | null;
  outcomeWindowMinutes: number | null;
  lifecycleEvents: LedgerEventType[];
  startedWithinWindow: boolean | "unknown";
  startLatencySeconds: number | null;
  isDescriptiveOnly: true;
  evidenceRefIds: string[];
};

export const OPERATOR_CONTEXT_UNCERTAINTY_REASONS = [
  "no_records",
  "source_unavailable",
  "insufficient_observations",
  "missing_paired_timestamps",
  "timezone_unavailable",
  "conflicting_signals",
  "stale_evidence",
  "no_verified_outcome",
  "proximal_outcome_window_unavailable",
  "evidence_window_truncated",
  "operator_binding_unavailable",
  "invalid_temporal_evidence",
] as const;

export type OperatorContextUncertaintyReason =
  (typeof OPERATOR_CONTEXT_UNCERTAINTY_REASONS)[number];

export type OperatorContextUncertainty = {
  reason: OperatorContextUncertaintyReason;
  scope: string;
  detail: string;
  relatedEvidenceRefs?: string[];
};

export type OperatorContextEvidenceRef = {
  id: string;
  sourceSystem: string;
  sourceRecordId: string;
  tenantId: string;
  operatorUserId: string;
  canonicalOperatorId: string;
  decisionPointId?: string | null;
  correlationId?: string | null;
  timestamp: string;
  verificationClass?: string | null;
  evidenceReference?: string | null;
  learningOutcomeId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Stage 1 OperatorContextPacket.
 *
 * NOTE: This packet does NOT have, and must never receive:
 * authoritativeFor: "current_business_truth"
 * or any equivalent business-truth authority.
 */
export type OperatorContextPacket = {
  tenantId: string;
  canonicalOperatorId: string;
  generatedAt: string;
  mappedUserIds: string[];

  card: OperatorContextCard;
  observedPatterns: OperatorObservedPattern[];
  learnedSignals: OperatorLearnedSignal[];
  interventionEvidence: OperatorInterventionEvidence[];
  uncertainty: OperatorContextUncertainty[];
  evidenceRefs: OperatorContextEvidenceRef[];
};

// ---------------------------------------------------------------------------
// Dependency Injection & Invariants
// ---------------------------------------------------------------------------

export type OperatorContextDeps = {
  resolveIdentity?: (input: {
    tenantId: string;
    canonicalOperatorId: string;
  }) => Promise<CanonicalOperatorIdentity | null>;
  loadLedgerEvents?: (input: {
    tenantId: string;
    operatorUserIds: string[];
    limit: number;
  }) => Promise<BoundedLedgerReadEvent[]>;
  loadLearnedDeltas?: (input: {
    tenantId: string;
    canonicalOperatorId: string;
    limit: number;
  }) => Promise<GoalCycleLearnedDeltaRecord[]>;
  loadTenantTimezone?: (tenantId: string) => Promise<string | null>;
  loadOnboardingSession?: (tenantId: string) => Promise<GoldlineOnboardingSession | null>;
  loadExplicitPreferences?: (input: {
    tenantId: string;
    canonicalOperatorId: string;
  }) => Promise<OperatorExplicitPreference[]>;
};

export const MINIMUM_PATTERN_INDEPENDENT_OBSERVATIONS = 3;

function assertNoForbiddenDerivedPatterns(packet: OperatorContextPacket): void {
  // Check all observed patterns
  for (const pattern of packet.observedPatterns) {
    for (const forbidden of DIAGNOSIS_FORBIDDEN_PATTERNS) {
      if (forbidden.test(pattern.kind) || forbidden.test(pattern.summary)) {
        throw new Error(
          `Observed pattern emitted forbidden diagnostic or causal phrasing matching ${forbidden.toString()}: ${pattern.summary}`
        );
      }
    }
  }

  // Check intervention evidence
  for (const item of packet.interventionEvidence) {
    const serialized = JSON.stringify(item);
    for (const forbidden of DIAGNOSIS_FORBIDDEN_PATTERNS) {
      if (forbidden.test(serialized)) {
        throw new Error(
          `Intervention evidence emitted forbidden phrasing matching ${forbidden.toString()}: ${serialized}`
        );
      }
    }
  }

  // Check uncertainty
  for (const item of packet.uncertainty) {
    for (const forbidden of DIAGNOSIS_FORBIDDEN_PATTERNS) {
      if (forbidden.test(item.detail)) {
        throw new Error(
          `Uncertainty item emitted forbidden diagnostic phrasing matching ${forbidden.toString()}: ${item.detail}`
        );
      }
    }
  }
}

export function getOnboardingOperatorBinding(session: GoldlineOnboardingSession): {
  operatorUserId?: string | null;
  canonicalOperatorId?: string | null;
} | null {
  const s = session as Record<string, unknown>;
  const opUserId =
    typeof s.operatorUserId === "string"
      ? s.operatorUserId.trim()
      : typeof s.operatorUserId === "number"
        ? String(s.operatorUserId)
        : typeof s.userId === "string"
          ? s.userId.trim()
          : typeof s.userId === "number"
            ? String(s.userId)
            : null;

  const canOpId =
    typeof s.canonicalOperatorId === "string"
      ? s.canonicalOperatorId.trim()
      : null;

  if (!opUserId && !canOpId) return null;
  return { operatorUserId: opUserId, canonicalOperatorId: canOpId };
}

async function defaultResolveIdentity(input: {
  tenantId: string;
  canonicalOperatorId: string;
}): Promise<CanonicalOperatorIdentity | null> {
  // canonicalOperatorId format is tenant:<tenantId>:operator:<canonicalOpenId>
  const prefix = `tenant:${input.tenantId}:operator:`;
  const canonicalOpenId = input.canonicalOperatorId.startsWith(prefix)
    ? input.canonicalOperatorId.slice(prefix.length)
    : input.canonicalOperatorId;

  const result = await resolveCanonicalOperatorIdentity({
    tenantId: input.tenantId,
    source: { type: "open_id", value: canonicalOpenId },
    subsystem: "operator_context",
  });
  return result.ok ? result.identity : null;
}

async function defaultLoadTenantTimezone(tenantId: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ timeZone: legacyDayforgeSaasTenants.timeZone })
    .from(legacyDayforgeSaasTenants)
    .where(eq(legacyDayforgeSaasTenants.id, tenantId))
    .limit(1);
  return row?.timeZone?.trim() || null;
}

const defaultDeps: OperatorContextDeps = {
  resolveIdentity: defaultResolveIdentity,
  loadLedgerEvents: async input =>
    listBehavioralLedgerEventsForOperatorBounded({
      tenantId: input.tenantId,
      operatorUserIds: input.operatorUserIds,
      limit: input.limit,
    }),
  loadLearnedDeltas: async input =>
    listGoalCycleLearnedDeltas({
      tenantId: input.tenantId,
      canonicalOperatorId: input.canonicalOperatorId,
      limit: input.limit,
    }),
  loadTenantTimezone: defaultLoadTenantTimezone,
  loadOnboardingSession: async tenantId => readSession(tenantId),
};

// ---------------------------------------------------------------------------
// Builder Implementation
// ---------------------------------------------------------------------------

export type BuildOperatorContextPacketInput = {
  tenantId: string;
  canonicalOperatorId?: string;
  identity?: CanonicalOperatorIdentity;
  now?: Date;
  deps?: OperatorContextDeps;
};

/**
 * Builds a deterministic, read-only OperatorContextPacket for an authorized
 * canonical operator from existing persisted records.
 */
export async function buildOperatorContextPacket(
  input: BuildOperatorContextPacketInput
): Promise<OperatorContextPacket> {
  const tenantId = input.tenantId?.trim();
  if (!tenantId) {
    throw new Error("tenantId is required to build OperatorContextPacket");
  }

  const deps: OperatorContextDeps = { ...defaultDeps, ...input.deps };
  const generatedAt = (input.now ?? new Date()).toISOString();

  // 1. Resolve & authorize canonical identity
  let resolvedIdentity: CanonicalOperatorIdentity | null = null;
  if (input.identity) {
    if (input.identity.tenantId !== tenantId) {
      throw new Error(
        `Provided canonical identity belongs to tenant '${input.identity.tenantId}', not requested tenant '${tenantId}'`
      );
    }
    if (
      input.canonicalOperatorId &&
      input.identity.canonicalOperatorId !== input.canonicalOperatorId
    ) {
      throw new Error(
        `Provided canonical identity id '${input.identity.canonicalOperatorId}' does not match requested id '${input.canonicalOperatorId}'`
      );
    }
    resolvedIdentity = input.identity;
  } else if (input.canonicalOperatorId) {
    resolvedIdentity = deps.resolveIdentity
      ? await deps.resolveIdentity({
          tenantId,
          canonicalOperatorId: input.canonicalOperatorId,
        })
      : null;
  }

  if (!resolvedIdentity) {
    throw new Error(
      `Unable to resolve authorized canonical operator identity for tenant '${tenantId}'`
    );
  }

  const canonicalOperatorId = resolvedIdentity.canonicalOperatorId;

  // Gather strictly the mapped user IDs belonging to this canonical operator.
  // Never broaden to other tenant users.
  const mappedUserIdSet = new Set<string>();
  if (resolvedIdentity.canonicalUserId != null) {
    mappedUserIdSet.add(String(resolvedIdentity.canonicalUserId));
  }
  if (resolvedIdentity.sourceUserId != null) {
    mappedUserIdSet.add(String(resolvedIdentity.sourceUserId));
  }
  for (const alias of resolvedIdentity.aliases ?? []) {
    if (alias.userId != null) {
      mappedUserIdSet.add(String(alias.userId));
    }
  }
  const mappedUserIds = Array.from(mappedUserIdSet).sort();

  // Data structures for packet
  const explicitFacts: OperatorExplicitFact[] = [];
  const explicitPreferences: OperatorExplicitPreference[] = [];
  const observedPatterns: OperatorObservedPattern[] = [];
  const learnedSignals: OperatorLearnedSignal[] = [];
  const interventionEvidence: OperatorInterventionEvidence[] = [];
  const uncertainty: OperatorContextUncertainty[] = [];
  const evidenceRefs: OperatorContextEvidenceRef[] = [];

  let nextRefIndex = 1;
  const generateRefId = (prefix: string) => `ref-${prefix}-${nextRefIndex++}`;

  // 2. Canonical identity explicit fact
  const identityRefId = generateRefId("identity");
  evidenceRefs.push({
    id: identityRefId,
    sourceSystem: "persistent_operator_identity",
    sourceRecordId: String(resolvedIdentity.canonicalUserId),
    tenantId,
    operatorUserId: String(resolvedIdentity.canonicalUserId),
    canonicalOperatorId,
    timestamp: generatedAt,
    metadata: {
      canonicalOpenId: resolvedIdentity.canonicalOpenId,
      mappedUserIds,
      aliasCount: resolvedIdentity.aliases?.length ?? 0,
      sourceRole: resolvedIdentity.sourceRole,
    },
  });

  explicitFacts.push({
    kind: "canonical_identity",
    field: "canonicalOpenId",
    statement: `Canonical operator identity '${resolvedIdentity.canonicalOpenId}' mapped with ${mappedUserIds.length} authorized user binding(s).`,
    sourceSystem: "persistent_operator_identity",
    provenance: "canonical_identity",
    observedAt: generatedAt,
    evidenceRefId: identityRefId,
  });

  // 3. Load explicit onboarding facts (Goldline/JOYSTICK onboarding)
  let onboardingReadSuccessful = true;
  let onboardingSession: GoldlineOnboardingSession | null = null;
  try {
    if (deps.loadOnboardingSession) {
      onboardingSession = await deps.loadOnboardingSession(tenantId);
    }
  } catch {
    onboardingReadSuccessful = false;
    uncertainty.push({
      reason: "source_unavailable",
      scope: "goldline_onboarding",
      detail: "Goldline onboarding store was unavailable during packet construction.",
    });
  }

  if (onboardingSession?.answersByKey) {
    const binding = getOnboardingOperatorBinding(onboardingSession);
    const isBoundToThisOperator =
      binding != null &&
      ((binding.canonicalOperatorId && binding.canonicalOperatorId === canonicalOperatorId) ||
        (binding.operatorUserId && mappedUserIds.includes(binding.operatorUserId)));

    if (!isBoundToThisOperator) {
      uncertainty.push({
        reason: "operator_binding_unavailable",
        scope: "goldline_onboarding",
        detail:
          "Onboarding answers in goldline_onboarding_sessions are tenant-scoped and lack an authoritative binding to this canonical operator; omitted from operator card.",
      });
    } else {
      const answers = onboardingSession.answersByKey;
      const sessionRefId = generateRefId("onboarding");
      evidenceRefs.push({
        id: sessionRefId,
        sourceSystem: "goldline_onboarding_sessions",
        sourceRecordId: onboardingSession.id,
        tenantId,
        operatorUserId: binding?.operatorUserId ?? String(resolvedIdentity.canonicalUserId),
        canonicalOperatorId,
        timestamp: onboardingSession.startedAt ?? generatedAt,
        metadata: {
          status: onboardingSession.status,
          operatorBinding: binding,
        },
      });

      if (answers.daily_work?.trim()) {
        explicitFacts.push({
          kind: "declared_trade",
          field: "daily_work",
          statement: `Declared daily work: "${answers.daily_work.trim()}"`,
          sourceSystem: "goldline_onboarding",
          provenance: "operator_declared",
          observedAt: onboardingSession.startedAt ?? undefined,
          evidenceRefId: sessionRefId,
        });
      }

      if (answers.service_area?.trim()) {
        explicitFacts.push({
          kind: "declared_service_area",
          field: "service_area",
          statement: `Declared service area: "${answers.service_area.trim()}"`,
          sourceSystem: "goldline_onboarding",
          provenance: "operator_declared",
          observedAt: onboardingSession.startedAt ?? undefined,
          evidenceRefId: sessionRefId,
        });
      }

      if (answers.avoidance?.trim()) {
        explicitFacts.push({
          kind: "declared_avoided_task",
          field: "avoidance",
          statement: `Declared avoided task: "${answers.avoidance.trim()}"`,
          sourceSystem: "goldline_onboarding",
          provenance: "operator_declared",
          observedAt: onboardingSession.startedAt ?? undefined,
          evidenceRefId: sessionRefId,
        });
      }
    }
  }

  // 3b. Load structured explicit preferences if available
  if (deps.loadExplicitPreferences) {
    try {
      const prefs = await deps.loadExplicitPreferences({
        tenantId,
        canonicalOperatorId,
      });
      for (const pref of prefs) {
        explicitPreferences.push(pref);
      }
    } catch {
      // Preferences failure treated safely
    }
  }

  // 4. Timezone verification
  let tenantTimezone: string | null = null;
  try {
    if (deps.loadTenantTimezone) {
      tenantTimezone = await deps.loadTenantTimezone(tenantId);
    }
  } catch {
    tenantTimezone = null;
  }

  if (!tenantTimezone) {
    uncertainty.push({
      reason: "timezone_unavailable",
      scope: "timezone",
      detail:
        "Authoritative tenant/operator timezone is not configured. Local time-of-day claims (e.g. morning, before 10 AM) are omitted.",
    });
  }

  // 5. Bounded read from Behavioral Ledger
  const ledgerLimit = DEFAULT_BOUNDED_OPERATOR_LEDGER_LIMIT;
  let ledgerReadSuccessful = true;
  let ledgerEvents: BoundedLedgerReadEvent[] = [];
  try {
    if (deps.loadLedgerEvents) {
      ledgerEvents = await deps.loadLedgerEvents({
        tenantId,
        operatorUserIds: mappedUserIds,
        limit: ledgerLimit,
      });
    }
  } catch (error) {
    ledgerReadSuccessful = false;
    uncertainty.push({
      reason: "source_unavailable",
      scope: "behavioral_ledger",
      detail: `Behavioral ledger query failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // Check truncation: If the read returned the requested limit, flag that older evidence may exist
  if (ledgerEvents.length >= ledgerLimit) {
    uncertainty.push({
      reason: "evidence_window_truncated",
      scope: "behavioral_ledger",
      detail: `Behavioral Ledger read reached the ${ledgerLimit}-row Stage 1 limit; older evidence may not be represented in this packet.`,
    });
  }

  // Record ledger evidence references and index by observation unit
  type ObservationGroup = {
    decisionPointId: string | null;
    correlationId: string;
    events: BoundedLedgerReadEvent[];
    refIds: string[];
  };

  const decisionPointGroups = new Map<string, ObservationGroup>();
  const correlationOnlyGroups = new Map<string, ObservationGroup>();

  let hasVerifiedOutcomeInLedger = false;
  let missingPairedTimestampCount = 0;
  let missingOutcomeWindowCount = 0;
  let outOfOrderEvidenceCount = 0;

  for (const event of ledgerEvents) {
    if (event.eventType === "VERIFIED" || event.verificationClass === "VERIFIED") {
      hasVerifiedOutcomeInLedger = true;
    }

    const refId = generateRefId("ledger");
    evidenceRefs.push({
      id: refId,
      sourceSystem: event.sourceSystem,
      sourceRecordId: String(event.id),
      tenantId: event.tenantId,
      operatorUserId: event.operatorUserId,
      canonicalOperatorId,
      decisionPointId: event.decisionPointId,
      correlationId: event.correlationId,
      timestamp: event.occurredAt.toISOString(),
      verificationClass: event.verificationClass,
      evidenceReference: event.evidenceSource,
      metadata: {
        eventType: event.eventType,
        provenance: event.provenance,
        assignedOption: event.assignedOption,
        assignmentProbability: event.assignmentProbability,
      },
    });

    if (event.decisionPointId) {
      const existing = decisionPointGroups.get(event.decisionPointId) ?? {
        decisionPointId: event.decisionPointId,
        correlationId: event.correlationId,
        events: [],
        refIds: [],
      };
      existing.events.push(event);
      existing.refIds.push(refId);
      decisionPointGroups.set(event.decisionPointId, existing);
    } else {
      const existing = correlationOnlyGroups.get(event.correlationId) ?? {
        decisionPointId: null,
        correlationId: event.correlationId,
        events: [],
        refIds: [],
      };
      existing.events.push(event);
      existing.refIds.push(refId);
      correlationOnlyGroups.set(event.correlationId, existing);
    }
  }

  // Independent observation count:
  // Each distinct decisionPointId is ONE observation regardless of how many lifecycle events exist.
  // For events without decisionPointId, each distinct correlationId is ONE observation.
  const distinctDecisionPoints = Array.from(decisionPointGroups.values());
  const distinctCorrelationOnly = Array.from(correlationOnlyGroups.values());
  const totalIndependentObservations =
    distinctDecisionPoints.length + distinctCorrelationOnly.length;

  // Process intervention evidence for decision points
  for (const group of distinctDecisionPoints) {
    const sorted = [...group.events].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()
    );
    const firstEvent = sorted[0]!;
    // Do not fall back to firstEvent if no event has actual assignment fields, and an assignment cannot be the STARTED outcome event itself
    const assignmentEvent = sorted.find(e => e.eventType !== "STARTED" && e.assignedOption != null) ?? null;

    const assignedOption = assignmentEvent?.assignedOption ?? null;
    const assignmentProb =
      assignmentEvent?.assignmentProbability != null
        ? Number(assignmentEvent.assignmentProbability)
        : null;

    const outcomeWindowMinutes = assignmentEvent?.proximalOutcomeWindowMinutes ?? null;

    const startedEvent = sorted.find(e => e.eventType === "STARTED");
    let startedWithinWindow: boolean | "unknown" = "unknown";
    let startLatencySeconds: number | null = null;

    if (startedEvent) {
      if (assignmentEvent) {
        const assignmentTime = assignmentEvent.occurredAt.getTime();
        const startedTime = startedEvent.occurredAt.getTime();

        if (startedTime < assignmentTime) {
          startedWithinWindow = false;
          startLatencySeconds = null;
          outOfOrderEvidenceCount++;
        } else if (outcomeWindowMinutes != null) {
          const windowMs = outcomeWindowMinutes * 60_000;
          const windowEnd = assignmentTime + windowMs;

          startedWithinWindow = startedTime <= windowEnd;
          startLatencySeconds = (startedTime - assignmentTime) / 1000;
        } else {
          missingOutcomeWindowCount++;
        }
      } else {
        missingPairedTimestampCount++;
      }
    }

    interventionEvidence.push({
      decisionPointId: group.decisionPointId!,
      correlationId: group.correlationId,
      sourceSystem: firstEvent.sourceSystem,
      assignmentMechanism:
        assignmentProb != null
          ? "randomized_assignment"
          : "deterministic_or_observational",
      assignedOption,
      assignmentProbability: assignmentProb,
      policyVersion: assignmentEvent?.interventionPolicyVersion ?? null,
      definitionVersion: assignmentEvent?.interventionDefinitionVersion ?? null,
      outcomeWindowMinutes,
      lifecycleEvents: sorted.map(e => e.eventType),
      startedWithinWindow,
      startLatencySeconds,
      isDescriptiveOnly: true,
      evidenceRefIds: group.refIds,
    });
  }

  if (missingPairedTimestampCount > 0) {
    uncertainty.push({
      reason: "missing_paired_timestamps",
      scope: "start_latency",
      detail: `${missingPairedTimestampCount} event(s) had observed start actions without paired presentation timestamps; start latency was omitted.`,
    });
  }

  if (missingOutcomeWindowCount > 0) {
    uncertainty.push({
      reason: "proximal_outcome_window_unavailable",
      scope: "intervention_window",
      detail: `${missingOutcomeWindowCount} decision point(s) had observed start actions but lacked a persisted proximalOutcomeWindowMinutes; predefined outcome window was unavailable so startedWithinWindow was marked unknown and latency was omitted.`,
    });
  }

  if (outOfOrderEvidenceCount > 0) {
    uncertainty.push({
      reason: "invalid_temporal_evidence",
      scope: "start_latency",
      detail: `${outOfOrderEvidenceCount} decision point(s) had observed start actions occurring before the paired assignment timestamp; out-of-order temporal evidence cannot establish positive post-assignment latency or window compliance.`,
    });
  }

  // 6. Pattern derivation (Requires >= 3 independent observations)
  if (totalIndependentObservations >= MINIMUM_PATTERN_INDEPENDENT_OBSERVATIONS) {
    // Descriptive sequence pattern over qualifying decision points with valid assignment AND predefined window
    const qualifyingDecisionPoints = distinctDecisionPoints.filter(
      dp => dp.events.some(e => e.eventType !== "STARTED" && e.assignedOption != null && e.proximalOutcomeWindowMinutes != null)
    );

    if (qualifyingDecisionPoints.length >= MINIMUM_PATTERN_INDEPENDENT_OBSERVATIONS) {
      const startedInWindow = qualifyingDecisionPoints.filter(dp => {
        const assignment = dp.events.find(
          e => e.eventType !== "STARTED" && e.assignedOption != null && e.proximalOutcomeWindowMinutes != null
        );
        const started = dp.events.find(e => e.eventType === "STARTED");
        if (!assignment || !started || assignment.proximalOutcomeWindowMinutes == null) return false;
        const windowMin = assignment.proximalOutcomeWindowMinutes;
        const assignmentTime = assignment.occurredAt.getTime();
        const startedTime = started.occurredAt.getTime();
        return (
          startedTime >= assignmentTime &&
          startedTime <= assignmentTime + windowMin * 60_000
        );
      });

      const latencies = qualifyingDecisionPoints
        .map(dp => {
          const assignment = dp.events.find(
            e => e.eventType !== "STARTED" && e.assignedOption != null && e.proximalOutcomeWindowMinutes != null
          );
          const started = dp.events.find(e => e.eventType === "STARTED");
          if (!assignment || !started || assignment.proximalOutcomeWindowMinutes == null) return null;
          const assignmentTime = assignment.occurredAt.getTime();
          const startedTime = started.occurredAt.getTime();
          if (startedTime < assignmentTime) return null;
          return (startedTime - assignmentTime) / 1000;
        })
        .filter((l): l is number => l != null);

      const meanLatency =
        latencies.length > 0
          ? Math.round(latencies.reduce((sum, v) => sum + v, 0) / latencies.length)
          : null;

      const completedCount = qualifyingDecisionPoints.filter(dp =>
        dp.events.some(e => e.eventType === "COMPLETED")
      ).length;

      const verifiedCount = qualifyingDecisionPoints.filter(dp =>
        dp.events.some(e => e.eventType === "VERIFIED")
      ).length;

      const allRefIds = qualifyingDecisionPoints.flatMap(dp => dp.refIds);

      observedPatterns.push({
        kind: "intervention_start_sequence",
        scopeKey: "all_qualifying_interventions",
        observationCount: qualifyingDecisionPoints.length,
        distinctDecisionPointCount: qualifyingDecisionPoints.length,
        distinctCorrelationCount: new Set(
          qualifyingDecisionPoints.map(dp => dp.correlationId)
        ).size,
        summary: `${startedInWindow.length} of ${qualifyingDecisionPoints.length} qualifying decision points were followed by a STARTED event within the predefined window.`,
        confidence: "descriptive",
        metrics: {
          totalEligiblePoints: qualifyingDecisionPoints.length,
          startedWithinWindowCount: startedInWindow.length,
          startedLatencyMeanSeconds: meanLatency,
          completedCount,
          verifiedCount,
        },
        evidenceRefs: allRefIds,
      });
    }

    // Explicit deferral or dismissal pattern
    const deferredOrDismissed = distinctDecisionPoints.filter(dp =>
      dp.events.some(e => e.eventType === "DEFERRED" || e.eventType === "DISMISSED")
    );
    if (deferredOrDismissed.length >= MINIMUM_PATTERN_INDEPENDENT_OBSERVATIONS) {
      const deferredCount = deferredOrDismissed.filter(dp =>
        dp.events.some(e => e.eventType === "DEFERRED")
      ).length;
      const dismissedCount = deferredOrDismissed.filter(dp =>
        dp.events.some(e => e.eventType === "DISMISSED")
      ).length;

      observedPatterns.push({
        kind: "explicit_deferral_dismissal",
        scopeKey: "all_explicit_deferrals_dismissals",
        observationCount: deferredOrDismissed.length,
        distinctDecisionPointCount: deferredOrDismissed.length,
        distinctCorrelationCount: new Set(
          deferredOrDismissed.map(dp => dp.correlationId)
        ).size,
        summary: `Observed ${deferredCount} explicit DEFERRED event(s) and ${dismissedCount} explicit DISMISSED event(s) across distinct decision points.`,
        confidence: "descriptive",
        metrics: {
          deferredCount,
          dismissedCount,
        },
        evidenceRefs: deferredOrDismissed.flatMap(dp => dp.refIds),
      });
    }
  } else if (totalIndependentObservations > 0) {
    uncertainty.push({
      reason: "insufficient_observations",
      scope: "behavioral_patterns",
      detail: `Found ${totalIndependentObservations} independent observation(s); minimum threshold is ${MINIMUM_PATTERN_INDEPENDENT_OBSERVATIONS} distinct decision points/correlations. Observed patterns withheld.`,
    });
  }

  // 7. Load existing goalCycleLearnedDeltas
  let learnedDeltasReadSuccessful = true;
  let learnedDeltas: GoalCycleLearnedDeltaRecord[] = [];
  try {
    if (deps.loadLearnedDeltas) {
      learnedDeltas = await deps.loadLearnedDeltas({
        tenantId,
        canonicalOperatorId,
        limit: 50,
      });
    }
  } catch (error) {
    learnedDeltasReadSuccessful = false;
    uncertainty.push({
      reason: "source_unavailable",
      scope: "goal_cycle_learned_deltas",
      detail: `Learned deltas query failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  for (const delta of learnedDeltas) {
    const refId = generateRefId("delta");
    evidenceRefs.push({
      id: refId,
      sourceSystem: "goal_cycle_learned_deltas",
      sourceRecordId: delta.id,
      tenantId: delta.tenantId,
      operatorUserId: delta.operatorUserId,
      canonicalOperatorId: delta.canonicalOperatorId,
      decisionPointId: delta.decisionId,
      timestamp: delta.createdAt,
      evidenceReference: delta.evidenceReference,
      learningOutcomeId: delta.outcomeId,
      metadata: {
        learningKind: delta.learningKind,
        targetKey: delta.targetKey,
        deltaType: delta.deltaType,
      },
    });

    learnedSignals.push({
      learningKind: delta.learningKind,
      targetKey: delta.targetKey,
      confidence: delta.confidence,
      deltaType: delta.deltaType,
      beforeState: delta.beforeState,
      afterState: delta.afterState,
      evidenceReference: delta.evidenceReference,
      sourceDeltaId: delta.id,
      createdAt: delta.createdAt,
      evidenceRefId: refId,
    });
  }

  // 8. Check verified outcomes & empty operator state
  const hasVerifiedOutcomeInDeltas = learnedSignals.some(s =>
    Boolean(
      s.afterState &&
        (s.afterState.verifiedDeliveries || s.afterState.verifiedRevenueCents)
    )
  );

  // Absence claims require successful reads: do not claim absence when read failed
  if (ledgerReadSuccessful && !hasVerifiedOutcomeInLedger && !hasVerifiedOutcomeInDeltas) {
    uncertainty.push({
      reason: "no_verified_outcome",
      scope: "operational_verification",
      detail:
        "No verified action or commercial outcome was observed within the bounded Behavioral Ledger evidence read used for this packet.",
    });
  }

  // Check empty state
  const isCompletelyEmpty =
    explicitFacts.length <= 1 && // only identity fact
    explicitPreferences.length === 0 &&
    observedPatterns.length === 0 &&
    learnedSignals.length === 0 &&
    interventionEvidence.length === 0 &&
    ledgerEvents.length === 0;

  const allRequiredSourcesReadSuccessfully =
    ledgerReadSuccessful && learnedDeltasReadSuccessful && onboardingReadSuccessful;

  if (allRequiredSourcesReadSuccessfully && isCompletelyEmpty) {
    uncertainty.unshift({
      reason: "no_records",
      scope: "operator_profile",
      detail: "No behavioral ledger events, learned deltas, or declared onboarding facts exist for this operator.",
    });
  }

  // Build final packet
  const packet: OperatorContextPacket = {
    tenantId,
    canonicalOperatorId,
    generatedAt,
    mappedUserIds,
    card: {
      explicitFacts,
      explicitPreferences,
    },
    observedPatterns,
    learnedSignals,
    interventionEvidence,
    uncertainty,
    evidenceRefs,
  };

  // 10. Safety check: Run entire packet through forbidden derived pattern check
  assertNoForbiddenDerivedPatterns(packet);

  return packet;
}
