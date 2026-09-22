import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
  row: null | {
    id: string;
    tenantId: string;
    operatorUserId: string;
    occurrenceLedgerEntryId: string;
    beatId: string;
    presentationId: string;
    status: "prepared" | "rendered_to_surface";
    preparedAt: Date;
    renderedAt: Date | null;
    idempotencyKey: string;
  };
} = { row: null };

function mentionsPrepared(value: unknown, seen = new Set<object>()): boolean {
  if (value === "prepared") return true;
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some(item => mentionsPrepared(item, seen));
  }
  return Object.values(value).some(item => mentionsPrepared(item, seen));
}

vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    update: () => ({
      set: (values: { status: "rendered_to_surface"; renderedAt: Date }) => ({
        where: async (predicate: unknown) => {
          if (!state.row) return { affectedRows: 0 };
          const conditional = mentionsPrepared(predicate);
          if (conditional && state.row.status !== "prepared") {
            return { affectedRows: 0 };
          }
          state.row = {
            ...state.row,
            status: values.status,
            renderedAt: values.renderedAt,
          };
          return { affectedRows: 1 };
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (state.row ? [state.row] : []),
        }),
      }),
    }),
  })),
}));

describe("presentation receipt compare-and-set", () => {
  beforeEach(() => {
    state.row = {
      id: "receipt-1",
      tenantId: "t-h",
      operatorUserId: "op-h",
      occurrenceLedgerEntryId: "occ-1",
      beatId: "M04",
      presentationId: "presentation:occ-1",
      status: "prepared",
      preparedAt: new Date("2026-09-21T00:00:00.000Z"),
      renderedAt: null,
      idempotencyKey: "presentation:occ-1",
    };
  });

  it("keeps the first renderedAt when a later render loses the prepared update", async () => {
    const { createDrizzleNarratorPresentationStore } = await import(
      "./presentationDrizzleStore"
    );
    const store = createDrizzleNarratorPresentationStore();
    const firstStamp = "2026-09-21T01:00:00.000Z";
    const secondStamp = "2026-09-21T09:00:00.000Z";
    const first = await store.markRendered({
      scope: { tenantId: "t-h", operatorUserId: "op-h" },
      occurrenceLedgerEntryId: "occ-1",
      renderedAt: firstStamp,
    });
    const second = await store.markRendered({
      scope: { tenantId: "t-h", operatorUserId: "op-h" },
      occurrenceLedgerEntryId: "occ-1",
      renderedAt: secondStamp,
    });
    expect(first?.renderedAt).toBe(firstStamp);
    expect(second?.renderedAt).toBe(firstStamp);
    expect(second?.status).toBe("rendered_to_surface");
    expect(state.row?.renderedAt?.toISOString()).toBe(firstStamp);
  });
});
