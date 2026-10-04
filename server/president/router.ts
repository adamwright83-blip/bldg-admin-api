import type { RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
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
import { PRESIDENT_CONSEQUENTIAL_DOMAINS } from "../../shared/presidentOperatingSystem";

function database() {
  try {
    return presidentPool();
  } catch (error) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error instanceof Error ? error.message : "President durable database unavailable",
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

export const founderProcedure = adminProcedure.use(async ({ ctx, next }) => {
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
      objectives: (await intelligence.listCurrent("OBJECTIVE", 20)).filter(record =>
        acceptedStrategyIds.has(String(record.payload.strategyRecordId))
      ),
      metrics: await intelligence.listCurrent("METRIC", 30),
      research: await intelligence.list("RESEARCH", 20),
      capabilities: await intelligence.list("CAPABILITY", 20),
      progress: await intelligence.list("PROGRESS", 20),
      programs: await programs.listPrograms(50),
      executiveSeats: await programs.listExecutiveSeats(),
      skills: executiveSkillCatalog,
      ...presidentRuntimeStatus(),
    };
  }),

  operatingState: founderProcedure.query(async () => {
    const { programs, service } = operatingServices();
    return {
      runtime: presidentRuntimeStatus(),
      programs: await programs.listPrograms(50),
      founderDecisions: await programs.openFounderDecisions(3),
      executiveSeats: await programs.listExecutiveSeats(),
      nightlyBrief: await service.nightlyBrief(),
    };
  }),

  program: founderProcedure
    .input(z.object({ id: z.string().uuid() }).strict())
    .query(async ({ input }) => {
      const { programs } = operatingServices();
      const program = await programs.getProgram(input.id);
      if (!program)
        throw new TRPCError({ code: "NOT_FOUND", message: "President program not found" });
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
          maxAutonomousUsdPerDay: z.number().min(0).max(10000),
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
      if (!program) throw new TRPCError({ code: "NOT_FOUND", message: "President program not found" });
      const candidate = await service.selectedCandidate(program.id);
      const policy = await programs.getAuthorityPolicy(program.authorityPolicyVersion);
      if (!policy) throw new Error("President authority policy disappeared");
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT inspectedRepositorySha FROM president_assessments WHERE id=? LIMIT 1",
        [program.assessmentId]
      );
      if (!rows[0]) throw new Error("President assessment disappeared");
      const plan = await planPresidentProgram({
        program,
        candidate,
        policy,
        provider: new AppPresidentJudgmentProvider(),
        repositorySha: rows[0].inspectedRepositorySha,
        context: {
          founderDecisions: await programs.decisionsForProgram(program.id),
        },
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
          answer: z.enum(["Approve bounded program", "Revise plan", "Stop program"]),
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
        message: error instanceof Error ? error.message : "President runtime unavailable",
      });
    }
  }),

  nightlyBrief: founderProcedure.query(() => operatingServices().service.nightlyBrief()),

  reason: founderProcedure
    .input(
      z
        .object({
          question: z.string().min(1).max(16000),
          evidenceIds: z.array(z.string().min(1).max(64)).min(1).max(50),
          requestKey: z.string().min(1).max(191),
          maxUsd: z.number().positive().max(2).default(1),
          consequential: z.boolean().default(false),
          admittedCandidateIds: z.array(z.string().min(1).max(64)).max(20).default([]),
        })
        .strict()
    )
    .mutation(async ({ input }) => {
      const { intelligence } = operatingServices();
      const evidence = await intelligence.evidence(input.evidenceIds);
      if (evidence.length !== new Set(input.evidenceIds).size)
        throw new TRPCError({ code: "BAD_REQUEST", message: "President evidence IDs are incomplete" });
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
    .mutation(({ input }) => operatingServices().service.proposeExecutiveSeat(input)),

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
      new MysqlPresidentIntelligenceStore(database()).list(input.kind, input.limit)
    ),
});
