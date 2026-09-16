/**
 * CAMPAIGN RUN — the standing instance of one real operation.
 *
 * See docs/goldline/FICTION_PACKS.md section 2. A GrowthCampaign is reusable
 * truth; an ops_tasks row is one unit of work with one status. Neither can
 * represent "this particular 24-address operation, in progress, across days".
 *
 * FIVE LAWS ARE ENFORCED HERE RATHER THAN BY CONVENTION:
 *
 * 1. Progress is DERIVED, never incremented. There is no counter field
 *    anywhere in this file. Following the opsTaskEvents philosophy already in
 *    the repo: preserve facts, derive state.
 *
 * 2. The denominator is FROZEN AT START. A run is a fixed list of SLOTS
 *    snapshotted when it begins. Freezing more targets into the underlying set
 *    afterwards cannot change a running 24 into a 25.
 *
 * 3. Replacement SUBSTITUTES, it does not delete. Retiring an inaccessible
 *    address moves a new occupant into that slot and the slot returns to
 *    incomplete. A door that cannot be reached must never quietly leave the
 *    denominator — that would let a run complete by shrinking.
 *
 * 4. Presence is never placement, and one presence ping is not a season pass.
 *    A qualifying placement needs a territory-presence event from the SAME
 *    RUN, by the SAME OPERATOR, recorded BEFORE it, within
 *    PRESENCE_VALIDITY_MINUTES. Otherwise a single GPS hit on day one would
 *    silently authorize every placement for the rest of the campaign.
 *
 * 5. Territory presence is a measured observation, not a claim. It carries
 *    coordinates and an accuracy reading and is checked against the real
 *    targets; nothing may simply assert `device_location`.
 *
 * Nothing here decays. No expiry, no degradation, no streak. Ten placed is ten
 * placed permanently (FICTION_PACKS.md section 7).
 */
import { formatInTimeZone } from "date-fns-tz";
import type { GoldlineProvenanceClass, EpistemicState } from "./goldlineWorld";

export const CAMPAIGN_RUN_STATUSES = ["active", "complete", "abandoned"] as const;
export type CampaignRunStatus = (typeof CAMPAIGN_RUN_STATUSES)[number];

export const PLACEMENT_POINTS = [
  "front_door_knob",
  "gate",
  "call_box",
  "reception_desk",
  "job_site",
  "yard",
] as const;
export type PlacementPoint = (typeof PLACEMENT_POINTS)[number];

/**
 * How a target was established. Narrowed from GOLDLINE_PROVENANCE_CLASSES to
 * the classes that can legitimately produce an address. `derived` and
 * `generated_game_fiction` are deliberately absent — REALITY_BRIDGE section 4,
 * nothing may invent an address.
 */
export const TARGET_SOURCE_CLASSES = [
  "operator_observed",
  "official_property_source",
  "existing_business_record",
] as const;
export type TargetSourceClass = (typeof TARGET_SOURCE_CLASSES)[number];

/**
 * How long one territory-presence observation can vouch for placements after
 * it. A named, editable assumption in the manner of Slice 4's
 * `travelReserveMinutes` — deliberately a policy, never an estimate of
 * anything. Long enough to cover a real working stretch on a block, short
 * enough that it cannot span days.
 */
export const PRESENCE_VALIDITY_MINUTES = 90;

/**
 * Base radius for "in the territory". Wider than day1TenDoors' ~125m arrival
 * radius on purpose: this establishes presence in an AREA, and never which
 * address the operator is standing at. Per-target identity comes from the
 * frozen list, never from GPS (FICTION_PACKS.md section 3).
 */
export const TERRITORY_RADIUS_METERS = 250;

/** Mirrors DAY1_ARRIVAL_ACCURACY_CAP_METERS so a noisy reading degrades
 * gracefully instead of quietly widening the territory without limit. */
export const TERRITORY_ACCURACY_CAP_METERS = 100;

export type CampaignTarget = {
  /** Stable slug, never regenerated, so state always keys back to the target. */
  targetId: string;
  targetSetId: string;
  label: string;
  address: string;
  lat: number | null;
  lng: number | null;
  placementPoint: PlacementPoint;
  /** How this address was established, in words. Never empty. */
  sourceNote: string;
  provenance: TargetSourceClass;
};

/**
 * A slot in a started run. The snapshot that makes the denominator immutable.
 * `originalTargetId` is the address the slot was frozen with; replacements
 * move through the event log, never by editing this row.
 */
export type RunTargetSlot = {
  campaignRunId: string;
  slotId: string;
  originalTargetId: string;
};

export const CAMPAIGN_TARGET_EVENT_KINDS = [
  "territory_presence",
  "placement_reported",
  "supporting_photo",
  "target_replaced",
] as const;
export type CampaignTargetEventKind =
  (typeof CAMPAIGN_TARGET_EVENT_KINDS)[number];

export type CampaignTargetEvent = {
  eventId: string;
  campaignRunId: string;
  /** Null for run-scoped events such as territory presence. */
  targetId: string | null;
  kind: CampaignTargetEventKind;
  occurredAt: string;
  operatorUserId: string;
  provenance: GoldlineProvenanceClass;
  epistemicState: EpistemicState;
  /**
   * Required on `placement_reported`: the territory-presence event that puts
   * this operator in the territory shortly before the placement.
   */
  supportingPresenceEventId: string | null;
  /** Required on `target_replaced`: the target that takes over the slot. */
  replacementTargetId: string | null;
  /** Present on `territory_presence`: the actual observation. */
  lat: number | null;
  lng: number | null;
  accuracyMeters: number | null;
  note: string | null;
};

export type CampaignRun = {
  campaignRunId: string;
  tenantId: string;
  operatorUserId: string;
  campaignId: string;
  campaignVersion: number;
  fictionPackId: string | null;
  fictionPackVersion: number | null;
  targetSetId: string;
  startedAt: string;
  status: CampaignRunStatus;
  completedAt: string | null;
};

export type SlotProgress = {
  slotId: string;
  originalTargetId: string;
  /** The address currently occupying this slot. */
  currentTargetId: string;
  /** True when the completion contract is satisfied for the current occupant. */
  qualified: boolean;
  placementReportedAt: string | null;
  presenceEventId: string | null;
  hasSupportingPhoto: boolean;
  /** Every address this slot has held, oldest first. */
  history: string[];
};

export type RunProgress = {
  campaignRunId: string;
  /** Derived. Never stored, never incremented. */
  qualified: number;
  /** The frozen denominator. Equal to the snapshot slot count, always. */
  total: number;
  fraction: number;
  complete: boolean;
  slots: SlotProgress[];
  /**
   * Placements that did not satisfy the contract, with the reason. Surfaced
   * rather than silently dropped — a real thing happened, it just does not
   * qualify.
   */
  unqualifiedPlacements: Array<{
    targetId: string;
    reason:
      | "no_supporting_presence"
      | "presence_not_in_run"
      | "presence_different_operator"
      | "presence_after_placement"
      | "presence_expired"
      | "target_not_in_run";
  }>;
};

function metersBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type TerritoryCheck =
  | { inTerritory: true; nearestTargetId: string; distanceMeters: number }
  | {
      inTerritory: false;
      reason: "no_target_coordinates" | "outside_territory";
      nearestTargetId: string | null;
      distanceMeters: number | null;
    };

/**
 * Is this observation inside the run's territory?
 *
 * Answers only that. It deliberately cannot answer "which address is the
 * operator at" — adjacent lots sit inside each other's radius, and a system
 * that guessed here would be inventing per-target identity out of GPS.
 */
export function checkTerritoryPresence(input: {
  observation: { lat: number; lng: number; accuracyMeters: number | null };
  targets: readonly CampaignTarget[];
  radiusMeters?: number;
}): TerritoryCheck {
  const located = input.targets.filter(
    (target): target is CampaignTarget & { lat: number; lng: number } =>
      target.lat != null && target.lng != null
  );
  if (located.length === 0) {
    return {
      inTerritory: false,
      reason: "no_target_coordinates",
      nearestTargetId: null,
      distanceMeters: null,
    };
  }

  let nearestTargetId = located[0].targetId;
  let nearest = Number.POSITIVE_INFINITY;
  for (const target of located) {
    const distance = metersBetween(input.observation, target);
    if (distance < nearest) {
      nearest = distance;
      nearestTargetId = target.targetId;
    }
  }

  const accuracy = input.observation.accuracyMeters;
  const accuracyContribution =
    accuracy != null && Number.isFinite(accuracy)
      ? Math.min(Math.max(0, accuracy), TERRITORY_ACCURACY_CAP_METERS)
      : 0;
  const radius =
    (input.radiusMeters ?? TERRITORY_RADIUS_METERS) + accuracyContribution;

  if (nearest <= radius) {
    return { inTerritory: true, nearestTargetId, distanceMeters: nearest };
  }
  return {
    inTerritory: false,
    reason: "outside_territory",
    nearestTargetId,
    distanceMeters: nearest,
  };
}

/**
 * The completion contract, in one place, over a frozen slot list.
 *
 * A slot qualifies when its CURRENT occupant carries a placement backed by a
 * territory-presence event from the same run, by the same operator, recorded
 * before it and still inside PRESENCE_VALIDITY_MINUTES. Every leg is required.
 */
export function deriveRunProgress(input: {
  campaignRunId: string;
  slots: readonly RunTargetSlot[];
  events: readonly CampaignTargetEvent[];
  presenceValidityMinutes?: number;
}): RunProgress {
  const validityMs =
    (input.presenceValidityMinutes ?? PRESENCE_VALIDITY_MINUTES) * 60_000;

  const runEvents = input.events.filter(
    event => event.campaignRunId === input.campaignRunId
  );
  const slots = input.slots.filter(
    slot => slot.campaignRunId === input.campaignRunId
  );

  const presenceById = new Map(
    runEvents
      .filter(event => event.kind === "territory_presence")
      .map(event => [event.eventId, event])
  );

  /** targetId -> the target that replaced it, in event order. */
  const replacements = new Map<string, string>();
  for (const event of [...runEvents].sort((a, b) =>
    a.occurredAt.localeCompare(b.occurredAt)
  )) {
    if (
      event.kind === "target_replaced" &&
      event.targetId &&
      event.replacementTargetId
    ) {
      replacements.set(event.targetId, event.replacementTargetId);
    }
  }

  const unqualifiedPlacements: RunProgress["unqualifiedPlacements"] = [];

  const slotProgress: SlotProgress[] = slots.map(slot => {
    const history: string[] = [slot.originalTargetId];
    let current = slot.originalTargetId;
    const guard = new Set<string>([current]);
    while (replacements.has(current)) {
      const next = replacements.get(current)!;
      if (guard.has(next)) break;
      guard.add(next);
      current = next;
      history.push(current);
    }

    const forTarget = runEvents.filter(event => event.targetId === current);
    const placements = forTarget
      .filter(event => event.kind === "placement_reported")
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

    let qualifying: CampaignTargetEvent | null = null;
    let lastReason: RunProgress["unqualifiedPlacements"][number]["reason"] | null =
      null;

    for (const placement of placements) {
      if (!placement.supportingPresenceEventId) {
        lastReason = "no_supporting_presence";
        continue;
      }
      const presence = presenceById.get(placement.supportingPresenceEventId);
      if (!presence) {
        lastReason = "presence_not_in_run";
        continue;
      }
      if (presence.operatorUserId !== placement.operatorUserId) {
        lastReason = "presence_different_operator";
        continue;
      }
      const presenceAt = Date.parse(presence.occurredAt);
      const placedAt = Date.parse(placement.occurredAt);
      if (!Number.isFinite(presenceAt) || !Number.isFinite(placedAt)) {
        lastReason = "presence_after_placement";
        continue;
      }
      if (presenceAt > placedAt) {
        lastReason = "presence_after_placement";
        continue;
      }
      if (placedAt - presenceAt > validityMs) {
        lastReason = "presence_expired";
        continue;
      }
      qualifying = placement;
      break;
    }

    if (!qualifying && lastReason) {
      unqualifiedPlacements.push({ targetId: current, reason: lastReason });
    }

    return {
      slotId: slot.slotId,
      originalTargetId: slot.originalTargetId,
      currentTargetId: current,
      qualified: qualifying != null,
      placementReportedAt: qualifying?.occurredAt ?? null,
      presenceEventId: qualifying?.supportingPresenceEventId ?? null,
      hasSupportingPhoto: forTarget.some(
        event => event.kind === "supporting_photo"
      ),
      history,
    };
  });

  /** Placements against addresses that are not in this run at all. */
  const occupants = new Set(slotProgress.map(slot => slot.currentTargetId));
  for (const event of runEvents) {
    if (
      event.kind === "placement_reported" &&
      event.targetId &&
      !occupants.has(event.targetId)
    ) {
      unqualifiedPlacements.push({
        targetId: event.targetId,
        reason: "target_not_in_run",
      });
    }
  }

  const qualified = slotProgress.filter(slot => slot.qualified).length;
  const total = slotProgress.length;

  return {
    campaignRunId: input.campaignRunId,
    qualified,
    total,
    fraction: total === 0 ? 0 : qualified / total,
    complete: total > 0 && qualified === total,
    slots: slotProgress,
    unqualifiedPlacements,
  };
}

/**
 * Cadence, for tempo grading (FICTION_PACKS.md section 6). Sessions are
 * distinct BUSINESS DATES in the operator's own timezone, not UTC days — late
 * evening work belongs to the day the operator was living, not the next one in
 * London.
 */
export type RunCadence = {
  sessionCount: number;
  firstQualifiedAt: string | null;
  lastQualifiedAt: string | null;
  /** Largest number of days between consecutive sessions. 0 for one session. */
  largestGapDays: number;
};

export function deriveRunCadence(
  progress: RunProgress,
  timeZone = "America/Los_Angeles"
): RunCadence {
  const stamps = progress.slots
    .map(slot => slot.placementReportedAt)
    .filter((value): value is string => value != null)
    .sort();

  if (stamps.length === 0) {
    return {
      sessionCount: 0,
      firstQualifiedAt: null,
      lastQualifiedAt: null,
      largestGapDays: 0,
    };
  }

  const days = [
    ...new Set(
      stamps.map(stamp => formatInTimeZone(new Date(stamp), timeZone, "yyyy-MM-dd"))
    ),
  ].sort();

  let largestGapDays = 0;
  for (let index = 1; index < days.length; index += 1) {
    const previous = Date.parse(`${days[index - 1]}T00:00:00Z`);
    const current = Date.parse(`${days[index]}T00:00:00Z`);
    if (Number.isNaN(previous) || Number.isNaN(current)) continue;
    const gap = Math.round((current - previous) / 86_400_000);
    if (gap > largestGapDays) largestGapDays = gap;
  }

  return {
    sessionCount: days.length,
    firstQualifiedAt: stamps[0],
    lastQualifiedAt: stamps[stamps.length - 1],
    largestGapDays,
  };
}
