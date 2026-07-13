import type { CommercialMissionStatus } from "./commercialMission";

const ALLOWED_TRANSITIONS: Record<CommercialMissionStatus, readonly CommercialMissionStatus[]> = {
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
  follow_up: ["visit_completed", "won", "lost"],
  won: [],
  lost: ["selected"],
};

export const EVENT_BY_TRANSITION: Partial<
  Record<CommercialMissionStatus, Partial<Record<CommercialMissionStatus, string>>>
> = {
  candidate: { selected: "mission_selected", lost: "account_lost" },
  selected: { game_ready: "game_unlocked", lost: "account_lost" },
  game_ready: { game_active: "game_started", lost: "account_lost" },
  game_active: { game_completed: "game_completed", game_ready: "game_abandoned", lost: "account_lost" },
  game_completed: { phone_ready: "phone_unlocked" },
  phone_ready: { preparing: "preparation_started", lost: "account_lost" },
  preparing: { en_route: "departed", phone_ready: "preparation_paused", lost: "account_lost" },
  en_route: { arrived: "arrived", preparing: "route_paused", lost: "account_lost" },
  arrived: { visit_completed: "visit_completed", en_route: "arrival_reverted", lost: "account_lost" },
  visit_completed: { follow_up: "follow_up_required", won: "account_won", lost: "account_lost" },
  follow_up: { visit_completed: "follow_up_reopened", won: "account_won", lost: "account_lost" },
  lost: { selected: "mission_reopened" },
};

export function canTransitionCommercialMission(
  from: CommercialMissionStatus,
  to: CommercialMissionStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function eventNameForCommercialMissionTransition(
  from: CommercialMissionStatus,
  to: CommercialMissionStatus,
): string {
  if (!canTransitionCommercialMission(from, to)) {
    throw new Error(`Invalid commercial mission transition: ${from} -> ${to}`);
  }
  const eventName = EVENT_BY_TRANSITION[from]?.[to];
  if (!eventName) throw new Error(`Missing commercial mission event mapping: ${from} -> ${to}`);
  return eventName;
}
