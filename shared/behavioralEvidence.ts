import type { LedgerEventType } from "./behavioralLedger";
import type { EpistemicClass } from "./behavioralInterventionMapping";

export type BehavioralLedgerLikeEvent = {
  tenantId: string;
  operatorUserId: string;
  eventType: LedgerEventType;
  /** Immutable source-event identity (ops_task_event.id). Not the history key. */
  sourceEntityId: string;
  /** Stable subject. For ops tasks: `ops_task:<taskId>`. */
  correlationId: string;
};

export type OperatorDeclaredBarrier = {
  key: "time" | "access" | "other";
  statement: string;
};

export type BehavioralEvidenceCounts = {
  delivered: number;
  viewable: number;
  engaged: number;
  accepted: number;
  started: number;
  completed: number;
  verified: number;
  deferred: number;
  dismissed: number;
  expired: number;
  notCompleted: number;
};

export type BehavioralEvidence = {
  tenantId: string;
  operatorUserId: string;
  correlationId: string;
  counts: BehavioralEvidenceCounts;
  consideredEventTypes: LedgerEventType[];
  declaredBarriers: OperatorDeclaredBarrier[];
  epistemicNotes: Array<{ class: EpistemicClass; detail: string }>;
};

const EMPTY_COUNTS: BehavioralEvidenceCounts = {
  delivered: 0,
  viewable: 0,
  engaged: 0,
  accepted: 0,
  started: 0,
  completed: 0,
  verified: 0,
  deferred: 0,
  dismissed: 0,
  expired: 0,
  notCompleted: 0,
};

function bump(counts: BehavioralEvidenceCounts, type: LedgerEventType): void {
  switch (type) {
    case "DELIVERED":
      counts.delivered += 1;
      break;
    case "VIEWABLE":
      counts.viewable += 1;
      break;
    case "ENGAGED":
      counts.engaged += 1;
      break;
    case "ACCEPTED":
      counts.accepted += 1;
      break;
    case "STARTED":
      counts.started += 1;
      break;
    case "COMPLETED":
      counts.completed += 1;
      break;
    case "VERIFIED":
      counts.verified += 1;
      break;
    case "DEFERRED":
      counts.deferred += 1;
      break;
    case "DISMISSED":
      counts.dismissed += 1;
      break;
    case "EXPIRED":
      counts.expired += 1;
      break;
    case "NOT_COMPLETED":
      counts.notCompleted += 1;
      break;
    default:
      break;
  }
}

/**
 * Assemble observed counts by tenant + operator + correlationId.
 * Does not infer DEFERRED from NOT_COMPLETED, DISMISSED, EXPIRED, or silence.
 */
export function assembleBehavioralEvidence(input: {
  tenantId: string;
  operatorUserId: string;
  correlationId: string;
  events: readonly BehavioralLedgerLikeEvent[];
  declaredBarriers?: readonly OperatorDeclaredBarrier[];
}): BehavioralEvidence {
  const counts = { ...EMPTY_COUNTS };
  const considered: LedgerEventType[] = [];
  for (const event of input.events) {
    if (event.tenantId !== input.tenantId) continue;
    if (event.operatorUserId !== input.operatorUserId) continue;
    if (event.correlationId !== input.correlationId) continue;
    bump(counts, event.eventType);
    considered.push(event.eventType);
  }
  const declaredBarriers = [...(input.declaredBarriers ?? [])];
  const epistemicNotes: BehavioralEvidence["epistemicNotes"] = [
    {
      class: "behavior-observed",
      detail: `Counted ${considered.length} ledger event(s) for ${input.correlationId}.`,
    },
  ];
  if (declaredBarriers.length) {
    epistemicNotes.push({
      class: "operator-declared",
      detail: declaredBarriers.map(item => item.statement).join(" "),
    });
  }
  return {
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    correlationId: input.correlationId,
    counts,
    consideredEventTypes: considered,
    declaredBarriers,
    epistemicNotes,
  };
}
