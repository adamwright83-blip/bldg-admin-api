import type { MitchMilestone, MitchWorkOrder } from "../../shared/mitchContracts";

export const MITCH_GAME_DIRECTOR_SKILLS = {
  core: {
    id: "core",
    purpose: "Protect the game's identity and judge whether the player-visible result is actually clear, responsive, and worth repeating.",
    checks: [
      "Judge the mechanic as a player experience, not as code completion.",
      "Prefer one legible interaction with immediate feedback over added systems.",
      "Reject work that technically satisfies nouns in the brief but misses the intended player experience.",
      "Treat IMPLEMENTED, VERIFIED, CREATIVE-ACCEPTED, and RELEASED as separate states.",
    ],
  },
  gamefeel: {
    id: "gamefeel",
    purpose: "Evaluate control, timing, feedback, anticipation, payoff, recovery, and the physical feel of the interaction.",
    checks: [
      "Input must produce an immediate, readable response.",
      "Failure or wrong input must teach rather than merely punish.",
      "The payoff must be stronger and clearer than the setup.",
      "Animation, sound, camera, haptics, particles, and timing should support the mechanic instead of hiding it.",
    ],
  },
  visual: {
    id: "visual",
    purpose: "Evaluate composition, hierarchy, animation, art consistency, and whether the player can read what matters in one glance.",
    checks: [
      "The focal interaction must win the visual hierarchy.",
      "Decorative motion must not compete with actionable state.",
      "New visuals must belong to the existing art direction rather than look like programmer placeholders.",
      "Desktop and touch layouts must preserve the intended focal point.",
    ],
  },
  systems: {
    id: "systems",
    purpose: "Evaluate progression, state, softlocks, repeatability, and whether one mechanic creates useful choices instead of chores.",
    checks: [
      "No state transition may silently skip required play.",
      "A failure path must recover without reload-only or developer-only escape hatches.",
      "Completion must not unlock unrelated progression.",
      "New state must remain deterministic and testable where the mechanic permits it.",
    ],
  },
  narrative: {
    id: "narrative",
    purpose: "Evaluate whether story beats are earned by play and whether character reaction follows the player's action rather than replacing it.",
    checks: [
      "The player causes the beat; exposition does not cause it for them.",
      "Character reaction follows successful player action.",
      "Do not add lore, dialogue, characters, objects, or stakes merely to explain a weak mechanic.",
      "Preserve canon constraints exactly.",
    ],
  },
  mobile: {
    id: "mobile",
    purpose: "Evaluate touch reachability, orientation, viewport ownership, accidental input, and readable feedback on a phone.",
    checks: [
      "Primary interaction must work with coarse touch without precision-hover assumptions.",
      "Targets and gestures must remain usable in intended orientations.",
      "No browser chrome, safe-area, or viewport behavior may hide critical controls.",
      "Touch behavior must be exercised, not inferred from desktop code.",
    ],
  },
  playtest: {
    id: "playtest",
    purpose: "Require evidence that proves the exact player-visible claim on the exact build.",
    checks: [
      "Do not translate passing unit tests into a gameplay claim.",
      "A gameplay acceptance pass requires the exact commit-backed build to be exercised.",
      "Capture the shortest proof that demonstrates setup, player input, response, payoff, and recovery.",
      "If fun, clarity, or taste remains uncertain after technical checks, stop for human creative judgment.",
    ],
  },
} as const;

export type MitchGameDirectorSkillId = keyof typeof MITCH_GAME_DIRECTOR_SKILLS;

export function routeMitchGameDirectorSkills(input: {
  milestone: MitchMilestone;
  order: MitchWorkOrder;
}): MitchGameDirectorSkillId[] {
  const corpus = [
    input.milestone.title,
    input.milestone.desiredPlayerVisibleResult,
    ...input.milestone.acceptanceCriteria,
    ...input.order.canonConstraints,
    ...input.order.relevantDependencies,
  ].join(" ").toLowerCase();

  const selected = new Set<MitchGameDirectorSkillId>(["core", "playtest"]);

  if (/(control|input|timing|reaction|feedback|movement|physics|aim|angle|kick|jump|combat|duel|feel)/.test(corpus))
    selected.add("gamefeel");
  if (/(visual|art|camera|animation|frame|light|color|layout|ui|hud|particle|sprite|scene)/.test(corpus))
    selected.add("visual");
  if (/(progress|state|unlock|save|softlock|repeat|score|round|level|kingdom|chapter|completion)/.test(corpus))
    selected.add("systems");
  if (/(story|character|dialogue|reaction|conductor|resident|narrative|canon|chapter)/.test(corpus))
    selected.add("narrative");
  if (/(touch|mobile|phone|landscape|portrait|viewport|gesture|pointer)/.test(corpus))
    selected.add("mobile");

  return [...selected];
}

export function buildMitchGameDirectorBrief(input: {
  milestone: MitchMilestone;
  order: MitchWorkOrder;
}): string {
  const skills = routeMitchGameDirectorSkills(input);
  return [
    "### Mitch game-director lens",
    "Diagnose before prescribing. Find the smallest player-visible defect or proof gap that blocks this milestone.",
    "Do not reward added scope. A smaller mechanic that reads and feels better wins.",
    ...skills.flatMap(skillId => {
      const skill = MITCH_GAME_DIRECTOR_SKILLS[skillId];
      return [
        "",
        `#### ${skill.id}: ${skill.purpose}`,
        ...skill.checks.map(check => "- " + check),
      ];
    }),
    "",
    "### Director verdict law",
    "- fix_needed = one concrete defect can be repaired without a new creative decision.",
    "- no_blocking_issue = the exact build was exercised and all acceptance criteria actually passed.",
    "- human_play_required = technical evidence is clean but fun, clarity, taste, or creative acceptability cannot be truthfully certified.",
    "- Never turn missing evidence into a positive verdict.",
  ].join("\n");
}
