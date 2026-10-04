import { randomUUID } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import type {
  PresidentCandidateProject,
} from "../../shared/presidentContracts";
import {
  assertPresidentStepAuthority,
  presidentProgramPlanDraftSchema,
  presidentNightlyBriefSchema,
  presidentExecutiveSeatSchema,
  type PresidentAuthorityPolicy,
  type PresidentIndependentReview,
  type PresidentNightlyBrief,
  type PresidentProgramPlanDraft,
  type PresidentProgramStep,
  type PresidentExecutiveSeat,
  type PresidentAgentCapability,
} from "../../shared/presidentOperatingSystem";
import { executiveSkillCatalog } from "./skillRouter";
import type { MysqlPresidentIntelligenceStore } from "./intelligenceStore";
import { MysqlPresidentProgramStore } from "./programStore";

const decode = <T>(value: unknown): T =>
  (typeof value === "string" ? JSON.parse(value) : value) as T;

function candidateFromRow(r: RowDataPacket): PresidentCandidateProject {
  return {
    id: r.id,
    assessmentId: r.assessmentId,
    title: r.title,
    missingCapability: r.missingCapability,
    currentGap: r.currentGap,
    proposedBuild: r.proposedBuild,
    resultingCapability: r.resultingCapability,
    rank: Number(r.rank),
    rankReason: r.rankReason,
    evidence: decode(r.evidenceJson),
    blockers: decode(r.blockersJson),
    humanDecisionDependency: r.humanDecisionDependency,
    status: r.status,
  } as PresidentCandidateProject;
}

function derivePreflightResult(plan: PresidentProgramPlanDraft) {
  const p = plan.preflight;
  if (p.commercialRelease) return "FORBIDDEN" as const;
  const founderRequired =
    p.customerImpact ||
    p.productionMutation ||
    p.billingMutation ||
    p.credentialMutation ||
    p.dnsMutation ||
    p.legalCommitment ||
    p.externalSpend ||
    plan.steps.some(step =>
      ["FOUNDER_APPROVAL", "HUMAN_PHYSICAL", "HUMAN_REMOTE"].includes(
        step.authorityClass
      )
    );
  if (p.unknowns.length) {
    const safeToInvestigate = plan.steps.every(
      step =>
        step.authorityClass === "AUTO_READ_ONLY" &&
        step.consequentialDomain === "NONE"
    );
    return safeToInvestigate ? ("CLEAR" as const) : ("UNKNOWN" as const);
  }
  return founderRequired ? ("FOUNDER_REQUIRED" as const) : ("CLEAR" as const);
}

export class PresidentProgramService {
  constructor(
    private readonly pool: Pool,
    private readonly programs: MysqlPresidentProgramStore,
    private readonly intelligence: MysqlPresidentIntelligenceStore
  ) {}

  async selectedCandidate(programId: string): Promise<PresidentCandidateProject> {
    const program = await this.programs.getProgram(programId);
    if (!program?.assessmentId || !program.candidateId)
      throw new Error("President program is not tied to a Stage-1 candidate");
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT p.* FROM president_candidate_projects p
       WHERE p.assessmentId=? AND p.id=? LIMIT 1`,
      [program.assessmentId, program.candidateId]
    );
    if (!rows[0]) throw new Error("Selected President candidate no longer exists");
    return candidateFromRow(rows[0]);
  }

  async selectCandidate(input: {
    assessmentId: string;
    candidateId: string;
    founderId: string;
    policyVersion?: string;
    maxProgramUsd: number;
  }) {
    const policy = await this.programs.getAuthorityPolicy(input.policyVersion);
    if (!policy) throw new Error("President authority policy is not configured");
    if (policy.founderId !== input.founderId)
      throw new Error("Only the configured founder may select a President program");
    if (
      !Number.isFinite(input.maxProgramUsd) ||
      input.maxProgramUsd < 0 ||
      input.maxProgramUsd > 10000
    )
      throw new Error("Invalid President program budget");

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT p.* FROM president_candidate_projects p
       JOIN president_assessments a ON a.id=p.assessmentId
       WHERE p.assessmentId=? AND p.id=? LIMIT 1`,
      [input.assessmentId, input.candidateId]
    );
    if (!rows[0]) throw new Error("President candidate not found");
    const candidate = candidateFromRow(rows[0]);
    if (candidate.status !== "PROPOSED_AWAITING_HUMAN_SELECTION")
      throw new Error("President candidate is not awaiting founder selection");

    const existing = await this.programs.findProgramByCandidate(
      input.assessmentId,
      input.candidateId
    );
    if (existing) return { program: existing, candidate, reused: true };

    const now = new Date().toISOString();
    const program = await this.programs.createProgram({
      id: randomUUID(),
      assessmentId: input.assessmentId,
      candidateId: input.candidateId,
      objectiveRecordId: null,
      title: candidate.title,
      outcome: candidate.resultingCapability,
      state: "SELECTED",
      selectedBy: input.founderId,
      selectedAt: now,
      authorityPolicyVersion: policy.policyVersion,
      maxProgramUsd: input.maxProgramUsd,
      spentUsd: 0,
      currentStepId: null,
      verifiedArtifactId: null,
      blockReason: null,
      stopReason: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.programs.recordEvent({
      programId: program.id,
      eventType: "PROGRAM_SELECTED",
      actorId: input.founderId,
      details: {
        assessmentId: input.assessmentId,
        candidateId: input.candidateId,
        maxProgramUsd: input.maxProgramUsd,
      },
    });
    return { program, candidate, reused: false };
  }

  async applyPlan(input: {
    programId: string;
    plan: PresidentProgramPlanDraft;
    plannerId: string;
    providerRunId?: string | null;
    model?: string | null;
  }) {
    const plan = presidentProgramPlanDraftSchema.parse(input.plan);
    const program = await this.programs.getProgram(input.programId);
    if (!program) throw new Error("President program not found");
    if (!["SELECTED", "PREFLIGHT", "BLOCKED_FOUNDER", "BLOCKED_CAPABILITY"].includes(program.state))
      throw new Error("President program cannot be replanned in its current state");
    const policy = await this.programs.getAuthorityPolicy(
      program.authorityPolicyVersion
    );
    if (!policy) throw new Error("President authority policy disappeared");
    if (
      plan.preflight.estimatedUsd > program.maxProgramUsd ||
      plan.steps.reduce((sum, step) => sum + step.maxUsd, 0) >
        program.maxProgramUsd
    )
      throw new Error("President plan exceeds founder-approved program budget");

    const priorSteps = await this.programs.listSteps(program.id);
    if (priorSteps.some(step => !["CANCELED", "BLOCKED"].includes(step.state)))
      throw new Error("Cannot replace a President plan after execution has begun");

    const result = derivePreflightResult(plan);
    const hasPlanQuestions = plan.founderQuestions.length > 0;
    const requiredFounderDecisions = [
      ...plan.founderQuestions.map(question => question.key),
      ...(!hasPlanQuestions && result === "FOUNDER_REQUIRED"
        ? [`program:${program.id}:preflight`]
        : []),
    ];
    await this.programs.putPreflight({
      programId: program.id,
      ...plan.preflight,
      requiredFounderDecisions,
      result,
      checkedAt: new Date().toISOString(),
    });

    if (result === "FORBIDDEN") {
      const stopped = await this.programs.updateProgram(program.id, {
        state: "STOPPED",
        stopReason: "Program plan attempted a commercial/customer-wide release",
      });
      await this.programs.recordEvent({
        programId: program.id,
        eventType: "PREFLIGHT_FORBIDDEN",
        actorId: input.plannerId,
        details: { providerRunId: input.providerRunId ?? null },
      });
      return { program: stopped, result, steps: [] as PresidentProgramStep[] };
    }

    if (priorSteps.length) {
      for (const prior of priorSteps)
        if (prior.state === "BLOCKED")
          await this.programs.updateStep(prior.id, { state: "CANCELED" });
    }

    const now = new Date().toISOString();
    const steps: PresidentProgramStep[] = [];
    for (let index = 0; index < plan.steps.length; index++) {
      const draft = plan.steps[index];
      const step: PresidentProgramStep = {
        id: randomUUID(),
        programId: program.id,
        sequence: index,
        type: draft.type,
        title: draft.title,
        outcome: draft.outcome,
        acceptanceCriteria: draft.acceptanceCriteria,
        nonGoals: draft.nonGoals,
        requiredEvidence: draft.requiredEvidence,
        authorityClass: draft.authorityClass,
        consequentialDomain: draft.consequentialDomain,
        maxUsd: draft.maxUsd,
        spentUsd: 0,
        executorCapability: draft.executorCapability,
        reviewerCapability: draft.reviewerCapability,
        executorId: null,
        reviewerId: null,
        baseRef: draft.baseRef,
        baseSha: draft.baseSha,
        state: hasPlanQuestions ? "BLOCKED" : "PENDING",
        attemptCount: 0,
        maxAttempts: 3,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        exactArtifactId: null,
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      // Static authority validation catches forbidden/autonomy mistakes now.
      const founderApproved =
        step.authorityClass === "FOUNDER_APPROVAL" ||
        step.authorityClass === "HUMAN_PHYSICAL" ||
        step.authorityClass === "HUMAN_REMOTE";
      assertPresidentStepAuthority(step, policy, founderApproved);
      steps.push(await this.programs.createStep(step));
    }

    const planQuestions = plan.founderQuestions.slice(
      0,
      result === "FOUNDER_REQUIRED" ? 2 : 3
    );
    for (const question of planQuestions) {
      const questionKey = `program:${program.id}:plan:${question.key}`;
      const priorQuestion = await this.programs.findDecisionByKey(questionKey);
      if (priorQuestion?.status === "ANSWERED")
        throw new Error("President planner repeated an already answered founder question");
      await this.programs.createFounderDecision({
        id: randomUUID(),
        programId: program.id,
        stepId: null,
        questionKey,
        question: question.question,
        options: question.options,
        recommendedOption: question.recommendedOption,
        reason: question.reason,
        status: "OPEN",
        answer: null,
        askedAt: now,
        answeredAt: null,
      });
    }

    if (result === "FOUNDER_REQUIRED" && !hasPlanQuestions) {
      await this.programs.createFounderDecision({
        id: randomUUID(),
        programId: program.id,
        stepId: null,
        questionKey: `program:${program.id}:preflight`,
        question:
          "Authorize this bounded President program inside the listed preflight risks and budget?",
        options: ["Approve bounded program", "Revise plan", "Stop program"],
        recommendedOption: "Approve bounded program",
        reason:
          "The plan crosses an authority boundary that President may not approve for itself.",
        status: "OPEN",
        answer: null,
        askedAt: now,
        answeredAt: null,
      });
    }

    const state =
      hasPlanQuestions || result === "FOUNDER_REQUIRED"
        ? "BLOCKED_FOUNDER"
        : result === "CLEAR"
          ? "READY"
          : "BLOCKED_CAPABILITY";
    const updated = await this.programs.updateProgram(program.id, {
      state,
      blockReason:
        hasPlanQuestions
          ? "Founder answer required before President replans"
          : state === "BLOCKED_FOUNDER"
            ? "Founder decision required by preflight"
            : state === "BLOCKED_CAPABILITY"
              ? "Preflight contains unresolved unknowns"
              : null,
      currentStepId: steps[0]?.id ?? null,
    });
    await this.programs.recordEvent({
      programId: program.id,
      eventType: "PROGRAM_PLANNED",
      actorId: input.plannerId,
      details: {
        result,
        providerRunId: input.providerRunId ?? null,
        model: input.model ?? null,
        stepCount: steps.length,
        measurement: plan.measurement,
      },
    });
    return { program: updated, result, steps };
  }

  async answerPlanQuestion(input: {
    decisionId: string;
    answer: string;
    founderId: string;
  }) {
    const policy = await this.programs.getAuthorityPolicy();
    if (!policy || policy.founderId !== input.founderId)
      throw new Error("Only the configured founder may answer President plan questions");
    const decision = await this.programs.answerFounderDecision(
      input.decisionId,
      input.answer
    );
    if (!decision.programId || !decision.questionKey.includes(":plan:"))
      throw new Error("Founder decision is not a President plan question");
    const program = await this.programs.getProgram(decision.programId);
    if (!program) throw new Error("President program not found");
    await this.programs.recordEvent({
      programId: program.id,
      eventType: "PLAN_QUESTION_ANSWERED",
      actorId: input.founderId,
      details: {
        decisionId: decision.id,
        questionKey: decision.questionKey,
        answer: input.answer,
      },
    });
    const remaining = (await this.programs.decisionsForProgram(program.id)).filter(
      item => item.status === "OPEN" && item.questionKey.includes(":plan:")
    );
    return this.programs.updateProgram(program.id, {
      state: remaining.length ? "BLOCKED_FOUNDER" : "SELECTED",
      blockReason: remaining.length
        ? "Additional founder plan questions remain open"
        : "Founder questions answered; President must replan before execution",
    });
  }

  async approvePreflight(input: {
    decisionId: string;
    answer: "Approve bounded program" | "Revise plan" | "Stop program";
    founderId: string;
  }) {
    const policy = await this.programs.getAuthorityPolicy();
    if (!policy || policy.founderId !== input.founderId)
      throw new Error("Only the configured founder may answer President authority decisions");
    const decision = await this.programs.answerFounderDecision(
      input.decisionId,
      input.answer
    );
    if (!decision.programId)
      throw new Error("Founder decision is not tied to a President program");
    const program = await this.programs.getProgram(decision.programId);
    if (!program) throw new Error("President program not found");
    if (input.answer === "Stop program") {
      return this.programs.updateProgram(program.id, {
        state: "STOPPED",
        stopReason: "Founder stopped the program at preflight",
        blockReason: null,
      });
    }
    if (input.answer === "Revise plan") {
      return this.programs.updateProgram(program.id, {
        state: "SELECTED",
        blockReason: "Founder requested a revised program plan",
      });
    }
    const otherOpen = (await this.programs.decisionsForProgram(program.id)).filter(
      item => item.status === "OPEN" && item.id !== decision.id
    );
    if (otherOpen.length)
      return this.programs.updateProgram(program.id, {
        state: "BLOCKED_FOUNDER",
        blockReason: "Additional founder questions remain open",
      });
    await this.programs.recordEvent({
      programId: program.id,
      eventType: "PREFLIGHT_AUTHORIZED",
      actorId: input.founderId,
      details: { decisionId: decision.id },
    });
    return this.programs.updateProgram(program.id, {
      state: "READY",
      blockReason: null,
    });
  }

  async acceptIndependentReview(review: PresidentIndependentReview) {
    const saved = await this.programs.recordReview(review);
    const step = await this.programs.getStep(review.stepId);
    if (!step) throw new Error("Reviewed President step disappeared");
    const program = await this.programs.getProgram(step.programId);
    if (!program) throw new Error("Reviewed President program disappeared");

    if (review.verdict === "PASS") {
      await this.programs.updateStep(step.id, {
        state: "VERIFIED",
        reviewerId: review.reviewerId,
        error: null,
      });
      await this.programs.recordEvent({
        programId: program.id,
        stepId: step.id,
        eventType: "STEP_INDEPENDENTLY_VERIFIED",
        actorId: review.reviewerId,
        details: { exactArtifactId: review.exactArtifactId },
      });
      const steps = await this.programs.listSteps(program.id);
      const remaining = steps.find(
        item => !["VERIFIED", "CANCELED"].includes(item.state)
      );
      if (remaining) {
        return this.programs.updateProgram(program.id, {
          state: "READY",
          currentStepId: remaining.id,
          blockReason: null,
        });
      }
      return this.programs.updateProgram(program.id, {
        state: "VERIFIED_INTERNAL",
        currentStepId: null,
        verifiedArtifactId: review.exactArtifactId,
        blockReason: null,
      });
    }

    if (review.verdict === "REVISE") {
      if (!review.requiredRevision)
        throw new Error("Revision verdict requires an explicit bounded revision");
      await this.programs.updateStep(step.id, {
        state: "PENDING",
        reviewerId: review.reviewerId,
        exactArtifactId: null,
        executorId: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        baseRef: review.exactArtifactId,
        error: `Independent review revision: ${review.requiredRevision}`,
        requiredEvidence: [
          ...step.requiredEvidence,
          `Revision required: ${review.requiredRevision}`,
        ],
      });
      await this.programs.recordEvent({
        programId: program.id,
        stepId: step.id,
        eventType: "STEP_REVISION_REQUIRED",
        actorId: review.reviewerId,
        details: { requiredRevision: review.requiredRevision },
      });
      return this.programs.updateProgram(program.id, {
        state: "REVISION_REQUIRED",
        currentStepId: step.id,
        blockReason: null,
      });
    }

    if (review.verdict === "BLOCK_FOUNDER") {
      await this.programs.updateStep(step.id, {
        state: "BLOCKED",
        reviewerId: review.reviewerId,
      });
      const now = new Date().toISOString();
      await this.programs.createFounderDecision({
        id: randomUUID(),
        programId: program.id,
        stepId: step.id,
        questionKey: `program:${program.id}:step:${step.id}:review-block`,
        question:
          review.requiredRevision ??
          "Independent review found a consequential ambiguity. Continue, revise, or stop?",
        options: ["Continue with bounded revision", "Stop program"],
        recommendedOption: null,
        reason:
          "Independent reviewer determined this decision exceeds President's authority.",
        status: "OPEN",
        answer: null,
        askedAt: now,
        answeredAt: null,
      });
      return this.programs.updateProgram(program.id, {
        state: "BLOCKED_FOUNDER",
        currentStepId: step.id,
        blockReason: "Independent review requires founder judgment",
      });
    }

    await this.programs.updateStep(step.id, {
      state: "FAILED",
      reviewerId: review.reviewerId,
      error: review.requiredRevision ?? "Independent review rejected the work",
    });
    return this.programs.updateProgram(program.id, {
      state: "STOPPED",
      currentStepId: step.id,
      stopReason:
        review.requiredRevision ?? "Independent reviewer rejected the program step",
    });
  }

  async recordMeasuredOutcome(input: {
    programId: string;
    evidenceIds: string[];
    observedOutcome: string;
    success: boolean;
    lesson: string;
    actorId: string;
  }) {
    const program = await this.programs.getProgram(input.programId);
    if (!program) throw new Error("President program not found");
    if (program.state !== "VERIFIED_INTERNAL")
      throw new Error("Only independently verified internal work may enter measurement");
    const evidence = await this.intelligence.evidence(input.evidenceIds);
    if (evidence.length !== new Set(input.evidenceIds).size)
      throw new Error("Measured President outcome requires real durable evidence");

    await this.programs.updateProgram(program.id, { state: "MEASURING" });
    const progress = await this.intelligence.appendCurrent({
      kind: "PROGRESS",
      key: `program:${program.id}:outcome`,
      evidenceIds: input.evidenceIds,
      idempotencyKey: `program:${program.id}:progress:${input.evidenceIds.join(",")}`,
      payload: {
        programId: program.id,
        observedOutcome: input.observedOutcome,
        success: input.success,
        verifiedArtifactId: program.verifiedArtifactId,
      },
    });
    await this.programs.updateProgram(program.id, { state: "LEARNING" });
    const lesson = await this.intelligence.appendCurrent({
      kind: "LESSON",
      key: `program:${program.id}:lesson`,
      evidenceIds: input.evidenceIds,
      idempotencyKey: `program:${program.id}:lesson:${input.evidenceIds.join(",")}`,
      payload: {
        programId: program.id,
        lesson: input.lesson,
        basedOnProgressRecordId: progress.id,
        success: input.success,
      },
    });
    await this.programs.recordEvent({
      programId: program.id,
      eventType: "PROGRAM_MEASURED_AND_LEARNED",
      actorId: input.actorId,
      details: { progressRecordId: progress.id, lessonRecordId: lesson.id },
    });
    const completed = await this.programs.updateProgram(program.id, {
      state: "COMPLETED",
      currentStepId: null,
      blockReason: null,
    });
    return { program: completed, progress, lesson };
  }

  async nightlyBrief(): Promise<PresidentNightlyBrief> {
    const programs = await this.programs.listPrograms(50);
    const questions = await this.programs.openFounderDecisions(3);
    const completed = programs
      .filter(program => program.state === "COMPLETED")
      .slice(0, 5)
      .map(program => program.title);
    const blocked = programs
      .filter(program =>
        ["BLOCKED_FOUNDER", "BLOCKED_CAPABILITY"].includes(program.state)
      )
      .slice(0, 10)
      .map(program => `${program.title}: ${program.blockReason ?? program.state}`);
    const inProgress = programs
      .filter(program =>
        ["READY", "RUNNING", "AWAITING_REVIEW", "REVISION_REQUIRED", "VERIFIED_INTERNAL", "MEASURING", "LEARNING"].includes(
          program.state
        )
      )
      .slice(0, 10)
      .map(program => `${program.title} — ${program.state}`);
    const tomorrow = programs
      .filter(program => !["COMPLETED", "STOPPED"].includes(program.state))
      .slice(0, 5)
      .map(program => `Advance ${program.title} from ${program.state}`);
    return presidentNightlyBriefSchema.parse({
      generatedAt: new Date().toISOString(),
      summary:
        questions.length > 0
          ? `President needs ${questions.length} founder decision${questions.length === 1 ? "" : "s"}; all other eligible work remains delegated.`
          : "No founder decision is currently required; President can continue inside existing authority.",
      completed,
      inProgress,
      blocked,
      questions,
      tomorrow,
    });
  }

  async registerAgentCapability(input: {
    capability: Omit<
      PresidentAgentCapability,
      "status" | "createdAt" | "updatedAt" | "revokedAt"
    >;
    requestedBy: string;
    idempotencyKey: string;
  }) {
    const policy = await this.programs.getAuthorityPolicy();
    if (!policy) throw new Error("President authority policy is not configured");
    const isFounder = input.requestedBy === policy.founderId;
    if (!isFounder) {
      if (
        input.requestedBy !== "seat.president" ||
        input.capability.kind !== "TEMPORARY_SPECIALIST" ||
        !input.capability.programId
      )
        throw new Error("Only founder may create enduring President capabilities");
      const program = await this.programs.getProgram(input.capability.programId);
      if (
        !program ||
        ["SELECTED", "PREFLIGHT", "BLOCKED_FOUNDER", "STOPPED", "COMPLETED"].includes(
          program.state
        )
      )
        throw new Error("Temporary specialist requires an already-authorized active program");
      if (input.capability.maxUsdPerRun > policy.maxAutonomousUsdPerDay)
        throw new Error("Temporary specialist exceeds autonomous policy budget");
    }

    const evidence = await this.intelligence.evidence(input.capability.evidenceIds);
    if (evidence.length !== new Set(input.capability.evidenceIds).size)
      throw new Error("Capability recruitment requires durable supporting evidence");

    if (input.capability.kind === "EXECUTIVE_SEAT") {
      const seat = input.capability.seatRoleKey
        ? await this.programs.getExecutiveSeat(input.capability.seatRoleKey)
        : null;
      if (!seat || !["AUTHORIZED", "ACTIVE"].includes(seat.state))
        throw new Error("Executive capability requires a founder-authorized executive seat");
    }

    for (const skill of input.capability.skillNames)
      if (!executiveSkillCatalog.some(item => item.name === skill))
        throw new Error(`Unknown President capability skill: ${skill}`);

    const now = new Date().toISOString();
    const existing = await this.programs.getAgentCapability(
      input.capability.capabilityKey
    );
    if (existing?.status === "ACTIVE") {
      const same =
        JSON.stringify({
          ...existing,
          createdAt: undefined,
          updatedAt: undefined,
          revokedAt: undefined,
          status: undefined,
        }) ===
        JSON.stringify({
          ...input.capability,
          createdAt: undefined,
          updatedAt: undefined,
          revokedAt: undefined,
          status: undefined,
        });
      if (!same)
        throw new Error("Active President capability cannot be silently redefined");
      return { capability: existing, reused: true };
    }

    const capability = await this.programs.putAgentCapability({
      ...input.capability,
      status: "ACTIVE",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      revokedAt: null,
    });
    const record = await this.intelligence.appendCurrent({
      kind: "CAPABILITY",
      key: capability.capabilityKey,
      evidenceIds: capability.evidenceIds,
      idempotencyKey: input.idempotencyKey,
      payload: {
        capability,
        action: existing ? "REACTIVATED" : "RECRUITED",
        requestedBy: input.requestedBy,
      },
    });
    if (capability.programId)
      await this.programs.recordEvent({
        programId: capability.programId,
        eventType: "SPECIALIST_CAPABILITY_RECRUITED",
        actorId: input.requestedBy,
        details: {
          capabilityKey: capability.capabilityKey,
          actorId: capability.actorId,
          intelligenceRecordId: record.id,
        },
      });
    if (capability.kind === "EXECUTIVE_SEAT" && capability.seatRoleKey) {
      const seat = await this.programs.getExecutiveSeat(capability.seatRoleKey);
      if (seat && seat.state === "AUTHORIZED")
        await this.programs.putExecutiveSeat({
          ...seat,
          state: "ACTIVE",
          provider: capability.targetCapability,
          updatedAt: now,
        });
    }
    return { capability, record, reused: false };
  }

  async evaluateAgentCapability(input: {
    capabilityKey: string;
    evidenceIds: string[];
    verdict: "PASS" | "WATCH" | "REVOKE";
    assessment: string;
    actorId: string;
    idempotencyKey: string;
  }) {
    const capability = await this.programs.getAgentCapability(input.capabilityKey);
    if (!capability) throw new Error("President capability not found");
    const evidence = await this.intelligence.evidence(input.evidenceIds);
    if (evidence.length !== new Set(input.evidenceIds).size)
      throw new Error("Capability evaluation requires durable evidence");
    const evaluation = await this.intelligence.appendCurrent({
      kind: "EVALUATION",
      key: `capability:${input.capabilityKey}`,
      evidenceIds: input.evidenceIds,
      idempotencyKey: input.idempotencyKey,
      payload: {
        capabilityKey: input.capabilityKey,
        verdict: input.verdict,
        assessment: input.assessment,
        actorId: input.actorId,
      },
    });
    if (input.verdict === "REVOKE")
      return {
        evaluation,
        capability: await this.revokeAgentCapability({
          capabilityKey: input.capabilityKey,
          evidenceIds: input.evidenceIds,
          reason: input.assessment,
          actorId: input.actorId,
          idempotencyKey: input.idempotencyKey + ":revoke",
        }),
      };
    return { evaluation, capability };
  }

  async revokeAgentCapability(input: {
    capabilityKey: string;
    evidenceIds: string[];
    reason: string;
    actorId: string;
    idempotencyKey: string;
  }) {
    const policy = await this.programs.getAuthorityPolicy();
    if (!policy) throw new Error("President authority policy is not configured");
    const capability = await this.programs.getAgentCapability(input.capabilityKey);
    if (!capability) throw new Error("President capability not found");
    const isFounder = input.actorId === policy.founderId;
    const canPresidentRevokeTemporary =
      input.actorId === "seat.president" &&
      capability.kind === "TEMPORARY_SPECIALIST";
    if (!isFounder && !canPresidentRevokeTemporary)
      throw new Error("Capability revocation exceeds actor authority");
    const evidence = await this.intelligence.evidence(input.evidenceIds);
    if (evidence.length !== new Set(input.evidenceIds).size)
      throw new Error("Capability revocation requires durable evidence");
    if (capability.status === "REVOKED") return capability;
    const now = new Date().toISOString();
    const revoked = await this.programs.putAgentCapability({
      ...capability,
      status: "REVOKED",
      updatedAt: now,
      revokedAt: now,
    });
    await this.intelligence.appendCurrent({
      kind: "CAPABILITY",
      key: capability.capabilityKey,
      evidenceIds: input.evidenceIds,
      idempotencyKey: input.idempotencyKey,
      payload: {
        capability: revoked,
        action: "REVOKED",
        reason: input.reason,
        actorId: input.actorId,
      },
    });
    if (capability.programId)
      await this.programs.recordEvent({
        programId: capability.programId,
        eventType: "SPECIALIST_CAPABILITY_REVOKED",
        actorId: input.actorId,
        details: { capabilityKey: capability.capabilityKey, reason: input.reason },
      });
    return revoked;
  }

  async proposeExecutiveSeat(input: {
    roleKey: string;
    title: string;
    mandate: string;
    capabilityGap: string;
    skillNames: string[];
    proposedByProgramId?: string | null;
    monthlyBudgetUsd: number;
  }): Promise<{ seat: PresidentExecutiveSeat; decisionId: string }> {
    const catalog = new Set(executiveSkillCatalog.map(skill => skill.name));
    if (
      !input.skillNames.length ||
      input.skillNames.some(name => !catalog.has(name))
    )
      throw new Error("Executive seat may use only reviewed President skills");
    const existing = await this.programs.getExecutiveSeat(input.roleKey);
    if (existing && !["REJECTED", "RETIRED"].includes(existing.state))
      throw new Error("Executive seat role already exists");
    const now = new Date().toISOString();
    const decisionId = randomUUID();
    const seat = presidentExecutiveSeatSchema.parse({
      id: existing?.id ?? randomUUID(),
      roleKey: input.roleKey,
      title: input.title,
      mandate: input.mandate,
      proposedByProgramId: input.proposedByProgramId ?? null,
      capabilityGap: input.capabilityGap,
      skillNames: input.skillNames,
      provider: null,
      monthlyBudgetUsd: input.monthlyBudgetUsd,
      state: "PROPOSED",
      founderDecisionId: decisionId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    await this.programs.putExecutiveSeat(seat);
    await this.programs.createFounderDecision({
      id: decisionId,
      programId: input.proposedByProgramId ?? null,
      stepId: null,
      questionKey: `executive-seat:${input.roleKey}`,
      question: `Want me to recruit a solid ${input.title}?`,
      options: ["Authorize executive agent", "Not now"],
      recommendedOption: "Authorize executive agent",
      reason: input.capabilityGap,
      status: "OPEN",
      answer: null,
      askedAt: now,
      answeredAt: null,
    });
    return { seat, decisionId };
  }

  async authorizeExecutiveSeat(input: {
    roleKey: string;
    decisionId: string;
    founderId: string;
    answer: "Authorize executive agent" | "Not now";
    provider?: string | null;
  }) {
    const policy = await this.programs.getAuthorityPolicy();
    if (!policy || policy.founderId !== input.founderId)
      throw new Error("Only the configured founder may authorize an executive seat");
    const seat = await this.programs.getExecutiveSeat(input.roleKey);
    if (!seat || seat.founderDecisionId !== input.decisionId)
      throw new Error("Executive seat proposal/decision mismatch");
    await this.programs.answerFounderDecision(input.decisionId, input.answer);
    const now = new Date().toISOString();
    return this.programs.putExecutiveSeat({
      ...seat,
      state:
        input.answer === "Authorize executive agent"
          ? input.provider
            ? "ACTIVE"
            : "AUTHORIZED"
          : "REJECTED",
      provider:
        input.answer === "Authorize executive agent"
          ? input.provider ?? null
          : null,
      updatedAt: now,
    });
  }
}
