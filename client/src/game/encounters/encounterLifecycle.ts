import type { ObjectionArchetype, SalesIntelChannel } from "./EncounterTypes";

export const ENCOUNTER_PHASES = [
  "APPROACHING",
  "STAGED",
  "ARMED",
  "ACTION_READY",
  "ACTION_IN_PROGRESS",
  "AWAITING_OUTCOME",
  "UNRESOLVED",
  "RESOLVED",
  "RECOVERY",
] as const;

export type EncounterPhase = (typeof ENCOUNTER_PHASES)[number];

export type EncounterRuntimeState = {
  encounterId: string;
  missionId: number;
  archetype: ObjectionArchetype;
  channel: SalesIntelChannel;
  phase: EncounterPhase;
  selectedStrategyId: string | null;
  actionRequestId: string | null;
  authoritativeRevision: string | null;
};

export type EncounterEvent =
  | { type: "PHYSICAL_APPROACH_COMPLETED" }
  | { type: "STRATEGY_SELECTED"; strategyId: string }
  | { type: "GAME_CHALLENGE_COMPLETED" }
  | { type: "REAL_ACTION_STARTED"; requestId: string }
  | { type: "REAL_ACTION_CANCELLED" }
  | { type: "REAL_ACTION_PERSISTED" }
  | { type: "AUTHORITATIVE_RESOLVED"; revision: string }
  | { type: "AUTHORITATIVE_RECOVERY"; revision: string }
  | { type: "AUTHORITATIVE_UNRESOLVED"; revision: string }
  | { type: "RETRY_AUTHORITATIVE_OUTCOME" };

const ALLOWED: Record<EncounterPhase, readonly EncounterEvent["type"][]> = {
  APPROACHING: ["PHYSICAL_APPROACH_COMPLETED"],
  STAGED: ["STRATEGY_SELECTED"],
  ARMED: ["STRATEGY_SELECTED", "GAME_CHALLENGE_COMPLETED"],
  ACTION_READY: ["STRATEGY_SELECTED", "REAL_ACTION_STARTED"],
  ACTION_IN_PROGRESS: ["REAL_ACTION_PERSISTED", "REAL_ACTION_CANCELLED"],
  AWAITING_OUTCOME: [
    "AUTHORITATIVE_RESOLVED",
    "AUTHORITATIVE_RECOVERY",
    "AUTHORITATIVE_UNRESOLVED",
  ],
  UNRESOLVED: ["RETRY_AUTHORITATIVE_OUTCOME"],
  RESOLVED: [],
  RECOVERY: ["RETRY_AUTHORITATIVE_OUTCOME"],
};

export function createEncounterRuntime(input: {
  encounterId: string;
  missionId: number;
  archetype: ObjectionArchetype;
  channel: SalesIntelChannel;
}): EncounterRuntimeState {
  return {
    ...input,
    phase: "APPROACHING",
    selectedStrategyId: null,
    actionRequestId: null,
    authoritativeRevision: null,
  };
}

/**
 * Goldline encounter UX only. Business states are intentionally absent from
 * both the input and output, so arcade performance cannot become business
 * truth through this reducer.
 */
export function transitionEncounter(
  state: EncounterRuntimeState,
  event: EncounterEvent
): EncounterRuntimeState {
  if (!ALLOWED[state.phase].includes(event.type)) {
    throw new Error(
      `Illegal encounter transition: ${state.phase} -> ${event.type}`
    );
  }

  switch (event.type) {
    case "PHYSICAL_APPROACH_COMPLETED":
      return { ...state, phase: "STAGED" };
    case "STRATEGY_SELECTED":
      return { ...state, phase: "ARMED", selectedStrategyId: event.strategyId };
    case "GAME_CHALLENGE_COMPLETED":
      return { ...state, phase: "ACTION_READY" };
    case "REAL_ACTION_STARTED":
      return {
        ...state,
        phase: "ACTION_IN_PROGRESS",
        actionRequestId: event.requestId,
      };
    case "REAL_ACTION_PERSISTED":
      return { ...state, phase: "AWAITING_OUTCOME" };
    case "REAL_ACTION_CANCELLED":
      return { ...state, phase: "ACTION_READY", actionRequestId: null };
    case "AUTHORITATIVE_RESOLVED":
      return {
        ...state,
        phase: "RESOLVED",
        authoritativeRevision: event.revision,
      };
    case "AUTHORITATIVE_RECOVERY":
      return {
        ...state,
        phase: "RECOVERY",
        authoritativeRevision: event.revision,
      };
    case "AUTHORITATIVE_UNRESOLVED":
      return {
        ...state,
        phase: "UNRESOLVED",
        authoritativeRevision: event.revision,
      };
    case "RETRY_AUTHORITATIVE_OUTCOME":
      return { ...state, phase: "AWAITING_OUTCOME" };
  }
}
