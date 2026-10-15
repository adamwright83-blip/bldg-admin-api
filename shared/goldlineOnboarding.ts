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
/** A desk action for an operator with no connected records. It is never a verified business outcome. */
export type OnboardingFirstAction = {
  kind: "operator_authored_task" | "claire_preparation";
  text: string;
  provenance: "operator_reported";
  verifiedBusinessOutcome: false;
  requiresIntegration: false;
  requiresPhone: false;
  recordedAt: string;
};
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
  /** Present after the operator saves a desk action. Older sessions omit it. */
  firstAction?: OnboardingFirstAction | null;
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
  // Keep the legacy positional projection contiguous up to the next unanswered
  // canonical question. Sparse acquisition state (Q0/Q1/Q3) is never padded:
  // after Q2 is supplied the first four answers become contiguous naturally.
  const legacyAnswers = ONBOARDING_QUESTION_KEYS
    .slice(0, nextQuestion)
    .map(answerKey => keyed[answerKey]!)
    .filter(Boolean);
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

const LEGACY_DEFAULT_TENANT = "default";

/**
 * The tenant id to read. A missing id is not rewritten to the legacy default
 * tenant, and a second tenant id is returned unchanged.
 */
export function onboardingReadTenantId(requestedTenantId: string | null | undefined): string {
  const requested = typeof requestedTenantId === "string" ? requestedTenantId.trim() : "";
  if (!requested) {
    throw new Error("Onboarding cannot read the default tenant in place of a missing tenant.");
  }
  return requested;
}

/** A record is visible only to its own tenant. The default tenant is not a stand-in for any other id. */
export function tenantRecordVisible(recordTenantId: string, readerTenantId: string): boolean {
  const reader = onboardingReadTenantId(readerTenantId);
  const owner = typeof recordTenantId === "string" ? recordTenantId.trim() : "";
  if (!owner || owner !== reader) return false;
  if (reader !== LEGACY_DEFAULT_TENANT && owner === LEGACY_DEFAULT_TENANT) return false;
  return true;
}

export function sessionForReader<T extends { tenantId: string }>(session: T | null, readerTenantId: string): T | null {
  if (!session || typeof session !== "object") return null;
  if (!tenantRecordVisible(session.tenantId, readerTenantId)) return null;
  return session;
}

export type OnboardingPreviewConnection = "none" | "customer_csv";
export type OnboardingPreview = {
  connection: OnboardingPreviewConnection;
  label: "Illustrative" | "From your imported file";
  illustrative: boolean;
  factualNames: readonly string[];
  factualSales: readonly [];
  note: string;
};

export function previewConnectionForSession(
  session: Pick<GoldlineOnboardingSession, "optionalUploadReference">
): OnboardingPreviewConnection {
  return session.optionalUploadReference ? "customer_csv" : "none";
}

/** An unconnected preview is illustrative and cannot present names or sales as facts. */
export function onboardingPreviewForConnection(input: {
  connection: OnboardingPreviewConnection;
  connectedNames?: readonly string[];
}): OnboardingPreview {
  if (input.connection === "none") {
    return {
      connection: "none",
      label: "Illustrative",
      illustrative: true,
      factualNames: [],
      factualSales: [],
      note: "Illustrative preview. Not your customers or sales.",
    };
  }
  const factualNames = (input.connectedNames ?? []).map(name => name.trim()).filter(Boolean);
  return {
    connection: "customer_csv",
    label: "From your imported file",
    illustrative: false,
    factualNames,
    factualSales: [],
    note: "Names here are from the file you imported. Sales are not shown.",
  };
}

export function openingAnswersReady(
  session: Pick<GoldlineOnboardingSession, "answers" | "answersByKey">
): boolean {
  const answers = onboardingAnswersByKey(session);
  return JOYSTICK_PREPAY_QUESTION_KEYS.every(key => Boolean(answers[key]?.trim()));
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
}

function reportedAction(
  kind: OnboardingFirstAction["kind"],
  text: string,
  now: Date
): OnboardingFirstAction {
  return {
    kind,
    text,
    provenance: "operator_reported",
    verifiedBusinessOutcome: false,
    requiresIntegration: false,
    requiresPhone: false,
    recordedAt: now.toISOString(),
  };
}

/** The operator's own next task. No connection and no phone are required. */
export function authorOperatorTask(text: string, now = new Date()): OnboardingFirstAction {
  return reportedAction("operator_authored_task", statement.parse(text), now);
}

/**
 * Claire's opening preparation restates the three answers the operator already
 * gave. It does not invent customers, sales, or a verified result.
 */
export function prepareClaireOpening(
  session: Pick<GoldlineOnboardingSession, "answers" | "answersByKey">,
  now = new Date()
): OnboardingFirstAction {
  if (!openingAnswersReady(session)) throw new Error("Answer the three opening questions first.");
  const answers = onboardingAnswersByKey(session);
  const work = oneLine(answers.daily_work!);
  const area = oneLine(answers.service_area!);
  const avoidance = oneLine(answers.avoidance!);
  return reportedAction(
    "claire_preparation",
    `Preparation only, from what you reported. The work is ${work}, around ${area}. The part you avoid is ${avoidance}. This is not a customer, a sale, or a verified result.`,
    now
  );
}

export function attachFirstAction(
  session: GoldlineOnboardingSession,
  action: OnboardingFirstAction
): GoldlineOnboardingSession {
  if (session.firstAction) return session;
  if (!openingAnswersReady(session)) throw new Error("Answer the three opening questions first.");
  if (action.provenance !== "operator_reported" || action.verifiedBusinessOutcome !== false) {
    throw new Error("A first action is operator-reported and is not a verified business outcome.");
  }
  return { ...session, firstAction: action, version: session.version + 1 };
}
