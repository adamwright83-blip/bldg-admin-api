import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dayDirectorCommitments,
  dayDirectorProcessingLocations,
  dayDirectorPromptStates,
  towerWarsPromises,
} from "../../../drizzle/schema";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../../db", () => ({ getDb: mocks.getDb }));

import { dayDirectorActorId } from "./dayDirectorActor";
import {
  completeDayDirectorCommitment,
  getDayDirectorState,
} from "./dayDirectorService";
import { activateTowerWarsPromise } from "./towerWarsPromiseService";
import { DayDirectorAdmissionError, type DayDirectorAdmission } from "./dayDirectorAdmission";

/** What towerWars.activatePromise passes for the signed-in admin. */
function appInstruction(actorId: string, ref: string): DayDirectorAdmission {
  return { kind: "operator_instruction", channel: "authenticated_app", operatorActorId: actorId, instructionRef: ref };
}

type Row = Record<string, any>;

function predicateParameters(predicate: unknown): unknown[] {
  if (!predicate || typeof predicate !== "object") return [];
  const node = predicate as {
    constructor?: { name?: string };
    queryChunks?: unknown[];
    value?: unknown;
  };
  if (node.constructor?.name === "Param") {
    return Array.isArray(node.value) ? node.value : [node.value];
  }
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
    fulfilledAt: null,
    fulfilledBy: null,
    fulfillmentEvidence: null,
  };
  const db: any = {
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
            const tenantId = params[0];
            const target = params[params.length - 1];
            const actorIds = params.slice(1, -1);
            rows = commitments.filter(
              row =>
                row.tenantId === tenantId &&
                (actorIds.length === 0 || actorIds.includes(row.actorId)) &&
                (row.businessDate === target || row.id === target)
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
    update: vi.fn((table: object) => ({
      set: (values: Row) => ({
        where: async (predicate: unknown) => {
          const params = predicateParameters(predicate);
          if (table === dayDirectorCommitments) {
            const tenantId = params[0];
            const target = params[params.length - 1];
            const actorIds = params.slice(1, -1);
            const row = commitments.find(
              item =>
                item.tenantId === tenantId &&
                (actorIds.length === 0 || actorIds.includes(item.actorId)) &&
                item.id === target
            );
            if (row) Object.assign(row, values);
          } else if (
            table === towerWarsPromises &&
            promise.tenantId === params[0] &&
            promise.id === params[1]
          ) {
            Object.assign(promise, values);
          }
        },
      }),
    })),
  };
  db.transaction = async (run: (tx: typeof db) => unknown) => run(db);
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
      admission: appInstruction(actorId, `tower_wars.activatePromise:oauth-open-id-42:${memory.promise.id}`),
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

  it("fulfills the originating promise when its Day Director work completes", async () => {
    const memory = memoryDb();
    mocks.getDb.mockResolvedValue(memory.db);
    const actorId = dayDirectorActorId({ user: { id: 42 } });
    await activateTowerWarsPromise({
      tenantId: "tenant-a",
      promiseId: memory.promise.id,
      actorId,
      admission: appInstruction(actorId, `tower_wars.activatePromise:42:${memory.promise.id}`),
    });
    const commitmentId = String(memory.commitments[0]!.id);

    await completeDayDirectorCommitment({
      tenantId: "tenant-a",
      actorId,
      commitmentId,
      admission: appInstruction(actorId, `day_director.complete:42:${commitmentId}`),
    });

    expect(memory.commitments[0]).toMatchObject({ status: "completed" });
    expect(memory.promise).toMatchObject({
      fulfilledBy: "42",
      fulfillmentEvidence: `Completed through Day Director commitment ${commitmentId}`,
    });
    expect(memory.promise.fulfilledAt).toBeInstanceOf(Date);
  });

  it("records the admitting instruction on the commitment it writes", async () => {
    const memory = memoryDb();
    mocks.getDb.mockResolvedValue(memory.db);
    await activateTowerWarsPromise({
      tenantId: "tenant-a",
      promiseId: memory.promise.id,
      actorId: "42",
      admission: appInstruction("42", "tower_wars.activatePromise:admin-42:p1"),
    });
    expect(memory.commitments[0]?.metadataJson).toMatchObject({
      admission: {
        kind: "operator_instruction",
        channel: "authenticated_app",
        instructionRef: "tower_wars.activatePromise:admin-42:p1",
      },
    });
  });

  it("refuses an activation without an admission, or for another operator, and writes nothing", async () => {
    const memory = memoryDb();
    mocks.getDb.mockResolvedValue(memory.db);
    await expect(
      activateTowerWarsPromise({
        tenantId: "tenant-a",
        promiseId: memory.promise.id,
        actorId: "42",
      } as unknown as Parameters<typeof activateTowerWarsPromise>[0])
    ).rejects.toMatchObject({ name: "DayDirectorAdmissionError", reason: "admission_missing" });
    await expect(
      activateTowerWarsPromise({
        tenantId: "tenant-a",
        promiseId: memory.promise.id,
        actorId: "42",
        admission: appInstruction("7", "tower_wars.activatePromise:someone-else:p1"),
      })
    ).rejects.toBeInstanceOf(DayDirectorAdmissionError);
    expect(memory.commitments).toHaveLength(0);
    expect(memory.db.insert).not.toHaveBeenCalled();
  });
});
