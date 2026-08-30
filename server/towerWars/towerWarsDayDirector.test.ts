import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dayDirectorCommitments,
  dayDirectorProcessingLocations,
  dayDirectorPromptStates,
  towerWarsPromises,
} from "../../drizzle/schema";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.getDb }));

import { dayDirectorActorId } from "../dayDirector/dayDirectorActor";
import { getDayDirectorState } from "../dayDirector/dayDirectorService";
import { activateTowerWarsPromise } from "./towerWarsService";

type Row = Record<string, any>;

function predicateParameters(predicate: unknown): unknown[] {
  if (!predicate || typeof predicate !== "object") return [];
  const node = predicate as {
    constructor?: { name?: string };
    queryChunks?: unknown[];
    value?: unknown;
  };
  if (node.constructor?.name === "Param") return [node.value];
  return (node.queryChunks ?? []).flatMap(predicateParameters);
}

function memoryDb() {
  const commitments: Row[] = [];
  const promise: Row = {
    id: "11111111-1111-4111-8111-111111111111",
    tenantId: "tenant-a",
    buildingId: "opus_la",
    promiseType: "referral_card",
    sourceText: "Send the referral card the customer explicitly requested.",
    sourceReference: "customer-note:1",
    quantity: 1,
    permissionStatus: "recorded",
    permissionChannel: "sms",
    permissionEvidence:
      "Customer explicitly requested the referral card by SMS.",
  };
  const db = {
    select: vi.fn(() => ({
      from: (table: object) => ({
        where: (predicate: unknown) => {
          const params = predicateParameters(predicate);
          let rows: Row[] = [];
          if (table === towerWarsPromises) {
            rows =
              promise.tenantId === params[0] && promise.id === params[1]
                ? [promise]
                : [];
          } else if (table === dayDirectorCommitments) {
            rows = commitments.filter(
              row =>
                row.tenantId === params[0] &&
                row.actorId === params[1] &&
                row.businessDate === params[2]
            );
          } else if (
            table === dayDirectorProcessingLocations ||
            table === dayDirectorPromptStates
          ) {
            rows = [];
          }
          const result = Promise.resolve(rows) as Promise<Row[]> & {
            limit: (count: number) => Promise<Row[]>;
          };
          result.limit = async count => rows.slice(0, count);
          return result;
        },
      }),
    })),
    insert: vi.fn((table: object) => ({
      values: (value: Row) => ({
        onDuplicateKeyUpdate: async () => {
          if (table === dayDirectorCommitments) {
            commitments.push({
              status: "open",
              completedAt: null,
              ...value,
            });
          }
        },
      }),
    })),
  };
  return { db, commitments, promise };
}

describe("Tower Wars → Day Director actor identity", () => {
  beforeEach(() => mocks.getDb.mockReset());

  it("arms the promise in the authenticated user's visible Day Director state", async () => {
    const memory = memoryDb();
    mocks.getDb.mockResolvedValue(memory.db);
    const ctx = { user: { id: 42, openId: "oauth-open-id-42" } };
    const actorId = dayDirectorActorId(ctx);

    const activation = await activateTowerWarsPromise({
      tenantId: "tenant-a",
      promiseId: memory.promise.id,
      actorId,
    });
    const state = await getDayDirectorState({
      tenantId: "tenant-a",
      actorId: dayDirectorActorId(ctx),
      businessDate: activation.businessDate,
    });

    expect(actorId).toBe("42");
    expect(state.commitments).toEqual([
      expect.objectContaining({
        title: "Fulfill permission-backed referral action",
        status: "open",
      }),
    ]);
    expect(memory.commitments[0]?.actorId).toBe("42");
    expect(memory.commitments[0]?.actorId).not.toBe(ctx.user.openId);
  });
});
