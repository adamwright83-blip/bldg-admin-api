import { z } from "zod";
import type { PresidentCandidateProject } from "../../shared/presidentContracts";
import {
  presidentProgramPlanDraftSchema,
  type PresidentAuthorityPolicy,
  type PresidentProgram,
  type PresidentProgramPlanDraft,
  type PresidentAgentCapability,
} from "../../shared/presidentOperatingSystem";
import type { PresidentJudgmentProvider } from "./reasoning";

const plannerSystem = (policy: PresidentAuthorityPolicy) => `
You are seat.president planning one already-selected JOYSTICK company/product program.
You are NOT selecting company strategy here. The supplied work item is already selected under the durable authority policy.
Produce the smallest bounded program that can establish its intended outcome.

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
- The final step MUST be MEASURE. Its requiredEvidence must include every measurement.evidenceRequired entry, and its acceptanceCriteria must include measurement.successCondition verbatim. This is what lets President independently verify the outcome instead of stopping at implementation.
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
  selectedWork:
    | { kind: "STAGE1_CANDIDATE"; candidate: PresidentCandidateProject }
    | {
        kind: "STRATEGIC_OBJECTIVE";
        objectiveRecordId: string;
        objective: Record<string, unknown>;
      };
  policy: PresidentAuthorityPolicy;
  provider: PresidentJudgmentProvider;
  repositorySha: string;
  context?: Record<string, unknown>;
  capabilities: PresidentAgentCapability[];
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
      selectedWork: input.selectedWork,
      repositorySha: input.repositorySha,
      companyContext: {
        ...(input.context ?? {}),
        availableCapabilities: input.capabilities.filter(
          capability => capability.status === "ACTIVE"
        ),
      },
    },
    maxUsd: input.maxUsd,
    signal: input.signal,
    outputSchema: z.toJSONSchema(presidentProgramPlanDraftSchema),
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

  const measurementStep = parsed.steps.at(-1);
  if (!measurementStep || measurementStep.type !== "MEASURE")
    throw new Error("President program must end with an independently reviewable MEASURE step");
  if (
    !parsed.measurement.evidenceRequired.every(required =>
      measurementStep.requiredEvidence.includes(required)
    ) ||
    !measurementStep.acceptanceCriteria.includes(parsed.measurement.successCondition)
  )
    throw new Error(
      "President measurement step must carry the declared evidence and success condition"
    );

  const capabilities = new Map(
    input.capabilities
      .filter(capability => capability.status === "ACTIVE")
      .map(capability => [capability.capabilityKey, capability])
  );
  for (const step of parsed.steps) {
    if (["HUMAN_PHYSICAL", "HUMAN_REMOTE"].includes(step.authorityClass))
      continue;
    const executor = capabilities.get(step.executorCapability);
    const reviewer = capabilities.get(step.reviewerCapability);
    if (!executor)
      throw new Error(
        `President plan names unavailable executor capability "${step.executorCapability}"`
      );
    if (!reviewer)
      throw new Error(
        `President plan names unavailable reviewer capability "${step.reviewerCapability}"`
      );
    if (executor.actorId === reviewer.actorId)
      throw new Error("President plan cannot assign executor and reviewer to the same actor");
    if (
      !executor.authorityClasses.includes(step.authorityClass) ||
      !executor.consequentialDomains.includes(step.consequentialDomain) ||
      step.maxUsd > executor.maxUsdPerRun
    )
      throw new Error(
        `President executor capability "${step.executorCapability}" is outside its durable authority scope`
      );
    if (
      !reviewer.authorityClasses.includes("AUTO_READ_ONLY") ||
      !reviewer.consequentialDomains.includes("NONE")
    )
      throw new Error(
        `President reviewer capability "${step.reviewerCapability}" lacks read-only independent-review scope`
      );
  }

  return {
    plan: parsed,
    providerRunId: response.providerRunId,
    model: response.model,
    costUsd: response.costUsd,
  };
}
