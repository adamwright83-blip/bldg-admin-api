import type {
  MitchDirectorDiagnosis,
  MitchDirectorObservation,
  MitchEvidenceKind,
  MitchExperimentPlan,
  MitchGameModel,
} from "../../shared/mitchDirectorContracts";
import {
  classifyStructuredObservation,
  evaluateDirectorPlan,
} from "./mitchDirectorConstitution";

export type MitchGameDirectorDecision = {
  plan: MitchExperimentPlan;
  constitution: ReturnType<typeof evaluateDirectorPlan>;
};

function hasHumanObservation(kinds: MitchEvidenceKind[]): boolean {
  return kinds.some(kind =>
    [
      "founder_playtest",
      "naive_first_time",
      "repeated_naive_pattern",
      "observed_behavior",
      "hinted_comparison",
    ].includes(kind)
  );
}

function requestedKilledIdea(
  model: MitchGameModel,
  request: string | null
): string | null {
  if (!request) return null;
  const text = request.toLowerCase();
  for (const killed of model.killedIdeas) {
    const aliases = [killed.idea, ...killed.formAliases].map(value =>
      value.toLowerCase()
    );
    if (aliases.some(alias => alias && text.includes(alias))) return killed.idea;
  }
  for (const role of model.contentRoles) {
    if (role.status === "proven" && role.secondInstanceAllowed) continue;
    const aliases = [role.role, ...role.formAliases].map(value =>
      value.toLowerCase()
    );
    if (aliases.some(alias => alias && text.includes(alias))) return role.role;
  }
  return null;
}

function runnerUp(primary: MitchDirectorDiagnosis): MitchDirectorDiagnosis {
  switch (primary) {
    case "implementation_bug":
      return "technical_limitation";
    case "technical_limitation":
      return "game_feel";
    case "ux_discoverability":
      return "core_loop";
    case "core_loop":
      return "game_feel";
    case "progression":
      return "core_loop";
    case "narrative":
      return "fantasy_mismatch";
    case "game_feel":
      return "fantasy_mismatch";
    case "pacing":
      return "ux_discoverability";
    case "fantasy_mismatch":
      return "core_loop";
    case "content_shortage":
      return "progression";
    case "insufficient_evidence":
      return "ux_discoverability";
  }
}

function protocolFor(observation: MitchDirectorObservation) {
  return {
    buildSha: observation.buildSha ?? "unknown-build",
    spoilState: "unspoiled" as const,
    facilitatorMaySay: ["Play naturally. You can stop whenever you want."],
    facilitatorMustNotSay: [
      "Do not explain the goal, control, solution, or intended emotional payoff.",
    ],
    handsToWatch: [
      "first intentional verb",
      "hesitation/re-aiming",
      "voluntary repeat after success",
      "unprompted transfer to another object",
    ],
    first60SecondsWatch:
      "Record the action sequence and what the player ignores before asking any interpretive question.",
    abandonRule:
      "Treat a clear stop, request to quit, or sustained disengagement as an abandon point; do not rescue the probe.",
    observationThatAnswersHypothesis:
      "Whether the named player action is discovered/performed and voluntarily re-entered after success.",
    questionTesterMustNotBeAsked:
      "Do not ask whether they liked the mechanic or whether they want more content before the behavioral observation is recorded.",
  };
}

function commonPlan(
  observation: MitchDirectorObservation,
  primary: MitchDirectorDiagnosis,
  evidenceIds: string[]
): MitchExperimentPlan {
  return {
    symptom: { rawReport: observation.rawReport, evidenceIds },
    diagnosisId: `director:${primary}`,
    hypothesisId: `hypothesis:${primary}`,
    primaryDiagnosis: primary,
    runnerUpDiagnosis: runnerUp(primary),
    primaryHypothesis: "The observed symptom is best explained by " + primary + ".",
    primaryLocus: primary,
    rivalHypothesis: "A different locus may explain the same behavior.",
    rivalLocus: runnerUp(primary),
    smallestDiscriminatingProbe: "Observe the current build without changing it.",
    probeDeltaCount: 0,
    frozen: ["sound", "animation", "copy", "adjacent assets"],
    confoundCheck: ["build SHA", "spoil state", "input device", "player familiarity"],
    assetRoleCheck: "existing_asset_only",
    proposedAssets: [],
    nonGoals: ["no new content family", "no currency or progression scaffolding"],
    falsifier:
      "The named observation occurs in the opposite direction from the primary hypothesis.",
    observationRequired:
      "A human behavior observation that discriminates the primary and rival loci.",
    evidenceSourceRequired: ["naive_first_time"],
    buildShaRequired: observation.buildSha,
    specialist: null,
    craftSkills: [],
    decisionRights: {
      mitchMayAuthorize: false,
      adamRequired: false,
      reason: "No implementation is authorized until the missing observation exists.",
    },
    expiration: "after the next discriminating observation",
    disposition: "blocked_awaiting_human_observation",
    playtestProtocol: protocolFor(observation),
  };
}

export class MitchGameDirector {
  decide(input: {
    model: MitchGameModel;
    observation: MitchDirectorObservation;
    evidenceIds?: string[];
  }): MitchGameDirectorDecision {
    const { model, observation } = input;
    const evidenceIds = input.evidenceIds ?? [];
    const killed = requestedKilledIdea(model, observation.requestedFeature);

    if (killed) {
      const plan = commonPlan(observation, "core_loop", evidenceIds);
      plan.smallestDiscriminatingProbe =
        `Do not build requested "${observation.requestedFeature}". Preserve the current build and identify the pain the request is masking.`;
      plan.probeDeltaCount = 0;
      plan.disposition = "do_not_build";
      plan.playtestProtocol = null;
      plan.decisionRights = {
        mitchMayAuthorize: false,
        adamRequired: true,
        reason: `Requested work collides with killed/unproven role "${killed}". Adam may only force a logged probe with a falsifier.`,
      };
      return { plan, constitution: evaluateDirectorPlan(model, plan) };
    }

    const primary = classifyStructuredObservation(observation);
    let plan = commonPlan(observation, primary, evidenceIds);

    if (!hasHumanObservation(observation.evidenceKinds)) {
      return { plan, constitution: evaluateDirectorPlan(model, plan) };
    }

    switch (primary) {
      case "implementation_bug":
        plan = {
          ...plan,
          smallestDiscriminatingProbe:
            "Repair only the rule that betrayed the player's formed intention.",
          probeDeltaCount: 1,
          specialist: "implementation-engineer",
          craftSkills: [],
          disposition: "authorize_probe",
          playtestProtocol: null,
          decisionRights: {
            mitchMayAuthorize: true,
            adamRequired: false,
            reason: "A correct intention was betrayed by implementation.",
          },
          falsifier:
            "The exact same intention still fails after the isolated rule repair.",
          observationRequired:
            "The previously failing intention now produces the expected rule outcome.",
        };
        break;

      case "technical_limitation":
        plan = {
          ...plan,
          smallestDiscriminatingProbe:
            "Remove the measured technical hitch or substitute one honest technical fake while freezing game feel variables.",
          probeDeltaCount: 1,
          specialist: "performance-engineer",
          craftSkills: ["performance-optimization"],
          disposition: "authorize_probe",
          playtestProtocol: null,
          decisionRights: {
            mitchMayAuthorize: true,
            adamRequired: false,
            reason: "Technical production is preventing the intended effect from being judged.",
          },
          falsifier:
            "Removing the measured technical limitation does not change the observed failure.",
          observationRequired:
            "Measured technical effect is stable enough that design feel can be judged honestly.",
        };
        break;

      case "ux_discoverability":
        plan = {
          ...plan,
          smallestDiscriminatingProbe:
            "Create one unmerged temporary comparison arm that changes only the affordance/signifier, not the mechanic.",
          probeDeltaCount: 1,
          specialist: "gameplay-prototyper",
          craftSkills: ["prototype-fast"],
          disposition: "authorize_probe",
          playtestProtocol: null,
          decisionRights: {
            mitchMayAuthorize: true,
            adamRequired: false,
            reason: "A delta-one comparison can distinguish discoverability from mechanic failure.",
          },
          falsifier:
            "The player sees the affordance, forms the intended action, and still does not voluntarily re-enter the verb.",
          observationRequired:
            "Whether the signifier change causes the intended action to form without changing the mechanic.",
          nonGoals: ["no sparkle/juice as affordance", "no shipping tooltip or objective copy"],
        };
        break;

      case "core_loop":
        plan = {
          ...plan,
          smallestDiscriminatingProbe:
            "Change one existing hand-action while keeping content, reward, narrative, and adjacent assets frozen.",
          probeDeltaCount: 1,
          specialist: "gameplay-prototyper",
          craftSkills: ["prototype-fast"],
          disposition: "authorize_probe",
          playtestProtocol: null,
          decisionRights: {
            mitchMayAuthorize: true,
            adamRequired: false,
            reason: "Mitch may order a delta-one probe inside the existing fantasy; Adam owns any generalization.",
          },
          falsifier:
            "The player understands and completes the changed hand-action once but does not voluntarily re-enter it.",
          observationRequired:
            "Voluntary second use after successful first use, with no prompt or reward escalation.",
          nonGoals: ["no sibling content", "no crafting/economy system"],
        };
        break;

      case "progression":
        plan = {
          ...plan,
          smallestDiscriminatingProbe:
            "Add one readable world-state consequence to a verb the player already voluntarily repeats.",
          probeDeltaCount: 1,
          specialist: "gameplay-prototyper",
          craftSkills: ["prototype-fast"],
          disposition: "authorize_probe",
          playtestProtocol: null,
          decisionRights: {
            mitchMayAuthorize: true,
            adamRequired: false,
            reason: "One consequence probe does not change progression kind.",
          },
          falsifier:
            "The readable consequence appears and the player still abandons the voluntarily repeated verb at the same point.",
          observationRequired:
            "Whether the player re-enters the existing verb after seeing one usable world-state consequence.",
          nonGoals: ["no currency", "no skill tree or quest log"],
        };
        break;

      case "narrative":
        plan = {
          ...plan,
          smallestDiscriminatingProbe:
            "Change one environmental placement/state that carries the intended inference; add no exposition.",
          probeDeltaCount: 1,
          specialist: "narrative-designer",
          craftSkills: [],
          disposition: "authorize_probe",
          playtestProtocol: null,
          decisionRights: {
            mitchMayAuthorize: true,
            adamRequired: false,
            reason: "Environmental inference may be tested without changing withheld story.",
          },
          falsifier:
            "The intended inference still does not land after the one environmental state change.",
          observationRequired:
            "Player states or behaves as if the intended inference was understood without explanatory dialogue.",
          nonGoals: ["no narrator", "no journal/dialogue patch"],
        };
        break;

      default:
        // game_feel/fantasy/pacing/content shortage require a more specific authored plan
        // rather than guessing a build from sparse structured evidence.
        break;
    }

    return { plan, constitution: evaluateDirectorPlan(model, plan) };
  }
}
