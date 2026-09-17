import { describe, expect, it } from "vitest";
import type { ActionGrammar } from "../../shared/actionGrammar";
import type { FictionTemplate } from "../../shared/fictionTemplate";
import { recordBehavioralLedgerEvent, type BehavioralLedgerStore } from "../behavioralLedger/behavioralLedger";
import type { BehavioralLedgerEvent, InsertBehavioralLedgerEvent } from "../../drizzle/schema";
import { selectPreferredFictionForTask } from "./selectPreferredFiction";

function createFakeStore(): BehavioralLedgerStore & { rows: BehavioralLedgerEvent[] } {
  const rows: BehavioralLedgerEvent[] = [];
  let nextId = 1;
  return {
    rows,
    async insertIfAbsent(input: InsertBehavioralLedgerEvent) {
      const existing = rows.find(
        r => r.tenantId === input.tenantId && r.idempotencyKey === input.idempotencyKey
      );
      if (existing) return existing;
      const row = { ...input, id: nextId++, createdAt: new Date() } as BehavioralLedgerEvent;
      rows.push(row);
      return row;
    },
    async listByCorrelation(tenantId, correlationId) {
      return rows.filter(r => r.tenantId === tenantId && r.correlationId === correlationId);
    },
    async listByOperatorSource(tenantId, operatorUserId, sourceEntityId) {
      return rows.filter(
        r =>
          r.tenantId === tenantId &&
          r.operatorUserId === operatorUserId &&
          r.sourceEntityId === sourceEntityId
      );
    },
    async listByOperatorCorrelation(tenantId, operatorUserId, correlationId) {
      return rows.filter(
        r =>
          r.tenantId === tenantId &&
          r.operatorUserId === operatorUserId &&
          r.correlationId === correlationId
      );
    },
  };
}

const grammar: ActionGrammar = {
  kind: "VISIT_LOCATION",
  businessActionId: "42",
  occurrenceId: 42,
  sourceType: "recovery",
  count: 1,
  locations: ["100 Wilshire"],
  channel: "in_person",
  requiresTravel: true,
  requiresDriving: false,
  timerSafe: true,
  sensitiveConversation: false,
};

const template: FictionTemplate = {
  id: "beacon-walk-v1",
  rulesVersion: 1,
  compatibleGrammarKinds: ["VISIT_LOCATION"],
  title: "BEACON WALK",
  briefing: () => "x",
  physicalInstruction: () => "y",
  stakes: "z",
  successTreatment: { headline: "a", detail: "b" },
  failureTreatment: { headline: "c", detail: "d" },
  worldReturnTreatment: "w",
  timerEligible: false,
  drivingCompatible: false,
  attentionSafetyClass: "safe_walking",
  humanInteractionCompatible: false,
};

describe("selectPreferredFictionForTask", () => {
  it("assembles realistic mirrored ops rows by correlation, not sourceEntityId", async () => {
    const store = createFakeStore();
    const base = {
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      correlationId: "ops_task:42",
      sourceSystem: "ops_task" as const,
      sourceEntityType: "ops_task_event",
      occurredAt: new Date("2026-09-17T12:00:00Z"),
      verificationClass: null,
      provenance: "ops_task_event",
    };
    await recordBehavioralLedgerEvent(
      { ...base, sourceEntityId: "101", eventType: "DELIVERED", idempotencyKey: "ops_task_event:101" },
      store
    );
    await recordBehavioralLedgerEvent(
      { ...base, sourceEntityId: "102", eventType: "DEFERRED", idempotencyKey: "ops_task_event:102" },
      store
    );
    await recordBehavioralLedgerEvent(
      { ...base, sourceEntityId: "103", eventType: "DEFERRED", idempotencyKey: "ops_task_event:103" },
      store
    );
    await recordBehavioralLedgerEvent(
      {
        ...base,
        correlationId: "ops_task:99",
        sourceEntityId: "201",
        eventType: "DEFERRED",
        idempotencyKey: "ops_task_event:201",
      },
      store
    );
    const before = store.rows.length;
    const decision = await selectPreferredFictionForTask({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      grammar,
      registry: [template],
      store,
    });
    expect(store.rows).toHaveLength(before);
    expect(new Set(store.rows.map(row => row.sourceEntityId)).size).toBe(4);
    expect(decision.preferredTemplateId).toBe("beacon-walk-v1");
    expect(decision.evidence.counts.deferred).toBe(2);
    expect(decision.assignmentProbability).toBeNull();
    expect(decision.assignmentMechanism).toBe("deterministic_policy");
    expect(decision.businessActionId).toBe("42");
    expect(decision.correlationId).toBe("ops_task:42");
  });
});
