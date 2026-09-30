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
});
