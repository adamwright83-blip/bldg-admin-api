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
  it("reads ledger history without rewriting it", async () => {
    const store = createFakeStore();
    const base = {
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      correlationId: "task:42",
      sourceSystem: "ops_task" as const,
      sourceEntityType: "ops_task",
      sourceEntityId: "42",
      occurredAt: new Date("2026-09-17T12:00:00Z"),
      verificationClass: null,
      provenance: "test",
    };
    await recordBehavioralLedgerEvent({ ...base, eventType: "DEFERRED", idempotencyKey: "d1" }, store);
    await recordBehavioralLedgerEvent({ ...base, eventType: "DEFERRED", idempotencyKey: "d2" }, store);
    const before = store.rows.length;
    const decision = await selectPreferredFictionForTask({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      sourceEntityId: "42",
      grammar,
      registry: [template],
      store,
    });
    expect(store.rows).toHaveLength(before);
    expect(decision.preferredTemplateId).toBe("beacon-walk-v1");
    expect(decision.businessActionId).toBe("42");
  });
});
