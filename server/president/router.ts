import type { RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { ENV } from "../_core/env";
import { MysqlPresidentAssessmentStore } from "./mysqlStore";
import { MysqlPresidentIntelligenceStore } from "./intelligenceStore";
import {
  companyEvidenceSchema,
  intelligenceRecordKinds,
} from "../../shared/presidentIntelligence";
import { executiveSkillCatalog } from "./skillRouter";
import { presidentPool } from "./database";
import { MysqlPresidentProgramStore } from "./programStore";
import { PresidentProgramService } from "./programService";
import { planPresidentProgram } from "./programPlanner";
import { AppPresidentJudgmentProvider } from "./appProvider";
import { AnthropicWebSearchPresidentProvider } from "./webResearchProvider";
import { reasonAboutCompany } from "./reasoning";
import { researchCompanyQuestion, researchPlanSchema } from "./research";
import { getPresidentRuntime, presidentRuntimeStatus } from "./runtime";
import { getPresidentCycleRuntime, presidentCycleReadiness } from "./cycle/runtime";
import { buildPresidentMorningReport } from "./fabric/morningReport";
import {
  PRESIDENT_AUTHORITY_CLASSES,
  PRESIDENT_CONSEQUENTIAL_DOMAINS,
} from "../../shared/presidentOperatingSystem";

function database() {
  try {
    return presidentPool();
  } catch (error) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "President durable database unavailable",
    });
  }
}

function operatingServices() {
  const pool = database();
  const programs = new MysqlPresidentProgramStore(pool);
  const intelligence = new MysqlPresidentIntelligenceStore(pool);
  return {
    pool,
    programs,
    intelligence,
    service: new PresidentProgramService(pool, programs, intelligence),
  };
}

export const founderProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ENV.ownerOpenId || ctx.user.openId !== ENV.ownerOpenId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "President is available only to the configured JOYSTICK founder",
    });
  return next({ ctx });
});

export const presidentRouter = router({
  state: founderProcedure.query(async () => {
    const pool = database();
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT inspectedRepositorySha,evidenceSnapshotId FROM president_assessments ORDER BY completedAt DESC LIMIT 1"
    );
    const assessment = rows[0]
      ? await new MysqlPresidentAssessmentStore(pool).findByEvidence(
          rows[0].inspectedRepositorySha,
          rows[0].evidenceSnapshotId
        )
      : null;
    const intelligence = new MysqlPresidentIntelligenceStore(pool);
    const programs = new MysqlPresidentProgramStore(pool);
    const strategies = (await intelligence.list("STRATEGY", 20)).filter(
      record =>
        record.payload.status === "ACCEPTED" &&
        record.payload.policyVersion === "source-excerpt-v4"
    );
    const acceptedStrategyIds = new Set(strategies.map(record => record.id));
    return {
      seat: "seat.president" as const,
      assessment,
      strategies,
      thesis: (await intelligence.listCurrent("THESIS", 20)).filter(record =>
        acceptedStrategyIds.has(String(record.payload.strategyRecordId))
      ),
      objectives: (await intelligence.listCurrent("OBJECTIVE", 20)).filter(
        record =>
          acceptedStrategyIds.has(String(record.payload.strategyRecordId))
      ),
      metrics: await intelligence.listCurrent("METRIC", 30),
      research: await intelligence.list("RESEARCH", 20),
      capabilities: await intelligence.list("CAPABILITY", 20),
      progress: await intelligence.list("PROGRESS", 20),
      programs: await programs.listPrograms(50),
      executiveSeats: await programs.listExecutiveSeats(),
      agentCapabilities: await programs.listAgentCapabilities(),
      skills: executiveSkillCatalog,
      ...presidentRuntimeStatus(),
    };
  }),

  founderSurface: founderProcedure.query(async () => {
    const { programs, service, intelligence } = operatingServices();
    const objectives = await intelligence.listCurrent("OBJECTIVE", 20);
    const thesis = await intelligence.listCurrent("THESIS", 12);
    const research = await intelligence.list("RESEARCH", 10);
    const work = await programs.listPrograms(20);
    const events = (
      await Promise.all(work.slice(0, 5).map(p => programs.listEvents(p.id)))
    )
      .flat()
      .slice(-20);
    const evidenceIds = [
      ...new Set(
        [...objectives, ...thesis, ...research].flatMap(r => r.evidenceIds)
      ),
    ].slice(0, 50);
    return {
      runtime: presidentRuntimeStatus(),
      brief: await service.nightlyBrief(),
      objectives,
      thesis,
      research,
      programs: work,
      evidence: await intelligence.evidence(evidenceIds),
      events,
    };
  }),

  operatingState: founderProcedure.query(async () => {
    const { programs, service } = operatingServices();
    return {
      runtime: presidentRuntimeStatus(),
      programs: await programs.listPrograms(50),
      founderDecisions: await programs.openFounderDecisions(3),
      executiveSeats: await programs.listExecutiveSeats(),
      agentCapabilities: await programs.listAgentCapabilities(),
      nightlyBrief: await service.nightlyBrief(),
    };
  }),

  program: founderProcedure
    .input(z.object({ id: z.string().uuid() }).strict())
    .query(async ({ input }) => {
      const { programs } = operatingServices();
      const program = await programs.getProgram(input.id);
      if (!program)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "President program not found",
        });
      return {
        program,
        preflight: await programs.getPreflight(input.id),
        steps: await programs.listSteps(input.id),
        events: await programs.listEvents(input.id),
        decisions: await programs.decisionsForProgram(input.id),
      };
    }),

  configureAuthority: founderProcedure
    .input(
      z
        .object({
          policyVersion: z.string().min(1).max(64),
          internalMergeAllowed: z.boolean().default(false),
          internalDeployAllowed: z.boolean().default(false),
          maxAutonomousUsdPerDay: z.number().min(0).max(1000),
          autonomousProgramSelectionAllowed: z.boolean().default(false),
          allowedRepositories: z.array(z.string().min(1)).max(20),
          allowedEnvironments: z.array(z.string().min(1)).max(20),
          prohibitedDomains: z
            .array(z.enum(PRESIDENT_CONSEQUENTIAL_DOMAINS))
            .max(50),
        })
        .strict()
    )
    .mutation(async ({ input, ctx }) => {
      const { programs } = operatingServices();
      return programs.putAuthorityPolicy({
        ...input,
        founderId: ctx.user.openId,
        updatedAt: new Date().toISOString(),
      });
    }),

  selectCandidate: founderProcedure
    .input(
      z
        .object({
          assessmentId: z.string().min(1).max(64),
          candidateId: z.string().min(1).max(64),
          policyVersion: z.string().min(1).max(64).optional(),
          maxProgramUsd: z.number().min(0).max(10000),
        })
        .strict()
    )
    .mutation(async ({ input, ctx }) =>
      operatingServices().service.selectCandidate({
        ...input,
        founderId: ctx.user.openId,
      })
    ),

  planProgram: founderProcedure
    .input(
      z
        .object({
          programId: z.string().uuid(),
          maxReasoningUsd: z.number().positive().max(2).default(1),
        })
        .strict()
    )
    .mutation(async ({ input }) => {
      const { pool, programs, service } = operatingServices();
      const program = await programs.getProgram(input.programId);
      if (!program)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "President program not found",
        });
      const selectedWork = await service.selectedWork(program.id);
      const policy = await programs.getAuthorityPolicy(
        program.authorityPolicyVersion
      );
      if (!policy) throw new Error("President authority policy disappeared");
      const [rows] = program.assessmentId
        ? await pool.execute<RowDataPacket[]>(
            "SELECT inspectedRepositorySha FROM president_assessments WHERE id=? LIMIT 1",
            [program.assessmentId]
          )
        : await pool.execute<RowDataPacket[]>(
            "SELECT inspectedRepositorySha FROM president_assessments ORDER BY completedAt DESC LIMIT 1"
          );
      const plan = await planPresidentProgram({
        program,
        selectedWork,
        policy,
        provider: new AppPresidentJudgmentProvider(),
        repositorySha: rows[0]?.inspectedRepositorySha ?? null,
        context: {
          founderDecisions: await programs.decisionsForProgram(program.id),
        },
        capabilities: await programs.listAgentCapabilities(),
        maxUsd: input.maxReasoningUsd,
      });
      const applied = await service.applyPlan({
        programId: program.id,
        plan: plan.plan,
        plannerId: "seat.president",
        providerRunId: plan.providerRunId,
        model: plan.model,
      });
      return { ...plan, applied };
    }),

  requestObjectiveSelection: founderProcedure
    .input(z.object({ objectiveRecordId: z.string().uuid() }).strict())
    .mutation(({ input }) =>
      operatingServices().service.requestObjectiveSelectionDecision(input)
    ),

  answerObjectiveSelection: founderProcedure
    .input(
      z
        .object({
          decisionId: z.string().uuid(),
          answer: z.enum([
            "Authorize this program",
            "Not now",
            "Stop objective",
          ]),
          maxProgramUsd: z.number().min(0).max(10000),
        })
        .strict()
    )
    .mutation(({ input, ctx }) =>
      operatingServices().service.answerObjectiveSelectionDecision({
        ...input,
        founderId: ctx.user.openId,
      })
    ),

  answerPlanQuestion: founderProcedure
    .input(
      z
        .object({
          decisionId: z.string().uuid(),
          answer: z.string().min(1).max(512),
        })
        .strict()
    )
    .mutation(({ input, ctx }) =>
      operatingServices().service.answerPlanQuestion({
        ...input,
        founderId: ctx.user.openId,
      })
    ),

  approvePreflight: founderProcedure
    .input(
      z
        .object({
          decisionId: z.string().uuid(),
          answer: z.enum([
            "Approve bounded program",
            "Revise plan",
            "Stop program",
          ]),
        })
        .strict()
    )
    .mutation(({ input, ctx }) =>
      operatingServices().service.approvePreflight({
        ...input,
        founderId: ctx.user.openId,
      })
    ),

  dispatchNext: founderProcedure.mutation(async () => {
    try {
      return await getPresidentRuntime().coordinator.dispatchNext();
    } catch (error) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "President runtime unavailable",
      });
    }
  }),

  nightlyBrief: founderProcedure.query(() =>
    operatingServices().service.nightlyBrief()
  ),

  reason: founderProcedure
    .input(
      z
        .object({
          question: z.string().min(1).max(16000),
          evidenceIds: z.array(z.string().min(1).max(64)).min(1).max(50),
          requestKey: z.string().min(1).max(191),
          maxUsd: z.number().positive().max(2).default(1),
          consequential: z.boolean().default(false),
          admittedCandidateIds: z
            .array(z.string().min(1).max(64))
            .max(20)
            .default([]),
        })
        .strict()
    )
    .mutation(async ({ input }) => {
      const { intelligence } = operatingServices();
      const evidence = await intelligence.evidence(input.evidenceIds);
      if (evidence.length !== new Set(input.evidenceIds).size)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "President evidence IDs are incomplete",
        });
      return reasonAboutCompany({
        question: input.question,
        evidence,
        context: { requestedBy: "founder" },
        provider: new AppPresidentJudgmentProvider(),
        store: intelligence,
        maxUsd: input.maxUsd,
        requestKey: input.requestKey,
        consequential: input.consequential,
        admittedCandidateIds: input.admittedCandidateIds,
      });
    }),

  research: founderProcedure
    .input(
      z
        .object({
          plan: researchPlanSchema,
          requestKey: z.string().min(1).max(191),
        })
        .strict()
    )
    .mutation(({ input }) =>
      researchCompanyQuestion({
        plan: input.plan,
        provider: new AnthropicWebSearchPresidentProvider(),
        store: operatingServices().intelligence,
        requestKey: input.requestKey,
      })
    ),

  registerAgentCapability: founderProcedure
    .input(
      z
        .object({
          capabilityKey: z.string().min(1).max(191),
          kind: z.enum(["BUILTIN", "TEMPORARY_SPECIALIST", "EXECUTIVE_SEAT"]),
          actorId: z.string().min(1).max(191),
          targetCapability: z.string().min(1).max(191),
          seatRoleKey: z.string().min(1).max(128).nullable(),
          programId: z.string().uuid().nullable(),
          skillNames: z.array(z.string().min(1)).max(20),
          authorityClasses: z
            .array(z.enum(PRESIDENT_AUTHORITY_CLASSES))
            .min(1)
            .max(7),
          consequentialDomains: z
            .array(z.enum(PRESIDENT_CONSEQUENTIAL_DOMAINS))
            .min(1)
            .max(9),
          maxUsdPerRun: z.number().min(0).max(1000),
          evidenceIds: z.array(z.string().min(1).max(64)).min(1).max(50),
          justification: z.string().min(1).max(4000),
          idempotencyKey: z.string().min(1).max(191),
        })
        .strict()
    )
    .mutation(({ input, ctx }) => {
      const { idempotencyKey, ...capability } = input;
      return operatingServices().service.registerAgentCapability({
        capability,
        requestedBy: ctx.user.openId,
        idempotencyKey,
      });
    }),

  evaluateAgentCapability: founderProcedure
    .input(
      z
        .object({
          capabilityKey: z.string().min(1).max(191),
          evidenceIds: z.array(z.string().min(1).max(64)).min(1).max(50),
          verdict: z.enum(["PASS", "WATCH", "REVOKE"]),
          assessment: z.string().min(1).max(8000),
          idempotencyKey: z.string().min(1).max(191),
        })
        .strict()
    )
    .mutation(({ input, ctx }) =>
      operatingServices().service.evaluateAgentCapability({
        ...input,
        actorId: ctx.user.openId,
      })
    ),

  revokeAgentCapability: founderProcedure
    .input(
      z
        .object({
          capabilityKey: z.string().min(1).max(191),
          evidenceIds: z.array(z.string().min(1).max(64)).min(1).max(50),
          reason: z.string().min(1).max(8000),
          idempotencyKey: z.string().min(1).max(191),
        })
        .strict()
    )
    .mutation(({ input, ctx }) =>
      operatingServices().service.revokeAgentCapability({
        ...input,
        actorId: ctx.user.openId,
      })
    ),

  proposeExecutiveSeat: founderProcedure
    .input(
      z
        .object({
          roleKey: z.string().min(1).max(128),
          title: z.string().min(1).max(191),
          mandate: z.string().min(1).max(4000),
          capabilityGap: z.string().min(1).max(4000),
          skillNames: z.array(z.string().min(1)).min(1).max(12),
          proposedByProgramId: z.string().uuid().nullable().optional(),
          monthlyBudgetUsd: z.number().min(0).max(100000),
        })
        .strict()
    )
    .mutation(({ input }) =>
      operatingServices().service.proposeExecutiveSeat(input)
    ),

  authorizeExecutiveSeat: founderProcedure
    .input(
      z
        .object({
          roleKey: z.string().min(1).max(128),
          decisionId: z.string().uuid(),
          answer: z.enum(["Authorize executive agent", "Not now"]),
          provider: z.string().min(1).max(191).nullable().optional(),
        })
        .strict()
    )
    .mutation(({ input, ctx }) =>
      operatingServices().service.authorizeExecutiveSeat({
        ...input,
        founderId: ctx.user.openId,
      })
    ),

  recordMeasuredOutcome: founderProcedure
    .input(
      z
        .object({
          programId: z.string().uuid(),
          evidenceIds: z.array(z.string().min(1).max(64)).min(1).max(50),
          observedOutcome: z.string().min(1).max(8000),
          success: z.boolean(),
          lesson: z.string().min(1).max(8000),
        })
        .strict()
    )
    .mutation(({ input, ctx }) =>
      operatingServices().service.recordMeasuredOutcome({
        ...input,
        actorId: ctx.user.openId,
      })
    ),

  evidence: founderProcedure
    .input(
      z.object({ ids: z.array(z.string().max(64)).min(1).max(50) }).strict()
    )
    .query(({ input }) =>
      new MysqlPresidentIntelligenceStore(database()).evidence(input.ids)
    ),

  ingestEvidence: founderProcedure
    .input(companyEvidenceSchema)
    .mutation(({ input }) =>
      new MysqlPresidentIntelligenceStore(database()).putEvidence(input)
    ),

  cycleReadiness: founderProcedure.query(() => presidentCycleReadiness()),

  latestCycle: founderProcedure.query(async () => {
    const runtime = getPresidentCycleRuntime();
    const cycle = await runtime.store.latestCycle();
    return {
      cycle,
      missions: cycle ? await runtime.store.listMissions(cycle.id) : [],
    };
  }),

  startImprovementCycle: founderProcedure
    .input(
      z
        .object({
          evidenceIds: z
            .array(z.string().min(1).max(64))
            .min(1)
            .max(50)
            .optional(),
        })
        .strict()
    )
    .mutation(async ({ input }) => {
      try {
        const service = getPresidentCycleRuntime().service;
        return input.evidenceIds
          ? await service.createAndDeliberate(input.evidenceIds)
          : await service.startFromCurrentCompanyTruth();
      } catch (error) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "President deliberation failed",
        });
      }
    }),

  cycleOtherSeven: founderProcedure
    .input(z.object({ cycleId: z.string().uuid() }).strict())
    .query(({ input }) =>
      getPresidentCycleRuntime().service.otherSeven(input.cycleId)
    ),

  approveImprovementCycle: founderProcedure
    .input(
      z
        .object({
          cycleId: z.string().uuid(),
          approvedCandidateIds: z
            .array(z.string().min(1).max(96))
            .min(1)
            .max(3),
        })
        .strict()
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await getPresidentCycleRuntime().service.approve({
          cycleId: input.cycleId,
          approvedCandidateIds: input.approvedCandidateIds,
          founderId: ctx.user.openId,
        });
      } catch (error) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "President approval failed",
        });
      }
    }),

  runApprovedCycle: founderProcedure
    .input(z.object({ cycleId: z.string().uuid() }).strict())
    .mutation(async ({ input }) => {
      try {
        return await getPresidentCycleRuntime().runner.runApprovedCycle(
          input.cycleId
        );
      } catch (error) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "President overnight execution failed",
        });
      }
    }),

  cycleMorningReport: founderProcedure
    .input(z.object({ cycleId: z.string().uuid() }).strict())
    .query(({ input }) => {
      const runtime = getPresidentCycleRuntime();
      return buildPresidentMorningReport(runtime.store, input.cycleId);
    }),

  ledger: founderProcedure
    .input(
      z
        .object({
          kind: z.enum(intelligenceRecordKinds),
          limit: z.number().int().min(1).max(100).default(30),
        })
        .strict()
    )
    .query(({ input }) =>
      new MysqlPresidentIntelligenceStore(database()).list(
        input.kind,
        input.limit
      )
    ),
});
