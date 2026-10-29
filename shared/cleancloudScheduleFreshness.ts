/**
 * Whether the Driver's CleanCloud schedule can be trusted right now.
 *
 * Three separate claims, never merged into one green "synced":
 *   connected — CleanCloud answered the last pickup read without an error;
 *   current   — that read is recent enough to plan on (SCHEDULE_CURRENT_MINUTES);
 *   complete  — every kind of CleanCloud job the route depends on is covered.
 *
 * Pickups come from the Gumballpals bridge, which saves a snapshot only when
 * its row count matches CleanCloud's own pickup counter, so a current pickup
 * snapshot is a complete pickup list. Deliveries have no CleanCloud source
 * today, so a CleanCloud schedule is never `complete` until one exists. A
 * business that does not run on CleanCloud is `applicable: false` and nothing
 * here limits it.
 */

export const SCHEDULE_CURRENT_MINUTES = 10;

export type ScheduleGap =
  | "freshness_unreadable"
  | "pickups_not_connected"
  | "pickups_capture_failed"
  | "pickups_stale"
  | "deliveries_not_synced";

export type ScheduleFreshness = {
  applicable: boolean;
  connected: boolean;
  current: boolean;
  complete: boolean;
  pickupsVerifiedAt: string | null;
  pickupsAgeMinutes: number | null;
  gaps: ScheduleGap[];
  /** One line for the Driver. Empty when not applicable. */
  label: string;
  tone: "ok" | "warn" | "alert";
};

export type ScheduleSourceFacts = {
  usesCleanCloud: boolean;
  pickupConnection: {
    enabled: boolean;
    capturedAt: Date | null;
    lastError: string | null;
  } | null;
  /** No server-side CleanCloud delivery feed exists yet. */
  deliveriesSynced: boolean;
};

export const NOT_APPLICABLE_SCHEDULE: ScheduleFreshness = {
  applicable: false,
  connected: false,
  current: false,
  complete: true,
  pickupsVerifiedAt: null,
  pickupsAgeMinutes: null,
  gaps: [],
  label: "",
  tone: "ok",
};

export function unreadableScheduleFreshness(): ScheduleFreshness {
  return {
    applicable: true,
    connected: false,
    current: false,
    complete: false,
    pickupsVerifiedAt: null,
    pickupsAgeMinutes: null,
    gaps: ["freshness_unreadable"],
    label:
      "Couldn't check the CleanCloud schedule. This route may be missing jobs.",
    tone: "alert",
  };
}

function clockLabel(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

export function assessScheduleFreshness(
  facts: ScheduleSourceFacts,
  now: Date,
  timeZone = "America/Los_Angeles"
): ScheduleFreshness {
  if (!facts.usesCleanCloud) return NOT_APPLICABLE_SCHEDULE;
  const connection = facts.pickupConnection;
  const capturedAt = connection?.capturedAt ?? null;
  const gaps: ScheduleGap[] = [];
  const ageMinutes =
    capturedAt && Number.isFinite(capturedAt.getTime())
      ? Math.max(0, Math.floor((now.getTime() - capturedAt.getTime()) / 60_000))
      : null;

  const connected = Boolean(
    connection?.enabled && capturedAt && !connection.lastError
  );
  if (!connection?.enabled || !capturedAt) gaps.push("pickups_not_connected");
  else if (connection.lastError) gaps.push("pickups_capture_failed");
  const current =
    connected && ageMinutes != null && ageMinutes <= SCHEDULE_CURRENT_MINUTES;
  if (connected && !current) gaps.push("pickups_stale");
  if (!facts.deliveriesSynced) gaps.push("deliveries_not_synced");
  const complete = current && facts.deliveriesSynced;

  const verified = capturedAt ? clockLabel(capturedAt, timeZone) : null;
  let label: string;
  let tone: ScheduleFreshness["tone"];
  if (!connection?.enabled || !capturedAt) {
    label =
      "CleanCloud pickups aren't connected. This route may be missing jobs.";
    tone = "alert";
  } else if (connection.lastError) {
    label = `CleanCloud didn't answer the last pickup read (last good read ${verified}). This route may be missing jobs.`;
    tone = "alert";
  } else if (!current) {
    label = `CleanCloud pickups last verified ${verified}, not current. This route may be missing jobs.`;
    tone = "alert";
  } else if (!facts.deliveriesSynced) {
    label = `CleanCloud pickups verified ${verified}. Deliveries aren't synced from CleanCloud yet.`;
    tone = "warn";
  } else {
    label = `CleanCloud pickups and deliveries verified ${verified}.`;
    tone = "ok";
  }

  return {
    applicable: true,
    connected,
    current,
    complete,
    pickupsVerifiedAt: capturedAt ? capturedAt.toISOString() : null,
    pickupsAgeMinutes: ageMinutes,
    gaps,
    label,
    tone,
  };
}

/** Day Line omission labels Claire speaks ("I could not read X, so this is not the full Day Line."). */
export function scheduleOmissions(freshness: ScheduleFreshness): string[] {
  if (!freshness.applicable || freshness.complete) return [];
  const out: string[] = [];
  if (freshness.gaps.includes("freshness_unreadable"))
    return ["cleancloud_schedule"];
  if (!freshness.current) out.push("cleancloud_pickups");
  if (freshness.gaps.includes("deliveries_not_synced"))
    out.push("cleancloud_deliveries");
  return out;
}
