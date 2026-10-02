import { z } from "zod";

export const WORLD_MODES = ["LOCAL_PHYSICAL", "REGIONAL_PHYSICAL", "GLOBAL_MARKET", "ABSTRACT_FANTASY"] as const;
export type WorldMode = typeof WORLD_MODES[number];
export interface WorldSkin { id: string; supportedModes: readonly WorldMode[]; tags: { climate: string[]; foliage: string[]; density: string[]; architecture: string[]; terrain: string[] } }
export const ONBOARDING_QUESTIONS = [
  "What do you actually do all day?", "Where do you work?",
  "Where do your best customers come from?", "What's the part of the job you avoid?",
  "If one thing changed in the next 90 days, what would it be?",
] as const;

export const ONBOARDING_QUESTION_KEYS = [
  "daily_work",
  "service_area",
  "customer_source",
  "avoidance",
  "objective_90_day",
] as const;
export type GoldlineOnboardingQuestionKey = typeof ONBOARDING_QUESTION_KEYS[number];
export const JOYSTICK_PREPAY_QUESTION_KEYS = [
  "daily_work",
  "service_area",
  "avoidance",
] as const satisfies readonly GoldlineOnboardingQuestionKey[];

export type GoldlineAnswerProvenance = "operator_declared" | "geocoded_declaration";
export function onboardingQuestionKey(index: number): GoldlineOnboardingQuestionKey {
  const key = ONBOARDING_QUESTION_KEYS[index];
  if (!key) throw new Error("Unknown onboarding question.");
  return key;
}
const statement = z.string().trim().min(1).max(2000);
export const businessProfileSchema = z.object({
  whatTheyDo: statement, servicePattern: statement, localServiceAreaDescription: statement,
  /** A single concise place name that can be resolved to one canonical location. */
  geocodableServiceArea: statement,
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
  currentQuestion: number; answers: string[];
  /** Stable semantic answer identity. Older sessions may omit this and remain positional. */
  answersByKey?: Partial<Record<GoldlineOnboardingQuestionKey, string>>;
  answerProvenanceByKey?: Partial<Record<GoldlineOnboardingQuestionKey, GoldlineAnswerProvenance>>;
  acquisitionSessionId?: string | null;
  interpretation: { provenance: "ai_interpretation"; model: string; profile: GoldlineBusinessProfile } | null;
  optionalUploadReference: string | null; startedAt: string; completedAt: string | null; version: number;
  world: { mode: "LOCAL_PHYSICAL"; skinId: "WATER_LAND"; topologyId: string; topologyRevision: number; compositionRevision: number; topology: LocalTopology } | null;
  mission: FirstMission | null;
};
export function onboardingAnswersByKey(
  session: Pick<GoldlineOnboardingSession, "answers" | "answersByKey">
): Partial<Record<GoldlineOnboardingQuestionKey, string>> {
  if (session.answersByKey) return { ...session.answersByKey };
  const mapped: Partial<Record<GoldlineOnboardingQuestionKey, string>> = {};
  session.answers.forEach((value, index) => {
    const key = ONBOARDING_QUESTION_KEYS[index];
    if (key && value?.trim()) mapped[key] = value;
  });
  return mapped;
}

export function getGoldlineOnboardingAnswer(
  session: Pick<GoldlineOnboardingSession, "answers" | "answersByKey">,
  key: GoldlineOnboardingQuestionKey
): string | null {
  return onboardingAnswersByKey(session)[key] ?? null;
}

export function nextGoldlineOnboardingQuestion(
  answers: Partial<Record<GoldlineOnboardingQuestionKey, string>>
): number {
  const index = ONBOARDING_QUESTION_KEYS.findIndex(key => !answers[key]?.trim());
  return index === -1 ? ONBOARDING_QUESTION_KEYS.length : index;
}

export function orderedGoldlineOnboardingAnswers(
  session: Pick<GoldlineOnboardingSession, "answers" | "answersByKey">
): string[] {
  const answers = onboardingAnswersByKey(session);
  const ordered = ONBOARDING_QUESTION_KEYS.map(key => answers[key]?.trim() ?? "");
  if (ordered.some(value => !value)) throw new Error("Answer all five questions first.");
  return ordered;
}

export function answerSession(session: GoldlineOnboardingSession, question: number, answer: string): GoldlineOnboardingSession {
  if (session.status !== "INTERVIEW" || question !== session.currentQuestion || question > 4) throw new Error("This question has already changed. Reload to resume.");
  const parsed = statement.parse(answer);
  const key = onboardingQuestionKey(question);
  const keyed = onboardingAnswersByKey(session);
  keyed[key] = parsed;
  const nextQuestion = nextGoldlineOnboardingQuestion(keyed);
  const provenance = { ...(session.answerProvenanceByKey ?? {}), [key]: "operator_declared" as const };
  // Preserve legacy positional storage for pre-migration sessions while making
  // semantic keys authoritative for all new/continued sessions.
  const legacyAnswers = session.answersByKey ? session.answers : [...session.answers, parsed];
  return {
    ...session,
    answers: legacyAnswers,
    answersByKey: keyed,
    answerProvenanceByKey: provenance,
    currentQuestion: nextQuestion,
    status: nextQuestion === ONBOARDING_QUESTION_KEYS.length ? "READY" : "INTERVIEW",
    version: session.version + 1,
  };
}
