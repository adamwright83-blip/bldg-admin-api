import type {
  MitchDirectorDiagnosis,
  MitchDirectorObservation,
  MitchExperimentPlan,
  MitchGameModel,
} from "../../shared/mitchDirectorContracts";

export type MitchDirectorViolation = {
  rule: string;
  message: string;
};

export type MitchDirectorGateResult = {
  allowed: boolean;
  violations: MitchDirectorViolation[];
};

const LLM_ONLY = new Set([
  "coding_agent_intuition",
  "llm_design_opinion",
  "agent_consensus",
  "automated_gameplay_script",
]);

const GENERALIZATION_TERMS = [
  "crafting system",
  "crafting tree",
  "inventory system",
  "recipe system",
  "object language",
  "systemize",
  "generalize",
];

const RETENTION_HACK_TERMS = ["streak", "daily penalty", "loss aversion", "fake urgency"];

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function containsAny(value: string, terms: readonly string[]): boolean {
  const text = norm(value);
  return terms.some(term => text.includes(norm(term)));
}

function proposedText(plan: MitchExperimentPlan): string {
  return [
    plan.smallestDiscriminatingProbe,
    ...plan.proposedAssets,
    ...plan.nonGoals,
  ].join(" ");
}

export function classifyStructuredObservation(
  observation: MitchDirectorObservation
): MitchDirectorDiagnosis {
  const humanEvidence =
    observation.evidenceKinds.includes("founder_playtest") ||
    observation.evidenceKinds.includes("naive_first_time") ||
    observation.evidenceKinds.includes("repeated_naive_pattern") ||
    observation.evidenceKinds.includes("observed_behavior");

  if (!humanEvidence) return "insufficient_evidence";

  if (
    observation.technicalEffectProduced === false ||
    observation.performanceStable === false
  ) {
    return "technical_limitation";
  }

  if (observation.formedIntention === false) return "ux_discoverability";

  if (
    observation.formedIntention === true &&
    observation.producedExpectedEffect === false
  ) {
    return "implementation_bug";
  }

  if (
    observation.producedExpectedEffect === true &&
    observation.voluntarilyRepeated === false
  ) {
    return "core_loop";
  }

  if (
    observation.voluntarilyRepeated === true &&
    observation.worldChangedReadably === false
  ) {
    return "progression";
  }

  if (
    observation.voluntarilyRepeated === true &&
    observation.intendedInferenceLanded === false
  ) {
    return "narrative";
  }

  return "insufficient_evidence";
}

export function evaluateDirectorPlan(
  model: MitchGameModel,
  plan: MitchExperimentPlan
): MitchDirectorGateResult {
  const violations: MitchDirectorViolation[] = [];
  const add = (rule: string, message: string) => violations.push({ rule, message });

  // R1-R4: diagnosis/hypothesis/falsifier/rival integrity.
  if (!plan.diagnosisId || !plan.hypothesisId)
    add("R2", "Every implementation task must trace to diagnosis_id and hypothesis_id.");
  if (norm(plan.primaryLocus) === norm(plan.rivalLocus))
    add("R4", "Primary and rival hypotheses must name different loci.");
  if (plan.primaryDiagnosis === plan.runnerUpDiagnosis && norm(plan.primaryLocus) === norm(plan.rivalLocus))
    add("R4", "A rival cannot be a restatement of the primary diagnosis.");
  if (norm(plan.falsifier) === "feature exists" || norm(plan.falsifier).includes("feature exists"))
    add("R3", "A probe falsifier cannot be implementation success.");

  // R15: delta one and frozen controls.
  if (plan.disposition === "authorize_probe" && plan.frozen.length === 0)
    add("R15", "An authorized delta probe must name frozen variables.");
  if (plan.probeDeltaCount > 1)
    add("R15", "A probe may change at most one experiential variable.");

  // R8/R20: craft skills only when implementation is authorized; blocked means protocol.
  if (plan.disposition !== "authorize_probe" && plan.craftSkills.length > 0)
    add("R8", "Craft skills must remain unloaded when the next act is refusal or observation.");
  if (plan.disposition === "blocked_awaiting_human_observation" && !plan.playtestProtocol)
    add("R20", "Blocked-awaiting-observation requires a Playtest Protocol Brief.");
  if (plan.disposition === "do_not_build" && plan.playtestProtocol && !plan.decisionRights.adamRequired)
    add("R20", "A refusal should not masquerade as an observation block.");

  // R9/R10/R11/R12/R24: evidence cannot crown fun.
  if (
    plan.disposition === "authorize_probe" &&
    plan.evidenceSourceRequired.length > 0 &&
    plan.evidenceSourceRequired.every(kind => LLM_ONLY.has(kind))
  ) {
    add("R9", "LLM/script-only evidence cannot authorize a fun/loop claim.");
  }

  // R7: core-loop failure cannot be answered with sibling content.
  const roleById = new Map(model.contentRoles.map(role => [role.roleId, role]));
  const role = roleById.get(plan.assetRoleCheck);
  if (
    plan.primaryDiagnosis === "core_loop" &&
    plan.proposedAssets.length > 0 &&
    role &&
    role.status !== "proven"
  ) {
    add("R7", "Content cannot be prescribed as the fix for an unproven core loop.");
  }

  // R17/R23: asset-role aliases and killed ideas survive renaming/jargon.
  const assetText = plan.proposedAssets.join(" ").toLowerCase();
  for (const contentRole of model.contentRoles) {
    if (contentRole.status === "proven" && contentRole.secondInstanceAllowed) continue;
    const aliases = [contentRole.role, ...contentRole.formAliases].map(norm);
    if (aliases.some(alias => alias && assetText.includes(alias))) {
      const existingOnly = plan.assetRoleCheck === "existing_asset_only";
      if (!existingOnly) add("R17", `Proposed asset collides with unproven/killed content role "${contentRole.roleId}".`);
    }
  }
  for (const killed of model.killedIdeas) {
    const aliases = [killed.idea, ...killed.formAliases].map(norm);
    if (aliases.some(alias => alias && assetText.includes(alias))) {
      add("R6", `Killed idea "${killed.idea}" cannot be revived without new-class evidence and Adam approval.`);
    }
  }

  // R5: no generalized system from a single probe.
  const text = proposedText(plan);
  if (
    containsAny(text, GENERALIZATION_TERMS) &&
    !plan.decisionRights.adamRequired
  ) {
    add("R5", "Generalizing a successful probe into a system is Adam-owned after a second discriminating probe.");
  }

  // R14: retention hacks conflict with anti-feelings/tenderness unless Adam changes the model first.
  if (
    containsAny(text, RETENTION_HACK_TERMS) &&
    model.antiFeelings.length > 0
  ) {
    add("R14", "Retention mechanics may not violate the game's anti-feelings.");
  }

  // R21/R22: discoverability is not patched with juice or shipping copy.
  if (plan.primaryDiagnosis === "ux_discoverability") {
    const illegal = ["sparkle", "particle", "hit sound", "tooltip", "objective copy", "label"];
    if (containsAny(plan.smallestDiscriminatingProbe, illegal)) {
      add("R21/R22", "Discoverability must first test signifier/affordance; juice or shipping text is not the fix.");
    }
  }

  // R13: game-feel craft is illegal unless diagnosis is game feel.
  if (
    plan.craftSkills.includes("game-feel") &&
    plan.primaryDiagnosis !== "game_feel"
  ) {
    add("R13", "game-feel polish cannot be loaded to disguise an unproven verb.");
  }

  // R18: named observation is required and cannot be implementation success.
  if (!plan.observationRequired.trim() || containsAny(plan.observationRequired, ["feature exists", "build passes"])) {
    add("R18", "Handback must be graded against a player observation, not build completion.");
  }

  // Constitution: Adam-owned changes.
  if (
    containsAny(plan.smallestDiscriminatingProbe, ["change player fantasy", "change tone", "revive killed", "remove major mechanic"]) &&
    !plan.decisionRights.adamRequired
  ) {
    add("decision_rights", "Fantasy/tone/revival/major-mechanic changes require Adam.");
  }

  // A blocked observation state is the only legal next step for fun/discovery claims with no human evidence.
  const hasHumanEvidence = plan.symptom.evidenceIds.some(id => {
    const ev = model.evidence.find(item => item.id === id);
    return ev && !LLM_ONLY.has(ev.kind);
  });
  if (
    !hasHumanEvidence &&
    ["core_loop", "ux_discoverability", "game_feel", "fantasy_mismatch"].includes(plan.primaryDiagnosis) &&
    plan.disposition === "authorize_probe" &&
    plan.probeDeltaCount === 0
  ) {
    add("R20", "A delta-0 fun/discovery claim without human observation must block into a playtest protocol.");
  }

  return { allowed: violations.length === 0, violations };
}

export function assertDirectorPlanAllowed(
  model: MitchGameModel,
  plan: MitchExperimentPlan
): void {
  const result = evaluateDirectorPlan(model, plan);
  if (!result.allowed) {
    throw new Error(
      "Mitch Director Constitution rejected plan: " +
        result.violations.map(item => `${item.rule}: ${item.message}`).join(" | ")
    );
  }
}
