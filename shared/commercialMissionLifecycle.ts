import type {
  CommercialMission,
  CommercialMissionStatus,
} from "./commercialMission";

const ALLOWED_TRANSITIONS: Record<CommercialMissionStatus, CommercialMissionStatus[]> = {
  candidate: ["selected", "lost"],
  selected: ["game_ready", "lost"],
  game_ready: ["game_active", "lost"],
  game_active: ["game_completed", "game_ready", "lost"],
  game_completed: ["phone_ready"],
  phone_ready: ["preparing", "lost"],
  preparing: ["en_route", "phone_ready", "lost"],
  en_route: ["arrived", "preparing", "lost"],
  arrived: ["visit_completed", "en_route", "lost"],
  visit_completed: ["follow_up", "won", "lost"],
  follow_up: ["won", "lost", "visit_completed"],
  won: [],
  lost: ["selected"],
};

export type CommercialMissionEventName =
  | "mission_selected"
  | "game_unlocked"
  | "game_started"
  | "game_completed"
  | "phone_unlocked"
  | "preparation_started"
  | "departed"
  | "arrived"
  | "visit_completed"
  | "follow_up_required"
  | "account_won"
  | "account_lost"
  | "mission_reopened";

export type CommercialMissionLifecycleEvent = {
  eventName: CommercialMissionEventName;
  missionId: number;
  missionCode: string;
  fromStatus: CommercialMissionStatus;
  toStatus: CommercialMissionStatus;
  occurredAt: string;
  actorType: "system" | "operator" | "driver" | "game";
  actorId: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

const EVENT_BY_TRANSITION: Partial<
  Record<CommercialMissionStatus, Partial<Record<CommercialMissionStatus, CommercialMissionEventName>>>
> = {
  candidate: { selected: "mission_selected", lost: "account_lost" },
  selected: { game_ready: "game_unlocked", lost: "account_lost" },
  game_ready: { game_active: "game_started", lost: "account_lost" },
  game_active: {
    game_completed: "game_completed",
    game_ready: "mission_reopened",
    lost: "account_lost",
  },
  game_completed: { phone_ready: "phone_unlocked" },
  phone_ready: { preparing: "preparation_started", lost: "account_lost" },
  preparing: {
    en_route: "departed",
    phone_ready: "mission_reopened",
    lost: "account_lost",
  },
  en_route: {
    arrived: "arrived",
    preparing: "mission_reopened",
    lost: "account_lost",
  },
  arrived: {
    visit_completed: "visit_completed",
    en_route: "mission_reopened",
    lost: "account_lost",
  },
  visit_completed: {
    follow_up: "follow_up_required",
    won: "account_won",
    lost: "account_lost",
  },
  follow_up: {
    won: "account_won",
    lost: "account_lost",
    visit_completed: "mission_reopened",
  },
  lost: { selected: "mission_reopened" },
};

export function canTransitionCommercialMission(
  fromStatus: CommercialMissionStatus,
  toStatus: CommercialMissionStatus
): boolean {
  return ALLOWED_TRANSITIONS[fromStatus].includes(toStatus);
}

export function transitionCommercialMission(
  mission: CommercialMission,
  toStatus: CommercialMissionStatus,
  input: {
    actorType: CommercialMissionLifecycleEvent["actorType"];
    actorId?: string | null;
    occurredAt?: string;
    metadata?: Record<string, unknown>;
  }
): {
  mission: CommercialMission;
  event: CommercialMissionLifecycleEvent;
} {
  if (!canTransitionCommercialMission(mission.status, toStatus)) {
    throw new Error(
      `Invalid commercial mission transition: ${mission.status} -> ${toStatus}`
    );
  }

  const eventName = EVENT_BY_TRANSITION[mission.status]?.[toStatus];
  if (!eventName) {
    throw new Error(
      `Missing lifecycle event mapping: ${mission.status} -> ${toStatus}`
    );
  }

  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const event: CommercialMissionLifecycleEvent = {
    eventName,
    missionId: mission.id,
    missionCode: mission.code,
    fromStatus: mission.status,
    toStatus,
    occurredAt,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    idempotencyKey: `${mission.tenantId}:${mission.id}:${eventName}:${occurredAt}`,
    metadata: input.metadata,
  };

  return {
    mission: {
      ...mission,
      status: toStatus,
    },
    event,
  };
}

export function isTerminalCommercialMissionStatus(
  status: CommercialMissionStatus
): boolean {
  return status === "won" || status === "lost";
}
