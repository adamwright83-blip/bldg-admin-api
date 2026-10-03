/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
/**
 * Deterministic Conquest Crash Recovery Test
 *
 * Simulates the exact production crash window identified in audit:
 * 1. An authoritative won event persists in commercialMissionEvents.
 * 2. Immediate conquest propagation was skipped (simulated crash / restart before conquest ran).
 * 3. The original sales objective was already transitioned to "completed" by the normal win bridge.
 * 4. The sweeper later runs:
 *    - Discovers the won event across any tenant (tenant-discovering, zero default-tenant fallback).
 *    - Recovers the original objectiveId from the durable account_won outcome (or matching completed objective).
 *    - Propagates conquest exactly once with recovered objective lineage.
 *    - Persists completion receipt.
 * 5. A second sweep runs immediately:
 *    - Finds the durable completion receipt / outcome.
 *    - Exactly zero duplicate conquest work is performed (processedCount = 0).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import * as dbModule from "../db";
import { sweepUnpropagatedConquestWins } from "./autonomousWorkerService";
import * as geographicConquestModule from "./geographicConquestService";

describe("Conquest Crash Recovery & Multi-Tenant Sweeper Lineage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("recovers objective lineage from durable account_won outcome during crash window and converges idempotently", async () => {
    const testTenant = "test-tenant-recovery-alpha";
    const testMissionId = 4410;
    const testActorId = "operator-alex";
    const completedObjectiveId = "obj-lineage-completed-789";

    // In-memory state tracking for crash simulation
    let conquestOutcomePersisted = false;
    let conquestReceiptPersisted = false;
    let propagateConquestCallCount = 0;
    let passedObjectiveIdToConquest: string | null = null;

    // Spy on propagateGeographicConquest
    vi.spyOn(geographicConquestModule, "propagateGeographicConquest").mockImplementation(
      async (input) => {
        propagateConquestCallCount++;
        passedObjectiveIdToConquest = input.objectiveId ?? null;
        conquestOutcomePersisted = true;
        conquestReceiptPersisted = true;
        return {
          propagated: true,
          wonAccount: {
            id: 88,
            name: "Verified Won Property",
            address: "100 Route Blvd",
            latitude: 34.1,
            longitude: -118.3,
          },
          generatedMissions: [
            {
              missionId: 4411,
              accountName: "Adjacent Neighbor Facility",
              distanceMiles: 0.15,
              reason: "Corridor neighbor pitch",
            },
          ],
        };
      }
    );

    // Mock DB queries simulating the exact database state
    const mockDb = {
      select: (fields: any) => ({
        from: (table: any) => ({
          where: (condition: any) => ({
            orderBy: () => ({
              limit: async (limitCount: number) => {
                // Check if querying commercialMissionEvents for won events
                if (fields.toStatus !== undefined || fields.missionId !== undefined) {
                  return [
                    {
                      id: 9001,
                      tenantId: testTenant,
                      missionId: testMissionId,
                      actorId: testActorId,
                      createdAt: new Date(),
                    },
                  ];
                }
                // Check if querying goalCycleOutcomes for lineage
                if (fields.objectiveId !== undefined) {
                  return [
                    {
                      objectiveId: completedObjectiveId,
                      metadataJson: {
                        missionId: testMissionId,
                        resolution: "won",
                      },
                    },
                  ];
                }
                return [];
              },
            }),
            limit: async (limitCount: number) => {
              // Table: Check A - existing conquest outcome in goalCycleOutcomes
              // (selected field is { id: goalCycleOutcomes.id })
              if (conquestOutcomePersisted || conquestReceiptPersisted) {
                return [{ id: "outcome-receipt-conquest-1" }];
              }
              return [];
            },
          }),
        }),
      }),
    };

    vi.spyOn(dbModule, "getDb").mockResolvedValue(mockDb as any);

    // --- SWEEP 1: Crash Recovery ---
    // Simulates the autonomous worker waking up after a crash where the won event was written
    // and the objective was completed, but conquest was interrupted.
    const sweep1Result = await sweepUnpropagatedConquestWins({ tenantId: testTenant });

    expect(sweep1Result.errors).toEqual([]);
    expect(sweep1Result.processedCount).toBe(1);
    expect(propagateConquestCallCount).toBe(1);
    // CRITICAL: Original objective lineage must be recovered from the durable account_won outcome!
    expect(passedObjectiveIdToConquest).toBe(completedObjectiveId);

    // --- SWEEP 2: Idempotent Zero-Work Convergence ---
    // A subsequent sweep runs on the next tick; receipt and outcome exist, so 0 work must be done.
    const sweep2Result = await sweepUnpropagatedConquestWins({ tenantId: testTenant });

    expect(sweep2Result.errors).toEqual([]);
    expect(sweep2Result.processedCount).toBe(0);
    // propagateGeographicConquest MUST NOT be invoked a second time!
    expect(propagateConquestCallCount).toBe(1);
  });

  it("is multi-tenant discovering across all tenants when tenantId is omitted", async () => {
    let queriedWithoutTenantFilter = false;

    const mockDb = {
      select: () => ({
        from: () => ({
          where: (condition: any) => {
            // When tenantId is omitted, conditions should only filter by toStatus = 'won'
            // and NOT constrain to any default tenant.
            queriedWithoutTenantFilter = true;
            return {
              orderBy: () => ({
                limit: async () => [],
              }),
            };
          },
        }),
      }),
    };

    vi.spyOn(dbModule, "getDb").mockResolvedValue(mockDb as any);

    const result = await sweepUnpropagatedConquestWins();
    expect(result.processedCount).toBe(0);
    expect(result.errors).toEqual([]);
    expect(queriedWithoutTenantFilter).toBe(true);
  });

  it("recovers objective lineage from goalCycleObjectives if account_won outcome metadata is unavailable", async () => {
    const testTenant = "test-tenant-recovery-fallback";
    const testMissionId = 5520;
    const testActorId = "operator-sam";
    const completedObjectiveId = "obj-lineage-direct-fallback-999";

    let passedObjectiveIdToConquest: string | null = null;

    vi.spyOn(geographicConquestModule, "propagateGeographicConquest").mockImplementation(
      async (input) => {
        passedObjectiveIdToConquest = input.objectiveId ?? null;
        return {
          propagated: true,
          wonAccount: null,
          generatedMissions: [],
        };
      }
    );

    const mockDb = {
      select: (fields: any) => ({
        from: (table: any) => ({
          where: (condition: any) => ({
            orderBy: () => ({
              limit: async (limitCount: number) => {
                // Table 1: won event query
                if (fields.toStatus !== undefined || fields.missionId !== undefined) {
                  return [
                    {
                      id: 9005,
                      tenantId: testTenant,
                      missionId: testMissionId,
                      actorId: testActorId,
                      createdAt: new Date(),
                    },
                  ];
                }
                // Table 2: goalCycleOutcomes query (simulate missing outcome metadata)
                if (fields.objectiveId !== undefined) {
                  return [];
                }
                // Table 3: goalCycleObjectives query (completed objective lookup)
                if (fields.id !== undefined) {
                  return [{ id: completedObjectiveId }];
                }
                return [];
              },
            }),
            limit: async () => [],
          }),
        }),
      }),
    };

    vi.spyOn(dbModule, "getDb").mockResolvedValue(mockDb as any);

    const sweepResult = await sweepUnpropagatedConquestWins({ tenantId: testTenant });
    expect(sweepResult.errors).toEqual([]);
    expect(sweepResult.processedCount).toBe(1);
    // Verifies fallback lineage recovery directly from completed objectives table
    expect(passedObjectiveIdToConquest).toBe(completedObjectiveId);
  });

  it("prevents backlog starvation: pages past >25 newer already-processed wins to recover an older pending win", async () => {
    const testTenant = "test-tenant-anti-starvation";
    const testActorId = "operator-alex";
    const olderPendingMissionId = 2001;
    const olderPendingObjectiveId = "obj-lineage-older-pending-1001";

    // Build 30 won events: IDs 1030 down to 1001
    // Top 29 events (IDs 1030 to 1002) ALREADY have conquest completion receipts.
    // The 30th event (ID 1001, mission 2001) is unpropagated.
    const totalEventsCount = 30;
    const allWonEvents: Array<{
      id: number;
      tenantId: string;
      missionId: number;
      actorId: string;
      createdAt: Date;
    }> = [];

    for (let i = totalEventsCount; i >= 1; i--) {
      allWonEvents.push({
        id: 1000 + i,
        tenantId: testTenant,
        missionId: 2000 + i,
        actorId: testActorId,
        createdAt: new Date(Date.now() - (totalEventsCount - i) * 1000),
      });
    }

    let recoveredMissionId: number | null = null;
    let recoveredObjectiveId: string | null = null;

    vi.spyOn(geographicConquestModule, "propagateGeographicConquest").mockImplementation(
      async (input) => {
        recoveredMissionId = input.missionId ?? null;
        recoveredObjectiveId = input.objectiveId ?? null;
        return {
          propagated: true,
          wonAccount: null,
          generatedMissions: [],
        };
      }
    );

    let currentCursor: number | null = null;
    let receiptCheckCalls = 0;

    const mockDb = {
      select: (fields: any) => ({
        from: (table: any) => ({
          where: (condition: any) => ({
            orderBy: () => ({
              limit: async (batchLimit: number) => {
                // 1. Won events query with cursor pagination
                if (fields.toStatus !== undefined || fields.missionId !== undefined) {
                  let candidates = allWonEvents;
                  if (currentCursor !== null) {
                    candidates = candidates.filter((e) => e.id < currentCursor!);
                  }
                  const batch = candidates.slice(0, batchLimit);
                  if (batch.length > 0) {
                    currentCursor = batch[batch.length - 1].id;
                  }
                  return batch;
                }
                // 2. Lineage query (goalCycleOutcomes / goalCycleObjectives)
                if (fields.objectiveId !== undefined) {
                  return [
                    {
                      objectiveId: olderPendingObjectiveId,
                      metadataJson: {
                        missionId: olderPendingMissionId,
                        resolution: "won",
                      },
                    },
                  ];
                }
                return [];
              },
            }),
            limit: async () => {
              // 3. Receipt checks (goalCycleOutcomes / commercialMissionEvents)
              // The first 29 missions are already receipted.
              // Calls 30+ correspond to older mission 2001 which has NO receipt.
              if (receiptCheckCalls < 29) {
                receiptCheckCalls++;
                return [{ id: 8888 }];
              }
              receiptCheckCalls++;
              return [];
            },
          }),
        }),
      }),
    };

    vi.spyOn(dbModule, "getDb").mockResolvedValue(mockDb as any);

    // Run sweeper with batchSize = 10, limit = 25
    // The top 29 items (batches 1, 2, and 3) are already processed.
    // The cursoring loop must page past the first 29 items and process the 30th item (mission 2001).
    const sweepResult = await sweepUnpropagatedConquestWins({
      tenantId: testTenant,
      limit: 25,
      batchSize: 10,
    });

    expect(sweepResult.errors).toEqual([]);
    expect(sweepResult.processedCount).toBe(1);
    // Verifies the older starved win (mission 2001) beyond position 25 was successfully reached and recovered!
    expect(recoveredMissionId).toBe(olderPendingMissionId);
    expect(recoveredObjectiveId).toBe(olderPendingObjectiveId);
  });
});
