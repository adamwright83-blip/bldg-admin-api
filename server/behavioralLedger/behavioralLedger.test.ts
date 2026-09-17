import { describe, expect, it } from "vitest";
import { recordBehavioralLedgerEvent, listBehavioralLedgerEventsForCorrelation, listBehavioralLedgerEventsForOperatorSource, listBehavioralLedgerEventsForOperatorCorrelation } from "./behavioralLedger";
import type { BehavioralLedgerStore } from "./behavioralLedger";
import type { BehavioralLedgerEvent, InsertBehavioralLedgerEvent } from "../../drizzle/schema";

/**
 * In-memory fake store, mirroring the drizzle store's idempotency contract:
 * a second insert with the same (tenantId, idempotencyKey) returns the
 * existing row rather than creating a duplicate.
 */
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
    async listByCorrelation(tenantId: string, correlationId: string) {
      return rows.filter(r => r.tenantId === tenantId && r.correlationId === correlationId);
    },
    async listByOperatorSource(tenantId: string, operatorUserId: string, sourceEntityId: string) {
      return rows.filter(
        r =>
          r.tenantId === tenantId &&
          r.operatorUserId === operatorUserId &&
          r.sourceEntityId === sourceEntityId
      );
    },
    async listByOperatorCorrelation(tenantId: string, operatorUserId: string, correlationId: string) {
      return rows.filter(
        r =>
          r.tenantId === tenantId &&
          r.operatorUserId === operatorUserId &&
          r.correlationId === correlationId
      );
    },
  };
}

const baseInput = {
  tenantId: "tenant-a",
  operatorUserId: "operator-1",
  correlationId: "ops_task:42",
  sourceSystem: "ops_task" as const,
  sourceEntityType: "ops_task",
  sourceEntityId: "42",
  occurredAt: new Date("2026-09-17T09:13:00Z"),
  verificationClass: null,
  provenance: "test",
};

describe("recordBehavioralLedgerEvent", () => {
  it("a delivery produces exactly one row, not one per render/read", async () => {
    const store = createFakeStore();
    // Simulate three renders/polls all trying to record the same delivery.
    for (let i = 0; i < 3; i++) {
      await recordBehavioralLedgerEvent(
        { ...baseInput, eventType: "DELIVERED", idempotencyKey: "ops_task:42:DELIVERED" },
        store
      );
    }
    expect(store.rows.filter(r => r.eventType === "DELIVERED")).toHaveLength(1);
  });

  it("acceptance is distinguishable from start", async () => {
    const store = createFakeStore();
    await recordBehavioralLedgerEvent(
      { ...baseInput, eventType: "ACCEPTED", idempotencyKey: "ops_task:42:ACCEPTED" },
      store
    );
    await recordBehavioralLedgerEvent(
      { ...baseInput, eventType: "STARTED", idempotencyKey: "ops_task:42:STARTED" },
      store
    );
    const events = await listBehavioralLedgerEventsForCorrelation("tenant-a", "ops_task:42", store);
    const types = events.map(e => e.eventType).sort();
    expect(types).toEqual(["ACCEPTED", "STARTED"]);
  });

  it("an explicit defer stays factual and distinct from dismissal/expiry", async () => {
    const store = createFakeStore();
    await recordBehavioralLedgerEvent(
      { ...baseInput, eventType: "DEFERRED", idempotencyKey: "ops_task:42:DEFERRED:1" },
      store
    );
    expect(store.rows[0]?.eventType).toBe("DEFERRED");
    expect(store.rows[0]?.eventType).not.toBe("DISMISSED");
    expect(store.rows[0]?.eventType).not.toBe("EXPIRED");
  });

  it("completion does not imply verification", async () => {
    const store = createFakeStore();
    const row = await recordBehavioralLedgerEvent(
      {
        ...baseInput,
        eventType: "COMPLETED",
        verificationClass: "CLAIMED",
        idempotencyKey: "ops_task:42:COMPLETED",
      },
      store
    );
    expect(row?.eventType).toBe("COMPLETED");
    expect(row?.verificationClass).toBe("CLAIMED");
    expect(row?.verificationClass).not.toBe("VERIFIED");

    // Independent verification arrives later as its own row, not a mutation
    // of the completion row (append-only — nothing here is ever edited).
    await recordBehavioralLedgerEvent(
      {
        ...baseInput,
        eventType: "VERIFIED",
        verificationClass: "VERIFIED",
        idempotencyKey: "ops_task:42:VERIFIED",
      },
      store
    );
    expect(store.rows).toHaveLength(2);
    expect(store.rows[0]?.eventType).toBe("COMPLETED");
    expect(store.rows[0]?.verificationClass).toBe("CLAIMED");
  });

  it("duplicate callbacks/retries of the same transition do not duplicate rows", async () => {
    const store = createFakeStore();
    const key = "ops_task:42:STARTED";
    const first = await recordBehavioralLedgerEvent(
      { ...baseInput, eventType: "STARTED", idempotencyKey: key },
      store
    );
    const retry = await recordBehavioralLedgerEvent(
      { ...baseInput, eventType: "STARTED", occurredAt: new Date("2026-09-17T09:20:00Z"), idempotencyKey: key },
      store
    );
    expect(store.rows).toHaveLength(1);
    expect(retry?.id).toBe(first?.id);
    // The retry's later timestamp must not overwrite the original occurredAt.
    expect(retry?.occurredAt).toEqual(first?.occurredAt);
  });

  it("tenant A events cannot leak into tenant B's correlation listing", async () => {
    const store = createFakeStore();
    await recordBehavioralLedgerEvent(
      { ...baseInput, tenantId: "tenant-a", eventType: "STARTED", idempotencyKey: "ops_task:42:STARTED" },
      store
    );
    await recordBehavioralLedgerEvent(
      { ...baseInput, tenantId: "tenant-b", eventType: "STARTED", idempotencyKey: "ops_task:42:STARTED" },
      store
    );
    const tenantAEvents = await listBehavioralLedgerEventsForCorrelation("tenant-a", "ops_task:42", store);
    const tenantBEvents = await listBehavioralLedgerEventsForCorrelation("tenant-b", "ops_task:42", store);
    expect(tenantAEvents).toHaveLength(1);
    expect(tenantBEvents).toHaveLength(1);
    expect(store.rows).toHaveLength(2);
  });

  it("fails closed (no-op) when operatorUserId is unresolved, rather than writing an orphan row", async () => {
    const store = createFakeStore();
    const result = await recordBehavioralLedgerEvent(
      { ...baseInput, operatorUserId: "", eventType: "STARTED", idempotencyKey: "ops_task:42:STARTED" },
      store
    );
    expect(result).toBeNull();
    expect(store.rows).toHaveLength(0);
  });

  it("decision-point fields round-trip without inferred data masquerading as observed", async () => {
    const store = createFakeStore();
    await recordBehavioralLedgerEvent(
      {
        ...baseInput,
        eventType: "STARTED",
        idempotencyKey: "ops_task:42:STARTED",
        decisionPoint: {
          decisionPointId: "dp-1",
          availability: true,
          eligibleOptions: ["standard_presentation", "infiltration"],
          assignedOption: "infiltration",
          assignmentProbability: 0.5,
          interventionPolicyVersion: 1,
          interventionDefinitionVersion: 1,
          proximalOutcomeWindowMinutes: 60,
        },
      },
      store
    );
    const row = store.rows[0]!;
    // Preserved exactly as given — this module never derives or infers any
    // of these fields itself, it only persists what the caller observed.
    expect(row.decisionPointId).toBe("dp-1");
    expect(row.availability).toBe(true);
    expect(row.eligibleOptionsJson).toEqual(["standard_presentation", "infiltration"]);
    expect(row.assignedOption).toBe("infiltration");
    expect(row.assignmentProbability).toBe("0.5");
    expect(row.interventionPolicyVersion).toBe(1);
  });

  it("non-decision-point events carry no decision-point fields", async () => {
    const store = createFakeStore();
    await recordBehavioralLedgerEvent(
      { ...baseInput, eventType: "DELIVERED", idempotencyKey: "ops_task:42:DELIVERED" },
      store
    );
    const row = store.rows[0]!;
    expect(row.decisionPointId).toBeNull();
    expect(row.assignedOption).toBeNull();
    expect(row.assignmentProbability).toBeNull();
  });
});

describe("listBehavioralLedgerEventsForOperatorSource", () => {
  it("does not return another tenant or operator's history", async () => {
    const store = createFakeStore();
    await recordBehavioralLedgerEvent(
      { ...baseInput, eventType: "DEFERRED", idempotencyKey: "a" },
      store
    );
    await recordBehavioralLedgerEvent(
      { ...baseInput, tenantId: "other", eventType: "DEFERRED", idempotencyKey: "b" },
      store
    );
    const rows = await listBehavioralLedgerEventsForOperatorSource("tenant-a", "operator-1", "42", store);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe("tenant-a");
  });
});

describe("listBehavioralLedgerEventsForOperatorCorrelation", () => {
  it("aggregates distinct sourceEntityIds that share ops_task correlation", async () => {
    const store = createFakeStore();
    await recordBehavioralLedgerEvent(
      {
        ...baseInput,
        sourceEntityType: "ops_task_event",
        sourceEntityId: "101",
        eventType: "DELIVERED",
        idempotencyKey: "ops_task_event:101",
      },
      store
    );
    await recordBehavioralLedgerEvent(
      {
        ...baseInput,
        sourceEntityType: "ops_task_event",
        sourceEntityId: "102",
        eventType: "ACCEPTED",
        idempotencyKey: "ops_task_event:102",
      },
      store
    );
    await recordBehavioralLedgerEvent(
      {
        ...baseInput,
        correlationId: "ops_task:99",
        sourceEntityType: "ops_task_event",
        sourceEntityId: "201",
        eventType: "DEFERRED",
        idempotencyKey: "ops_task_event:201",
      },
      store
    );
    const rows = await listBehavioralLedgerEventsForOperatorCorrelation(
      "tenant-a",
      "operator-1",
      "ops_task:42",
      store
    );
    expect(rows.map(row => row.eventType).sort()).toEqual(["ACCEPTED", "DELIVERED"]);
    expect(new Set(rows.map(row => row.sourceEntityId))).toEqual(new Set(["101", "102"]));
  });
});
