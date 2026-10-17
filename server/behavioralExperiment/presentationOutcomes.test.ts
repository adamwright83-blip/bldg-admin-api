import { describe, expect, it } from "vitest";
import { STANDARD_PRESENTATION } from "../../shared/behavioralInterventionMapping";
import type { LedgerEventType } from "../../shared/behavioralLedger";
import {
  joinPresentationOutcomes,
  presentationOutcomesAsDaphneEvidence,
  type JoinableLedgerRow,
} from "./presentationOutcomes";

let nextId = 1;
const at = (minute: number) => new Date(Date.UTC(2026, 9, 12, 16, minute));
function row(eventType: LedgerEventType, minute: number, changes: Partial<JoinableLedgerRow> = {}): JoinableLedgerRow {
  return {
    id: nextId++, tenantId: "t1", operatorUserId: "op1", correlationId: "ops_task:7", eventType,
    occurredAt: at(minute), verificationClass: eventType === "COMPLETED" ? "CLAIMED" : null,
    decisionPointId: null, availability: null, eligibleOptionsJson: null, assignedOption: null,
    assignmentProbability: null, interventionPolicyVersion: null, interventionDefinitionVersion: null,
    proximalOutcomeWindowMinutes: null, ...changes,
  };
}
function assigned(minute: number, occasion: string, option: string, changes: Partial<JoinableLedgerRow> = {}) {
  return row("ASSIGNED", minute, {
    decisionPointId: `ops_task:7:offer:${occasion}`, availability: true,
    eligibleOptionsJson: [STANDARD_PRESENTATION, "beacon-walk-v1", "sealed-doors-v1"], assignedOption: option,
    assignmentProbability: "0.33333", interventionPolicyVersion: 1, interventionDefinitionVersion: 1,
    proximalOutcomeWindowMinutes: 120, ...changes,
  });
}

describe("joining observed outcomes to presentation assignments", () => {
  it("attaches start and completion to the assignment in force, with the frozen window", () => {
    const a = assigned(0, "c1", "beacon-walk-v1");
    const [joined] = joinPresentationOutcomes([row("COMPLETED", 50), row("STARTED", 10), a]);
    expect(joined).toMatchObject({
      assignmentEventId: a.id, decisionPointId: "ops_task:7:offer:c1", assignedOption: "beacon-walk-v1",
      availability: true, assignmentProbability: 0.33333, interventionPolicyVersion: 1,
      interventionDefinitionVersion: 1, proximalOutcomeWindowMinutes: 120, outcome: "completed",
    });
    expect(joined.outcomeEvents.map(e => e.eventType)).toEqual(["STARTED", "COMPLETED"]);
    expect(joined.proximal).toMatchObject({ startedWithinWindow: true, startLatencySeconds: 600, windowFrozenAtAssignment: true });
  });

  it("calls a dismissal or expiry a skip, a bare start a start, and silence unknown", () => {
    const outcomes = joinPresentationOutcomes([
      assigned(0, "dismissed", "beacon-walk-v1", { correlationId: "ops_task:1" }),
      row("STARTED", 5, { correlationId: "ops_task:1" }),
      row("DISMISSED", 9, { correlationId: "ops_task:1" }),
      assigned(0, "expired", "sealed-doors-v1", { correlationId: "ops_task:2" }),
      row("EXPIRED", 200, { correlationId: "ops_task:2" }),
      assigned(0, "started", STANDARD_PRESENTATION, { correlationId: "ops_task:3" }),
      row("STARTED", 3, { correlationId: "ops_task:3" }),
      assigned(0, "silent", "beacon-walk-v1", { correlationId: "ops_task:4" }),
      row("VIEWABLE", 1, { correlationId: "ops_task:4", decisionPointId: "ops_task:7:offer:silent" }),
    ]);
    expect(outcomes.map(o => [o.correlationId, o.outcome])).toEqual([
      ["ops_task:1", "skipped"], ["ops_task:2", "skipped"], ["ops_task:3", "started"], ["ops_task:4", "unknown"],
    ]);
    expect(outcomes[3].decisiveEvent).toBeNull();
    expect(outcomes[3].outcomeEvents.map(e => e.eventType)).toEqual(["VIEWABLE"]);
  });

  it("gives each outcome to the latest assignment before it, never to a later one or another operator", () => {
    const first = assigned(0, "c1", "beacon-walk-v1");
    const second = assigned(30, "c2", STANDARD_PRESENTATION);
    const outcomes = joinPresentationOutcomes([
      first, row("DISMISSED", 10), second, row("COMPLETED", 40),
      row("COMPLETED", 45, { operatorUserId: "someone-else" }),
    ]);
    expect(outcomes.find(o => o.assignmentEventId === first.id)?.outcome).toBe("skipped");
    expect(outcomes.find(o => o.assignmentEventId === second.id)?.outcome).toBe("completed");
    expect(outcomes.flatMap(o => o.outcomeEvents)).toHaveLength(2);
  });

  it("ignores outcome events with no prior assignment", () => {
    expect(joinPresentationOutcomes([row("DISMISSED", 1), assigned(5, "c1", "beacon-walk-v1")])[0].outcome).toBe("unknown");
  });

  it("trusts ledger order within a second of clock rounding, but never attaches a genuinely older replayed event", () => {
    const a = assigned(10, "c1", "beacon-walk-v1");
    const sameSecond = row("STARTED", 10, { occurredAt: new Date(a.occurredAt.getTime() - 1000) });
    const replayed = row("DISMISSED", 2);
    const [joined] = joinPresentationOutcomes([a, sameSecond, replayed]);
    expect(joined.outcomeEvents.map(e => e.id)).toEqual([sameSecond.id]);
    expect(joined.outcome).toBe("started");
  });

  it("keeps an unavailable (throttled) decision distinct from a randomized one", () => {
    const [joined] = joinPresentationOutcomes([
      assigned(0, "c1", STANDARD_PRESENTATION, { availability: false, assignmentProbability: null }),
    ]);
    expect(joined).toMatchObject({ availability: false, assignmentProbability: null, assignedOption: STANDARD_PRESENTATION });
  });

  it("feeds Daphne verified skips and attested (claimed) completions, and nothing for unknown", () => {
    const outcomes = joinPresentationOutcomes([
      assigned(0, "a", "beacon-walk-v1", { correlationId: "ops_task:1" }), row("DISMISSED", 2, { correlationId: "ops_task:1" }),
      assigned(0, "b", "sealed-doors-v1", { correlationId: "ops_task:2" }), row("COMPLETED", 2, { correlationId: "ops_task:2" }),
      assigned(0, "c", "sealed-doors-v1", { correlationId: "ops_task:3" }), row("STARTED", 2, { correlationId: "ops_task:3" }),
    ]);
    const evidence = presentationOutcomesAsDaphneEvidence(outcomes);
    expect(evidence).toHaveLength(2);
    expect(evidence[0]).toMatchObject({ missionId: "ops_task:1", variantId: "beacon-walk-v1", outcome: "skipped", verificationStatus: "verified" });
    expect(evidence[1]).toMatchObject({ missionId: "ops_task:2", variantId: "sealed-doors-v1", outcome: "completed", verificationStatus: "attested" });
    expect(evidence.every(e => e.sourceRef.startsWith("behavioral_ledger_events:") && e.operatorReason === undefined)).toBe(true);
  });
});
