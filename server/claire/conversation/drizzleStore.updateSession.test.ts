import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("../../db", () => ({ getDb: mocks.getDb }));

import { attachConversationKind, createConversationSession, productionConversationStore } from "./ledgerService";
import { createDrizzleClaireConversationStore } from "./drizzleStore";
import { setClaireConversationStoreForTesting } from "./memoryStore";

function predicateValues(predicate: unknown): unknown[] {
  if (!predicate || typeof predicate !== "object") return [];
  const node = predicate as { constructor?: { name?: string }; queryChunks?: unknown[]; value?: unknown };
  if (node.constructor?.name === "Param") return [node.value];
  return (node.queryChunks ?? []).flatMap(predicateValues);
}

function createInMemoryConversationDb() {
  const sessions = new Map<string, Record<string, unknown>>();
  const updateSets: Record<string, unknown>[] = [];

  function rowFor(predicate: unknown): Record<string, unknown> | undefined {
    for (const value of predicateValues(predicate)) {
      if (typeof value !== "string") continue;
      const byId = sessions.get(value);
      if (byId) return byId;
      for (const row of sessions.values()) {
        if (row.claireConversationId === value) return row;
      }
    }
    return undefined;
  }

  return {
    updateSets,
    insert() {
      return {
        values: async (values: Record<string, unknown>) => {
          sessions.set(String(values.id), { ...values });
        },
      };
    },
    update() {
      return {
        set(values: Record<string, unknown>) {
          updateSets.push({ ...values });
          return {
            where: async (predicate: unknown) => {
              const row = rowFor(predicate);
              if (row) Object.assign(row, values);
            },
          };
        },
      };
    },
    select() {
      return {
        from() {
          return {
            where(predicate: unknown) {
              return {
                limit: async (count: number) => {
                  const row = rowFor(predicate);
                  return row ? [row].slice(0, count) : [];
                },
              };
            },
          };
        },
      };
    },
  };
}

describe("Drizzle conversation store persists conversationKind patches", () => {
  let db: ReturnType<typeof createInMemoryConversationDb>;

  beforeEach(() => {
    db = createInMemoryConversationDb();
    mocks.getDb.mockResolvedValue(db);
    setClaireConversationStoreForTesting(createDrizzleClaireConversationStore());
  });

  afterEach(() => {
    setClaireConversationStoreForTesting(null);
  });

  it("attachConversationKind writes morning_reconciliation through the production Drizzle updater", async () => {
    const created = await createConversationSession({
      tenantId: "default",
      operatorUserId: "adam-admin",
      claireConversationId: "conv-kind-drizzle",
      conversationKind: "pre_drive",
      recordingEnabled: false,
      providerCallSid: "CA-KIND-DRIZZLE",
    });
    expect(created.conversationKind).toBe("pre_drive");

    const before = await productionConversationStore().getSessionByClaireId("conv-kind-drizzle");
    expect(before?.conversationKind).toBe("pre_drive");

    const updated = await attachConversationKind({
      claireConversationId: "conv-kind-drizzle",
      conversationKind: "morning_reconciliation",
    });
    expect(updated?.conversationKind).toBe("morning_reconciliation");
    expect(db.updateSets).toContainEqual(
      expect.objectContaining({ conversationKind: "morning_reconciliation" })
    );

    const stored = await productionConversationStore().getSessionByClaireId("conv-kind-drizzle");
    expect(stored?.conversationKind).toBe("morning_reconciliation");
    const byId = await productionConversationStore().getSession(created.id);
    expect(byId?.conversationKind).toBe("morning_reconciliation");
  });
});
