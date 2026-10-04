import type {
  MitchDirectorDiagnosis,
  MitchExperimentPlan,
} from "../../shared/mitchDirectorContracts";

export const MITCH_GAMEDEV_SKILLS = [
  "prototype-fast",
  "game-feel",
  "level-design",
  "game-ui-ux",
  "camera-systems",
  "performance-optimization",
  "game-ai",
  "dialogue-systems",
  "save-systems",
  "create-game-assets",
  "threejs-scene-setup",
  "threejs-gltf-loading",
  "threejs-materials-lighting",
] as const;
export type MitchGameDevSkill = (typeof MITCH_GAMEDEV_SKILLS)[number];

export type MitchCraftProblem = {
  engine?: "threejs" | "other" | "unknown";
  diagnosis: MitchDirectorDiagnosis;
  tags?: Array<
    | "prototype"
    | "feel"
    | "level"
    | "ui"
    | "camera"
    | "performance"
    | "npc"
    | "dialogue"
    | "save"
    | "asset"
    | "gltf"
    | "materials"
    | "scene"
  >;
};

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/**
 * Specialist craft knowledge is deliberately downstream of director authorization.
 * A refusal, playtest protocol, or confounded probe loads no implementation skill.
 */
export function selectGameDevSkills(
  plan: MitchExperimentPlan,
  problem: MitchCraftProblem
): MitchGameDevSkill[] {
  if (plan.disposition !== "authorize_probe") return [];

  const skills: MitchGameDevSkill[] = [];
  const tags = new Set(problem.tags ?? []);

  if (tags.has("prototype") || plan.craftSkills.includes("prototype-fast"))
    skills.push("prototype-fast");
  if (problem.diagnosis === "game_feel" || tags.has("feel"))
    skills.push("game-feel");
  if (tags.has("level")) skills.push("level-design");
  if (tags.has("ui")) skills.push("game-ui-ux");
  if (tags.has("camera")) skills.push("camera-systems");
  if (problem.diagnosis === "technical_limitation" || tags.has("performance"))
    skills.push("performance-optimization");
  if (tags.has("npc")) skills.push("game-ai");
  if (tags.has("dialogue")) skills.push("dialogue-systems");
  if (tags.has("save")) skills.push("save-systems");
  if (tags.has("asset")) skills.push("create-game-assets");

  if (problem.engine === "threejs") {
    if (tags.has("scene")) skills.push("threejs-scene-setup");
    if (tags.has("gltf")) skills.push("threejs-gltf-loading");
    if (tags.has("materials")) skills.push("threejs-materials-lighting");
  }

  return uniq(skills);
}
