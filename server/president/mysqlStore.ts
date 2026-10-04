import type { Pool, RowDataPacket } from "mysql2/promise";
import type {
  PresidentAssessment,
  PresidentCandidateProject,
} from "../../shared/presidentContracts";
import { assertPresidentStage1Assessment } from "../../shared/presidentContracts";
import type { PresidentAssessmentStore } from "./store";
const decode = <T>(value: unknown): T =>
  (typeof value === "string" ? JSON.parse(value) : value) as T;

/** Uses the existing mysql2 pool convention. Only President-owned tables are writable. */
export class MysqlPresidentAssessmentStore implements PresidentAssessmentStore {
  constructor(private readonly pool: Pool) {}
  async findByEvidence(
    sha: string,
    snapshot: string
  ): Promise<PresidentAssessment | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM president_assessments WHERE inspectedRepositorySha=? AND evidenceSnapshotId=?",
      [sha, snapshot]
    );
    if (!rows.length) return null;
    const row = rows[0];
    const [projects] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM president_candidate_projects WHERE assessmentId=? ORDER BY `rank`",
      [row.id]
    );
    const candidates = projects.map(p => ({
      id: p.id,
      assessmentId: p.assessmentId,
      title: p.title,
      missingCapability: p.missingCapability,
      currentGap: p.currentGap,
      proposedBuild: p.proposedBuild,
      resultingCapability: p.resultingCapability,
      rank: p.rank,
      rankReason: p.rankReason,
      evidence: decode(p.evidenceJson),
      blockers: decode(p.blockersJson),
      humanDecisionDependency: p.humanDecisionDependency,
      status: p.status,
    })) as PresidentCandidateProject[];
    return {
      id: row.id,
      seat: row.seat,
      inspectedRepositorySha: row.inspectedRepositorySha,
      evidenceSnapshotId: row.evidenceSnapshotId,
      status: row.status,
      resultState: row.resultState,
      evidenceSourcesAvailable: decode(row.availableSourcesJson),
      evidenceSourcesUnavailable: decode(row.unavailableSourcesJson),
      provider: row.provider,
      model: row.model,
      startedAt: new Date(row.startedAt).toISOString(),
      completedAt: new Date(row.completedAt).toISOString(),
      candidates,
      executionCount: 0,
    };
  }
  async saveIfAbsent(a: PresidentAssessment): Promise<PresidentAssessment> {
    assertPresidentStage1Assessment(a);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      // The unique immutable-evidence key serializes concurrent retries. Duplicate inserts
      // leave every field untouched; candidate inserts belong only to the winning transaction.
      const [prior] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM president_assessments WHERE inspectedRepositorySha=? AND evidenceSnapshotId=?",
        [a.inspectedRepositorySha, a.evidenceSnapshotId]
      );
      if (!prior.length) {
        await connection.execute(
          "INSERT INTO president_assessments (id,seat,inspectedRepositorySha,evidenceSnapshotId,status,resultState,availableSourcesJson,unavailableSourcesJson,provider,model,startedAt,completedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          [
            a.id,
            a.seat,
            a.inspectedRepositorySha,
            a.evidenceSnapshotId,
            a.status,
            a.resultState,
            JSON.stringify(a.evidenceSourcesAvailable),
            JSON.stringify(a.evidenceSourcesUnavailable),
            a.provider,
            a.model,
            new Date(a.startedAt),
            new Date(a.completedAt),
          ]
        );
        for (const p of a.candidates)
          await connection.execute(
            "INSERT INTO president_candidate_projects (id,assessmentId,title,missingCapability,currentGap,proposedBuild,resultingCapability,`rank`,rankReason,evidenceJson,blockersJson,humanDecisionDependency,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [
              p.id,
              p.assessmentId,
              p.title,
              p.missingCapability,
              p.currentGap,
              p.proposedBuild,
              p.resultingCapability,
              p.rank,
              p.rankReason,
              JSON.stringify(p.evidence),
              JSON.stringify(p.blockers),
              p.humanDecisionDependency,
              p.status,
            ]
          );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if ((error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;
    } finally {
      connection.release();
    }
    const result = await this.findByEvidence(
      a.inspectedRepositorySha,
      a.evidenceSnapshotId
    );
    if (!result) throw new Error("President transaction did not persist");
    return result;
  }
  async count(): Promise<number> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM president_assessments"
    );
    return Number(rows[0].n);
  }
  async candidateCount(): Promise<number> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM president_candidate_projects"
    );
    return Number(rows[0].n);
  }
}
