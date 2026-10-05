import { randomUUID } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  presidentCycleMissionSchema,
  presidentCycleSchema,
  type PresidentApprovalReceipt,
  type PresidentCandidateList,
  type PresidentClaudeCritique,
  type PresidentCycle,
  type PresidentCycleMission,
} from "../../../shared/presidentCycle";

const decode = <T>(value: unknown): T =>
  (typeof value === "string" ? JSON.parse(value) : value) as T;

const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();

function cycleFromRow(row: RowDataPacket): PresidentCycle {
  return presidentCycleSchema.parse({
    id: row.id,
    state: row.state,
    evidenceIds: decode(row.evidenceIdsJson),
    initialCandidates: row.initialCandidatesJson ? decode(row.initialCandidatesJson) : null,
    claudeCritique: row.claudeCritiqueJson ? decode(row.claudeCritiqueJson) : null,
    finalCandidates: row.finalCandidatesJson ? decode(row.finalCandidatesJson) : null,
    proposedCandidateIds: decode(row.proposedCandidateIdsJson),
    approval: row.approvalJson ? decode(row.approvalJson) : null,
    blockReason: row.blockReason,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });
}

function missionFromRow(row: RowDataPacket): PresidentCycleMission {
  return presidentCycleMissionSchema.parse({
    id: row.id,
    cycleId: row.cycleId,
    candidateId: row.candidateId,
    title: row.title,
    objective: row.objective,
    evidenceIds: decode(row.evidenceIdsJson),
    acceptanceCriteria: decode(row.acceptanceCriteriaJson),
    executionDomain: row.executionDomain,
    state: row.state,
    attemptCount: Number(row.attemptCount),
    maxAttempts: Number(row.maxAttempts),
    executorId: row.executorId,
    reviewerId: row.reviewerId,
    baseSha: row.baseSha,
    branch: row.branch,
    commitSha: row.commitSha,
    pullRequestUrl: row.pullRequestUrl,
    result: row.resultJson ? decode(row.resultJson) : null,
    review: row.reviewJson ? decode(row.reviewJson) : null,
    blocker: row.blocker,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });
}

export class MysqlPresidentCycleStore {
  constructor(
    readonly pool: Pool,
    private readonly connection?: PoolConnection
  ) {}

  private executor() {
    return this.connection ?? this.pool;
  }

  async transaction<T>(operation: (store: MysqlPresidentCycleStore) => Promise<T>): Promise<T> {
    if (this.connection) return operation(this);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await operation(new MysqlPresidentCycleStore(this.pool, connection));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async createCycle(evidenceIds: string[]): Promise<PresidentCycle> {
    const now = new Date().toISOString();
    const cycle = presidentCycleSchema.parse({
      id: randomUUID(),
      state: "DELIBERATING",
      evidenceIds: [...new Set(evidenceIds)],
      initialCandidates: null,
      claudeCritique: null,
      finalCandidates: null,
      proposedCandidateIds: [],
      approval: null,
      blockReason: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.executor().execute(
      `INSERT INTO president_cycles
       (id,state,evidenceIdsJson,initialCandidatesJson,claudeCritiqueJson,finalCandidatesJson,proposedCandidateIdsJson,approvalJson,blockReason,version,createdAt,updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        cycle.id,
        cycle.state,
        JSON.stringify(cycle.evidenceIds),
        null,
        null,
        null,
        JSON.stringify([]),
        null,
        null,
        1,
        new Date(cycle.createdAt),
        new Date(cycle.updatedAt),
      ]
    );
    return cycle;
  }

  async getCycle(id: string, forUpdate = false): Promise<PresidentCycle | null> {
    const [rows] = await this.executor().execute<RowDataPacket[]>(
      `SELECT * FROM president_cycles WHERE id=? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
      [id]
    );
    return rows[0] ? cycleFromRow(rows[0]) : null;
  }

  async latestCycle(): Promise<PresidentCycle | null> {
    const [rows] = await this.executor().query<RowDataPacket[]>(
      "SELECT * FROM president_cycles ORDER BY createdAt DESC,id DESC LIMIT 1"
    );
    return rows[0] ? cycleFromRow(rows[0]) : null;
  }

  async updateCycle(
    id: string,
    patch: Partial<Pick<
      PresidentCycle,
      "state" | "initialCandidates" | "claudeCritique" | "finalCandidates" |
      "proposedCandidateIds" | "approval" | "blockReason"
    >>
  ): Promise<PresidentCycle> {
    const prior = await this.getCycle(id, Boolean(this.connection));
    if (!prior) throw new Error("President cycle not found");
    const next = presidentCycleSchema.parse({
      ...prior,
      ...patch,
      id: prior.id,
      evidenceIds: prior.evidenceIds,
      createdAt: prior.createdAt,
      updatedAt: new Date().toISOString(),
    });
    await this.executor().execute(
      `UPDATE president_cycles SET
       state=?,initialCandidatesJson=?,claudeCritiqueJson=?,finalCandidatesJson=?,
       proposedCandidateIdsJson=?,approvalJson=?,blockReason=?,version=version+1,updatedAt=?
       WHERE id=?`,
      [
        next.state,
        next.initialCandidates ? JSON.stringify(next.initialCandidates) : null,
        next.claudeCritique ? JSON.stringify(next.claudeCritique) : null,
        next.finalCandidates ? JSON.stringify(next.finalCandidates) : null,
        JSON.stringify(next.proposedCandidateIds),
        next.approval ? JSON.stringify(next.approval) : null,
        next.blockReason,
        new Date(next.updatedAt),
        id,
      ]
    );
    return next;
  }

  async recordRound(input: {
    cycleId: string;
    stage: "CHATGPT_PROPOSAL" | "CLAUDE_CRITIQUE" | "CHATGPT_SYNTHESIS";
    provider: string;
    model: string;
    providerRunId: string | null;
    inputHash: string;
    output: PresidentCandidateList | PresidentClaudeCritique;
  }): Promise<void> {
    await this.executor().execute(
      `INSERT INTO president_cycle_rounds
       (id,cycleId,stage,provider,model,providerRunId,inputHash,outputJson,createdAt)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE cycleId=cycleId`,
      [
        randomUUID(),
        input.cycleId,
        input.stage,
        input.provider,
        input.model,
        input.providerRunId,
        input.inputHash,
        JSON.stringify(input.output),
        new Date(),
      ]
    );
  }

  async createMissions(
    cycleId: string,
    candidates: PresidentCandidateList["candidates"],
    approval: PresidentApprovalReceipt
  ): Promise<PresidentCycleMission[]> {
    const now = new Date().toISOString();
    for (const candidateId of approval.approvedCandidateIds) {
      const candidate = candidates.find(item => item.id === candidateId);
      if (!candidate) throw new Error("Approved candidate disappeared from final ten");
      const mission = presidentCycleMissionSchema.parse({
        id: randomUUID(),
        cycleId,
        candidateId,
        title: candidate.title,
        objective: candidate.proposedChange,
        evidenceIds: candidate.evidenceIds,
        acceptanceCriteria: candidate.successCriteria,
        executionDomain: candidate.executionDomain,
        state: "QUEUED",
        attemptCount: 0,
        maxAttempts: 3,
        executorId: null,
        reviewerId: null,
        baseSha: null,
        branch: null,
        commitSha: null,
        pullRequestUrl: null,
        result: null,
        review: null,
        blocker: null,
        createdAt: now,
        updatedAt: now,
      });
      await this.executor().execute(
        `INSERT INTO president_cycle_missions
         (id,cycleId,candidateId,title,objective,evidenceIdsJson,acceptanceCriteriaJson,executionDomain,state,attemptCount,maxAttempts,executorId,reviewerId,baseSha,branch,commitSha,pullRequestUrl,resultJson,reviewJson,blocker,leaseOwner,leaseExpiresAt,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE id=id`,
        [
          mission.id,
          mission.cycleId,
          mission.candidateId,
          mission.title,
          mission.objective,
          JSON.stringify(mission.evidenceIds),
          JSON.stringify(mission.acceptanceCriteria),
          mission.executionDomain,
          mission.state,
          mission.attemptCount,
          mission.maxAttempts,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          new Date(mission.createdAt),
          new Date(mission.updatedAt),
        ]
      );
    }
    return this.listMissions(cycleId);
  }

  async listMissions(cycleId: string): Promise<PresidentCycleMission[]> {
    const [rows] = await this.executor().execute<RowDataPacket[]>(
      "SELECT * FROM president_cycle_missions WHERE cycleId=? ORDER BY createdAt,id",
      [cycleId]
    );
    return rows.map(missionFromRow);
  }

  async getMission(id: string, forUpdate = false): Promise<PresidentCycleMission | null> {
    const [rows] = await this.executor().execute<RowDataPacket[]>(
      `SELECT * FROM president_cycle_missions WHERE id=? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
      [id]
    );
    return rows[0] ? missionFromRow(rows[0]) : null;
  }

  async updateMission(
    id: string,
    patch: Partial<Omit<PresidentCycleMission, "id" | "cycleId" | "candidateId" | "createdAt">>
  ): Promise<PresidentCycleMission> {
    const prior = await this.getMission(id, Boolean(this.connection));
    if (!prior) throw new Error("President cycle mission not found");
    const next = presidentCycleMissionSchema.parse({
      ...prior,
      ...patch,
      id: prior.id,
      cycleId: prior.cycleId,
      candidateId: prior.candidateId,
      createdAt: prior.createdAt,
      updatedAt: new Date().toISOString(),
    });
    await this.executor().execute(
      `UPDATE president_cycle_missions SET
       title=?,objective=?,evidenceIdsJson=?,acceptanceCriteriaJson=?,executionDomain=?,state=?,
       attemptCount=?,maxAttempts=?,executorId=?,reviewerId=?,baseSha=?,branch=?,commitSha=?,
       pullRequestUrl=?,resultJson=?,reviewJson=?,blocker=?,updatedAt=? WHERE id=?`,
      [
        next.title,
        next.objective,
        JSON.stringify(next.evidenceIds),
        JSON.stringify(next.acceptanceCriteria),
        next.executionDomain,
        next.state,
        next.attemptCount,
        next.maxAttempts,
        next.executorId,
        next.reviewerId,
        next.baseSha,
        next.branch,
        next.commitSha,
        next.pullRequestUrl,
        next.result ? JSON.stringify(next.result) : null,
        next.review ? JSON.stringify(next.review) : null,
        next.blocker,
        new Date(next.updatedAt),
        id,
      ]
    );
    return next;
  }

  async claimNextMission(cycleId: string, owner: string, leaseMs = 20 * 60 * 1000): Promise<PresidentCycleMission | null> {
    return this.transaction(async store => {
      const [rows] = await store.executor().execute<RowDataPacket[]>(
        `SELECT * FROM president_cycle_missions
         WHERE cycleId=? AND state IN ('QUEUED','REPAIR_REQUIRED')
           AND attemptCount<maxAttempts
           AND (leaseExpiresAt IS NULL OR leaseExpiresAt<=NOW(3))
         ORDER BY createdAt,id LIMIT 1 FOR UPDATE`,
        [cycleId]
      );
      if (!rows[0]) return null;
      const mission = missionFromRow(rows[0]);
      const expires = new Date(Date.now() + leaseMs);
      await store.executor().execute(
        `UPDATE president_cycle_missions
         SET state='PREPARING',attemptCount=attemptCount+1,leaseOwner=?,leaseExpiresAt=?,updatedAt=NOW(3)
         WHERE id=?`,
        [owner, expires, mission.id]
      );
      return store.getMission(mission.id);
    });
  }

  async releaseLease(id: string): Promise<void> {
    await this.executor().execute(
      "UPDATE president_cycle_missions SET leaseOwner=NULL,leaseExpiresAt=NULL,updatedAt=NOW(3) WHERE id=?",
      [id]
    );
  }

  async recoverExpiredLeases(): Promise<void> {
    await this.executor().execute(
      `UPDATE president_cycle_missions
       SET state=IF(attemptCount<maxAttempts,'REPAIR_REQUIRED','BLOCKED'),
           blocker=IF(attemptCount<maxAttempts,blocker,'Execution lease expired after bounded retries'),
           leaseOwner=NULL,leaseExpiresAt=NULL,updatedAt=NOW(3)
       WHERE state IN ('PREPARING','EXECUTING','VALIDATING','REVIEWING')
         AND leaseExpiresAt IS NOT NULL AND leaseExpiresAt<=NOW(3)`
    );
  }
}
