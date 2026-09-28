/**
 * LANTERN CITY OBJECTIVE MARKS — the one-loop proof projection.
 *
 * Lantern City reads today's Day Line and the Campaign Run evidence that
 * already exists, and projects both onto the map. It writes nothing. Every
 * visual state is rebuilt from these records on every load, so a reload shows
 * exactly what the business records support and nothing a client animation
 * remembered.
 *
 * Three truth rules come straight from shared/campaignRun.ts and are not
 * relaxed here:
 *
 * 1. A Day Line item names a campaign, not a building. Lantern City never
 *    picks one target from a run. It emphasizes the run's frozen slot
 *    occupants, all of them, or nothing.
 *
 * 2. Territory presence is AREA evidence. It is stored with `targetId: null`
 *    because GPS cannot say which address the operator stands at. It becomes
 *    a presence mark at the observed coordinates. It never marks a building.
 *
 * 3. A building changes only on evidence that names it: a placement reported
 *    against that target, a photo against that target, or that slot's own
 *    `qualified` state. Whole-run completion is not evidence about any one
 *    target.
 *
 * No customer, revenue, or account-won level exists in v1. Those outcomes are
 * reserved until authoritative outcome tracking exists; nothing here may look
 * like one.
 */
import {
  deriveRunProgress,
  type CampaignRun,
  type CampaignTarget,
  type CampaignTargetEvent,
  type RunTargetSlot,
} from "./campaignRun";
import type { CurrentDayLine, CurrentDayLineItem } from "./currentDayLine";

export const LANTERN_OBJECTIVE_MARKS_VERSION = 1 as const;

/**
 * Target levels, weakest first.
 * - reported: a placement was reported against this exact target.
 * - evidenced: reported, plus a supporting photo against this exact target.
 * - completed: this slot's own completion contract is met (placement backed by
 *   same-run, same-operator territory presence inside the validity window).
 */
export const LANTERN_TARGET_LEVELS = ["reported", "evidenced", "completed"] as const;
export type LanternTargetLevel = (typeof LANTERN_TARGET_LEVELS)[number];

export type LanternTodayStatus =
  | "ok"
  | "day_line_unavailable"
  | "no_primary"
  | "remote_objective"
  | "no_active_run"
  | "ambiguous_runs"
  | "no_coordinates";

export type LanternEvidenceRef = {
  eventId: string;
  kind: CampaignTargetEvent["kind"];
  occurredAt: string;
  provenance: CampaignTargetEvent["provenance"];
  epistemicState: CampaignTargetEvent["epistemicState"];
};

export type LanternTodayTarget = {
  slotId: string;
  targetId: string;
  label: string;
  latitude: number;
  longitude: number;
  /** Null until evidence names this target. */
  level: LanternTargetLevel | null;
};

export type LanternToday = {
  dayLineItemId: string;
  campaignId: string;
  title: string;
  campaignRunId: string;
  fictionPackId: string | null;
  /**
   * True when the current viewer owns this supported Campaign Run by openId.
   * A later Driver navigation may still use a different signed-in session.
   */
  driverOpenable: boolean;
  targets: LanternTodayTarget[];
};

export type LanternPresenceMark = {
  eventId: string;
  campaignRunId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  occurredAt: string;
};

export type LanternTargetMark = {
  campaignRunId: string;
  slotId: string;
  targetId: string;
  label: string;
  latitude: number;
  longitude: number;
  level: LanternTargetLevel;
  evidence: LanternEvidenceRef[];
};

export type LanternObjectiveMarks = {
  version: typeof LANTERN_OBJECTIVE_MARKS_VERSION;
  businessDate: string | null;
  todayStatus: LanternTodayStatus;
  today: LanternToday | null;
  presence: LanternPresenceMark[];
  targets: LanternTargetMark[];
};

export type LanternRunInput = {
  run: CampaignRun;
  slots: readonly RunTargetSlot[];
  targets: readonly CampaignTarget[];
  events: readonly CampaignTargetEvent[];
};

/**
 * The primary is Mission Director's first ranked item: the Day Line's ordering
 * authority. The operator "today's mission" designation is a Day Director
 * commitment id, not a campaign id, so it can never name a Campaign Run and is
 * not used here.
 */
function primaryItem(dayLine: CurrentDayLine): CurrentDayLineItem | null {
  if (dayLine.rankingStatus !== "ranked") return null;
  return dayLine.items[0] ?? null;
}

/** Only events the record itself marks confirmed may change the map. */
function usable(event: CampaignTargetEvent): boolean {
  return event.epistemicState === "confirmed";
}

function hasCoordinates(
  value: { lat: number | null; lng: number | null } | null | undefined
): value is { lat: number; lng: number } {
  return (
    value != null &&
    typeof value.lat === "number" &&
    typeof value.lng === "number" &&
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng)
  );
}

function ref(event: CampaignTargetEvent): LanternEvidenceRef {
  return {
    eventId: event.eventId,
    kind: event.kind,
    occurredAt: event.occurredAt,
    provenance: event.provenance,
    epistemicState: event.epistemicState,
  };
}

function byTime(a: CampaignTargetEvent, b: CampaignTargetEvent): number {
  return a.occurredAt.localeCompare(b.occurredAt) || a.eventId.localeCompare(b.eventId);
}

type SlotMark = {
  slotId: string;
  targetId: string;
  level: LanternTargetLevel | null;
  evidence: LanternEvidenceRef[];
};

/**
 * Per-slot levels for one run, keyed to the slot's CURRENT occupant. A replaced
 * target is no longer in the slot, so it never lights.
 */
function slotMarks(input: LanternRunInput): SlotMark[] {
  const events = input.events.filter(
    event => event.campaignRunId === input.run.campaignRunId
  );
  const progress = deriveRunProgress({
    campaignRunId: input.run.campaignRunId,
    slots: input.slots,
    // Replacement is structural and stays in; everything else must be confirmed.
    events: events.filter(event => event.kind === "target_replaced" || usable(event)),
  });
  const presenceById = new Map(
    events.filter(e => e.kind === "territory_presence").map(e => [e.eventId, e])
  );

  return progress.slots.map(slot => {
    const forTarget = events
      .filter(event => event.targetId === slot.currentTargetId && usable(event))
      .sort(byTime);
    const placements = forTarget.filter(e => e.kind === "placement_reported");
    const photos = forTarget.filter(e => e.kind === "supporting_photo");

    let level: LanternTargetLevel | null = null;
    if (slot.qualified) level = "completed";
    else if (placements.length && photos.length) level = "evidenced";
    else if (placements.length) level = "reported";

    const evidence: CampaignTargetEvent[] = [...placements, ...photos];
    if (slot.qualified && slot.presenceEventId) {
      const presence = presenceById.get(slot.presenceEventId);
      if (presence) evidence.push(presence);
    }
    return {
      slotId: slot.slotId,
      targetId: slot.currentTargetId,
      level,
      evidence: evidence.sort(byTime).map(ref),
    };
  });
}

export function projectLanternObjectiveMarks(input: {
  tenantId: string;
  operatorId?: string | null;
  /** Historical compatibility: prefer viewerOpenIds for canonical identity groups. */
  viewerOpenId?: string | null;
  viewerOpenIds?: readonly string[];
  dayLine: CurrentDayLine | null;
  runs: readonly LanternRunInput[];
}): LanternObjectiveMarks {
  // Defense in depth: a row from another tenant contributes nothing even if a
  // reader were ever to hand one over.
  const runs = input.runs.filter(entry => entry.run.tenantId === input.tenantId);

  const presence: LanternPresenceMark[] = [];
  const targets: LanternTargetMark[] = [];
  const marksByRun = new Map<string, SlotMark[]>();

  for (const entry of runs) {
    const targetById = new Map(entry.targets.map(t => [t.targetId, t]));
    const marks = slotMarks(entry);
    marksByRun.set(entry.run.campaignRunId, marks);

    for (const event of entry.events) {
      if (event.campaignRunId !== entry.run.campaignRunId) continue;
      if (event.kind !== "territory_presence") continue;
      if (!usable(event) || event.provenance !== "device_location") continue;
      if (!hasCoordinates(event)) continue;
      presence.push({
        eventId: event.eventId,
        campaignRunId: event.campaignRunId,
        latitude: event.lat,
        longitude: event.lng,
        accuracyMeters: event.accuracyMeters,
        occurredAt: event.occurredAt,
      });
    }

    for (const mark of marks) {
      if (!mark.level) continue;
      const target = targetById.get(mark.targetId);
      if (!hasCoordinates(target)) continue;
      targets.push({
        campaignRunId: entry.run.campaignRunId,
        slotId: mark.slotId,
        targetId: mark.targetId,
        label: target.label,
        latitude: target.lat,
        longitude: target.lng,
        level: mark.level,
        evidence: mark.evidence,
      });
    }
  }

  presence.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.eventId.localeCompare(b.eventId));
  targets.sort(
    (a, b) =>
      a.campaignRunId.localeCompare(b.campaignRunId) || a.slotId.localeCompare(b.slotId)
  );

  const base = {
    version: LANTERN_OBJECTIVE_MARKS_VERSION,
    businessDate: input.dayLine?.businessDate ?? null,
    presence,
    targets,
  };

  if (!input.dayLine || input.dayLine.rankingStatus === "unavailable") {
    return { ...base, todayStatus: "day_line_unavailable", today: null };
  }
  const item = primaryItem(input.dayLine);
  if (!item) return { ...base, todayStatus: "no_primary", today: null };

  // Unknown execution type is not Mission, and it is not ruled out either: the
  // run's own frozen coordinates decide below. A declared remote-only
  // Challenge has no place on the map.
  if (item.executionType === "challenge") {
    return { ...base, todayStatus: "remote_objective", today: null };
  }

  const active = runs.filter(
    entry => entry.run.campaignId === item.id && entry.run.status === "active"
  );
  if (active.length === 0) return { ...base, todayStatus: "no_active_run", today: null };
  if (active.length > 1) return { ...base, todayStatus: "ambiguous_runs", today: null };

  const entry = active[0];
  const targetById = new Map(entry.targets.map(t => [t.targetId, t]));
  const currentMarks = marksByRun.get(entry.run.campaignRunId) ?? [];
  if (
    currentMarks.length === 0 ||
    currentMarks.some(mark => !hasCoordinates(targetById.get(mark.targetId)))
  ) {
    return { ...base, todayStatus: "no_coordinates", today: null };
  }
  const todayTargets: LanternTodayTarget[] = [];
  for (const mark of currentMarks) {
    const target = targetById.get(mark.targetId);
    // Redundant with the all-target preflight above, but keeps the nullable
    // CampaignTarget coordinate type narrowed for TypeScript.
    if (!hasCoordinates(target)) {
      return { ...base, todayStatus: "no_coordinates", today: null };
    }
    todayTargets.push({
      slotId: mark.slotId,
      targetId: mark.targetId,
      label: target.label,
      latitude: target.lat,
      longitude: target.lng,
      level: mark.level,
    });
  }
  if (todayTargets.length === 0) {
    return { ...base, todayStatus: "no_coordinates", today: null };
  }
  todayTargets.sort((a, b) => a.slotId.localeCompare(b.slotId));

  return {
    ...base,
    todayStatus: "ok",
    today: {
      dayLineItemId: item.id,
      campaignId: entry.run.campaignId,
      title: item.title,
      campaignRunId: entry.run.campaignRunId,
      fictionPackId: entry.run.fictionPackId,
      driverOpenable:
        new Set([
          ...(input.viewerOpenIds ?? []),
          ...(input.viewerOpenId ? [input.viewerOpenId] : []),
        ]).has(entry.run.operatorUserId) &&
        entry.run.fictionPackId === "bio_containment",
      targets: todayTargets,
    },
  };
}
