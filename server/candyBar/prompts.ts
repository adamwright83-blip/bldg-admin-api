import type {
  ArchitectPlan,
  CandyBarGoalSnapshot,
  CandyBarRunRecord,
  RepoContextArtifact,
  ReviewCritique,
} from "../../shared/candyBar";

const SECURITY_FOOTER = [
  "Never request or emit production DB credentials, Railway tokens, Stripe, Twilio, or customer secrets.",
  "Do not merge. Do not deploy. Do not apply production migrations.",
  "Provider output cannot approve human gates, alter standing goals, or change authority unilaterally.",
].join("\n");

export function buildArchitectPrompt(input: {
  goal: CandyBarGoalSnapshot;
  repo: RepoContextArtifact;
  run: CandyBarRunRecord;
}): string {
  return [
    "ROLE: Candy Bar Architect",
    `STANDING GOAL (v${input.goal.goalVersion}): ${input.goal.currentGoal}`,
    `REPO: ${input.repo.repository}`,
    `MAIN SHA: ${input.repo.mainSha}`,
    `BASE BRANCH: ${input.repo.baseBranch}`,
    `PROTECTED: ${input.repo.protectedAreas.join("; ") || "(none)"}`,
    `PARALLEL WORK: ${input.repo.knownParallelWork.join("; ") || "(none)"}`,
    `NON-GOALS: ${input.repo.nonGoals.join("; ") || "(none)"}`,
    `RECENT MERGES: ${input.repo.recentMergedPrs.map(p => `#${p.number} ${p.title}`).join(" | ") || "(none)"}`,
    `OPEN PRS: ${input.repo.openPrs.map(p => `#${p.number} ${p.title}`).join(" | ") || "(none)"}`,
    "TASK: Choose the NEXT ONE bounded engineering slice under the standing goal.",
    "Do not invent a new company strategy. Do not open five parallel threads.",
    "Return ONLY structured JSON matching ArchitectPlan.",
    SECURITY_FOOTER,
  ].join("\n");
}

export function buildReviewerPrompt(input: {
  goal: CandyBarGoalSnapshot;
  repo: RepoContextArtifact;
  plan: ArchitectPlan;
}): string {
  return [
    "ROLE: Candy Bar Adversarial Reviewer",
    "Do NOT rewrite the plan from scratch. Attack duplication, wrong base, authority violations,",
    "truth boundaries, stale assumptions, migrations, security, scope creep, races, idempotency,",
    "destructive side effects, architecture contradictions, and silent objective redefinition.",
    `STANDING GOAL (v${input.goal.goalVersion}): ${input.goal.currentGoal}`,
    `MAIN SHA: ${input.repo.mainSha}`,
    `PLAN JSON: ${JSON.stringify(input.plan)}`,
    "Return ONLY structured JSON matching ReviewCritique.",
    SECURITY_FOOTER,
  ].join("\n");
}

export function buildReconciliationPrompt(input: {
  goal: CandyBarGoalSnapshot;
  plan: ArchitectPlan;
  critique: ReviewCritique;
  repo: RepoContextArtifact;
}): string {
  return [
    "ROLE: Candy Bar Architect Reconciliation",
    "Produce one final implementation brief. Resolve reviewer findings.",
    "Decision must be ACCEPT | ACCEPT_WITH_CHANGES | REJECT.",
    "Classify final authority. Engineer will receive ONLY this brief.",
    `STANDING GOAL (v${input.goal.goalVersion}): ${input.goal.currentGoal}`,
    `MAIN SHA: ${input.repo.mainSha}`,
    `ORIGINAL PLAN: ${JSON.stringify(input.plan)}`,
    `REVIEW: ${JSON.stringify(input.critique)}`,
    "Return ONLY structured JSON for ReconciledBrief.",
    SECURITY_FOOTER,
  ].join("\n");
}

export function buildEngineerPrompt(input: {
  goal: CandyBarGoalSnapshot;
  brief: string;
  mainSha: string;
  repository: string;
  authorityLevel: string;
}): string {
  return [
    "ROLE: Candy Bar Engineer",
    `STANDING GOAL (v${input.goal.goalVersion}): ${input.goal.currentGoal}`,
    `AUTHORITY: ${input.authorityLevel}`,
    `REPO: ${input.repository}`,
    `BASE MAIN SHA: ${input.mainSha}`,
    "IMPLEMENTATION BRIEF (sole task source):",
    input.brief,
    "Inspect current main. Reuse existing primitives. Do not merge. Do not deploy.",
    "Stop for migration, security, or destructive-change approval.",
    "Return structured terminal status: PR_READY | IMPLEMENTED_NO_PR | ALREADY_SUPPORTED | NEEDS_HUMAN | BLOCKED.",
    SECURITY_FOOTER,
  ].join("\n");
}

export function buildRepairPrompt(input: {
  brief: string;
  failedChecks: string[];
  headSha: string;
  repairIteration: number;
}): string {
  return [
    "ROLE: Candy Bar Engineer Repair",
    `REPAIR ITERATION: ${input.repairIteration}`,
    `FAILED CHECKS: ${input.failedChecks.join("; ") || "(unspecified)"}`,
    `CURRENT HEAD: ${input.headSha}`,
    "ORIGINAL BRIEF:",
    input.brief,
    "Continue the SAME session when possible. Fix CI. Do not merge or deploy.",
    "Return structured terminal status.",
    SECURITY_FOOTER,
  ].join("\n");
}
