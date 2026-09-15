/**
 * Slice 4 §4 — time pockets, derived from scheduled windows only.
 *
 * getFieldToday's own dataQuality admits order addresses carry no verified
 * coordinates and travel duration is unavailable. So this never computes
 * travel time — travelReserveMinutes is a single named, editable safety
 * margin, not a distance calculation. A pocket bounded by an item with no
 * real scheduledAt is never emitted as a between_stops pocket; only a fully
 * unscheduled day gets the open_ended pocket, which never claims a minute
 * count.
 */
import type { TimePocket } from "./missionDirectorTypes";

export const DEFAULT_TRAVEL_RESERVE_MINUTES = 15;
/** Conservative named deduction when stop service/work duration is unknown. Not a measured duration. */
export const DEFAULT_UNKNOWN_STOP_WORK_RESERVE_MINUTES = 10;

type ScheduledItem = {
  id: string;
  title: string;
  scheduledAt: string | null;
  kind: string;
  /** Measured stop/service duration in minutes when an authoritative source supplies it. */
  durationMinutes?: number | null;
};

const FIXED_KINDS = new Set(["pickup", "delivery", "job"]);

export function detectTimePockets(input: {
  timeline: readonly ScheduledItem[];
  travelReserveMinutes?: number;
  unknownStopWorkReserveMinutes?: number;
}): TimePocket[] {
  const travelReserveMinutes =
    input.travelReserveMinutes ?? DEFAULT_TRAVEL_RESERVE_MINUTES;
  const unknownStopWorkReserveMinutes =
    input.unknownStopWorkReserveMinutes ?? DEFAULT_UNKNOWN_STOP_WORK_RESERVE_MINUTES;
  const fixed = input.timeline
    .filter(item => FIXED_KINDS.has(item.kind) && item.scheduledAt)
    .map(item => ({ ...item, at: Date.parse(item.scheduledAt!) }))
    .filter(item => Number.isFinite(item.at))
    .sort((a, b) => a.at - b.at);

  if (fixed.length === 0) {
    return [
      {
        startsAt: null,
        endsAt: null,
        minutes: null,
        kind: "open_ended",
        boundedBy: { before: null, after: null },
        travelReserveMinutes,
        unknownStopWorkReserveMinutes: null,
        usableMinutes: null,
        confidence: "low",
        warnings: [
          "No fixed scheduled commitments for this day — pocket duration cannot be claimed, only that the day is open.",
          "Travel duration is unavailable; travelReserveMinutes is a named safety reserve, not verified travel time.",
        ],
      },
    ];
  }

  const pockets: TimePocket[] = [];
  for (let i = 0; i < fixed.length - 1; i += 1) {
    const before = fixed[i];
    const after = fixed[i + 1];
    const minutes = Math.max(0, Math.round((after.at - before.at) / 60_000));
    const measuredStopWork = before.durationMinutes;
    const stopWorkMinutes =
      measuredStopWork != null && Number.isFinite(measuredStopWork)
        ? Math.max(0, Math.round(measuredStopWork))
        : unknownStopWorkReserveMinutes;
    const usableMinutes = Math.max(
      0,
      minutes - travelReserveMinutes - stopWorkMinutes
    );
    const warnings = [
      "Travel duration is unavailable; travelReserveMinutes is a named safety reserve, not verified travel time.",
    ];
    if (measuredStopWork != null && Number.isFinite(measuredStopWork)) {
      warnings.push(
        `Stop service duration of ${stopWorkMinutes} minutes was used from the scheduled item.`
      );
    } else {
      warnings.push(
        "Stop service duration is unknown; unknownStopWorkReserveMinutes is a named conservative assumption, not a measured duration."
      );
    }
    pockets.push({
      startsAt: before.scheduledAt,
      endsAt: after.scheduledAt,
      minutes,
      kind: "between_stops",
      boundedBy: { before: before.id, after: after.id },
      travelReserveMinutes,
      unknownStopWorkReserveMinutes:
        measuredStopWork != null && Number.isFinite(measuredStopWork)
          ? null
          : unknownStopWorkReserveMinutes,
      usableMinutes,
      confidence: "high",
      warnings,
    });
  }
  return pockets;
}
