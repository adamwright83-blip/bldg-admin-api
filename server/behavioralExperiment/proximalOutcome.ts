import type { LedgerEventType } from "../../shared/behavioralLedger";

export type ObservableLedgerEvent = {
  eventType: LedgerEventType;
  occurredAt: Date;
  decisionPointId?: string | null;
};

export type ProximalOutcomeCharacterization = {
  decisionPointId: string;
  assignedOption: string;
  proximalOutcomeWindowMinutes: number;
  windowFrozenAtAssignment: true;
  deliveredAt: string | null;
  viewableAt: string | null;
  engagedAt: string | null;
  acceptedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  verifiedAt: string | null;
  startedWithinWindow: boolean | "unknown";
  startLatencySeconds: number | null;
  deferredWithinWindow: boolean | "unavailable";
  dismissedWithinWindow: boolean | "unknown";
  deferredSignal: "observed" | "unavailable";
};

function firstAfter(
  events: readonly ObservableLedgerEvent[],
  type: LedgerEventType,
  from: Date
): Date | null {
  const match = events.find(event => event.eventType === type && event.occurredAt >= from);
  return match?.occurredAt ?? null;
}

/**
 * Characterize observed events after a persisted assignment.
 * Absence is unknown — never IGNORED. DEFERRED is unavailable unless rows exist
 * in the post-assignment stream (no manufactured deferral).
 */
export function characterizeProximalOutcome(input: {
  decisionPointId: string;
  assignedOption: string;
  assignedAt: Date;
  proximalOutcomeWindowMinutes: number;
  events: readonly ObservableLedgerEvent[];
  deferredProducerExists: boolean;
}): ProximalOutcomeCharacterization {
  const from = input.assignedAt;
  const windowMs = input.proximalOutcomeWindowMinutes * 60_000;
  const windowEnd = new Date(from.getTime() + windowMs);
  const after = input.events.filter(event => event.occurredAt >= from);
  const deliveredAt = firstAfter(after, "DELIVERED", from);
  const startedAt = firstAfter(after, "STARTED", from);
  const dismissedAt = firstAfter(after, "DISMISSED", from);
  const deferredAt = firstAfter(after, "DEFERRED", from);
  let startedWithinWindow: boolean | "unknown" = "unknown";
  let startLatencySeconds: number | null = null;
  if (startedAt) {
    startedWithinWindow = startedAt.getTime() <= windowEnd.getTime();
    startLatencySeconds = Math.max(0, (startedAt.getTime() - from.getTime()) / 1000);
  }
  const deferredSignal: "observed" | "unavailable" = input.deferredProducerExists
    ? "observed"
    : "unavailable";
  return {
    decisionPointId: input.decisionPointId,
    assignedOption: input.assignedOption,
    proximalOutcomeWindowMinutes: input.proximalOutcomeWindowMinutes,
    windowFrozenAtAssignment: true,
    deliveredAt: deliveredAt?.toISOString() ?? null,
    viewableAt: firstAfter(after, "VIEWABLE", from)?.toISOString() ?? null,
    engagedAt: firstAfter(after, "ENGAGED", from)?.toISOString() ?? null,
    acceptedAt: firstAfter(after, "ACCEPTED", from)?.toISOString() ?? null,
    startedAt: startedAt?.toISOString() ?? null,
    completedAt: firstAfter(after, "COMPLETED", from)?.toISOString() ?? null,
    verifiedAt: firstAfter(after, "VERIFIED", from)?.toISOString() ?? null,
    startedWithinWindow,
    startLatencySeconds,
    deferredWithinWindow:
      deferredSignal === "unavailable" ? "unavailable" : deferredAt != null && deferredAt <= windowEnd,
    dismissedWithinWindow: dismissedAt ? dismissedAt <= windowEnd : "unknown",
    deferredSignal,
  };
}
