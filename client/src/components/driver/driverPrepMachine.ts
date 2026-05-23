export type DriverPrepPhase =
  | "command_center"
  | "order_detail"
  | "prep_t1"
  | "prep_t2"
  | "prep_t3"
  | "prep_complete"
  | "laundry_run"
  | "mission_briefing"
  | "flyer_proof"
  | "signal_override"
  | "verify_success"
  | "verify_failed"
  | "next_target"
  | "mission_complete";

export type VerificationFailureReason =
  | "timeout"
  | "missing_upload"
  | "manual_test_failure";

export type PrepUploadSlot = {
  status: "empty" | "previewed" | "secured";
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
  totalXp: number;
  streakDays: number;
};

export type PendingOrderResolution = {
  orderId: number;
  nextStatus: "collected" | "delivered";
} | null;

export type DriverPrepState = {
  version: 2;
  missionNumber: number;
  payloadCount: number;
  currentPayloadIndex: number;
  completedPayloadsCurrentMission: number;
  missionDayKey: string;
  missionCompletedForDay: boolean;
  phase: DriverPrepPhase;
  currentOrderId: number | null;
  prepUploads: {
    t1: PrepUploadSlot;
    t2: PrepUploadSlot;
    t3: PrepUploadSlot;
  };
  laundryRunScore: number;
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
  | { type: "SELECT_ORDER"; orderId: number }
  | { type: "BACK_TO_COMMAND_CENTER" }
  | { type: "START_RUN_FROM_ORDER" }
  | { type: "SET_PREP_PREVIEW"; tier: 1 | 2 | 3; previewDataUrl: string }
  | { type: "SECURE_PREP_TASK"; tier: 1 | 2 | 3; now: string }
  | { type: "ADVANCE_PREP_COMPLETE" }
  | { type: "COMPLETE_LAUNDRY_RUN"; score: number }
  | { type: "ADVANCE_TO_FLYER_PROOF" }
  | {
      type: "COMPLETE_FLYER_PROOF";
      previewDataUrl?: string | null;
    }
  | { type: "START_SIGNAL_OVERRIDE"; startedAt: string; deadlineAt: string }
  | {
      type: "RESOLVE_VERIFY_SUCCESS";
      now: string;
      resolvedOrder?: {
        orderId: number;
        nextStatus: "collected" | "delivered";
      };
      xpAwarded?: number;
    }
  | {
      type: "RESOLVE_VERIFY_FAILURE";
      reason: VerificationFailureReason;
      now: string;
    }
  | { type: "ADVANCE_AFTER_VERIFY_SUCCESS" }
  | { type: "ACK_VERIFY_FAILURE" }
  | { type: "ACK_ORDER_RESOLUTION" }
  | {
      type: "SKIP_GAMES_TO_COMMAND_CENTER";
      resolvedOrder?: {
        orderId: number;
        nextStatus: "collected" | "delivered";
      };
    }
  | { type: "REGISTER_NEXT_TARGET_LAUNCH" }
  | { type: "CANCEL_NEXT_TARGET_LAUNCH" }
  | { type: "RESUME_AFTER_MAP_RETURN" }
  | { type: "ADVANCE_WITHOUT_MAP" };

const STORAGE_VERSION = 2 as const;

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

/** True when `nextDayKey` is exactly one calendar day after `prevDayKey` (both YYYY-MM-DD). */
export function isConsecutiveDay(
  prevDayKey: string | null,
  nextDayKey: string
): boolean {
  if (!prevDayKey) return false;
  const prev = new Date(`${prevDayKey}T00:00:00`);
  const next = new Date(`${nextDayKey}T00:00:00`);
  if (Number.isNaN(prev.getTime()) || Number.isNaN(next.getTime())) return false;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.round((next.getTime() - prev.getTime()) / dayMs) === 1;
}

function carryHistory(
  history?: Partial<LifetimeCampaignStats>
): LifetimeCampaignStats {
  return {
    payloadsDiffusedLifetime: history?.payloadsDiffusedLifetime ?? 0,
    missionsCompletedLifetime: history?.missionsCompletedLifetime ?? 0,
    lastCompletedMissionNumber: history?.lastCompletedMissionNumber ?? null,
    lastCompletedDayKey: history?.lastCompletedDayKey ?? null,
    totalXp: history?.totalXp ?? 0,
    streakDays: history?.streakDays ?? 0,
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
    phase: "command_center",
    currentOrderId: null,
    prepUploads: {
      t1: createEmptyUploadSlot(),
      t2: createEmptyUploadSlot(),
      t3: createEmptyUploadSlot(),
    },
    laundryRunScore: 0,
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

function normalizePrepUploadSlot(
  slot:
    | PrepUploadSlot
    | {
        status?: string;
        previewDataUrl?: string | null;
        completedAt?: string | null;
      }
    | undefined
): PrepUploadSlot {
  if (!slot) return createEmptyUploadSlot();
  const normalizedStatus =
    slot.status === "secured" || slot.status === "previewed" || slot.status === "empty"
      ? slot.status
      : slot.status === "uploaded"
        ? "previewed"
        : "empty";

  return {
    status: normalizedStatus,
    previewDataUrl: slot.previewDataUrl ?? null,
    completedAt: normalizedStatus === "secured" ? slot.completedAt ?? null : null,
  };
}

/** First prep phase whose upload slot is not yet `secured`, or null if all three are done. */
function firstPendingPrepPhase(
  state: DriverPrepState["prepUploads"]
): DriverPrepPhase | null {
  if (state.t1.status !== "secured") return "prep_t1";
  if (state.t2.status !== "secured") return "prep_t2";
  if (state.t3.status !== "secured") return "prep_t3";
  return null;
}

function advanceMissionForNewDay(
  state: DriverPrepState,
  todayKey: string
): DriverPrepState {
  const nextMissionNumber = getNextMissionNumber(state.missionNumber);
  return createInitialDriverPrepState(nextMissionNumber, todayKey, state.history);
}

const VALID_PHASES: ReadonlySet<DriverPrepPhase> = new Set<DriverPrepPhase>([
  "command_center",
  "order_detail",
  "prep_t1",
  "prep_t2",
  "prep_t3",
  "prep_complete",
  "laundry_run",
  "mission_briefing",
  "flyer_proof",
  "signal_override",
  "verify_success",
  "verify_failed",
  "next_target",
  "mission_complete",
]);

/** Phases that require prep to already be fully secured. */
const GAME_PHASES: ReadonlySet<DriverPrepPhase> = new Set<DriverPrepPhase>([
  "laundry_run",
  "mission_briefing",
  "flyer_proof",
  "signal_override",
  "verify_success",
  "verify_failed",
  "next_target",
  "mission_complete",
]);

function sanitizeState(candidate: DriverPrepState): DriverPrepState {
  const payloadCount = getPayloadCountForMission(candidate.missionNumber);
  const currentPayloadIndex = Math.max(
    1,
    Math.min(payloadCount, candidate.currentPayloadIndex || 1)
  );
  const completedPayloadsCurrentMission = Math.max(
    0,
    Math.min(payloadCount, candidate.completedPayloadsCurrentMission || 0)
  );
  const phase = VALID_PHASES.has(candidate.phase) ? candidate.phase : "command_center";

  return {
    ...candidate,
    version: STORAGE_VERSION,
    payloadCount,
    currentPayloadIndex,
    completedPayloadsCurrentMission,
    phase,
    currentOrderId:
      typeof candidate.currentOrderId === "number" ? candidate.currentOrderId : null,
    prepUploads: {
      t1: normalizePrepUploadSlot(candidate.prepUploads?.t1),
      t2: normalizePrepUploadSlot(candidate.prepUploads?.t2),
      t3: normalizePrepUploadSlot(candidate.prepUploads?.t3),
    },
    laundryRunScore: Math.max(0, Math.floor(candidate.laundryRunScore ?? 0)),
    deployment: candidate.deployment ?? createEmptyDeploymentProof(),
    verification: candidate.verification ?? createEmptyVerificationState(),
    postVerifyPhase: candidate.postVerifyPhase ?? null,
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

  // If we restored into a game phase (laundry_run → mission_complete) but prep
  // isn't fully secured, bounce back to the first pending prep step so the
  // reducer invariant "game phases require prep secured" holds.
  const pendingPrepPhase = firstPendingPrepPhase(sanitized.prepUploads);
  if (
    pendingPrepPhase &&
    !sanitized.missionCompletedForDay &&
    GAME_PHASES.has(sanitized.phase)
  ) {
    return {
      ...sanitized,
      phase: pendingPrepPhase,
      currentPayloadIndex: 1,
      completedPayloadsCurrentMission: 0,
      laundryRunScore: 0,
      deployment: createEmptyDeploymentProof(),
      verification: createEmptyVerificationState(),
      postVerifyPhase: null,
      resolvedOrderIdsCurrentMission: [],
      nextTargetLaunchPending: false,
      pendingOrderResolution: null,
    };
  }

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

/** Shared reset used by both the hard failure penalty and the map-return refresh paths. */
function resetPayloadLoopToOne(state: DriverPrepState): DriverPrepState {
  return {
    ...state,
    currentPayloadIndex: 1,
    completedPayloadsCurrentMission: 0,
    laundryRunScore: 0,
    deployment: createEmptyDeploymentProof(),
    verification: createEmptyVerificationState(),
    postVerifyPhase: null,
    resolvedOrderIdsCurrentMission: [],
    pendingOrderResolution: null,
    nextTargetLaunchPending: false,
  };
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
    case "SELECT_ORDER":
      if (state.missionCompletedForDay) return state;
      return stampUpdatedAt({
        ...state,
        phase: "order_detail",
        currentOrderId: action.orderId,
      });
    case "BACK_TO_COMMAND_CENTER":
      return stampUpdatedAt({
        ...state,
        phase: "command_center",
        currentOrderId: null,
      });
    case "START_RUN_FROM_ORDER": {
      if (state.missionCompletedForDay) return state;
      const pendingPrep = firstPendingPrepPhase(state.prepUploads);
      return stampUpdatedAt({
        ...state,
        phase: pendingPrep ?? "laundry_run",
      });
    }
    case "SET_PREP_PREVIEW": {
      if (state.phase !== `prep_t${action.tier}`) return state;
      const key = `t${action.tier}` as "t1" | "t2" | "t3";
      return stampUpdatedAt({
        ...state,
        prepUploads: {
          ...state.prepUploads,
          [key]: {
            ...state.prepUploads[key],
            status: "previewed",
            previewDataUrl: action.previewDataUrl,
            completedAt: null,
          },
        },
      });
    }
    case "SECURE_PREP_TASK": {
      if (state.phase !== `prep_t${action.tier}`) return state;
      const key = `t${action.tier}` as "t1" | "t2" | "t3";
      const phase = nextPrepPhase(action.tier);
      return stampUpdatedAt({
        ...state,
        prepUploads: {
          ...state.prepUploads,
          [key]: {
            ...state.prepUploads[key],
            status: "secured",
            completedAt: action.now,
          },
        },
        phase,
      });
    }
    case "ADVANCE_PREP_COMPLETE":
      return stampUpdatedAt({ ...state, phase: "laundry_run" });
    case "COMPLETE_LAUNDRY_RUN":
      return stampUpdatedAt({
        ...state,
        phase: "mission_briefing",
        laundryRunScore: Math.max(0, Math.floor(action.score)),
      });
    case "ADVANCE_TO_FLYER_PROOF":
      if (state.phase !== "mission_briefing") return state;
      return stampUpdatedAt({
        ...state,
        phase: "flyer_proof",
      });
    case "COMPLETE_FLYER_PROOF":
      if (state.phase !== "flyer_proof") return state;
      return stampUpdatedAt({
        ...state,
        phase: "signal_override",
        deployment: {
          status: "uploaded",
          previewDataUrl: action.previewDataUrl ?? null,
          uploadedAt: new Date().toISOString(),
        },
      });
    case "START_SIGNAL_OVERRIDE":
      if (state.phase !== "signal_override") return state;
      return stampUpdatedAt({
        ...state,
        phase: "signal_override",
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
      const xpDelta = Math.max(0, Math.floor(action.xpAwarded ?? 0));

      const nextStreak = isMissionComplete
        ? isConsecutiveDay(state.history.lastCompletedDayKey, state.missionDayKey)
          ? state.history.streakDays + 1
          : 1
        : state.history.streakDays;

      return stampUpdatedAt({
        ...state,
        completedPayloadsCurrentMission,
        currentPayloadIndex: nextPayloadIndex,
        phase: "verify_success",
        laundryRunScore: 0,
        deployment: createEmptyDeploymentProof(),
        verification: {
          startedAt: state.verification.startedAt,
          deadlineAt: state.verification.deadlineAt,
          result: "success",
          failureReason: null,
        },
        postVerifyPhase: isMissionComplete ? "mission_complete" : "next_target",
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
          totalXp: state.history.totalXp + xpDelta,
          streakDays: nextStreak,
        },
      });
    }
    case "RESOLVE_VERIFY_FAILURE":
      // Decision A: hard reset — payload loop snaps back to 1, keeping prep
      // secured, mission number, and lifetime history untouched. User sees the
      // failed verify screen first; ACK_VERIFY_FAILURE then sends them back to
      // laundry_run to redo the full loop.
      return stampUpdatedAt({
        ...resetPayloadLoopToOne(state),
        phase: "verify_failed",
        verification: {
          startedAt: state.verification.startedAt,
          deadlineAt: state.verification.deadlineAt,
          result: "failed",
          failureReason: action.reason,
        },
      });
    case "ADVANCE_AFTER_VERIFY_SUCCESS":
      return stampUpdatedAt({
        ...state,
        phase: state.postVerifyPhase ?? "next_target",
        postVerifyPhase: null,
      });
    case "ACK_VERIFY_FAILURE":
      return stampUpdatedAt({
        ...state,
        phase: "laundry_run",
        verification: createEmptyVerificationState(),
      });
    case "ACK_ORDER_RESOLUTION":
      return stampUpdatedAt({ ...state, pendingOrderResolution: null });
    case "SKIP_GAMES_TO_COMMAND_CENTER": {
      const resolvedOrderIdsCurrentMission = action.resolvedOrder
        ? state.resolvedOrderIdsCurrentMission.includes(
            action.resolvedOrder.orderId
          )
          ? state.resolvedOrderIdsCurrentMission
          : [
              ...state.resolvedOrderIdsCurrentMission,
              action.resolvedOrder.orderId,
            ]
        : state.resolvedOrderIdsCurrentMission;

      return stampUpdatedAt({
        ...state,
        phase: "command_center",
        currentOrderId: null,
        laundryRunScore: 0,
        deployment: createEmptyDeploymentProof(),
        verification: createEmptyVerificationState(),
        postVerifyPhase: null,
        resolvedOrderIdsCurrentMission,
        nextTargetLaunchPending: false,
        pendingOrderResolution: action.resolvedOrder ?? null,
      });
    }
    case "REGISTER_NEXT_TARGET_LAUNCH":
      return stampUpdatedAt({ ...state, nextTargetLaunchPending: true });
    case "CANCEL_NEXT_TARGET_LAUNCH":
      return stampUpdatedAt({ ...state, nextTargetLaunchPending: false });
    case "RESUME_AFTER_MAP_RETURN":
    case "ADVANCE_WITHOUT_MAP":
      return stampUpdatedAt({
        ...state,
        phase: "laundry_run",
        nextTargetLaunchPending: false,
        deployment: createEmptyDeploymentProof(),
        verification: createEmptyVerificationState(),
        postVerifyPhase: null,
      });
    default:
      return state;
  }
}
