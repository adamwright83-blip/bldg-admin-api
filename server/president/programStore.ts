import { canonicalJson } from "./canonicalJson";
import { randomUUID } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { DurableExecutionStore } from "../durableExecution/worker";
import {
  presidentAuthorityPolicySchema,
  presidentExecutionHandbackSchema,
  presidentFounderDecisionSchema,
  presidentIndependentReviewSchema,
  presidentPreflightSchema,
  presidentProgramSchema,
  presidentProgramStepSchema,
  presidentExecutiveSeatSchema,
  presidentAgentCapabilitySchema,
  type PresidentAuthorityPolicy,
  type PresidentExecutionHandback,
  type PresidentFounderDecision,
  type PresidentIndependentReview,
  type PresidentPreflight,
  type PresidentProgram,
  type PresidentProgramStep,
  type PresidentExecutiveSeat,
  type PresidentAgentCapability,
} from "../../shared/presidentOperatingSystem";

const decode = <T>(value: unknown): T =>
  (typeof value === "string" ? JSON.parse(value) : value) as T;

const iso = (value: unknown): string =>
  value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
const isoNullable = (value: unknown): string | null =>
  value == null ? null : iso(value);

export type ClaimedPresidentProgramStep = PresidentProgramStep & {
  leaseOwner: string;
  leaseExpiresAt: string;
};

function programFromRow(r: RowDataPacket): PresidentProgram {
  return presidentProgramSchema.parse({
    id: r.id,
    assessmentId: r.assessmentId,
    candidateId: r.candidateId,
    objectiveRecordId: r.objectiveRecordId,
    title: r.title,
    outcome: r.outcome,
    state: r.state,
    selectedBy: r.selectedBy,
    selectedAt: iso(r.selectedAt),
    authorityPolicyVersion: r.authorityPolicyVersion,
    maxProgramUsd: Number(r.maxProgramUsd),
    spentUsd: Number(r.spentUsd),
    currentStepId: r.currentStepId,
    verifiedArtifactId: r.verifiedArtifactId,
    blockReason: r.blockReason,
    stopReason: r.stopReason,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  });
}

function stepFromRow(r: RowDataPacket): PresidentProgramStep {
  return presidentProgramStepSchema.parse({
    id: r.id,
    programId: r.programId,
    sequence: Number(r.sequence),
    type: r.type,
    title: r.title,
    outcome: r.outcome,
    acceptanceCriteria: decode(r.acceptanceCriteriaJson),
    nonGoals: decode(r.nonGoalsJson),
    requiredEvidence: decode(r.requiredEvidenceJson),
    authorityClass: r.authorityClass,
    consequentialDomain: r.consequentialDomain,
    maxUsd: Number(r.maxUsd),
    spentUsd: Number(r.spentUsd),
    executorCapability: r.executorCapability,
    reviewerCapability: r.reviewerCapability,
    executorId: r.executorId,
    reviewerId: r.reviewerId,
    baseRef: r.baseRef,
    baseSha: r.baseSha,
    state: r.state,
    attemptCount: Number(r.attemptCount),
    maxAttempts: Number(r.maxAttempts),
    leaseOwner: r.leaseOwner,
    leaseExpiresAt: isoNullable(r.leaseExpiresAt),
    nextAttemptAt: isoNullable(r.nextAttemptAt),
    exactArtifactId: r.exactArtifactId,
    error: r.error,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  });
}

function decisionFromRow(r: RowDataPacket): PresidentFounderDecision {
  return presidentFounderDecisionSchema.parse({
    id: r.id,
    programId: r.programId,
    stepId: r.stepId,
    questionKey: r.questionKey,
    question: r.question,
    options: decode(r.optionsJson),
    recommendedOption: r.recommendedOption,
    reason: r.reason,
    status: r.status,
    answer: r.answer,
    askedAt: iso(r.askedAt),
    answeredAt: isoNullable(r.answeredAt),
  });
}

function capabilityFromRow(r: RowDataPacket): PresidentAgentCapability {
  return presidentAgentCapabilitySchema.parse({
    capabilityKey: r.capabilityKey,
    kind: r.kind,
    actorId: r.actorId,
    targetCapability: r.targetCapability,
    seatRoleKey: r.seatRoleKey,
    programId: r.programId,
    skillNames: decode(r.skillNamesJson),
    authorityClasses: decode(r.authorityClassesJson),
    consequentialDomains: decode(r.consequentialDomainsJson),
    maxUsdPerRun: Number(r.maxUsdPerRun),
    evidenceIds: decode(r.evidenceIdsJson),
    justification: r.justification,
    status: r.status,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    revokedAt: isoNullable(r.revokedAt),
  });
}

function seatFromRow(r: RowDataPacket): PresidentExecutiveSeat {
  return presidentExecutiveSeatSchema.parse({
    id: r.id,
    roleKey: r.roleKey,
    title: r.title,
    mandate: r.mandate,
    proposedByProgramId: r.proposedByProgramId,
    capabilityGap: r.capabilityGap,
    skillNames: decode(r.skillNamesJson),
    provider: r.provider,
    monthlyBudgetUsd: Number(r.monthlyBudgetUsd),
    state: r.state,
    founderDecisionId: r.founderDecisionId,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  });
}

export class MysqlPresidentProgramStore
  implements DurableExecutionStore<ClaimedPresidentProgramStep>
{
  constructor(
    readonly pool: Pool,
    private readonly transactionConnection?: PoolConnection
  ) {}

  async transaction<T>(
    programId: string,
    operation: (store: MysqlPresidentProgramStore) => Promise<T>
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        "SELECT id FROM president_programs WHERE id=? FOR UPDATE",
        [programId]
      );
      const result = await operation(
        new MysqlPresidentProgramStore(
          connection as unknown as Pool,
          connection
        )
      );
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async callbackReplay(
    input: PresidentExecutionHandback | PresidentIndependentReview
  ): Promise<boolean> {
    const execution = "executorId" in input;
    const table = execution
      ? "president_execution_handbacks"
      : "president_independent_reviews";
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT stepId FROM ${table} WHERE eventId=?`,
      [input.eventId]
    );
    if (!rows[0]) return false;
    const saved = execution
      ? await this.getHandback(rows[0].stepId)
      : await this.latestReview(rows[0].stepId);
    if (!saved || canonicalJson(saved) !== canonicalJson(input))
      throw new Error("Callback event identity conflict");
    return true;
  }

  async putAuthorityPolicy(
    input: PresidentAuthorityPolicy
  ): Promise<PresidentAuthorityPolicy> {
    const policy = presidentAuthorityPolicySchema.parse(input);
    await this.pool.execute(
      `INSERT INTO president_authority_policies
       (policyVersion,founderId,internalMergeAllowed,internalDeployAllowed,maxAutonomousUsdPerDay,autonomousProgramSelectionAllowed,allowedRepositoriesJson,allowedEnvironmentsJson,prohibitedDomainsJson,updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE policyVersion=policyVersion`,
      [
        policy.policyVersion,
        policy.founderId,
        policy.internalMergeAllowed,
        policy.internalDeployAllowed,
        policy.maxAutonomousUsdPerDay,
        policy.autonomousProgramSelectionAllowed,
        JSON.stringify(policy.allowedRepositories),
        JSON.stringify(policy.allowedEnvironments),
        JSON.stringify(policy.prohibitedDomains),
        new Date(policy.updatedAt),
      ]
    );
    const persisted = await this.getAuthorityPolicy(policy.policyVersion);
    if (!persisted)
      throw new Error("President authority policy persistence failed");
    const { updatedAt: _inputAt, ...requestedAuthority } = policy;
    const { updatedAt: _savedAt, ...savedAuthority } = persisted;
    if (canonicalJson(requestedAuthority) !== canonicalJson(savedAuthority))
      throw new Error(
        "Authority policy versions are immutable; create a new policy version"
      );
    return persisted;
  }

  async getAuthorityPolicy(
    version?: string
  ): Promise<PresidentAuthorityPolicy | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      version
        ? "SELECT * FROM president_authority_policies WHERE policyVersion=? LIMIT 1"
        : "SELECT * FROM president_authority_policies ORDER BY updatedAt DESC LIMIT 1",
      version ? [version] : []
    );
    const r = rows[0];
    if (!r) return null;
    return presidentAuthorityPolicySchema.parse({
      policyVersion: r.policyVersion,
      founderId: r.founderId,
      internalMergeAllowed: Boolean(r.internalMergeAllowed),
      internalDeployAllowed: Boolean(r.internalDeployAllowed),
      maxAutonomousUsdPerDay: Number(r.maxAutonomousUsdPerDay),
      autonomousProgramSelectionAllowed: Boolean(
        r.autonomousProgramSelectionAllowed
      ),
      allowedRepositories: decode(r.allowedRepositoriesJson),
      allowedEnvironments: decode(r.allowedEnvironmentsJson),
      prohibitedDomains: decode(r.prohibitedDomainsJson),
      updatedAt: iso(r.updatedAt),
    });
  }

  async createProgram(input: PresidentProgram): Promise<PresidentProgram> {
    const program = presidentProgramSchema.parse(input);
    try {
      await this.pool.execute(
        `INSERT INTO president_programs
         (id,assessmentId,candidateId,objectiveRecordId,title,outcome,state,selectedBy,selectedAt,authorityPolicyVersion,maxProgramUsd,spentUsd,currentStepId,verifiedArtifactId,blockReason,stopReason,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          program.id,
          program.assessmentId,
          program.candidateId,
          program.objectiveRecordId,
          program.title,
          program.outcome,
          program.state,
          program.selectedBy,
          new Date(program.selectedAt),
          program.authorityPolicyVersion,
          program.maxProgramUsd,
          program.spentUsd,
          program.currentStepId,
          program.verifiedArtifactId,
          program.blockReason,
          program.stopReason,
          new Date(program.createdAt),
          new Date(program.updatedAt),
        ]
      );
    } catch (error) {
      if ((error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;
      const prior = program.objectiveRecordId
        ? await this.findProgramByObjective(program.objectiveRecordId)
        : program.assessmentId && program.candidateId
          ? await this.findProgramByCandidate(
              program.assessmentId,
              program.candidateId
            )
          : null;
      if (!prior) throw error;
      return prior;
    }
    return program;
  }

  async getProgram(id: string): Promise<PresidentProgram | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM president_programs WHERE id=? LIMIT 1",
      [id]
    );
    return rows[0] ? programFromRow(rows[0]) : null;
  }

  async findProgramByCandidate(
    assessmentId: string,
    candidateId: string
  ): Promise<PresidentProgram | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM president_programs WHERE assessmentId=? AND candidateId=? LIMIT 1",
      [assessmentId, candidateId]
    );
    return rows[0] ? programFromRow(rows[0]) : null;
  }

  async findProgramByObjective(
    objectiveRecordId: string
  ): Promise<PresidentProgram | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM president_programs WHERE objectiveRecordId=? LIMIT 1",
      [objectiveRecordId]
    );
    return rows[0] ? programFromRow(rows[0]) : null;
  }

  async listPrograms(limit = 50): Promise<PresidentProgram[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM president_programs ORDER BY updatedAt DESC,id DESC LIMIT ?",
      [Math.max(1, Math.min(100, limit))]
    );
    return rows.map(programFromRow);
  }

  async updateProgram(
    id: string,
    patch: Partial<
      Pick<
        PresidentProgram,
        | "state"
        | "spentUsd"
        | "currentStepId"
        | "verifiedArtifactId"
        | "blockReason"
        | "stopReason"
      >
    >
  ): Promise<PresidentProgram> {
    const prior = await this.getProgram(id);
    if (!prior) throw new Error("President program not found");
    const updated = presidentProgramSchema.parse({
      ...prior,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    await this.pool.execute(
      `UPDATE president_programs SET
       state=?,spentUsd=?,currentStepId=?,verifiedArtifactId=?,blockReason=?,stopReason=?,updatedAt=?
       WHERE id=?`,
      [
        updated.state,
        updated.spentUsd,
        updated.currentStepId,
        updated.verifiedArtifactId,
        updated.blockReason,
        updated.stopReason,
        new Date(updated.updatedAt),
        id,
      ]
    );
    return updated;
  }

  async putPreflight(input: PresidentPreflight): Promise<PresidentPreflight> {
    const p = presidentPreflightSchema.parse(input);
    await this.pool.execute(
      `INSERT INTO president_program_preflights
       (programId,reversible,rollbackPlan,estimatedUsd,licensesJson,secretRequirementsJson,customerImpact,productionMutation,billingMutation,credentialMutation,dnsMutation,legalCommitment,commercialRelease,externalSpend,unknownsJson,requiredFounderDecisionsJson,result,checkedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
       reversible=VALUES(reversible),rollbackPlan=VALUES(rollbackPlan),estimatedUsd=VALUES(estimatedUsd),licensesJson=VALUES(licensesJson),secretRequirementsJson=VALUES(secretRequirementsJson),customerImpact=VALUES(customerImpact),productionMutation=VALUES(productionMutation),billingMutation=VALUES(billingMutation),credentialMutation=VALUES(credentialMutation),dnsMutation=VALUES(dnsMutation),legalCommitment=VALUES(legalCommitment),commercialRelease=VALUES(commercialRelease),externalSpend=VALUES(externalSpend),unknownsJson=VALUES(unknownsJson),requiredFounderDecisionsJson=VALUES(requiredFounderDecisionsJson),result=VALUES(result),checkedAt=VALUES(checkedAt)`,
      [
        p.programId,
        p.reversible,
        p.rollbackPlan,
        p.estimatedUsd,
        JSON.stringify(p.licenses),
        JSON.stringify(p.secretRequirements),
        p.customerImpact,
        p.productionMutation,
        p.billingMutation,
        p.credentialMutation,
        p.dnsMutation,
        p.legalCommitment,
        p.commercialRelease,
        p.externalSpend,
        JSON.stringify(p.unknowns),
        JSON.stringify(p.requiredFounderDecisions),
        p.result,
        new Date(p.checkedAt),
      ]
    );
    return p;
  }

  async getPreflight(programId: string): Promise<PresidentPreflight | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM president_program_preflights WHERE programId=? LIMIT 1",
      [programId]
    );
    const r = rows[0];
    if (!r) return null;
    return presidentPreflightSchema.parse({
      programId: r.programId,
      reversible: Boolean(r.reversible),
      rollbackPlan: r.rollbackPlan,
      estimatedUsd: Number(r.estimatedUsd),
      licenses: decode(r.licensesJson),
      secretRequirements: decode(r.secretRequirementsJson),
      customerImpact: Boolean(r.customerImpact),
      productionMutation: Boolean(r.productionMutation),
      billingMutation: Boolean(r.billingMutation),
      credentialMutation: Boolean(r.credentialMutation),
      dnsMutation: Boolean(r.dnsMutation),
      legalCommitment: Boolean(r.legalCommitment),
      commercialRelease: Boolean(r.commercialRelease),
      externalSpend: Boolean(r.externalSpend),
      unknowns: decode(r.unknownsJson),
      requiredFounderDecisions: decode(r.requiredFounderDecisionsJson),
      result: r.result,
      checkedAt: iso(r.checkedAt),
    });
  }

  async createStep(input: PresidentProgramStep): Promise<PresidentProgramStep> {
    const step = presidentProgramStepSchema.parse(input);
    await this.pool.execute(
      `INSERT INTO president_program_steps
       (id,programId,sequence,type,title,outcome,acceptanceCriteriaJson,nonGoalsJson,requiredEvidenceJson,authorityClass,consequentialDomain,maxUsd,spentUsd,executorCapability,reviewerCapability,executorId,reviewerId,baseRef,baseSha,state,attemptCount,maxAttempts,leaseOwner,leaseExpiresAt,nextAttemptAt,exactArtifactId,error,createdAt,updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        step.id,
        step.programId,
        step.sequence,
        step.type,
        step.title,
        step.outcome,
        JSON.stringify(step.acceptanceCriteria),
        JSON.stringify(step.nonGoals),
        JSON.stringify(step.requiredEvidence),
        step.authorityClass,
        step.consequentialDomain,
        step.maxUsd,
        step.spentUsd,
        step.executorCapability,
        step.reviewerCapability,
        step.executorId,
        step.reviewerId,
        step.baseRef,
        step.baseSha,
        step.state,
        step.attemptCount,
        step.maxAttempts,
        step.leaseOwner,
        step.leaseExpiresAt ? new Date(step.leaseExpiresAt) : null,
        step.nextAttemptAt ? new Date(step.nextAttemptAt) : null,
        step.exactArtifactId,
        step.error,
        new Date(step.createdAt),
        new Date(step.updatedAt),
      ]
    );
    return step;
  }

  async getStep(id: string): Promise<PresidentProgramStep | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM president_program_steps WHERE id=? LIMIT 1",
      [id]
    );
    return rows[0] ? stepFromRow(rows[0]) : null;
  }

  async listSteps(programId: string): Promise<PresidentProgramStep[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM president_program_steps WHERE programId=? ORDER BY sequence,id",
      [programId]
    );
    return rows.map(stepFromRow);
  }

  async updateStep(
    id: string,
    patch: Partial<PresidentProgramStep>
  ): Promise<PresidentProgramStep> {
    const prior = await this.getStep(id);
    if (!prior) throw new Error("President program step not found");
    const step = presidentProgramStepSchema.parse({
      ...prior,
      ...patch,
      id: prior.id,
      programId: prior.programId,
      createdAt: prior.createdAt,
      updatedAt: new Date().toISOString(),
    });
    await this.pool.execute(
      `UPDATE president_program_steps SET
       type=?,title=?,outcome=?,acceptanceCriteriaJson=?,nonGoalsJson=?,requiredEvidenceJson=?,authorityClass=?,consequentialDomain=?,maxUsd=?,spentUsd=?,executorCapability=?,reviewerCapability=?,executorId=?,reviewerId=?,baseRef=?,baseSha=?,state=?,attemptCount=?,maxAttempts=?,leaseOwner=?,leaseExpiresAt=?,nextAttemptAt=?,exactArtifactId=?,error=?,updatedAt=?
       WHERE id=?`,
      [
        step.type,
        step.title,
        step.outcome,
        JSON.stringify(step.acceptanceCriteria),
        JSON.stringify(step.nonGoals),
        JSON.stringify(step.requiredEvidence),
        step.authorityClass,
        step.consequentialDomain,
        step.maxUsd,
        step.spentUsd,
        step.executorCapability,
        step.reviewerCapability,
        step.executorId,
        step.reviewerId,
        step.baseRef,
        step.baseSha,
        step.state,
        step.attemptCount,
        step.maxAttempts,
        step.leaseOwner,
        step.leaseExpiresAt ? new Date(step.leaseExpiresAt) : null,
        step.nextAttemptAt ? new Date(step.nextAttemptAt) : null,
        step.exactArtifactId,
        step.error,
        new Date(step.updatedAt),
        id,
      ]
    );
    return step;
  }

  async recordHandback(
    input: PresidentExecutionHandback
  ): Promise<PresidentExecutionHandback> {
    const h = presidentExecutionHandbackSchema.parse(input);
    await this.pool.execute(
      `INSERT INTO president_execution_handbacks
       (id,eventId,stepId,executorId,exactArtifactId,branch,commitSha,summary,changedFilesJson,testsActuallyRunJson,testsNotRunJson,evidenceJson,knownLimitationsJson,costUsd,reversible,rollbackInstructions,completedAt,createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`,
      [
        randomUUID(),
        h.eventId,
        h.stepId,
        h.executorId,
        h.exactArtifactId,
        h.branch,
        h.commitSha,
        h.summary,
        JSON.stringify(h.changedFiles),
        JSON.stringify(h.testsActuallyRun),
        JSON.stringify(h.testsNotRun),
        JSON.stringify(h.evidence),
        JSON.stringify(h.knownLimitations),
        h.costUsd,
        h.reversible,
        h.rollbackInstructions,
        new Date(h.completedAt),
        new Date(),
      ]
    );
    return h;
  }

  async getHandback(
    stepId: string
  ): Promise<PresidentExecutionHandback | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM president_execution_handbacks WHERE stepId=? ORDER BY createdAt DESC LIMIT 1",
      [stepId]
    );
    const r = rows[0];
    if (!r) return null;
    return presidentExecutionHandbackSchema.parse({
      eventId: r.eventId,
      stepId: r.stepId,
      executorId: r.executorId,
      exactArtifactId: r.exactArtifactId,
      branch: r.branch,
      commitSha: r.commitSha,
      summary: r.summary,
      changedFiles: decode(r.changedFilesJson),
      testsActuallyRun: decode(r.testsActuallyRunJson),
      testsNotRun: decode(r.testsNotRunJson),
      evidence: decode(r.evidenceJson),
      knownLimitations: decode(r.knownLimitationsJson),
      costUsd: r.costUsd == null ? null : Number(r.costUsd),
      reversible: Boolean(r.reversible),
      rollbackInstructions: r.rollbackInstructions,
      completedAt: iso(r.completedAt),
    });
  }

  async hasExecutionEvent(eventId: string): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT eventId FROM president_execution_handbacks WHERE eventId=? LIMIT 1",
      [eventId]
    );
    return Boolean(rows[0]);
  }

  async hasReviewEvent(eventId: string): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT eventId FROM president_independent_reviews WHERE eventId=? LIMIT 1",
      [eventId]
    );
    return Boolean(rows[0]);
  }

  async recordReview(
    input: PresidentIndependentReview
  ): Promise<PresidentIndependentReview> {
    const review = presidentIndependentReviewSchema.parse(input);
    const step = await this.getStep(review.stepId);
    if (!step) throw new Error("Review step not found");
    const handback = await this.getHandback(review.stepId);
    if (!handback)
      throw new Error("Review requires a durable execution handback");
    if (review.evidence.executionEventId !== handback.eventId)
      throw new Error("Review belongs to a stale execution run");
    if (handback.executorId === review.reviewerId)
      throw new Error(
        "President cannot self-certify: reviewer must be independent of executor"
      );
    if (
      review.exactArtifactId !== handback.exactArtifactId ||
      review.exactArtifactId !== step.exactArtifactId
    )
      throw new Error(
        "Review artifact identity does not match exact executed artifact"
      );
    if (
      review.verdict === "PASS" &&
      (review.acceptanceResults.length !== step.acceptanceCriteria.length ||
        review.acceptanceResults.some(
          (result, index) =>
            result.criterion !== step.acceptanceCriteria[index] ||
            !result.passed
        ))
    )
      throw new Error("PASS requires every exact acceptance criterion to pass");

    await this.pool.execute(
      `INSERT INTO president_independent_reviews
       (id,eventId,stepId,reviewerId,exactArtifactId,verdict,acceptanceResultsJson,observedRisksJson,requiredRevision,evidenceJson,reviewedAt,createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
`,
      [
        randomUUID(),
        review.eventId,
        review.stepId,
        review.reviewerId,
        review.exactArtifactId,
        review.verdict,
        JSON.stringify(review.acceptanceResults),
        JSON.stringify(review.observedRisks),
        review.requiredRevision,
        JSON.stringify(review.evidence),
        new Date(review.reviewedAt),
        new Date(),
      ]
    );
    return review;
  }

  async latestReview(
    stepId: string
  ): Promise<PresidentIndependentReview | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM president_independent_reviews WHERE stepId=? ORDER BY reviewedAt DESC,id DESC LIMIT 1",
      [stepId]
    );
    const r = rows[0];
    if (!r) return null;
    return presidentIndependentReviewSchema.parse({
      eventId: r.eventId,
      stepId: r.stepId,
      reviewerId: r.reviewerId,
      exactArtifactId: r.exactArtifactId,
      verdict: r.verdict,
      acceptanceResults: decode(r.acceptanceResultsJson),
      observedRisks: decode(r.observedRisksJson),
      requiredRevision: r.requiredRevision,
      evidence: decode(r.evidenceJson),
      reviewedAt: iso(r.reviewedAt),
    });
  }

  async createFounderDecision(
    input: PresidentFounderDecision
  ): Promise<PresidentFounderDecision> {
    const d = presidentFounderDecisionSchema.parse(input);
    const connection =
      this.transactionConnection ?? (await this.pool.getConnection());
    try {
      if (!this.transactionConnection) await connection.beginTransaction();
      const [openRows] = await connection.execute<RowDataPacket[]>(
        "SELECT * FROM president_founder_decisions WHERE questionKey=? AND status='OPEN' ORDER BY decisionRound DESC LIMIT 1 FOR UPDATE",
        [d.questionKey]
      );
      if (d.status === "OPEN" && openRows[0]) {
        if (!this.transactionConnection) await connection.commit();
        return decisionFromRow(openRows[0]);
      }
      const [roundRows] = await connection.execute<RowDataPacket[]>(
        "SELECT decisionRound FROM president_founder_decisions WHERE questionKey=? ORDER BY decisionRound DESC LIMIT 1 FOR UPDATE",
        [d.questionKey]
      );
      const decisionRound = Number(roundRows[0]?.decisionRound ?? 0) + 1;
      await connection.execute(
        `INSERT INTO president_founder_decisions
         (id,programId,stepId,questionKey,decisionRound,question,optionsJson,recommendedOption,reason,status,answer,askedAt,answeredAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          d.id,
          d.programId,
          d.stepId,
          d.questionKey,
          decisionRound,
          d.question,
          JSON.stringify(d.options),
          d.recommendedOption,
          d.reason,
          d.status,
          d.answer,
          new Date(d.askedAt),
          d.answeredAt ? new Date(d.answeredAt) : null,
        ]
      );
      if (!this.transactionConnection) await connection.commit();
      return d;
    } catch (error) {
      if (!this.transactionConnection) await connection.rollback();
      if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
        const existing = await this.findOpenDecision(d.questionKey);
        if (existing) return existing;
      }
      throw error;
    } finally {
      if (!this.transactionConnection) connection.release();
    }
  }

  async findOpenDecision(
    questionKey: string
  ): Promise<PresidentFounderDecision | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM president_founder_decisions WHERE questionKey=? AND status='OPEN' ORDER BY askedAt DESC LIMIT 1",
      [questionKey]
    );
    return rows[0] ? decisionFromRow(rows[0]) : null;
  }

  async openFounderDecisions(limit = 3): Promise<PresidentFounderDecision[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM president_founder_decisions WHERE status='OPEN' ORDER BY askedAt,id LIMIT ?",
      [Math.max(1, Math.min(3, limit))]
    );
    return rows.map(decisionFromRow);
  }

  async answerFounderDecision(
    id: string,
    answer: string
  ): Promise<PresidentFounderDecision> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM president_founder_decisions WHERE id=? LIMIT 1",
      [id]
    );
    if (!rows[0]) throw new Error("Founder decision not found");
    const prior = decisionFromRow(rows[0]);
    if (prior.status === "ANSWERED") {
      if (prior.answer !== answer)
        throw new Error("Founder decision already answered differently");
      return prior;
    }
    if (!prior.options.includes(answer))
      throw new Error("Founder answer must match an offered option");
    const answeredAt = new Date();
    await this.pool.execute(
      "UPDATE president_founder_decisions SET status='ANSWERED',answer=?,answeredAt=? WHERE id=? AND status='OPEN'",
      [answer, answeredAt, id]
    );
    return presidentFounderDecisionSchema.parse({
      ...prior,
      status: "ANSWERED",
      answer,
      answeredAt: answeredAt.toISOString(),
    });
  }

  async putAgentCapability(
    input: PresidentAgentCapability
  ): Promise<PresidentAgentCapability> {
    const capability = presidentAgentCapabilitySchema.parse(input);
    await this.pool.execute(
      `INSERT INTO president_agent_capabilities
       (capabilityKey,kind,actorId,targetCapability,seatRoleKey,programId,skillNamesJson,authorityClassesJson,consequentialDomainsJson,maxUsdPerRun,evidenceIdsJson,justification,status,createdAt,updatedAt,revokedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
       kind=VALUES(kind),actorId=VALUES(actorId),targetCapability=VALUES(targetCapability),
       seatRoleKey=VALUES(seatRoleKey),programId=VALUES(programId),skillNamesJson=VALUES(skillNamesJson),
       authorityClassesJson=VALUES(authorityClassesJson),consequentialDomainsJson=VALUES(consequentialDomainsJson),
       maxUsdPerRun=VALUES(maxUsdPerRun),evidenceIdsJson=VALUES(evidenceIdsJson),
       justification=VALUES(justification),status=VALUES(status),updatedAt=VALUES(updatedAt),revokedAt=VALUES(revokedAt)`,
      [
        capability.capabilityKey,
        capability.kind,
        capability.actorId,
        capability.targetCapability,
        capability.seatRoleKey,
        capability.programId,
        JSON.stringify(capability.skillNames),
        JSON.stringify(capability.authorityClasses),
        JSON.stringify(capability.consequentialDomains),
        capability.maxUsdPerRun,
        JSON.stringify(capability.evidenceIds),
        capability.justification,
        capability.status,
        new Date(capability.createdAt),
        new Date(capability.updatedAt),
        capability.revokedAt ? new Date(capability.revokedAt) : null,
      ]
    );
    return (await this.getAgentCapability(capability.capabilityKey))!;
  }

  async getAgentCapability(
    capabilityKey: string
  ): Promise<PresidentAgentCapability | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM president_agent_capabilities WHERE capabilityKey=? LIMIT 1",
      [capabilityKey]
    );
    return rows[0] ? capabilityFromRow(rows[0]) : null;
  }

  async listAgentCapabilities(): Promise<PresidentAgentCapability[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM president_agent_capabilities ORDER BY capabilityKey"
    );
    return rows.map(capabilityFromRow);
  }

  async putExecutiveSeat(
    input: PresidentExecutiveSeat
  ): Promise<PresidentExecutiveSeat> {
    const seat = presidentExecutiveSeatSchema.parse(input);
    await this.pool.execute(
      `INSERT INTO president_executive_seats
       (id,roleKey,title,mandate,proposedByProgramId,capabilityGap,skillNamesJson,provider,monthlyBudgetUsd,state,founderDecisionId,createdAt,updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
       title=VALUES(title),mandate=VALUES(mandate),proposedByProgramId=VALUES(proposedByProgramId),capabilityGap=VALUES(capabilityGap),skillNamesJson=VALUES(skillNamesJson),provider=VALUES(provider),monthlyBudgetUsd=VALUES(monthlyBudgetUsd),state=VALUES(state),founderDecisionId=VALUES(founderDecisionId),updatedAt=VALUES(updatedAt)`,
      [
        seat.id,
        seat.roleKey,
        seat.title,
        seat.mandate,
        seat.proposedByProgramId,
        seat.capabilityGap,
        JSON.stringify(seat.skillNames),
        seat.provider,
        seat.monthlyBudgetUsd,
        seat.state,
        seat.founderDecisionId,
        new Date(seat.createdAt),
        new Date(seat.updatedAt),
      ]
    );
    const found = await this.getExecutiveSeat(seat.roleKey);
    if (!found) throw new Error("Executive seat did not persist");
    return found;
  }

  async getExecutiveSeat(
    roleKey: string
  ): Promise<PresidentExecutiveSeat | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM president_executive_seats WHERE roleKey=? LIMIT 1",
      [roleKey]
    );
    return rows[0] ? seatFromRow(rows[0]) : null;
  }

  async listExecutiveSeats(): Promise<PresidentExecutiveSeat[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM president_executive_seats ORDER BY createdAt,id"
    );
    return rows.map(seatFromRow);
  }

  async recordEvent(input: {
    programId: string;
    stepId?: string | null;
    eventType: string;
    actorId: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.execute(
      "INSERT INTO president_program_events (id,programId,stepId,eventType,actorId,detailsJson,occurredAt) VALUES (?,?,?,?,?,?,?)",
      [
        randomUUID(),
        input.programId,
        input.stepId ?? null,
        input.eventType,
        input.actorId,
        JSON.stringify(input.details ?? {}),
        new Date(),
      ]
    );
  }

  async listEvents(programId: string): Promise<
    Array<{
      id: string;
      programId: string;
      stepId: string | null;
      eventType: string;
      actorId: string;
      details: Record<string, unknown>;
      occurredAt: string;
    }>
  > {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM president_program_events WHERE programId=? ORDER BY occurredAt,id",
      [programId]
    );
    return rows.map(r => ({
      id: r.id,
      programId: r.programId,
      stepId: r.stepId,
      eventType: r.eventType,
      actorId: r.actorId,
      details: decode(r.detailsJson),
      occurredAt: iso(r.occurredAt),
    }));
  }

  async nextPendingStep(): Promise<PresidentProgramStep | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT s.* FROM president_program_steps s
       JOIN president_programs p ON p.id=s.programId
       WHERE s.state='PENDING' AND s.attemptCount<s.maxAttempts
         AND p.state IN ('READY','RUNNING','REVISION_REQUIRED')
         AND (s.nextAttemptAt IS NULL OR s.nextAttemptAt<=NOW(3))
         AND NOT EXISTS (
           SELECT 1 FROM president_program_steps earlier
           WHERE earlier.programId=s.programId
             AND earlier.sequence<s.sequence
             AND earlier.state NOT IN ('VERIFIED','CANCELED')
         )
       ORDER BY p.updatedAt,s.sequence,s.createdAt,s.id
       LIMIT 1`
    );
    return rows[0] ? stepFromRow(rows[0]) : null;
  }

  async claimSpecificStep(input: {
    stepId: string;
    executorId: string;
    leaseMs: number;
  }): Promise<PresidentProgramStep | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT s.* FROM president_program_steps s
         JOIN president_programs p ON p.id=s.programId
         WHERE s.id=? AND s.state='PENDING' AND s.attemptCount<s.maxAttempts
           AND p.state IN ('READY','RUNNING','REVISION_REQUIRED')
           AND (s.nextAttemptAt IS NULL OR s.nextAttemptAt<=NOW(3))
           AND NOT EXISTS (
             SELECT 1 FROM president_program_steps earlier
             WHERE earlier.programId=s.programId
               AND earlier.sequence<s.sequence
               AND earlier.state NOT IN ('VERIFIED','CANCELED')
           )
         FOR UPDATE`,
        [input.stepId]
      );
      if (!rows[0]) {
        await connection.commit();
        return null;
      }
      const [programRows] = await connection.execute<RowDataPacket[]>(
        "SELECT * FROM president_programs WHERE id=? FOR UPDATE",
        [rows[0].programId]
      );
      const program = programRows[0];
      const [policies] = await connection.execute<RowDataPacket[]>(
        "SELECT * FROM president_authority_policies WHERE policyVersion=? FOR UPDATE",
        [program.authorityPolicyVersion]
      );
      if (!policies[0])
        throw new Error("President authority policy disappeared");
      // Reserve every attempted ceiling conservatively, including lost returns.
      // Unknown actual spend can never free authority for another execution.
      const [reserved] = await connection.execute<RowDataPacket[]>(
        "SELECT COALESCE(SUM(s.maxUsd*s.attemptCount),0) AS total FROM president_program_steps s WHERE s.programId=?",
        [program.id]
      );
      if (
        Number(reserved[0].total) + Number(rows[0].maxUsd) >
        Number(program.maxProgramUsd)
      ) {
        await connection.execute(
          "UPDATE president_programs SET state='BLOCKED_CAPABILITY',blockReason='Bounded program attempt budget exhausted',updatedAt=NOW(3) WHERE id=?",
          [program.id]
        );
        await connection.commit();
        return null;
      }
      const [daily] = await connection.execute<RowDataPacket[]>(
        "SELECT COALESCE(SUM(s.maxUsd*s.attemptCount),0) AS total FROM president_program_steps s JOIN president_programs p ON p.id=s.programId WHERE p.authorityPolicyVersion=? AND s.updatedAt>=UTC_DATE()",
        [program.authorityPolicyVersion]
      );
      if (
        rows[0].authorityClass !== "FOUNDER_APPROVAL" &&
        Number(daily[0].total) + Number(rows[0].maxUsd) >
          Number(policies[0].maxAutonomousUsdPerDay)
      )
        throw new Error(
          "President attempts exceed daily standing spend authority"
        );
      const leaseExpiresAt = new Date(Date.now() + input.leaseMs);
      await connection.execute(
        `UPDATE president_program_steps
         SET state='RUNNING',executorId=?,leaseOwner=?,leaseExpiresAt=?,
             attemptCount=attemptCount+1,error=NULL,updatedAt=NOW(3)
         WHERE id=? AND state='PENDING'`,
        [input.executorId, input.executorId, leaseExpiresAt, input.stepId]
      );
      await connection.execute(
        `UPDATE president_programs
         SET state='RUNNING',currentStepId=?,blockReason=NULL,updatedAt=NOW(3)
         WHERE id=?`,
        [input.stepId, rows[0].programId]
      );
      await connection.commit();
      return this.getStep(input.stepId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async submitExternalHandback(
    input: PresidentExecutionHandback
  ): Promise<PresidentProgramStep> {
    const handback = presidentExecutionHandbackSchema.parse(input);
    const [eventRows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT eventId FROM president_execution_handbacks WHERE eventId=? LIMIT 1",
      [handback.eventId]
    );
    const step = await this.getStep(handback.stepId);
    if (!step) throw new Error("President execution callback step not found");
    if (eventRows[0]) {
      await this.callbackReplay(handback);
      return step;
    }
    const activeProgram = await this.getProgram(step.programId);
    if (activeProgram?.state !== "RUNNING")
      throw new Error("Execution callback program is not running");
    if (!["CLAIMED", "RUNNING"].includes(step.state))
      throw new Error(
        "President execution callback arrived for a non-running step"
      );
    if (!step.executorId || step.executorId !== handback.executorId)
      throw new Error(
        "President execution callback actor is not the assigned executor"
      );
    if (
      !step.leaseExpiresAt ||
      new Date(step.leaseExpiresAt).getTime() <= Date.now()
    )
      throw new Error(
        "President execution callback arrived after the execution lease expired"
      );
    if (handback.evidence.executionAttempt !== step.attemptCount)
      throw new Error("President execution callback belongs to a stale run");
    if (handback.costUsd === null || handback.costUsd > step.maxUsd)
      throw new Error(
        "President execution callback requires known cost inside step budget"
      );
    await this.recordHandback(handback);
    const updated = await this.updateStep(step.id, {
      state: "REVIEW_PENDING",
      spentUsd: handback.costUsd ?? 0,
      exactArtifactId: handback.exactArtifactId,
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      error: null,
    });
    const program = await this.getProgram(step.programId);
    if (!program) throw new Error("President program disappeared");
    await this.updateProgram(program.id, {
      state: "AWAITING_REVIEW",
      currentStepId: step.id,
      spentUsd: program.spentUsd + (handback.costUsd ?? 0),
    });
    await this.recordEvent({
      programId: step.programId,
      stepId: step.id,
      eventType: "EXECUTION_HANDBACK",
      actorId: handback.executorId,
      details: { exactArtifactId: handback.exactArtifactId },
    });
    return updated;
  }

  async assignReviewer(
    stepId: string,
    reviewerId: string
  ): Promise<PresidentProgramStep> {
    const step = await this.getStep(stepId);
    if (!step) throw new Error("President review step not found");
    if (step.state !== "REVIEW_PENDING")
      throw new Error("President step is not awaiting independent review");
    if (step.executorId === reviewerId)
      throw new Error(
        "President cannot assign the executor as its own independent reviewer"
      );
    return this.updateStep(step.id, { reviewerId });
  }

  async decisionsForProgram(
    programId: string
  ): Promise<PresidentFounderDecision[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM president_founder_decisions WHERE programId=? ORDER BY askedAt,id",
      [programId]
    );
    return rows.map(decisionFromRow);
  }

  async findDecisionByKey(
    questionKey: string
  ): Promise<PresidentFounderDecision | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM president_founder_decisions WHERE questionKey=? ORDER BY askedAt DESC LIMIT 1",
      [questionKey]
    );
    return rows[0] ? decisionFromRow(rows[0]) : null;
  }

  // DurableExecutionStore implementation.
  async deadLetterExpiredSteps(): Promise<number> {
    const [result] = await this.pool.execute<any>(
      `UPDATE president_program_steps
       SET state=CASE WHEN attemptCount>=maxAttempts THEN 'DEAD_LETTER' ELSE 'PENDING' END,
           error=CASE WHEN attemptCount>=maxAttempts THEN COALESCE(error,'Lease expired after maximum attempts') ELSE error END,
           leaseOwner=NULL,leaseExpiresAt=NULL,
           nextAttemptAt=CASE WHEN attemptCount>=maxAttempts THEN NULL ELSE NOW(3) END,
           updatedAt=NOW(3)
       WHERE state IN ('CLAIMED','RUNNING') AND leaseExpiresAt IS NOT NULL AND leaseExpiresAt<NOW(3)`
    );
    await this.pool.execute(
      `UPDATE president_programs p
       JOIN president_program_steps s ON s.programId=p.id
       SET p.state='BLOCKED_CAPABILITY',
           p.currentStepId=s.id,
           p.blockReason='Execution lease expired after bounded retry policy',
           p.updatedAt=NOW(3)
       WHERE s.state='DEAD_LETTER'
         AND p.state IN ('READY','RUNNING','REVISION_REQUIRED')`
    );
    return Number(result.affectedRows ?? 0);
  }

  async claimNextStep(input: {
    leaseOwner: string;
    leaseMs: number;
  }): Promise<ClaimedPresidentProgramStep | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT s.* FROM president_program_steps s
         JOIN president_programs p ON p.id=s.programId
         WHERE s.state='PENDING'
           AND p.state IN ('READY','RUNNING','REVISION_REQUIRED')
           AND (s.nextAttemptAt IS NULL OR s.nextAttemptAt<=NOW(3))
           AND NOT EXISTS (
             SELECT 1 FROM president_program_steps earlier
             WHERE earlier.programId=s.programId
               AND earlier.sequence<s.sequence
               AND earlier.state NOT IN ('VERIFIED','CANCELED')
           )
         ORDER BY p.updatedAt,s.sequence,s.createdAt,s.id
         LIMIT 1 FOR UPDATE SKIP LOCKED`
      );
      const r = rows[0];
      if (!r) {
        await connection.commit();
        return null;
      }
      const leaseExpiresAt = new Date(Date.now() + input.leaseMs);
      await connection.execute(
        `UPDATE president_program_steps
         SET state='CLAIMED',leaseOwner=?,leaseExpiresAt=?,attemptCount=attemptCount+1,updatedAt=NOW(3)
         WHERE id=? AND state='PENDING'`,
        [input.leaseOwner, leaseExpiresAt, r.id]
      );
      await connection.commit();
      const claimed = await this.getStep(r.id);
      if (!claimed || !claimed.leaseOwner || !claimed.leaseExpiresAt)
        return null;
      return {
        ...claimed,
        leaseOwner: claimed.leaseOwner,
        leaseExpiresAt: claimed.leaseExpiresAt,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async markRunning(step: ClaimedPresidentProgramStep): Promise<boolean> {
    const [result] = await this.pool.execute<any>(
      `UPDATE president_program_steps SET state='RUNNING',updatedAt=NOW(3)
       WHERE id=? AND state='CLAIMED' AND leaseOwner=? AND leaseExpiresAt>NOW(3)`,
      [step.id, step.leaseOwner]
    );
    if (Number(result.affectedRows ?? 0) === 1)
      await this.updateProgram(step.programId, {
        state: "RUNNING",
        currentStepId: step.id,
        blockReason: null,
      });
    return Number(result.affectedRows ?? 0) === 1;
  }

  async heartbeat(
    step: ClaimedPresidentProgramStep,
    leaseMs: number
  ): Promise<boolean> {
    const leaseExpiresAt = new Date(Date.now() + leaseMs);
    const [result] = await this.pool.execute<any>(
      `UPDATE president_program_steps SET leaseExpiresAt=?,updatedAt=NOW(3)
       WHERE id=? AND state='RUNNING' AND leaseOwner=? AND leaseExpiresAt>NOW(3)`,
      [leaseExpiresAt, step.id, step.leaseOwner]
    );
    return Number(result.affectedRows ?? 0) === 1;
  }

  async completeStep(
    step: ClaimedPresidentProgramStep,
    result: unknown
  ): Promise<boolean> {
    const handback = presidentExecutionHandbackSchema.parse(result);
    if (handback.stepId !== step.id)
      throw new Error("President handback step identity mismatch");
    const current = await this.getStep(step.id);
    const assignedExecutor =
      current?.executorId ?? step.executorId ?? step.leaseOwner;
    if (handback.executorId !== assignedExecutor)
      throw new Error("President handback does not match assigned executor");
    if (
      !current ||
      current.state !== "RUNNING" ||
      current.leaseOwner !== step.leaseOwner ||
      !current.leaseExpiresAt ||
      new Date(current.leaseExpiresAt).getTime() <= Date.now()
    )
      return false;
    await this.recordHandback(handback);
    await this.updateStep(step.id, {
      state: "REVIEW_PENDING",
      executorId: handback.executorId,
      spentUsd: handback.costUsd ?? 0,
      exactArtifactId: handback.exactArtifactId,
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      error: null,
    });
    const program = await this.getProgram(step.programId);
    if (!program) throw new Error("President program disappeared");
    await this.updateProgram(program.id, {
      state: "AWAITING_REVIEW",
      currentStepId: step.id,
      spentUsd: program.spentUsd + (handback.costUsd ?? 0),
    });
    await this.recordEvent({
      programId: step.programId,
      stepId: step.id,
      eventType: "EXECUTION_HANDBACK",
      actorId: handback.executorId,
      details: { exactArtifactId: handback.exactArtifactId },
    });
    return true;
  }

  async failStep(
    step: ClaimedPresidentProgramStep,
    error: unknown,
    retryDelayMs: number
  ): Promise<unknown> {
    const current = await this.getStep(step.id);
    if (!current || current.leaseOwner !== step.leaseOwner) return false;
    const terminal = current.attemptCount >= current.maxAttempts;
    await this.updateStep(step.id, {
      state: terminal ? "DEAD_LETTER" : "PENDING",
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: terminal
        ? null
        : new Date(Date.now() + retryDelayMs).toISOString(),
      error:
        error instanceof Error
          ? error.message.slice(0, 4000)
          : String(error).slice(0, 4000),
    });
    if (terminal)
      await this.updateProgram(step.programId, {
        state: "BLOCKED_CAPABILITY",
        currentStepId: step.id,
        blockReason: "Execution exhausted bounded retry policy",
      });
    await this.recordEvent({
      programId: step.programId,
      stepId: step.id,
      eventType: terminal ? "STEP_DEAD_LETTER" : "STEP_RETRY_SCHEDULED",
      actorId: step.leaseOwner,
      details: { error: String(error).slice(0, 1000), retryDelayMs },
    });
    return true;
  }
}
