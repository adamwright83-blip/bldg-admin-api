import { z } from "zod";

export const WORLD_MODES = ["LOCAL_PHYSICAL", "REGIONAL_PHYSICAL", "GLOBAL_MARKET", "ABSTRACT_FANTASY"] as const;
export type WorldMode = typeof WORLD_MODES[number];
export interface WorldSkin { id: string; supportedModes: readonly WorldMode[]; tags: { climate: string[]; foliage: string[]; density: string[]; architecture: string[]; terrain: string[] } }
export const ONBOARDING_QUESTIONS = [
  "What do you actually do all day?", "Where do you work?",
  "Where do your best customers come from?", "What's the part of the job you avoid?",
  "If one thing changed in the next 90 days, what would it be?",
] as const;
const statement = z.string().trim().min(1).max(2000);
export const businessProfileSchema = z.object({
  whatTheyDo: statement, servicePattern: statement, localServiceAreaDescription: statement,
  customerSourceDescription: statement, avoidancePattern: statement, objective90Day: statement,
  routeBased: z.boolean(), transportsCustomerProperty: z.boolean(), vehicleCountReported: z.number().int().min(0).nullable(),
  inferredBusinessType: statement, campaignIntent: statement,
  firstMissionThemes: z.array(z.enum(["TERRITORY_SCOUT", "PROSPECT_HUNT", "COLLATERAL_SWEEP", "FOLLOW_UP_PURSUIT"])).min(1).max(3),
}).strict();
export type GoldlineBusinessProfile = z.infer<typeof businessProfileSchema>;
export type WorldAnchor = { id: string; label: string; latitude: number; longitude: number; provenance: "geocoded_declaration" | "imported_evidence" | "operator_reported"; evidenceId: string | null };
export type LocalTopology = { id: string; revision: number; mode: "LOCAL_PHYSICAL"; label: string; classification: "game_projection"; territories: { id: string; label: string; anchorIds: string[] }[]; adjacency: [string, string][]; anchors: WorldAnchor[] };
export type FirstMission = { id: string; archetype: "TERRITORY_SCOUT"; title: string; objective: string; avoidance: string; guardianId: string; territoryId: string; checkpoint: WorldAnchor; status: "active" | "completed"; outcome: { text: string; reportedAt: string; actorId: string; provenance: "operator_reported"; gps: { latitude: number; longitude: number; accuracy: number } | null } | null; traversalCompletedAt: string | null; gameplayCompletedAt: string | null };
export type GoldlineOnboardingSession = {
  id: string; tenantId: string; status: "INTERVIEW" | "READY" | "COMPLETE";
  currentQuestion: number; answers: string[]; interpretation: { provenance: "ai_interpretation"; model: string; profile: GoldlineBusinessProfile } | null;
  optionalUploadReference: string | null; startedAt: string; completedAt: string | null; version: number;
  world: { mode: "LOCAL_PHYSICAL"; skinId: "WATER_LAND"; topologyId: string; topologyRevision: number; compositionRevision: number; topology: LocalTopology } | null;
  mission: FirstMission | null;
};
export function answerSession(session: GoldlineOnboardingSession, question: number, answer: string): GoldlineOnboardingSession {
  if (session.status !== "INTERVIEW" || question !== session.currentQuestion || question > 4) throw new Error("This question has already changed. Reload to resume.");
  const answers = [...session.answers, statement.parse(answer)];
  return { ...session, answers, currentQuestion: answers.length, status: answers.length === 5 ? "READY" : "INTERVIEW", version: session.version + 1 };
}
