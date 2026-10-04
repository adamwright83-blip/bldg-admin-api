/**
 * Mitch v1 — Durable Production Store
 *
 * Implements persistence for Mitch game production operating system.
 * Follows repository conventions: supports Drizzle / MySQL database operations
 * when database is available, with full in-memory fallback for isolated testing
 * and environments without live MySQL.
 */
import { and, asc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  mitchAuditEvents,
  mitchBuilds,
  mitchExecutionRuns,
  mitchGameProductionStates,
  mitchIssues,
  mitchMilestones,
  mitchQaRuns,
  mitchWorkOrders,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type {
  MitchAuditEvent,
  MitchBuild,
  MitchExecutionHandback,
  MitchExecutionRun,
  MitchGameProductionState,
  MitchIssue,
  MitchMilestone,
  MitchQaRun,
  MitchWorkOrder,
  MitchWorkOrderStatus,
} from "../../shared/mitchContracts";
import { assertValidBuildIdentity } from "../../shared/mitchContracts";

export interface IMitchProductionStore {
  // Game Production State
  getProductionState(tenantId: string, gameId: string): Promise<MitchGameProductionState | null>;
  saveProductionState(state: MitchGameProductionState): Promise<MitchGameProductionState>;

  // Milestones
  listMilestones(tenantId: string, gameId: string): Promise<MitchMilestone[]>;
  getMilestone(tenantId: string, gameId: string, milestoneKey: string): Promise<MitchMilestone | null>;
  saveMilestone(milestone: MitchMilestone): Promise<MitchMilestone>;

  // Work Orders
  createWorkOrder(order: Omit<MitchWorkOrder, "id" | "createdAt" | "updatedAt">): Promise<MitchWorkOrder>;
  getWorkOrder(tenantId: string, workOrderId: string): Promise<MitchWorkOrder | null>;
  listWorkOrders(tenantId: string, gameId: string, status?: MitchWorkOrderStatus): Promise<MitchWorkOrder[]>;
  claimWorkOrder(input: {
    tenantId: string;
    workOrderId: string;
    claimedBy: string;
    leaseMs: number;
  }): Promise<MitchWorkOrder | null>;
  renewWorkOrderLease(input: {
    tenantId: string;
    workOrderId: string;
    claimedBy: string;
    leaseMs: number;
  }): Promise<boolean>;
  completeWorkOrderImplementation(input: {
    tenantId: string;
    workOrderId: string;
    handback: MitchExecutionHandback;
    executionRunId: string;
  }): Promise<{ workOrder: MitchWorkOrder; build: MitchBuild }>;
  failWorkOrder(input: {
    tenantId: string;
    workOrderId: string;
    error: string;
  }): Promise<MitchWorkOrder>;

  // Execution Runs
  recordExecutionRun(run: Omit<MitchExecutionRun, "id" | "createdAt">): Promise<MitchExecutionRun>;
  getExecutionRun(tenantId: string, runId: string): Promise<MitchExecutionRun | null>;

  // Builds
  recordBuild(build: MitchBuild): Promise<MitchBuild>;
  getBuild(tenantId: string, buildId: string): Promise<MitchBuild | null>;
  listBuilds(tenantId: string, gameId: string): Promise<MitchBuild[]>;
  markBuildVerified(tenantId: string, buildId: string): Promise<MitchBuild>;

  // QA Runs
  recordQaRun(qaRun: Omit<MitchQaRun, "id" | "createdAt">): Promise<MitchQaRun>;
  getQaRun(tenantId: string, qaRunId: string): Promise<MitchQaRun | null>;
  listQaRuns(tenantId: string, gameId: string): Promise<MitchQaRun[]>;

  // Issues
  createIssue(issue: Omit<MitchIssue, "id" | "createdAt" | "updatedAt">): Promise<MitchIssue>;
  getIssue(tenantId: string, issueId: string): Promise<MitchIssue | null>;
  updateIssue(issue: MitchIssue): Promise<MitchIssue>;
  listIssues(tenantId: string, gameId: string, status?: string): Promise<MitchIssue[]>;

  // Audit
  recordAuditEvent(event: Omit<MitchAuditEvent, "id" | "occurredAt">): Promise<MitchAuditEvent>;
  listAuditEvents(tenantId: string, gameId: string): Promise<MitchAuditEvent[]>;
}

export class MitchProductionStore implements IMitchProductionStore {
  // In-memory fallback stores for tests or when DB is unreachable
  private memoryStates = new Map<string, MitchGameProductionState>();
  private memoryMilestones = new Map<string, MitchMilestone>();
  private memoryWorkOrders = new Map<string, MitchWorkOrder>();
  private memoryExecutionRuns = new Map<string, MitchExecutionRun>();
  private memoryBuilds = new Map<string, MitchBuild>();
  private memoryQaRuns = new Map<string, MitchQaRun>();
  private memoryIssues = new Map<string, MitchIssue>();
  private memoryAuditEvents: MitchAuditEvent[] = [];

  constructor(
    private readonly forceMemoryMode: boolean = false,
    private readonly requireDurablePersistence: boolean = false
  ) {
    if (forceMemoryMode && requireDurablePersistence) {
      throw new Error("MitchProductionStore cannot require durable persistence in forced memory mode.");
    }
  }

  private handlePersistenceFailure(error: unknown): void {
    if (this.requireDurablePersistence) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private assertDurableDb(db: unknown): void {
    if (this.requireDurablePersistence && !db) {
      throw new Error("Mitch native producer requires durable MySQL persistence, but getDb() returned null.");
    }
  }

  private stateKey(tenantId: string, gameId: string) {
    return `${tenantId}::${gameId}`;
  }

  private milestoneKey(tenantId: string, gameId: string, milestoneKey: string) {
    return `${tenantId}::${gameId}::${milestoneKey}`;
  }

  // --- Game Production State ---
  async getProductionState(tenantId: string, gameId: string): Promise<MitchGameProductionState | null> {
    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          const [row] = await db
            .select()
            .from(mitchGameProductionStates)
            .where(
              and(
                eq(mitchGameProductionStates.tenantId, tenantId),
                eq(mitchGameProductionStates.gameId, gameId)
              )
            )
            .limit(1);
          if (row) {
            return {
              id: row.id,
              tenantId: row.tenantId,
              gameId: row.gameId,
              storedRowId: row.storedRowId ?? null,
              title: row.title,
              lifecycleState: row.lifecycleState as MitchGameProductionState["lifecycleState"],
              realBusinessBinding: row.realBusinessBinding,
              coreMechanic: row.coreMechanic,
              companionDependency: row.companionDependency,
              requiredAssets: (row.requiredAssetsJson as string[]) ?? [],
              blockingDependencies: (row.blockingDependenciesJson as string[]) ?? [],
              currentAvailableBuildId: row.currentAvailableBuildId,
              lastVerifiedBuildId: row.lastVerifiedBuildId,
              creativeAcceptanceState: row.creativeAcceptanceState as MitchGameProductionState["creativeAcceptanceState"],
              creativeAcceptanceNote: row.creativeAcceptanceNote,
              creativeAcceptanceDecidedAt: row.creativeAcceptanceDecidedAt?.toISOString() ?? null,
              releaseState: row.releaseState as MitchGameProductionState["releaseState"],
              releasedAt: row.releasedAt?.toISOString() ?? null,
              createdAt: row.createdAt.toISOString(),
              updatedAt: row.updatedAt.toISOString(),
            };
          }
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Fall back to memory
      
      }
    }
    return this.memoryStates.get(this.stateKey(tenantId, gameId)) ?? null;
  }

  async saveProductionState(state: MitchGameProductionState): Promise<MitchGameProductionState> {
    const nowIso = new Date().toISOString();
    const updatedState: MitchGameProductionState = {
      ...state,
      updatedAt: nowIso,
    };

    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          const row = {
            id: state.id,
            tenantId: state.tenantId,
            gameId: state.gameId,
            storedRowId: state.storedRowId ?? null,
            title: state.title,
            lifecycleState: state.lifecycleState,
            realBusinessBinding: state.realBusinessBinding,
            coreMechanic: state.coreMechanic,
            companionDependency: state.companionDependency,
            requiredAssetsJson: state.requiredAssets,
            blockingDependenciesJson: state.blockingDependencies,
            currentAvailableBuildId: state.currentAvailableBuildId,
            lastVerifiedBuildId: state.lastVerifiedBuildId,
            creativeAcceptanceState: state.creativeAcceptanceState,
            creativeAcceptanceNote: state.creativeAcceptanceNote,
            creativeAcceptanceDecidedAt: state.creativeAcceptanceDecidedAt
              ? new Date(state.creativeAcceptanceDecidedAt)
              : null,
            releaseState: state.releaseState,
            releasedAt: state.releasedAt ? new Date(state.releasedAt) : null,
            updatedAt: new Date(),
          };

          const existing = await this.getProductionState(state.tenantId, state.gameId);
          if (existing) {
            await db
              .update(mitchGameProductionStates)
              .set(row)
              .where(
                and(
                  eq(mitchGameProductionStates.tenantId, state.tenantId),
                  eq(mitchGameProductionStates.gameId, state.gameId)
                )
              );
          } else {
            await db.insert(mitchGameProductionStates).values({
              ...row,
              createdAt: new Date(state.createdAt),
            });
          }
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Continue to memory
      
      }
    }

    this.memoryStates.set(this.stateKey(state.tenantId, state.gameId), updatedState);
    return updatedState;
  }

  // --- Milestones ---
  async listMilestones(tenantId: string, gameId: string): Promise<MitchMilestone[]> {
    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          const rows = await db
            .select()
            .from(mitchMilestones)
            .where(
              and(
                eq(mitchMilestones.tenantId, tenantId),
                eq(mitchMilestones.gameId, gameId)
              )
            )
            .orderBy(asc(mitchMilestones.sequence));
          if (rows.length > 0) {
            return rows.map(r => ({
              id: r.id,
              tenantId: r.tenantId,
              gameId: r.gameId,
              milestoneKey: r.milestoneKey,
              sequence: r.sequence,
              title: r.title,
              desiredPlayerVisibleResult: r.desiredPlayerVisibleResult,
              acceptanceCriteria: (r.acceptanceCriteriaJson as string[]) ?? [],
              status: r.status as MitchMilestone["status"],
              currentAvailableBuildId: r.currentAvailableBuildId,
              lastVerifiedBuildId: r.lastVerifiedBuildId,
              blockedReason: r.blockedReason,
              isHumanCreativeBlocker: Boolean(r.isHumanCreativeBlocker),
              createdAt: r.createdAt.toISOString(),
              updatedAt: r.updatedAt.toISOString(),
            }));
          }
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
      }
    }

    return Array.from(this.memoryMilestones.values())
      .filter(m => m.tenantId === tenantId && m.gameId === gameId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  async getMilestone(tenantId: string, gameId: string, milestoneKey: string): Promise<MitchMilestone | null> {
    const list = await this.listMilestones(tenantId, gameId);
    return list.find(m => m.milestoneKey === milestoneKey) ?? null;
  }

  async saveMilestone(milestone: MitchMilestone): Promise<MitchMilestone> {
    const nowIso = new Date().toISOString();
    const updated: MitchMilestone = { ...milestone, updatedAt: nowIso };

    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          const row = {
            id: milestone.id,
            tenantId: milestone.tenantId,
            gameId: milestone.gameId,
            milestoneKey: milestone.milestoneKey,
            sequence: milestone.sequence,
            title: milestone.title,
            desiredPlayerVisibleResult: milestone.desiredPlayerVisibleResult,
            acceptanceCriteriaJson: milestone.acceptanceCriteria,
            status: milestone.status,
            currentAvailableBuildId: milestone.currentAvailableBuildId,
            lastVerifiedBuildId: milestone.lastVerifiedBuildId,
            blockedReason: milestone.blockedReason,
            isHumanCreativeBlocker: milestone.isHumanCreativeBlocker,
            updatedAt: new Date(),
          };
          const existing = await this.getMilestone(milestone.tenantId, milestone.gameId, milestone.milestoneKey);
          if (existing) {
            await db
              .update(mitchMilestones)
              .set(row)
              .where(
                and(
                  eq(mitchMilestones.tenantId, milestone.tenantId),
                  eq(mitchMilestones.gameId, milestone.gameId),
                  eq(mitchMilestones.milestoneKey, milestone.milestoneKey)
                )
              );
          } else {
            await db.insert(mitchMilestones).values({
              ...row,
              createdAt: new Date(milestone.createdAt),
            });
          }
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
      }
    }

    this.memoryMilestones.set(this.milestoneKey(milestone.tenantId, milestone.gameId, milestone.milestoneKey), updated);
    return updated;
  }

  // --- Work Orders ---
  async createWorkOrder(order: Omit<MitchWorkOrder, "id" | "createdAt" | "updatedAt">): Promise<MitchWorkOrder> {
    const nowIso = new Date().toISOString();
    const fullOrder: MitchWorkOrder = {
      ...order,
      id: randomUUID(),
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          await db.insert(mitchWorkOrders).values({
            id: fullOrder.id,
            tenantId: fullOrder.tenantId,
            gameId: fullOrder.gameId,
            milestoneId: fullOrder.milestoneId,
            milestoneKey: fullOrder.milestoneKey,
            title: fullOrder.title,
            desiredPlayerVisibleResult: fullOrder.desiredPlayerVisibleResult,
            acceptanceCriteriaJson: fullOrder.acceptanceCriteria,
            canonConstraintsJson: fullOrder.canonConstraints,
            relevantDependenciesJson: fullOrder.relevantDependencies,
            realBusinessEvidenceConstraintsJson: fullOrder.realBusinessEvidenceConstraints,
            baseBranch: fullOrder.baseBranch,
            baseSha: fullOrder.baseSha,
            requiredArtifact: fullOrder.requiredArtifact,
            requiredTestsJson: fullOrder.requiredTests,
            requiredEvidenceJson: fullOrder.requiredEvidence,
            status: fullOrder.status,
            claimedBy: fullOrder.claimedBy,
            claimedAt: fullOrder.claimedAt ? new Date(fullOrder.claimedAt) : null,
            leaseExpiresAt: fullOrder.leaseExpiresAt ? new Date(fullOrder.leaseExpiresAt) : null,
            attemptCount: fullOrder.attemptCount,
            maxAttempts: fullOrder.maxAttempts,
            lastError: fullOrder.lastError,
            completedAt: fullOrder.completedAt ? new Date(fullOrder.completedAt) : null,
            createdAt: new Date(fullOrder.createdAt),
            updatedAt: new Date(fullOrder.updatedAt),
          });
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
      }
    }

    this.memoryWorkOrders.set(fullOrder.id, fullOrder);
    return fullOrder;
  }

  async getWorkOrder(tenantId: string, workOrderId: string): Promise<MitchWorkOrder | null> {
    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          const [row] = await db
            .select()
            .from(mitchWorkOrders)
            .where(
              and(
                eq(mitchWorkOrders.tenantId, tenantId),
                eq(mitchWorkOrders.id, workOrderId)
              )
            )
            .limit(1);
          if (row) {
            return {
              id: row.id,
              tenantId: row.tenantId,
              gameId: row.gameId,
              milestoneId: row.milestoneId,
              milestoneKey: row.milestoneKey,
              title: row.title,
              desiredPlayerVisibleResult: row.desiredPlayerVisibleResult,
              acceptanceCriteria: (row.acceptanceCriteriaJson as string[]) ?? [],
              canonConstraints: (row.canonConstraintsJson as string[]) ?? [],
              relevantDependencies: (row.relevantDependenciesJson as string[]) ?? [],
              realBusinessEvidenceConstraints: (row.realBusinessEvidenceConstraintsJson as string[]) ?? [],
              baseBranch: row.baseBranch,
              baseSha: row.baseSha,
              requiredArtifact: row.requiredArtifact,
              requiredTests: (row.requiredTestsJson as string[]) ?? [],
              requiredEvidence: (row.requiredEvidenceJson as string[]) ?? [],
              status: row.status as MitchWorkOrderStatus,
              claimedBy: row.claimedBy,
              claimedAt: row.claimedAt?.toISOString() ?? null,
              leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
              attemptCount: row.attemptCount,
              maxAttempts: row.maxAttempts,
              lastError: row.lastError,
              completedAt: row.completedAt?.toISOString() ?? null,
              createdAt: row.createdAt.toISOString(),
              updatedAt: row.updatedAt.toISOString(),
            };
          }
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
      }
    }

    const order = this.memoryWorkOrders.get(workOrderId);
    if (order && order.tenantId === tenantId) return order;
    return null;
  }

  async listWorkOrders(tenantId: string, gameId: string, status?: MitchWorkOrderStatus): Promise<MitchWorkOrder[]> {
    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          const conditions = [
            eq(mitchWorkOrders.tenantId, tenantId),
            eq(mitchWorkOrders.gameId, gameId),
          ];
          if (status) conditions.push(eq(mitchWorkOrders.status, status));
          const rows = await db
            .select()
            .from(mitchWorkOrders)
            .where(and(...conditions))
            .orderBy(asc(mitchWorkOrders.createdAt));
          if (rows.length > 0) {
            return rows.map(r => ({
              id: r.id,
              tenantId: r.tenantId,
              gameId: r.gameId,
              milestoneId: r.milestoneId,
              milestoneKey: r.milestoneKey,
              title: r.title,
              desiredPlayerVisibleResult: r.desiredPlayerVisibleResult,
              acceptanceCriteria: (r.acceptanceCriteriaJson as string[]) ?? [],
              canonConstraints: (r.canonConstraintsJson as string[]) ?? [],
              relevantDependencies: (r.relevantDependenciesJson as string[]) ?? [],
              realBusinessEvidenceConstraints: (r.realBusinessEvidenceConstraintsJson as string[]) ?? [],
              baseBranch: r.baseBranch,
              baseSha: r.baseSha,
              requiredArtifact: r.requiredArtifact,
              requiredTests: (r.requiredTestsJson as string[]) ?? [],
              requiredEvidence: (r.requiredEvidenceJson as string[]) ?? [],
              status: r.status as MitchWorkOrderStatus,
              claimedBy: r.claimedBy,
              claimedAt: r.claimedAt?.toISOString() ?? null,
              leaseExpiresAt: r.leaseExpiresAt?.toISOString() ?? null,
              attemptCount: r.attemptCount,
              maxAttempts: r.maxAttempts,
              lastError: r.lastError,
              completedAt: r.completedAt?.toISOString() ?? null,
              createdAt: r.createdAt.toISOString(),
              updatedAt: r.updatedAt.toISOString(),
            }));
          }
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
      }
    }

    return Array.from(this.memoryWorkOrders.values()).filter(
      o => o.tenantId === tenantId && o.gameId === gameId && (!status || o.status === status)
    );
  }


  async claimWorkOrder(input: {
    tenantId: string;
    workOrderId: string;
    claimedBy: string;
    leaseMs: number;
  }): Promise<MitchWorkOrder | null> {
    const existing = await this.getWorkOrder(input.tenantId, input.workOrderId);
    if (!existing) return null;

    const now = new Date();
    const isPending = existing.status === "pending";
    const isExpired =
      (existing.status === "claimed" || existing.status === "executing") &&
      existing.leaseExpiresAt !== null &&
      new Date(existing.leaseExpiresAt).getTime() < now.getTime();
    if (!isPending && !isExpired) return null;
    if (existing.attemptCount >= existing.maxAttempts) return null;

    const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
    const nextAttempt = existing.attemptCount + 1;

    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          await db
            .update(mitchWorkOrders)
            .set({
              status: "claimed",
              claimedBy: input.claimedBy,
              claimedAt: now,
              leaseExpiresAt,
              attemptCount: nextAttempt,
              lastError: null,
              updatedAt: now,
            })
            .where(
              and(
                eq(mitchWorkOrders.tenantId, input.tenantId),
                eq(mitchWorkOrders.id, input.workOrderId),
                or(
                  eq(mitchWorkOrders.status, "pending"),
                  and(
                    or(
                      eq(mitchWorkOrders.status, "claimed"),
                      eq(mitchWorkOrders.status, "executing")
                    ),
                    lte(mitchWorkOrders.leaseExpiresAt, now)
                  )
                )
              )
            );

          const claimed = await this.getWorkOrder(input.tenantId, input.workOrderId);
          if (
            claimed &&
            claimed.claimedBy === input.claimedBy &&
            claimed.status === "claimed" &&
            claimed.attemptCount === nextAttempt
          ) {
            this.memoryWorkOrders.set(claimed.id, claimed);
            return claimed;
          }
          return null;
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Fall through to the isolated in-memory implementation.
      
      }
    }

    const claimedOrder: MitchWorkOrder = {
      ...existing,
      status: "claimed",
      claimedBy: input.claimedBy,
      claimedAt: now.toISOString(),
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      attemptCount: nextAttempt,
      lastError: null,
      updatedAt: now.toISOString(),
    };
    this.memoryWorkOrders.set(claimedOrder.id, claimedOrder);
    return claimedOrder;
  }

  async renewWorkOrderLease(input: {
    tenantId: string;
    workOrderId: string;
    claimedBy: string;
    leaseMs: number;
  }): Promise<boolean> {
    const existing = await this.getWorkOrder(input.tenantId, input.workOrderId);
    if (!existing) return false;
    if (existing.claimedBy !== input.claimedBy) return false;
    if (existing.status !== "claimed" && existing.status !== "executing") return false;

    const now = new Date();
    if (existing.leaseExpiresAt && new Date(existing.leaseExpiresAt).getTime() < now.getTime()) {
      return false;
    }
    const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);

    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          await db
            .update(mitchWorkOrders)
            .set({ leaseExpiresAt, updatedAt: now })
            .where(
              and(
                eq(mitchWorkOrders.tenantId, input.tenantId),
                eq(mitchWorkOrders.id, input.workOrderId),
                eq(mitchWorkOrders.claimedBy, input.claimedBy),
                or(
                  eq(mitchWorkOrders.status, "claimed"),
                  eq(mitchWorkOrders.status, "executing")
                ),
                gt(mitchWorkOrders.leaseExpiresAt, now)
              )
            );
          const renewed = await this.getWorkOrder(input.tenantId, input.workOrderId);
          return Boolean(
            renewed &&
            renewed.claimedBy === input.claimedBy &&
            renewed.leaseExpiresAt &&
            new Date(renewed.leaseExpiresAt).getTime() > now.getTime()
          );
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Fall through to memory.
      
      }
    }

    const updated: MitchWorkOrder = {
      ...existing,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.memoryWorkOrders.set(updated.id, updated);
    return true;
  }

  async completeWorkOrderImplementation(input: {
    tenantId: string;
    workOrderId: string;
    handback: MitchExecutionHandback;
    executionRunId: string;
  }): Promise<{ workOrder: MitchWorkOrder; build: MitchBuild }> {
    assertValidBuildIdentity(input.handback.exactBuildId);
    const existing = await this.getWorkOrder(input.tenantId, input.workOrderId);
    if (!existing) throw new Error(`Work order not found: ${input.workOrderId}`);

    const nowDate = new Date();
    const now = nowDate.toISOString();
    const completedOrder: MitchWorkOrder = {
      ...existing,
      status: "implementation_returned",
      completedAt: now,
      updatedAt: now,
    };

    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          await db
            .update(mitchWorkOrders)
            .set({
              status: "implementation_returned",
              completedAt: nowDate,
              updatedAt: nowDate,
            })
            .where(
              and(
                eq(mitchWorkOrders.tenantId, input.tenantId),
                eq(mitchWorkOrders.id, input.workOrderId)
              )
            );
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Keep memory fallback in sync even if the DB is temporarily unavailable.
      
      }
    }
    this.memoryWorkOrders.set(completedOrder.id, completedOrder);

    const build: MitchBuild = {
      id: input.handback.exactBuildId,
      tenantId: input.tenantId,
      gameId: existing.gameId,
      workOrderId: existing.id,
      executionRunId: input.executionRunId,
      commitSha: input.handback.commitSha,
      branch: input.handback.branch,
      buildArtifactType: input.handback.exactBuildId.startsWith("http") ? "preview_url" : "git_commit",
      buildArtifactId: input.handback.exactBuildId,
      sourceCompiled: true,
      unitTestsPassed: input.handback.testsActuallyRun.length > 0,
      isVerified: false,
      verifiedAt: null,
      createdAt: now,
    };
    await this.recordBuild(build);

    const milestone = await this.getMilestone(input.tenantId, existing.gameId, existing.milestoneKey);
    if (milestone) {
      await this.saveMilestone({
        ...milestone,
        status: "implemented",
        currentAvailableBuildId: build.id,
      });
    }

    const gameState = await this.getProductionState(input.tenantId, existing.gameId);
    if (gameState) {
      await this.saveProductionState({
        ...gameState,
        lifecycleState: "exact_build_available",
        currentAvailableBuildId: build.id,
      });
    }

    return { workOrder: completedOrder, build };
  }

  async failWorkOrder(input: {
    tenantId: string;
    workOrderId: string;
    error: string;
  }): Promise<MitchWorkOrder> {
    const existing = await this.getWorkOrder(input.tenantId, input.workOrderId);
    if (!existing) throw new Error(`Work order not found: ${input.workOrderId}`);

    const nowDate = new Date();
    const failedOrder: MitchWorkOrder = {
      ...existing,
      status: "failed",
      lastError: input.error,
      leaseExpiresAt: null,
      updatedAt: nowDate.toISOString(),
    };

    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          await db
            .update(mitchWorkOrders)
            .set({
              status: "failed",
              lastError: input.error,
              leaseExpiresAt: null,
              updatedAt: nowDate,
            })
            .where(
              and(
                eq(mitchWorkOrders.tenantId, input.tenantId),
                eq(mitchWorkOrders.id, input.workOrderId)
              )
            );
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Fall through to memory mirror.
      
      }
    }

    this.memoryWorkOrders.set(failedOrder.id, failedOrder);
    return failedOrder;
  }


  // --- Execution Runs ---
  async recordExecutionRun(run: Omit<MitchExecutionRun, "id" | "createdAt">): Promise<MitchExecutionRun> {
    const fullRun: MitchExecutionRun = {
      ...run,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          await db.insert(mitchExecutionRuns).values({
            id: fullRun.id,
            tenantId: fullRun.tenantId,
            workOrderId: fullRun.workOrderId,
            executorId: fullRun.executorId,
            startedAt: new Date(fullRun.startedAt),
            completedAt: fullRun.completedAt ? new Date(fullRun.completedAt) : null,
            status: fullRun.status,
            returnedBranch: fullRun.returnedBranch,
            returnedCommitSha: fullRun.returnedCommitSha,
            exactBuildId: fullRun.exactBuildId,
            whatChanged: fullRun.whatChanged,
            testsActuallyRunJson: fullRun.testsActuallyRun,
            testsNotRunJson: fullRun.testsNotRun,
            previewLaunchInstructions: fullRun.previewLaunchInstructions,
            evidenceJson: fullRun.evidence,
            knownLimitations: fullRun.knownLimitations,
            errorMessage: fullRun.errorMessage,
            createdAt: new Date(fullRun.createdAt),
          });
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Preserve isolated-test fallback.
      
      }
    }

    this.memoryExecutionRuns.set(fullRun.id, fullRun);
    return fullRun;
  }

  async getExecutionRun(tenantId: string, runId: string): Promise<MitchExecutionRun | null> {
    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          const [row] = await db
            .select()
            .from(mitchExecutionRuns)
            .where(and(eq(mitchExecutionRuns.tenantId, tenantId), eq(mitchExecutionRuns.id, runId)))
            .limit(1);
          if (row) {
            return {
              id: row.id,
              tenantId: row.tenantId,
              workOrderId: row.workOrderId,
              executorId: row.executorId,
              startedAt: row.startedAt.toISOString(),
              completedAt: row.completedAt?.toISOString() ?? null,
              status: row.status as MitchExecutionRun["status"],
              returnedBranch: row.returnedBranch,
              returnedCommitSha: row.returnedCommitSha,
              exactBuildId: row.exactBuildId,
              whatChanged: row.whatChanged,
              testsActuallyRun: (row.testsActuallyRunJson as string[]) ?? [],
              testsNotRun: (row.testsNotRunJson as string[]) ?? [],
              previewLaunchInstructions: row.previewLaunchInstructions,
              evidence: (row.evidenceJson as Record<string, unknown>) ?? {},
              knownLimitations: row.knownLimitations,
              errorMessage: row.errorMessage,
              createdAt: row.createdAt.toISOString(),
            };
          }
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Fall back to memory.
      
      }
    }
    const run = this.memoryExecutionRuns.get(runId);
    return run && run.tenantId === tenantId ? run : null;
  }

  // --- Builds ---
  async recordBuild(build: MitchBuild): Promise<MitchBuild> {
    assertValidBuildIdentity(build.id);

    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          const [existing] = await db
            .select({ id: mitchBuilds.id })
            .from(mitchBuilds)
            .where(and(eq(mitchBuilds.tenantId, build.tenantId), eq(mitchBuilds.id, build.id)))
            .limit(1);
          const row = {
            tenantId: build.tenantId,
            gameId: build.gameId,
            workOrderId: build.workOrderId,
            executionRunId: build.executionRunId,
            commitSha: build.commitSha,
            branch: build.branch,
            buildArtifactType: build.buildArtifactType,
            buildArtifactId: build.buildArtifactId,
            sourceCompiled: build.sourceCompiled,
            unitTestsPassed: build.unitTestsPassed,
            isVerified: build.isVerified,
            verifiedAt: build.verifiedAt ? new Date(build.verifiedAt) : null,
          };
          if (existing) {
            await db.update(mitchBuilds).set(row).where(eq(mitchBuilds.id, build.id));
          } else {
            await db.insert(mitchBuilds).values({
              id: build.id,
              ...row,
              createdAt: new Date(build.createdAt),
            });
          }
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Keep memory mirror available.
      
      }
    }

    this.memoryBuilds.set(build.id, build);
    return build;
  }

  async getBuild(tenantId: string, buildId: string): Promise<MitchBuild | null> {
    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          const [row] = await db
            .select()
            .from(mitchBuilds)
            .where(and(eq(mitchBuilds.tenantId, tenantId), eq(mitchBuilds.id, buildId)))
            .limit(1);
          if (row) {
            return {
              id: row.id,
              tenantId: row.tenantId,
              gameId: row.gameId,
              workOrderId: row.workOrderId,
              executionRunId: row.executionRunId,
              commitSha: row.commitSha,
              branch: row.branch,
              buildArtifactType: row.buildArtifactType as MitchBuild["buildArtifactType"],
              buildArtifactId: row.buildArtifactId,
              sourceCompiled: Boolean(row.sourceCompiled),
              unitTestsPassed: Boolean(row.unitTestsPassed),
              isVerified: Boolean(row.isVerified),
              verifiedAt: row.verifiedAt?.toISOString() ?? null,
              createdAt: row.createdAt.toISOString(),
            };
          }
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Fall back to memory.
      
      }
    }
    const build = this.memoryBuilds.get(buildId);
    return build && build.tenantId === tenantId ? build : null;
  }

  async listBuilds(tenantId: string, gameId: string): Promise<MitchBuild[]> {
    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          const rows = await db
            .select()
            .from(mitchBuilds)
            .where(and(eq(mitchBuilds.tenantId, tenantId), eq(mitchBuilds.gameId, gameId)))
            .orderBy(asc(mitchBuilds.createdAt));
          return rows.map(row => ({
            id: row.id,
            tenantId: row.tenantId,
            gameId: row.gameId,
            workOrderId: row.workOrderId,
            executionRunId: row.executionRunId,
            commitSha: row.commitSha,
            branch: row.branch,
            buildArtifactType: row.buildArtifactType as MitchBuild["buildArtifactType"],
            buildArtifactId: row.buildArtifactId,
            sourceCompiled: Boolean(row.sourceCompiled),
            unitTestsPassed: Boolean(row.unitTestsPassed),
            isVerified: Boolean(row.isVerified),
            verifiedAt: row.verifiedAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
          }));
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Fall back to memory.
      
      }
    }
    return Array.from(this.memoryBuilds.values()).filter(
      build => build.tenantId === tenantId && build.gameId === gameId
    );
  }

  async markBuildVerified(tenantId: string, buildId: string): Promise<MitchBuild> {
    const build = await this.getBuild(tenantId, buildId);
    if (!build) throw new Error(`Build not found: ${buildId}`);

    const now = new Date();
    const updated: MitchBuild = {
      ...build,
      isVerified: true,
      verifiedAt: now.toISOString(),
    };

    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          await db
            .update(mitchBuilds)
            .set({ isVerified: true, verifiedAt: now })
            .where(and(eq(mitchBuilds.tenantId, tenantId), eq(mitchBuilds.id, buildId)));
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Keep memory mirror.
      
      }
    }

    this.memoryBuilds.set(updated.id, updated);
    return updated;
  }

  // --- QA Runs ---
  async recordQaRun(qaRun: Omit<MitchQaRun, "id" | "createdAt">): Promise<MitchQaRun> {
    assertValidBuildIdentity(qaRun.buildId);
    const fullQaRun: MitchQaRun = {
      ...qaRun,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          await db.insert(mitchQaRuns).values({
            id: fullQaRun.id,
            tenantId: fullQaRun.tenantId,
            gameId: fullQaRun.gameId,
            milestoneId: fullQaRun.milestoneId,
            buildId: fullQaRun.buildId,
            testerId: fullQaRun.testerId,
            scenario: fullQaRun.scenario,
            expectedBehavior: fullQaRun.expectedBehavior,
            observedBehavior: fullQaRun.observedBehavior,
            gameActuallyExercised: fullQaRun.gameActuallyExercised,
            acceptancePassed: fullQaRun.acceptancePassed,
            status: fullQaRun.status,
            evidenceArtifact: fullQaRun.evidenceArtifact,
            issueId: fullQaRun.issueId,
            previousFailedQaRunId: fullQaRun.previousFailedQaRunId,
            isRetest: fullQaRun.isRetest,
            completedAt: new Date(fullQaRun.completedAt),
            createdAt: new Date(fullQaRun.createdAt),
          });
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Keep memory mirror.
      
      }
    }

    this.memoryQaRuns.set(fullQaRun.id, fullQaRun);
    return fullQaRun;
  }

  async getQaRun(tenantId: string, qaRunId: string): Promise<MitchQaRun | null> {
    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          const [row] = await db
            .select()
            .from(mitchQaRuns)
            .where(and(eq(mitchQaRuns.tenantId, tenantId), eq(mitchQaRuns.id, qaRunId)))
            .limit(1);
          if (row) {
            return {
              id: row.id,
              tenantId: row.tenantId,
              gameId: row.gameId,
              milestoneId: row.milestoneId,
              buildId: row.buildId,
              testerId: row.testerId,
              scenario: row.scenario,
              expectedBehavior: row.expectedBehavior,
              observedBehavior: row.observedBehavior,
              gameActuallyExercised: Boolean(row.gameActuallyExercised),
              acceptancePassed: Boolean(row.acceptancePassed),
              status: row.status as MitchQaRun["status"],
              evidenceArtifact: row.evidenceArtifact,
              issueId: row.issueId,
              previousFailedQaRunId: row.previousFailedQaRunId,
              isRetest: Boolean(row.isRetest),
              completedAt: row.completedAt.toISOString(),
              createdAt: row.createdAt.toISOString(),
            };
          }
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Fall back to memory.
      
      }
    }
    const run = this.memoryQaRuns.get(qaRunId);
    return run && run.tenantId === tenantId ? run : null;
  }

  async listQaRuns(tenantId: string, gameId: string): Promise<MitchQaRun[]> {
    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          const rows = await db
            .select()
            .from(mitchQaRuns)
            .where(and(eq(mitchQaRuns.tenantId, tenantId), eq(mitchQaRuns.gameId, gameId)))
            .orderBy(asc(mitchQaRuns.createdAt));
          return rows.map(row => ({
            id: row.id,
            tenantId: row.tenantId,
            gameId: row.gameId,
            milestoneId: row.milestoneId,
            buildId: row.buildId,
            testerId: row.testerId,
            scenario: row.scenario,
            expectedBehavior: row.expectedBehavior,
            observedBehavior: row.observedBehavior,
            gameActuallyExercised: Boolean(row.gameActuallyExercised),
            acceptancePassed: Boolean(row.acceptancePassed),
            status: row.status as MitchQaRun["status"],
            evidenceArtifact: row.evidenceArtifact,
            issueId: row.issueId,
            previousFailedQaRunId: row.previousFailedQaRunId,
            isRetest: Boolean(row.isRetest),
            completedAt: row.completedAt.toISOString(),
            createdAt: row.createdAt.toISOString(),
          }));
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Fall back to memory.
      
      }
    }
    return Array.from(this.memoryQaRuns.values()).filter(
      run => run.tenantId === tenantId && run.gameId === gameId
    );
  }

  // --- Issues ---
  async createIssue(issue: Omit<MitchIssue, "id" | "createdAt" | "updatedAt">): Promise<MitchIssue> {
    const now = new Date();
    const fullIssue: MitchIssue = {
      ...issue,
      id: randomUUID(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          await db.insert(mitchIssues).values({
            id: fullIssue.id,
            tenantId: fullIssue.tenantId,
            gameId: fullIssue.gameId,
            milestoneId: fullIssue.milestoneId,
            originatingQaRunId: fullIssue.originatingQaRunId,
            title: fullIssue.title,
            description: fullIssue.description,
            status: fullIssue.status,
            fixWorkOrderId: fullIssue.fixWorkOrderId,
            fixBuildId: fullIssue.fixBuildId,
            closingQaRunId: fullIssue.closingQaRunId,
            closedAt: fullIssue.closedAt ? new Date(fullIssue.closedAt) : null,
            createdAt: now,
            updatedAt: now,
          });
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Keep memory mirror.
      
      }
    }

    this.memoryIssues.set(fullIssue.id, fullIssue);
    return fullIssue;
  }

  async getIssue(tenantId: string, issueId: string): Promise<MitchIssue | null> {
    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          const [row] = await db
            .select()
            .from(mitchIssues)
            .where(and(eq(mitchIssues.tenantId, tenantId), eq(mitchIssues.id, issueId)))
            .limit(1);
          if (row) {
            return {
              id: row.id,
              tenantId: row.tenantId,
              gameId: row.gameId,
              milestoneId: row.milestoneId,
              originatingQaRunId: row.originatingQaRunId,
              title: row.title,
              description: row.description,
              status: row.status as MitchIssue["status"],
              fixWorkOrderId: row.fixWorkOrderId,
              fixBuildId: row.fixBuildId,
              closingQaRunId: row.closingQaRunId,
              closedAt: row.closedAt?.toISOString() ?? null,
              createdAt: row.createdAt.toISOString(),
              updatedAt: row.updatedAt.toISOString(),
            };
          }
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Fall back to memory.
      
      }
    }
    const issue = this.memoryIssues.get(issueId);
    return issue && issue.tenantId === tenantId ? issue : null;
  }

  async updateIssue(issue: MitchIssue): Promise<MitchIssue> {
    const now = new Date();
    const updated: MitchIssue = { ...issue, updatedAt: now.toISOString() };

    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          await db
            .update(mitchIssues)
            .set({
              title: updated.title,
              description: updated.description,
              status: updated.status,
              fixWorkOrderId: updated.fixWorkOrderId,
              fixBuildId: updated.fixBuildId,
              closingQaRunId: updated.closingQaRunId,
              closedAt: updated.closedAt ? new Date(updated.closedAt) : null,
              updatedAt: now,
            })
            .where(and(eq(mitchIssues.tenantId, updated.tenantId), eq(mitchIssues.id, updated.id)));
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Keep memory mirror.
      
      }
    }

    this.memoryIssues.set(updated.id, updated);
    return updated;
  }

  async listIssues(tenantId: string, gameId: string, status?: string): Promise<MitchIssue[]> {
    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          const conditions = [eq(mitchIssues.tenantId, tenantId), eq(mitchIssues.gameId, gameId)];
          if (status) conditions.push(eq(mitchIssues.status, status));
          const rows = await db
            .select()
            .from(mitchIssues)
            .where(and(...conditions))
            .orderBy(asc(mitchIssues.createdAt));
          return rows.map(row => ({
            id: row.id,
            tenantId: row.tenantId,
            gameId: row.gameId,
            milestoneId: row.milestoneId,
            originatingQaRunId: row.originatingQaRunId,
            title: row.title,
            description: row.description,
            status: row.status as MitchIssue["status"],
            fixWorkOrderId: row.fixWorkOrderId,
            fixBuildId: row.fixBuildId,
            closingQaRunId: row.closingQaRunId,
            closedAt: row.closedAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          }));
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Fall back to memory.
      
      }
    }
    return Array.from(this.memoryIssues.values()).filter(
      issue => issue.tenantId === tenantId && issue.gameId === gameId && (!status || issue.status === status)
    );
  }

  // --- Audit Events ---
  async recordAuditEvent(event: Omit<MitchAuditEvent, "id" | "occurredAt">): Promise<MitchAuditEvent> {
    const fullEvent: MitchAuditEvent = {
      ...event,
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
    };

    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          await db.insert(mitchAuditEvents).values({
            id: fullEvent.id,
            tenantId: fullEvent.tenantId,
            gameId: fullEvent.gameId,
            eventType: fullEvent.eventType,
            actorId: fullEvent.actorId,
            detailsJson: fullEvent.details,
            occurredAt: new Date(fullEvent.occurredAt),
          });
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Keep memory mirror.
      
      }
    }

    this.memoryAuditEvents.push(fullEvent);
    return fullEvent;
  }

  async listAuditEvents(tenantId: string, gameId: string): Promise<MitchAuditEvent[]> {
    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
        this.assertDurableDb(db);
        if (db) {
          const rows = await db
            .select()
            .from(mitchAuditEvents)
            .where(and(eq(mitchAuditEvents.tenantId, tenantId), eq(mitchAuditEvents.gameId, gameId)))
            .orderBy(asc(mitchAuditEvents.occurredAt));
          return rows.map(row => ({
            id: row.id,
            tenantId: row.tenantId,
            gameId: row.gameId,
            eventType: row.eventType,
            actorId: row.actorId,
            details: (row.detailsJson as Record<string, unknown>) ?? {},
            occurredAt: row.occurredAt.toISOString(),
          }));
        }
      } catch (err) {
        this.handlePersistenceFailure(err);
        // Fall back to memory.
      
      }
    }
    return this.memoryAuditEvents.filter(event => event.tenantId === tenantId && event.gameId === gameId);
  }

}
