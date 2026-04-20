export type DriverPrepPhase =
  | "prep_t1"
  | "prep_t2"
  | "prep_t3"
  | "prep_complete"
  | "sweep_armed"
  | "sweep_resolved_safe"
  | "sweep_resolved_explosion"
  | "deploy_live"
  | "deploy_resolved"
  | "verify_countdown"
  | "verify_success"
  | "verify_failed"
  | "next_target"
  | "mission_complete";

export type VerificationFailureReason =
  | "timeout"
  | "missing_upload"
  | "manual_test_failure";

export type PrepUploadSlot = {
  status: "empty" | "uploaded";
  previewDataUrl: string | null;
  completedAt: string | null;
};

export type DeploymentProof = {
  status: "empty" | "uploaded";
  previewDataUrl: string | null;
  uploadedAt: string | null;
};

export type VerificationState = {
  startedAt: string | null;
  deadlineAt: string | null;
  result: "pending" | "success" | "failed";
  failureReason: VerificationFailureReason | null;
};

export type LifetimeCampaignStats = {
  payloadsDiffusedLifetime: number;
  missionsCompletedLifetime: number;
  lastCompletedMissionNumber: number | null;
  lastCompletedDayKey: string | null;
};

export type SweepState = {
  boardSeed: string;
  mineIndex: number;
  winningIndex: number;
  selectedIndex: number | null;
  resolution: "armed" | "safe" | "explosion";
  preRevealed: number[];
};

export type PendingOrderResolution = {
  orderId: number;
  nextStatus: "collected" | "delivered";
} | null;

export type DriverPrepState = {
  version: 1;
  missionNumber: number;
  payloadCount: number;
  currentPayloadIndex: number;
  completedPayloadsCurrentMission: number;
  missionDayKey: string;
  missionCompletedForDay: boolean;
  phase: DriverPrepPhase;
  prepUploads: {
    t1: PrepUploadSlot;
    t2: PrepUploadSlot;
    t3: PrepUploadSlot;
  };
  sweep: SweepState;
  deployment: DeploymentProof;
  verification: VerificationState;
  postVerifyPhase: "next_target" | "mission_complete" | null;
  resolvedOrderIdsCurrentMission: number[];
  nextTargetLaunchPending: boolean;
  pendingOrderResolution: PendingOrderResolution;
  history: LifetimeCampaignStats;
  updatedAt: string;
};

export type DriverPrepAction =
  | { type: "HYDRATE"; state: DriverPrepState }
  | { type: "ROLL_TO_NEXT_DAY"; todayKey: string }
  | { type: "UPLOAD_PREP"; tier: 1 | 2 | 3; previewDataUrl: string; now: string }
  | { type: "ADVANCE_PREP_COMPLETE" }
  | { type: "ARM_SWEEP" }
  | { type: "SELECT_SWEEP_CELL"; index: number }
  | { type: "ADVANCE_AFTER_SAFE_HOLD" }
  | { type: "RESET_AFTER_EXPLOSION" }
  | { type: "UPLOAD_DEPLOY_PROOF"; previewDataUrl: string; now: string }
  | { type: "LOCK_DEPLOY_PROOF" }
  | { type: "START_VERIFY_COUNTDOWN"; startedAt: string; deadlineAt: string }
  | {
      type: "RESOLVE_VERIFY_SUCCESS";
      now: string;
      resolvedOrder?: {
        orderId: number;
        nextStatus: "collected" | "delivered";
      };
    }
  | {
      type: "RESOLVE_VERIFY_FAILURE";
      reason: VerificationFailureReason;
      now: string;
    }
  | { type: "ADVANCE_AFTER_VERIFY_SUCCESS" }
  | { type: "RETURN_TO_DEPLOY" }
  | { type: "ACK_ORDER_RESOLUTION" }
  | { type: "REGISTER_NEXT_TARGET_LAUNCH" }
  | { type: "CANCEL_NEXT_TARGET_LAUNCH" }
  | { type: "RESUME_AFTER_MAP_RETURN" }
  | { type: "ADVANCE_WITHOUT_MAP" };

const STORAGE_VERSION = 1 as const;

export function createEmptyUploadSlot(): PrepUploadSlot {
  return {
    status: "empty",
    previewDataUrl: null,
    completedAt: null,
  };
}

export function createEmptyDeploymentProof(): DeploymentProof {
  return {
    status: "empty",
    previewDataUrl: null,
    uploadedAt: null,
  };
}

export function createEmptyVerificationState(): VerificationState {
  return {
    startedAt: null,
    deadlineAt: null,
    result: "pending",
    failureReason: null,
  };
}

function hashString(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function buildPreRevealedCells(seed: number, mineIndex: number, winningIndex: number): number[] {
  const cells = new Set<number>();
  let cursor = seed;
  while (cells.size < 3) {
    cursor = (cursor * 1664525 + 1013904223) % 0x100000000;
    const next = cursor % 25;
    if (next !== mineIndex && next !== winningIndex) cells.add(next);
  }
  return Array.from(cells);
}

export function buildSweepState(
  missionNumber: number,
  currentPayloadIndex: number
): SweepState {
  const boardSeed = `${missionNumber}-${currentPayloadIndex}`;
  const seed = hashString(boardSeed);
  const mineIndex = seed % 25;
  let winningIndex = (seed * 7 + 11) % 25;
  if (winningIndex === mineIndex) {
    winningIndex = (winningIndex + 9) % 25;
  }
  return {
    boardSeed,
    mineIndex,
    winningIndex,
    selectedIndex: null,
    resolution: "armed",
    preRevealed: buildPreRevealedCells(seed, mineIndex, winningIndex),
  };
}

export function getMissionDayKey(date: Date = new Date()): string {
  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getNextMissionNumber(currentMission: number): number {
  return currentMission >= 30 ? 1 : currentMission + 1;
}

export function getPayloadCountForMission(missionNumber: number): number {
  const safeMission = Math.max(1, Math.min(30, missionNumber || 1));
  return safeMission;
}

function carryHistory(
  history?: Partial<LifetimeCampaignStats>
): LifetimeCampaignStats {
  return {
    payloadsDiffusedLifetime: history?.payloadsDiffusedLifetime ?? 0,
    missionsCompletedLifetime: history?.missionsCompletedLifetime ?? 0,
    lastCompletedMissionNumber: history?.lastCompletedMissionNumber ?? null,
    lastCompletedDayKey: history?.lastCompletedDayKey ?? null,
  };
}

export function createInitialDriverPrepState(
  missionNumber = 1,
  missionDayKey = getMissionDayKey(),
  history?: Partial<LifetimeCampaignStats>
): DriverPrepState {
  return {
    version: STORAGE_VERSION,
    missionNumber,
    payloadCount: getPayloadCountForMission(missionNumber),
    currentPayloadIndex: 1,
    completedPayloadsCurrentMission: 0,
    missionDayKey,
    missionCompletedForDay: false,
    phase: "prep_t1",
    prepUploads: {
      t1: createEmptyUploadSlot(),
      t2: createEmptyUploadSlot(),
      t3: createEmptyUploadSlot(),
    },
    sweep: buildSweepState(missionNumber, 1),
    deployment: createEmptyDeploymentProof(),
    verification: createEmptyVerificationState(),
    postVerifyPhase: null,
    resolvedOrderIdsCurrentMission: [],
    nextTargetLaunchPending: false,
    pendingOrderResolution: null,
    history: carryHistory(history),
    updatedAt: new Date().toISOString(),
  };
}

function advanceMissionForNewDay(state: DriverPrepState, todayKey: string): DriverPrepState {
  const nextMissionNumber = getNextMissionNumber(state.missionNumber);
  return createInitialDriverPrepState(nextMissionNumber, todayKey, state.history);
}

function sanitizeState(candidate: DriverPrepState): DriverPrepState {
  const payloadCount = getPayloadCountForMission(candidate.missionNumber);
  const currentPayloadIndex = Math.max(1, Math.min(payloadCount, candidate.currentPayloadIndex || 1));
  const completedPayloadsCurrentMission = Math.max(
    0,
    Math.min(payloadCount, candidate.completedPayloadsCurrentMission || 0)
  );

  return {
    ...candidate,
    version: STORAGE_VERSION,
    payloadCount,
    currentPayloadIndex,
    completedPayloadsCurrentMission,
    prepUploads: {
      t1: candidate.prepUploads?.t1 ?? createEmptyUploadSlot(),
      t2: candidate.prepUploads?.t2 ?? createEmptyUploadSlot(),
      t3: candidate.prepUploads?.t3 ?? createEmptyUploadSlot(),
    },
    deployment: candidate.deployment ?? createEmptyDeploymentProof(),
    verification: candidate.verification ?? createEmptyVerificationState(),
    postVerifyPhase: candidate.postVerifyPhase ?? null,
    sweep:
      candidate.sweep?.boardSeed &&
      typeof candidate.sweep.mineIndex === "number" &&
      typeof candidate.sweep.winningIndex === "number"
        ? candidate.sweep
        : buildSweepState(candidate.missionNumber, currentPayloadIndex),
    resolvedOrderIdsCurrentMission: candidate.resolvedOrderIdsCurrentMission ?? [],
    nextTargetLaunchPending: Boolean(candidate.nextTargetLaunchPending),
    pendingOrderResolution: candidate.pendingOrderResolution ?? null,
    history: carryHistory(candidate.history),
    updatedAt: candidate.updatedAt ?? new Date().toISOString(),
  };
}

export function normalizeHydratedDriverPrepState(
  candidate: unknown,
  todayKey: string
): DriverPrepState {
  if (!candidate || typeof candidate !== "object") {
    return createInitialDriverPrepState(1, todayKey);
  }

  const parsed = candidate as DriverPrepState;
  if (parsed.version !== STORAGE_VERSION) {
    return createInitialDriverPrepState(1, todayKey, parsed.history);
  }

  const sanitized = sanitizeState(parsed);
  if (
    sanitized.missionCompletedForDay &&
    sanitized.history.lastCompletedDayKey &&
    sanitized.history.lastCompletedDayKey !== todayKey
  ) {
    return advanceMissionForNewDay(sanitized, todayKey);
  }

  return sanitized;
}

function nextPrepPhase(tier: 1 | 2 | 3): DriverPrepPhase {
  if (tier === 1) return "prep_t2";
  if (tier === 2) return "prep_t3";
  return "prep_complete";
}

function stampUpdatedAt(state: DriverPrepState): DriverPrepState {
  return { ...state, updatedAt: new Date().toISOString() };
}

export function driverPrepReducer(
  state: DriverPrepState,
  action: DriverPrepAction
): DriverPrepState {
  switch (action.type) {
    case "HYDRATE":
      return sanitizeState(action.state);
    case "ROLL_TO_NEXT_DAY":
      if (!state.missionCompletedForDay) return state;
      if (state.history.lastCompletedDayKey === action.todayKey) return state;
      return advanceMissionForNewDay(state, action.todayKey);
    case "UPLOAD_PREP": {
      const key = `t${action.tier}` as "t1" | "t2" | "t3";
      const phase = nextPrepPhase(action.tier);
      return stampUpdatedAt({
        ...state,
        prepUploads: {
          ...state.prepUploads,
          [key]: {
            status: "uploaded",
            previewDataUrl: action.previewDataUrl,
            completedAt: action.now,
          },
        },
        phase,
      });
    }
    case "ADVANCE_PREP_COMPLETE":
      return stampUpdatedAt({ ...state, phase: "sweep_armed" });
    case "ARM_SWEEP":
      return stampUpdatedAt({
        ...state,
        phase: "sweep_armed",
        sweep: buildSweepState(state.missionNumber, state.currentPayloadIndex),
      });
    case "SELECT_SWEEP_CELL": {
      const isMine = action.index === state.sweep.mineIndex;
      return stampUpdatedAt({
        ...state,
        phase: isMine ? "sweep_resolved_explosion" : "sweep_resolved_safe",
        sweep: {
          ...state.sweep,
          selectedIndex: action.index,
          resolution: isMine ? "explosion" : "safe",
        },
      });
    }
    case "ADVANCE_AFTER_SAFE_HOLD":
      return stampUpdatedAt({ ...state, phase: "deploy_live" });
    case "RESET_AFTER_EXPLOSION":
      return stampUpdatedAt({
        ...state,
        currentPayloadIndex: 1,
        completedPayloadsCurrentMission: 0,
        phase: "sweep_armed",
        sweep: buildSweepState(state.missionNumber, 1),
        deployment: createEmptyDeploymentProof(),
        verification: createEmptyVerificationState(),
        postVerifyPhase: null,
        nextTargetLaunchPending: false,
      });
    case "UPLOAD_DEPLOY_PROOF":
      return stampUpdatedAt({
        ...state,
        deployment: {
          status: "uploaded",
          previewDataUrl: action.previewDataUrl,
          uploadedAt: action.now,
        },
      });
    case "LOCK_DEPLOY_PROOF":
      return stampUpdatedAt({ ...state, phase: "deploy_resolved" });
    case "START_VERIFY_COUNTDOWN":
      return stampUpdatedAt({
        ...state,
        phase: "verify_countdown",
        verification: {
          startedAt: action.startedAt,
          deadlineAt: action.deadlineAt,
          result: "pending",
          failureReason: null,
        },
      });
    case "RESOLVE_VERIFY_SUCCESS": {
      const completedPayloadsCurrentMission = state.completedPayloadsCurrentMission + 1;
      const payloadCount = state.payloadCount;
      const isMissionComplete = completedPayloadsCurrentMission >= payloadCount;
      const nextPayloadIndex = isMissionComplete
        ? payloadCount
        : Math.min(payloadCount, completedPayloadsCurrentMission + 1);

      return stampUpdatedAt({
        ...state,
        completedPayloadsCurrentMission,
        currentPayloadIndex: nextPayloadIndex,
        phase: "verify_success",
        deployment: createEmptyDeploymentProof(),
        verification: {
          startedAt: state.verification.startedAt,
          deadlineAt: state.verification.deadlineAt,
          result: "success",
          failureReason: null,
        },
        postVerifyPhase: isMissionComplete ? "mission_complete" : "next_target",
        sweep: buildSweepState(state.missionNumber, nextPayloadIndex),
        missionCompletedForDay: isMissionComplete,
        nextTargetLaunchPending: false,
        pendingOrderResolution: action.resolvedOrder ?? null,
        resolvedOrderIdsCurrentMission: action.resolvedOrder
          ? [...state.resolvedOrderIdsCurrentMission, action.resolvedOrder.orderId]
          : state.resolvedOrderIdsCurrentMission,
        history: {
          ...state.history,
          payloadsDiffusedLifetime: state.history.payloadsDiffusedLifetime + 1,
          missionsCompletedLifetime: isMissionComplete
            ? state.history.missionsCompletedLifetime + 1
            : state.history.missionsCompletedLifetime,
          lastCompletedMissionNumber: isMissionComplete
            ? state.missionNumber
            : state.history.lastCompletedMissionNumber,
          lastCompletedDayKey: isMissionComplete
            ? state.missionDayKey
            : state.history.lastCompletedDayKey,
        },
      });
    }
    case "RESOLVE_VERIFY_FAILURE":
      return stampUpdatedAt({
        ...state,
        phase: "verify_failed",
        verification: {
          startedAt: state.verification.startedAt,
          deadlineAt: state.verification.deadlineAt,
          result: "failed",
          failureReason: action.reason,
        },
        postVerifyPhase: null,
        nextTargetLaunchPending: false,
      });
    case "ADVANCE_AFTER_VERIFY_SUCCESS":
      return stampUpdatedAt({
        ...state,
        phase: state.postVerifyPhase ?? "next_target",
        postVerifyPhase: null,
      });
    case "RETURN_TO_DEPLOY":
      return stampUpdatedAt({
        ...state,
        phase: "deploy_live",
        verification: createEmptyVerificationState(),
        postVerifyPhase: null,
        nextTargetLaunchPending: false,
      });
    case "ACK_ORDER_RESOLUTION":
      return stampUpdatedAt({ ...state, pendingOrderResolution: null });
    case "REGISTER_NEXT_TARGET_LAUNCH":
      return stampUpdatedAt({ ...state, nextTargetLaunchPending: true });
    case "CANCEL_NEXT_TARGET_LAUNCH":
      return stampUpdatedAt({ ...state, nextTargetLaunchPending: false });
    case "RESUME_AFTER_MAP_RETURN":
    case "ADVANCE_WITHOUT_MAP":
      return stampUpdatedAt({
        ...state,
        phase: "sweep_armed",
        nextTargetLaunchPending: false,
        deployment: createEmptyDeploymentProof(),
        verification: createEmptyVerificationState(),
        postVerifyPhase: null,
        sweep: buildSweepState(state.missionNumber, state.currentPayloadIndex),
      });
    default:
      return state;
  }
}
