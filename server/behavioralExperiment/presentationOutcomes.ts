/**
 * Joins observed work outcomes back to the presentation assignment that was in
 * force (BEHAVIORAL_SCIENCE_FOUNDATION.md §§4–5, 7).
 *
 * Outcomes are never written onto the assignment row: the ledger stays
 * append-only and the join is derived. An outcome event belongs to the latest
 * ASSIGNED decision for the same operator and behavioral subject that was
 * recorded before it (ledger order) and did not occur after it. Absence of an
 * outcome is "unknown" — never skipped, never IGNORED.
 */
import type { LedgerEventType } from "../../shared/behavioralLedger";
import type { DaphneMissionPresentationEvidence } from "../agents/daphne/missionFramingExperiment";
import {
  listBehavioralLedgerEventsForOperatorBounded,
  MAX_BOUNDED_OPERATOR_LEDGER_LIMIT,
  type BehavioralLedgerStore,
} from "../behavioralLedger/behavioralLedger";
import { characterizeProximalOutcome, type ProximalOutcomeCharacterization } from "./proximalOutcome";
import { describeRandomizedOutcomes, type RandomizedExperimentReport } from "./experimentReport";

export type JoinableLedgerRow = {
  id: number;
  tenantId: string;
  operatorUserId: string;
  correlationId: string;
  eventType: LedgerEventType;
  occurredAt: Date;
  verificationClass: "VERIFIED" | "ATTESTED" | "CLAIMED" | null;
  decisionPointId: string | null;
  availability: boolean | null;
  eligibleOptionsJson: unknown;
  assignedOption: string | null;
  assignmentProbability: string | null;
  interventionPolicyVersion: number | null;
  interventionDefinitionVersion: number | null;
  proximalOutcomeWindowMinutes: number | null;
};

/** What the work did after the assignment, by precedence: completed > skipped > started. */
export type PresentationOutcome = "completed" | "skipped" | "started" | "unknown";

export type AttributedOutcomeEvent = {
  id: number;
  eventType: LedgerEventType;
  occurredAt: Date;
  verificationClass: "VERIFIED" | "ATTESTED" | "CLAIMED" | null;
};

export type JoinedPresentationOutcome = {
  assignmentEventId: number;
  tenantId: string;
  operatorUserId: string;
  correlationId: string;
  decisionPointId: string;
  availability: boolean;
  eligibleOptions: string[];
  assignedOption: string;
  assignmentProbability: number | null;
  interventionPolicyVersion: number | null;
  interventionDefinitionVersion: number | null;
  proximalOutcomeWindowMinutes: number;
  assignedAt: Date;
  outcome: PresentationOutcome;
  /** The event that decided `outcome`; null when unknown. */
  decisiveEvent: AttributedOutcomeEvent | null;
  outcomeEvents: AttributedOutcomeEvent[];
  proximal: ProximalOutcomeCharacterization;
};

/**
 * Ledger timestamps are whole seconds, and outcome rows take the database
 * clock while assignments take the application clock. Within this tolerance,
 * ledger order decides; a replayed, genuinely older event still cannot attach.
 */
const TIMESTAMP_TOLERANCE_MS = 1000;

const COMPLETION_EVENTS = new Set<LedgerEventType>(["COMPLETED", "VERIFIED"]);
/** Explicit dismissal or a defined expiry rule. Non-completion alone is not a skip. */
const SKIP_EVENTS = new Set<LedgerEventType>(["DISMISSED", "EXPIRED", "NOT_COMPLETED"]);

function byTime(a: JoinableLedgerRow, b: JoinableLedgerRow) {
  return a.occurredAt.getTime() - b.occurredAt.getTime() || a.id - b.id;
}

export function joinPresentationOutcomes(rows: readonly JoinableLedgerRow[]): JoinedPresentationOutcome[] {
  const ordered = [...rows].sort(byTime);
  const subject = (row: JoinableLedgerRow) => `${row.tenantId}\u0000${row.operatorUserId}\u0000${row.correlationId}`;
  const assignments = ordered.filter(
    row => row.eventType === "ASSIGNED" && row.decisionPointId && row.assignedOption && row.availability != null
  );
  const byDecisionPoint = new Map(assignments.map(row => [`${subject(row)}\u0000${row.decisionPointId}`, row]));
  const attributed = new Map<number, AttributedOutcomeEvent[]>(assignments.map(row => [row.id, []]));

  for (const row of ordered) {
    if (row.eventType === "ASSIGNED") continue;
    // Rows that carry their decision point (e.g. VIEWABLE) attach to it directly.
    const owner = row.decisionPointId
      ? byDecisionPoint.get(`${subject(row)}\u0000${row.decisionPointId}`)
      : assignments
          .filter(a => subject(a) === subject(row) && a.id < row.id &&
            a.occurredAt.getTime() - row.occurredAt.getTime() <= TIMESTAMP_TOLERANCE_MS)
          .reduce<JoinableLedgerRow | undefined>((latest, a) => (!latest || a.id > latest.id ? a : latest), undefined);
    if (!owner) continue;
    attributed.get(owner.id)!.push({
      id: row.id,
      eventType: row.eventType,
      occurredAt: row.occurredAt,
      verificationClass: row.verificationClass,
    });
  }

  return assignments.map(assignment => {
    const events = attributed.get(assignment.id)!;
    const completed = events.find(event => COMPLETION_EVENTS.has(event.eventType));
    const skipped = events.find(event => SKIP_EVENTS.has(event.eventType));
    const started = events.find(event => event.eventType === "STARTED");
    const decisiveEvent = completed ?? skipped ?? started ?? null;
    const outcome: PresentationOutcome = completed ? "completed" : skipped ? "skipped" : started ? "started" : "unknown";
    const windowMinutes = assignment.proximalOutcomeWindowMinutes ?? 0;
    return {
      assignmentEventId: assignment.id,
      tenantId: assignment.tenantId,
      operatorUserId: assignment.operatorUserId,
      correlationId: assignment.correlationId,
      decisionPointId: assignment.decisionPointId!,
      availability: assignment.availability!,
      eligibleOptions: Array.isArray(assignment.eligibleOptionsJson) ? assignment.eligibleOptionsJson.map(String) : [],
      assignedOption: assignment.assignedOption!,
      assignmentProbability: assignment.assignmentProbability == null ? null : Number(assignment.assignmentProbability),
      interventionPolicyVersion: assignment.interventionPolicyVersion,
      interventionDefinitionVersion: assignment.interventionDefinitionVersion,
      proximalOutcomeWindowMinutes: windowMinutes,
      assignedAt: assignment.occurredAt,
      outcome,
      decisiveEvent,
      outcomeEvents: events,
      proximal: characterizeProximalOutcome({
        decisionPointId: assignment.decisionPointId!,
        assignedOption: assignment.assignedOption!,
        assignedAt: assignment.occurredAt,
        proximalOutcomeWindowMinutes: windowMinutes,
        events,
        // No production surface records an explicit operator "not now" yet.
        deferredProducerExists: false,
      }),
    };
  });
}

/**
 * Converts joined outcomes into Daphne presentation evidence for the fatigue
 * gate. A skip proves the work was dismissed or expired, never why; a claimed
 * completion stays attested, not verified.
 */
export function presentationOutcomesAsDaphneEvidence(
  outcomes: readonly JoinedPresentationOutcome[]
): DaphneMissionPresentationEvidence[] {
  return outcomes.flatMap(item => {
    const event = item.decisiveEvent;
    if (!event || (item.outcome !== "skipped" && item.outcome !== "completed")) return [];
    const verified =
      item.outcome === "skipped" || event.eventType === "VERIFIED" || event.verificationClass === "VERIFIED";
    return [{
      tenantId: item.tenantId,
      operatorUserId: item.operatorUserId,
      missionId: item.correlationId,
      variantId: item.assignedOption,
      outcome: item.outcome,
      verificationStatus: verified ? "verified" : "attested",
      sourceRef: `behavioral_ledger_events:${event.id}`,
      observedAt: event.occurredAt.toISOString(),
    }];
  });
}

/** The operator's recent presentation assignments with their observed outcomes. */
export async function loadPresentationAssignmentOutcomes(
  input: { tenantId: string; operatorUserId: string; limit?: number },
  store?: BehavioralLedgerStore
): Promise<JoinedPresentationOutcome[]> {
  const rows = await listBehavioralLedgerEventsForOperatorBounded(
    {
      tenantId: input.tenantId,
      operatorUserIds: [input.operatorUserId],
      limit: input.limit ?? MAX_BOUNDED_OPERATOR_LEDGER_LIMIT,
    },
    store
  );
  return joinPresentationOutcomes(rows);
}

/**
 * Descriptive outcomes by arm for this operator's randomized decisions only.
 * Throttled (unavailable) decisions are excluded: they were not randomized.
 * Never a causal claim (foundation §2); the report says so itself.
 */
export async function loadPresentationExperimentReport(
  input: { tenantId: string; operatorUserId: string; minSamplePerArm: number },
  store?: BehavioralLedgerStore
): Promise<RandomizedExperimentReport & { unavailableDecisionCount: number }> {
  const outcomes = await loadPresentationAssignmentOutcomes(input, store);
  const randomized = outcomes.filter(item => item.availability && item.assignmentProbability != null);
  return {
    ...describeRandomizedOutcomes({
      outcomes: randomized.map(item => item.proximal),
      minSamplePerArm: input.minSamplePerArm,
      deferredProducerExists: false,
    }),
    unavailableDecisionCount: outcomes.length - randomized.length,
  };
}
