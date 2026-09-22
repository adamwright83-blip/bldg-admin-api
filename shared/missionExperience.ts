/**
 * Mission Experience Runtime — pure contract.
 *
 * Authority order stays WeeklyIntent → Daily Command → Mission Director →
 * this runtime. The runtime receives selected work. It does not choose it.
 *
 * Identity is the authoritative selected-work key. A fiction title, mission
 * title, missionKey, visual package, world destination, entrance, or random
 * id is not an identity. See docs/goldline/MISSION_EXPERIENCE_RUNTIME_AUDIT.md.
 */
import type { WeeklyIntentRecord } from "./weeklyMissionReadiness";

export const MISSION_EXPERIENCE_STATUSES = ["ACTIVE", "NOT_READY_TODAY", "COMPLETE"] as const;
export type MissionExperienceStatus = (typeof MISSION_EXPERIENCE_STATUSES)[number];

export const MISSION_EXPERIENCE_PHASES = [
  "BRIEFING",
  "PLAYABLE_BEFORE_GATE",
  "WAITING_FOR_REAL_ACTION",
  "REAL_ACTION_OBSERVED",
  "PLAYABLE_AFTER_GATE",
  "CONSEQUENCE_AVAILABLE",
  "COMPLETE",
] as const;
export type MissionExperiencePhase = (typeof MISSION_EXPERIENCE_PHASES)[number];

export const OPTIONAL_PLAY_PHASES = ["PLAYABLE_BEFORE_GATE", "PLAYABLE_AFTER_GATE"] as const;

export const REAL_GATE_KINDS = [
  "MESSAGE_SENT",
  "MESSAGE_DELIVERED",
  "CALL_ATTEMPTED",
  "CALL_CONNECTED",
  "PHYSICAL_ARRIVAL",
  "PLACEMENT_VERIFIED",
  "FOLLOW_UP_LOGGED",
  "OPERATOR_CONFIRMED_RESULT",
] as const;
export type RealGateKind = (typeof REAL_GATE_KINDS)[number];

export const REAL_GATE_STATES = ["UNAVAILABLE", "WAITING", "SATISFIED"] as const;
export type RealGateState = (typeof REAL_GATE_STATES)[number];

export const WORK_SOURCES = ["weekly_intent", "daily_command", "mission_director"] as const;
export type WorkSource = (typeof WORK_SOURCES)[number];

export const MISSION_ENTRANCES = ["DAY_LINE", "OVERWORLD"] as const;
export type MissionEntrance = (typeof MISSION_ENTRANCES)[number];

/**
 * Operator confirmation may record an explicit typed result through an
 * existing confirmation path. It cannot manufacture these outcomes.
 */
export const OPERATOR_CONFIRMATION_FORBIDDEN = [
  "customer_approval",
  "sale",
  "third_party_statement",
  "payment",
  "message_delivery",
  "phone_connection",
  "property_approval",
] as const;

export type RealGate = {
  kind: RealGateKind;
  state: RealGateState;
  evidenceRef: string | null;
  /** Null means this build has no authoritative producer. The gate stays UNAVAILABLE. */
  producer: string | null;
};

export type AuthoritativeEvidence = {
  gateKind: RealGateKind;
  evidenceRef: string;
  producer: string;
  confirmationPath?: "existing_authoritative_confirmation";
  resultKind?: string;
};

export type MissionConsequence = {
  attemptObserved: boolean;
  verifiedOutcomeObserved: boolean;
  attemptReactionAvailable: boolean;
  verifiedConsequenceAvailable: boolean;
  /** Never granted by a call connection or by words the operator typed. */
  propertyApproval: false;
};

export type MissionReplacement = {
  reason: "ORIGINAL_MISSION_NOT_READY";
  replacesMissionInstanceId: string;
};

export type AuthorityRef = {
  authorityKey: string;
  dailyCommandItemId: string | null;
  missionDirectorPlanId: string | null;
  missionDirectorSelection: "primary" | "fallback" | null;
  /** Reference only. A campaign run is not the experience identity. */
  campaignRunId: string | null;
};

/**
 * Host saves stay the owners. This checkpoint is a reference plus fictional
 * state for resume. It is not a second writer for Wayward, Overworld,
 * Campaign Run events, or Clockhead.
 *
 * Owners:
 * - wayward: client/src/pages/goldline/stages/waywardProgress.ts
 * - overworld: client/src/pages/goldline/overworld/checkpoint.ts
 * - campaign_run: goldline_campaign_runs + goldline_campaign_target_events
 * - campaign_run_presentation: client/src/game/fiction/campaignRunPresentationStorage.ts
 * - clockhead: in-memory clockhead duel; no durable host save
 */
export type GameplayCheckpoint = {
  host: string | null;
  checkpointRef: string | null;
  hostPhase: string | null;
  fictionalState: unknown;
};

export type PlayShape = "compact" | "rich_host";

export type MissionExperienceInstance = {
  id: string;
  tenantId: string;
  operatorId: string;
  businessDate: string;
  authorityRef: AuthorityRef;
  source: WorkSource;
  title: string;
  realObjective: string;
  status: MissionExperienceStatus;
  phase: MissionExperiencePhase;
  playShape: PlayShape;
  gameplayHost: string | null;
  gameplay: GameplayCheckpoint;
  realGate: RealGate;
  consequence: MissionConsequence;
  replacement: MissionReplacement | null;
  visualPackageId: string | null;
  entrances: MissionEntrance[];
  createdAt: string;
  updatedAt: string;
};

export type SelectedWorkRef = {
  source: WorkSource;
  title: string;
  realObjective: string;
  dailyCommandItemId?: string | null;
  missionDirectorPlanId?: string | null;
  missionDirectorSelection?: "primary" | "fallback" | null;
  campaignRunId?: string | null;
  gameplayHost?: string | null;
  playShape?: PlayShape;
  visualPackageId?: string | null;
  realGateKind: RealGateKind;
  gateProducer?: string | null;
};

export type UnreadinessObservation = {
  notReady: boolean;
  missingPrepTexts: readonly string[];
  existingFallback: SelectedWorkRef | null;
};

const REWARD_KEYS = new Set(["xp", "coins", "points", "reward", "currency", "gold"]);

export function authorityKey(ref: Pick<
  SelectedWorkRef,
  "dailyCommandItemId" | "missionDirectorPlanId" | "missionDirectorSelection"
>): string | null {
  const commandId = ref.dailyCommandItemId?.trim() ?? "";
  if (commandId) return `dc:${commandId}`;
  const planId = ref.missionDirectorPlanId?.trim() ?? "";
  if (!planId) return null;
  const selection = ref.missionDirectorSelection === "fallback" ? "fallback" : "primary";
  return `md:${planId}:${selection}`;
}

export function emptyConsequence(): MissionConsequence {
  return {
    attemptObserved: false,
    verifiedOutcomeObserved: false,
    attemptReactionAvailable: false,
    verifiedConsequenceAvailable: false,
    propertyApproval: false,
  };
}

export function initialRealGate(ref: Pick<SelectedWorkRef, "realGateKind" | "gateProducer">): RealGate {
  const producer = ref.gateProducer?.trim() || null;
  if (!producer) {
    return { kind: ref.realGateKind, state: "UNAVAILABLE", evidenceRef: null, producer: null };
  }
  return { kind: ref.realGateKind, state: "WAITING", evidenceRef: null, producer };
}

export function consequenceFor(gate: RealGate): MissionConsequence {
  const satisfied = gate.state === "SATISFIED";
  const attempt = satisfied && gate.kind === "CALL_ATTEMPTED";
  const verified = satisfied && gate.kind !== "CALL_ATTEMPTED";
  return {
    attemptObserved: attempt,
    verifiedOutcomeObserved: verified,
    attemptReactionAvailable: attempt,
    verifiedConsequenceAvailable: verified,
    propertyApproval: false,
  };
}

/** Week brochure reader. Reads the locked day. Does not write it. */
export function readLockedWeeklyPrimary(
  intent: WeeklyIntentRecord,
  businessDate: string
): { text: string; commitmentId: string | null } | null {
  const day = intent.days.find(item => item.businessDate === businessDate) ?? null;
  if (!day?.primary || day.disposition === "stand_down") return null;
  return { text: day.primary.text, commitmentId: day.primary.commitmentId };
}

export function replacementDependsOnMissingPrep(
  ref: Pick<SelectedWorkRef, "title" | "realObjective">,
  missingPrepTexts: readonly string[]
): boolean {
  const hay = `${ref.title}\n${ref.realObjective}`.trim().toLowerCase();
  return missingPrepTexts.some(text => {
    const needle = text.trim().toLowerCase();
    return needle.length > 0 && hay.includes(needle);
  });
}

export function markNotReadyToday(instance: MissionExperienceInstance, nowIso: string): MissionExperienceInstance {
  if (instance.status === "COMPLETE") return instance;
  return { ...instance, status: "NOT_READY_TODAY", updatedAt: nowIso };
}

function stripRewards(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (REWARD_KEYS.has(key.toLowerCase())) continue;
    next[key] = item;
  }
  return next;
}

export function applyGameplayMutation(
  instance: MissionExperienceInstance,
  mutation: { fictionalState?: unknown; hostPhase?: string | null; checkpointRef?: string | null },
  nowIso: string
): MissionExperienceInstance {
  const checkpointRef =
    mutation.checkpointRef && mutation.checkpointRef.trim()
      ? mutation.checkpointRef.trim()
      : instance.gameplay.checkpointRef;
  return {
    ...instance,
    gameplay: {
      host: instance.gameplayHost,
      checkpointRef,
      hostPhase: mutation.hostPhase ?? instance.gameplay.hostPhase,
      fictionalState:
        mutation.fictionalState === undefined
          ? instance.gameplay.fictionalState
          : stripRewards(mutation.fictionalState),
    },
    updatedAt: nowIso,
  };
}

/** A client or a game tick cannot move a gate. The instance is returned unchanged. */
export function applyClientGateAttempt(instance: MissionExperienceInstance): MissionExperienceInstance {
  return instance;
}

function phaseAfterSatisfied(instance: MissionExperienceInstance, gate: RealGate): MissionExperiencePhase {
  if (gate.kind === "CALL_ATTEMPTED") return "REAL_ACTION_OBSERVED";
  if (instance.playShape === "rich_host") return "PLAYABLE_AFTER_GATE";
  return "CONSEQUENCE_AVAILABLE";
}

export function applyAuthoritativeEvidence(
  instance: MissionExperienceInstance,
  evidence: AuthoritativeEvidence,
  nowIso: string
): MissionExperienceInstance {
  const gate = instance.realGate;
  if (gate.state === "UNAVAILABLE" || gate.producer == null) return instance;
  if (evidence.gateKind !== gate.kind) return instance;
  if (evidence.producer.trim() !== gate.producer) return instance;
  if (!evidence.evidenceRef.trim()) return instance;
  if (gate.kind === "OPERATOR_CONFIRMED_RESULT") {
    if (evidence.confirmationPath !== "existing_authoritative_confirmation") return instance;
    const resultKind = evidence.resultKind?.trim() ?? "";
    if (!resultKind) return instance;
    if ((OPERATOR_CONFIRMATION_FORBIDDEN as readonly string[]).includes(resultKind)) return instance;
  }
  const realGate: RealGate = {
    ...gate,
    state: "SATISFIED",
    evidenceRef: evidence.evidenceRef.trim(),
  };
  return {
    ...instance,
    realGate,
    consequence: consequenceFor(realGate),
    phase: phaseAfterSatisfied(instance, realGate),
    updatedAt: nowIso,
  };
}

export function advanceCompactToGate(instance: MissionExperienceInstance, nowIso: string): MissionExperienceInstance {
  if (instance.playShape !== "compact") return instance;
  if (instance.phase === "COMPLETE" || instance.phase === "CONSEQUENCE_AVAILABLE" || instance.phase === "REAL_ACTION_OBSERVED") {
    return instance;
  }
  return { ...instance, phase: "WAITING_FOR_REAL_ACTION", updatedAt: nowIso };
}

export function noteHostPhase(
  instance: MissionExperienceInstance,
  hostPhase: string,
  nowIso: string
): MissionExperienceInstance {
  const kept = hostPhase.trim();
  if (!kept) return instance;
  return {
    ...instance,
    phase: semanticPhaseForHost(instance, kept),
    gameplay: { ...instance.gameplay, hostPhase: kept },
    updatedAt: nowIso,
  };
}

function semanticPhaseForHost(instance: MissionExperienceInstance, hostPhase: string): MissionExperiencePhase {
  if (instance.playShape === "compact") {
    if (hostPhase === "briefing") return instance.phase;
    if (instance.phase === "BRIEFING") return "WAITING_FOR_REAL_ACTION";
    return instance.phase;
  }
  switch (hostPhase) {
    case "briefing":
      return "BRIEFING";
    case "field":
    case "antagonist_comms":
    case "en_route":
    case "arriving":
    case "1":
    case "2":
    case "3":
      return "PLAYABLE_BEFORE_GATE";
    case "focal":
    case "awaiting_record":
      return "WAITING_FOR_REAL_ACTION";
    default:
      return instance.phase === "BRIEFING" ? "PLAYABLE_BEFORE_GATE" : instance.phase;
  }
}

export function noteEntrance(
  instance: MissionExperienceInstance,
  entrance: MissionEntrance,
  nowIso: string
): MissionExperienceInstance {
  return { ...instance, entrances: [...instance.entrances, entrance], updatedAt: nowIso };
}

export function bindVisualPackage(
  instance: MissionExperienceInstance,
  visualPackageId: string | null
): MissionExperienceInstance {
  return { ...instance, visualPackageId };
}

export function completeExperience(
  instance: MissionExperienceInstance,
  nowIso: string
): MissionExperienceInstance {
  if (instance.realGate.state !== "SATISFIED" || !instance.realGate.evidenceRef) return instance;
  return { ...instance, status: "COMPLETE", phase: "COMPLETE", updatedAt: nowIso };
}

export function resumeExperience(
  instance: MissionExperienceInstance,
  evidence: AuthoritativeEvidence | null,
  nowIso: string
): MissionExperienceInstance {
  if (!evidence) return instance;
  return applyAuthoritativeEvidence(instance, evidence, nowIso);
}
