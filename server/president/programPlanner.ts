import { z } from "zod";
import type { PresidentCandidateProject } from "../../shared/presidentContracts";
import {
  presidentProgramPlanDraftSchema,
  type PresidentAuthorityPolicy,
  type PresidentProgram,
  type PresidentProgramPlanDraft,
} from "../../shared/presidentOperatingSystem";
import type { PresidentJudgmentProvider } from "./reasoning";

const plannerSystem = (policy: PresidentAuthorityPolicy) => `
You are seat.president planning one already-selected JOYSTICK company/product program.
You are NOT selecting the company strategy here; the founder already selected the candidate.
Produce the smallest bounded program that can establish the candidate's resulting capability.

Hard authority:
- No commercial/customer-wide release.
- No destructive production-data operation, billing mutation, credential mutation, DNS mutation, legal commitment, customer impact, or external spend may be treated as autonomous.
- If a step requires one of those, label its authority FOUNDER_APPROVAL, HUMAN_REMOTE, or HUMAN_PHYSICAL and name the consequential domain.
- AUTO_READ_ONLY means observation only.
- AUTO_SANDBOX means a reversible isolated/test environment only.
- STANDING_AUTHORIZATION is legal only inside this supplied policy.
- FORBIDDEN is allowed in the plan only to explicitly reject an action; do not create an executable forbidden step.
- Internal merge/deploy must respect policy flags.
- Games implementation belongs to Mitch. President may create a company-level dependency/brief, not direct game mechanics.
- Every implementation step must have exact acceptance criteria, non-goals, required evidence, an independent reviewer capability, rollback instructions in preflight, and a bounded USD ceiling.
- Never infer secrets, production status, pricing authority, customer facts, or successful execution.
- Research and evidence collection do not authorize adoption.
- Keep founder questions to 0–3 and only ask decisions that block material progress.

Authority policy:
${JSON.stringify(policy)}

Reply ONLY with JSON matching this schema:
${JSON.stringify(z.toJSONSchema(presidentProgramPlanDraftSchema))}
`;

export async function planPresidentProgram(input: {
  program: PresidentProgram;
  candidate: PresidentCandidateProject;
  policy: PresidentAuthorityPolicy;
  provider: PresidentJudgmentProvider;
  repositorySha: string;
  context?: Record<string, unknown>;
  maxUsd: number;
  signal?: AbortSignal;
}): Promise<{
  plan: PresidentProgramPlanDraft;
  providerRunId: string;
  model: string;
  costUsd: number | null;
}> {
  if (input.maxUsd <= 0 || input.maxUsd > 2)
    throw new Error("President planning requires a bounded <=$2 reasoning budget");
  const response = await input.provider.judge({
    question:
      "Create the bounded execution plan for the already-selected President program.",
    system: plannerSystem(input.policy),
    evidence: [],
    context: {
      program: input.program,
      selectedCandidate: input.candidate,
      repositorySha: input.repositorySha,
      companyContext: input.context ?? {},
    },
    maxUsd: input.maxUsd,
    signal: input.signal,
  });
  const parsed = presidentProgramPlanDraftSchema.parse(
    JSON.parse(
      response.text
        .trim()
        .replace(/^\`\`\`(?:json)?\s*/, "")
        .replace(/\s*\`\`\`$/, "")
    )
  );

  if (parsed.preflight.commercialRelease)
    throw new Error("President planner attempted to include commercial release");
  if (
    parsed.preflight.estimatedUsd > input.program.maxProgramUsd ||
    parsed.steps.reduce((sum, step) => sum + step.maxUsd, 0) >
      input.program.maxProgramUsd
  )
    throw new Error("President plan exceeds founder-approved program budget");
  if (
    parsed.steps.some(
      step =>
        step.consequentialDomain === "COMMERCIAL_RELEASE" ||
        step.authorityClass === "FORBIDDEN"
    )
  )
    throw new Error("President plan contains a non-executable forbidden step");

  return {
    plan: parsed,
    providerRunId: response.providerRunId,
    model: response.model,
    costUsd: response.costUsd,
  };
}
