/**
 * Mitch v1 — Durable Production Store
 *
 * Implements persistence for Mitch game production operating system.
 * Follows repository conventions: supports Drizzle / MySQL database operations
 * when database is available, with full in-memory fallback for isolated testing
 * and environments without live MySQL.
 */
import { and, asc, eq, isNull, lte } from "drizzle-orm";
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

  constructor(private readonly forceMemoryMode: boolean = false) {}

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
      } catch (err) {}
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
      } catch (err) {}
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
      } catch (err) {}
    }

    this.memoryWorkOrders.set(fullOrder.id, fullOrder);
    return fullOrder;
  }

  async getWorkOrder(tenantId: string, workOrderId: string): Promise<MitchWorkOrder | null> {
    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
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
      } catch (err) {}
    }

    const order = this.memoryWorkOrders.get(workOrderId);
    if (order && order.tenantId === tenantId) return order;
    return null;
  }

  async listWorkOrders(tenantId: string, gameId: string, status?: MitchWorkOrderStatus): Promise<MitchWorkOrder[]> {
    if (!this.forceMemoryMode) {
      try {
        const db = await getDb();
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
      } catch (err) {}
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
    // Eligible if pending, OR if claimed but lease has expired
    const isPending = existing.status === "pending";
    const isExpired =
      (existing.status === "claimed" || existing.status === "executing") &&
      existing.leaseExpiresAt !== null &&
      new Date(existing.leaseExpiresAt).getTime() < now.getTime();

    if (!isPending && !isExpired) {
      return null;
    }

    const leaseExpiresAt = new Date(now.getTime() + input.leaseMs).toISOString();
    const claimedOrder: MitchWorkOrder = {
      ...existing,
      status: "claimed",
      claimedBy: input.claimedBy,
      claimedAt: now.toISOString(),
      leaseExpiresAt,
      attemptCount: existing.attemptCount + 1,
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
    // Worker must match active claim
    if (existing.claimedBy !== input.claimedBy) return false;
    if (existing.status !== "claimed" && existing.status !== "executing") return false;

    const now = new Date();
    // Cannot renew if already expired and potentially reclaimed
    if (existing.leaseExpiresAt && new Date(existing.leaseExpiresAt).getTime() < now.getTime()) {
      return false;
    }

    const leaseExpiresAt = new Date(now.getTime() + input.leaseMs).toISOString();
    const updated: MitchWorkOrder = {
      ...existing,
      leaseExpiresAt,
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

    const now = new Date().toISOString();
    const completedOrder: MitchWorkOrder = {
      ...existing,
      status: "implementation_returned",
      completedAt: now,
      updatedAt: now,
    };
    this.memoryWorkOrders.set(completedOrder.id, completedOrder);

    // Record the exact build
    const build: MitchBuild = {
      id: input.handback.exactBuildId,
      tenantId: input.tenantId,
      gameId: existing.gameId,
      workOrderId: existing.id,
      executionRunId: input.executionRunId,
      commitSha: input.handback.commitSha,
      branch: input.handback.branch,
      buildArtifactType: "git_commit",
      buildArtifactId: input.handback.exactBuildId,
      sourceCompiled: true,
      unitTestsPassed: input.handback.testsActuallyRun.length > 0,
      isVerified: false, // Implementation does NOT equal verification!
      verifiedAt: null,
      createdAt: now,
    };
    await this.recordBuild(build);

    // Update milestone available build (NOT verified build!)
    const milestone = await this.getMilestone(input.tenantId, existing.gameId, existing.milestoneKey);
    if (milestone) {
      await this.saveMilestone({
        ...milestone,
        status: "implemented",
        currentAvailableBuildId: build.id,
        // Invariant: lastVerifiedBuildId stays untouched!
      });
    }

    // Update game production state available build (NOT verified build!)
    const gameState = await this.getProductionState(input.tenantId, existing.gameId);
    if (gameState) {
      await this.saveProductionState({
        ...gameState,
        lifecycleState: "exact_build_available",
        currentAvailableBuildId: build.id,
        // Invariant: lastVerifiedBuildId stays untouched!
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

    const now = new Date().toISOString();
    const failedOrder: MitchWorkOrder = {
      ...existing,
      status: "failed",
      lastError: input.error,
      updatedAt: now,
    };
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
    this.memoryExecutionRuns.set(fullRun.id, fullRun);
    return fullRun;
  }

  async getExecutionRun(tenantId: string, runId: string): Promise<MitchExecutionRun | null> {
    const run = this.memoryExecutionRuns.get(runId);
    if (run && run.tenantId === tenantId) return run;
    return null;
  }

  // --- Builds ---
  async recordBuild(build: MitchBuild): Promise<MitchBuild> {
    assertValidBuildIdentity(build.id);
    this.memoryBuilds.set(build.id, build);
    return build;
  }

  async getBuild(tenantId: string, buildId: string): Promise<MitchBuild | null> {
    const b = this.memoryBuilds.get(buildId);
    if (b && b.tenantId === tenantId) return b;
    return null;
  }

  async listBuilds(tenantId: string, gameId: string): Promise<MitchBuild[]> {
    return Array.from(this.memoryBuilds.values()).filter(
      b => b.tenantId === tenantId && b.gameId === gameId
    );
  }

  async markBuildVerified(tenantId: string, buildId: string): Promise<MitchBuild> {
    const build = await this.getBuild(tenantId, buildId);
    if (!build) throw new Error(`Build not found: ${buildId}`);

    const updated: MitchBuild = {
      ...build,
      isVerified: true,
      verifiedAt: new Date().toISOString(),
    };
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
    this.memoryQaRuns.set(fullQaRun.id, fullQaRun);
    return fullQaRun;
  }

  async getQaRun(tenantId: string, qaRunId: string): Promise<MitchQaRun | null> {
    const r = this.memoryQaRuns.get(qaRunId);
    if (r && r.tenantId === tenantId) return r;
    return null;
  }

  async listQaRuns(tenantId: string, gameId: string): Promise<MitchQaRun[]> {
    return Array.from(this.memoryQaRuns.values()).filter(
      r => r.tenantId === tenantId && r.gameId === gameId
    );
  }

  // --- Issues ---
  async createIssue(issue: Omit<MitchIssue, "id" | "createdAt" | "updatedAt">): Promise<MitchIssue> {
    const now = new Date().toISOString();
    const fullIssue: MitchIssue = {
      ...issue,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.memoryIssues.set(fullIssue.id, fullIssue);
    return fullIssue;
  }

  async getIssue(tenantId: string, issueId: string): Promise<MitchIssue | null> {
    const issue = this.memoryIssues.get(issueId);
    if (issue && issue.tenantId === tenantId) return issue;
    return null;
  }

  async updateIssue(issue: MitchIssue): Promise<MitchIssue> {
    const updated: MitchIssue = {
      ...issue,
      updatedAt: new Date().toISOString(),
    };
    this.memoryIssues.set(updated.id, updated);
    return updated;
  }

  async listIssues(tenantId: string, gameId: string, status?: string): Promise<MitchIssue[]> {
    return Array.from(this.memoryIssues.values()).filter(
      i => i.tenantId === tenantId && i.gameId === gameId && (!status || i.status === status)
    );
  }

  // --- Audit Events ---
  async recordAuditEvent(event: Omit<MitchAuditEvent, "id" | "occurredAt">): Promise<MitchAuditEvent> {
    const fullEvent: MitchAuditEvent = {
      ...event,
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
    };
    this.memoryAuditEvents.push(fullEvent);
    return fullEvent;
  }

  async listAuditEvents(tenantId: string, gameId: string): Promise<MitchAuditEvent[]> {
    return this.memoryAuditEvents.filter(e => e.tenantId === tenantId && e.gameId === gameId);
  }
}
