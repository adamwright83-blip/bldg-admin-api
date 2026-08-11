import type { PlayableMission } from "./GameState";

/**
 * Selects and paces which real missions get spotlighted, without ever
 * inventing urgency. Every tier below is grounded in a real signal already
 * present on PlayableMission (world state, a sourced contestedUntil/expiresAt
 * timestamp, whether a decision-maker phone was actually captured, whether
 * FIELD actually produced a move) — never a synthetic score.
 */
export type MissionDirectorSelection = {
  primary: PlayableMission | null;
  /** Up to 2 — deliberately capped so the world never becomes icon landfill. */
  secondary: PlayableMission[];
};

function priorityTier(mission: PlayableMission, now: Date): number {
  // 0: actively being recovered — the player already started this, real momentum.
  if (mission.state === "recovery_active") return 0;
  // 1: a real follow-up window has actually elapsed — genuinely due now.
  if (mission.state === "contested" && mission.contestedUntil && new Date(mission.contestedUntil) <= now) {
    return 1;
  }
  // 2: contested but not yet due — still worth surfacing, just not urgent.
  if (mission.state === "contested") return 2;
  // 3: a real decision-maker phone number exists and the mission is live —
  // immediately actionable right now.
  if ((mission.state === "active" || mission.state === "approaching") && mission.phoneUrl) return 3;
  // 4: FIELD actually produced a move for this — real, ready, unstarted.
  if (mission.state === "available" && mission.moveId != null) return 4;
  // 5: anything else live but without a stronger real signal.
  // 6: explicitly a waiting state — real, but lowest spotlight priority.
  if (mission.state === "watching" || mission.state === "recovery_available") return 6;
  return 5;
}

/** Earliest real sourced timestamp on the mission, or +Infinity if none exists — never fabricated. */
function tieBreakTime(mission: PlayableMission): number {
  const sourced = mission.contestedUntil ?? mission.expiresAt;
  if (!sourced) return Number.POSITIVE_INFINITY;
  const parsed = new Date(sourced).getTime();
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

/**
 * Pure and deterministic: the same mission list and `now` always produce
 * the same ordering, so a reload never reshuffles the world for no reason.
 */
export function selectMissionDirector(
  missions: PlayableMission[],
  now: Date
): MissionDirectorSelection {
  const ranked = [...missions].sort((a, b) => {
    const tierDelta = priorityTier(a, now) - priorityTier(b, now);
    if (tierDelta !== 0) return tierDelta;
    const timeDelta = tieBreakTime(a) - tieBreakTime(b);
    if (timeDelta !== 0) return timeDelta;
    return a.key.localeCompare(b.key);
  });
  return {
    primary: ranked[0] ?? null,
    secondary: ranked.slice(1, 3),
  };
}
