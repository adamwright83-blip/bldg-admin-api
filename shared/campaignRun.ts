/**
 * CAMPAIGN RUN — the standing instance of one real operation.
 *
 * See docs/goldline/FICTION_PACKS.md §2. A GrowthCampaign is reusable truth;
 * an ops_tasks row is one unit of work with one status. Neither can represent
 * "this particular 24-address operation, in progress, across days". This can.
 *
 * TWO LAWS ARE ENFORCED STRUCTURALLY HERE, NOT BY CONVENTION:
 *
 * 1. Progress is DERIVED, never incremented. There is no counter field
 *    anywhere in this file. `17/24` is computed from seventeen target states
 *    that satisfy the completion contract, every time it is asked for. This
 *    follows the opsTaskEvents philosophy already in the repo: preserve facts,
 *    derive state.
 *
 * 2. Presence is never placement. A placement only qualifies when it carries
 *    `supportingPresenceEventId` resolving to a real territory-presence event
 *    in the same run. Standing in the neighborhood completes nothing, and that
 *    is a property of the type, not a rule someone has to remember.
 *
 * Nothing in this file decays. There is no expiry, no degradation, no streak.
 * Ten placed is ten placed permanently (FICTION_PACKS.md §7).
 */
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
 * How a target was established. Mirrors GOLDLINE_PROVENANCE_CLASSES; narrowed
 * to the classes that can legitimately produce an address. `derived` and
 * `generated_game_fiction` are deliberately absent — REALITY_BRIDGE §4, Mara
 * may never invent an address.
 */
export const TARGET_SOURCE_CLASSES = [
  "operator_observed",
  "official_property_source",
  "existing_business_record",
] as const;
export type TargetSourceClass = (typeof TARGET_SOURCE_CLASSES)[number];

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
   * the operator in the territory when the placement was made. A placement
   * without one never qualifies.
   */
  supportingPresenceEventId: string | null;
  /** Required on `target_replaced`: the target that takes its place. */
  replacementTargetId: string | null;
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

export type TargetProgress = {
  targetId: string;
  /** True when the completion contract is satisfied for this target. */
  qualified: boolean;
  placementReportedAt: string | null;
  presenceEventId: string | null;
  hasSupportingPhoto: boolean;
  /** Set when a `target_replaced` event retired this target. */
  replacedByTargetId: string | null;
};

export type RunProgress = {
  campaignRunId: string;
  /** Derived. Never stored, never incremented. */
  qualified: number;
  total: number;
  /** qualified / total, or 0 when the target set is empty. */
  fraction: number;
  complete: boolean;
  targets: TargetProgress[];
  /**
   * Placements that were reported without a resolvable supporting presence
   * event. Surfaced rather than silently dropped — a real thing happened, it
   * just does not satisfy the contract.
   */
  unqualifiedPlacementTargetIds: string[];
};

function isPresenceEvent(event: CampaignTargetEvent): boolean {
  return event.kind === "territory_presence";
}

/**
 * The completion contract, in one place.
 *
 * A target qualifies when a placement was reported for it AND that placement
 * names a territory-presence event that actually exists in this run. Both legs
 * are required. This is the code form of FICTION_PACKS.md §3.
 */
export function deriveRunProgress(input: {
  campaignRunId: string;
  targets: readonly CampaignTarget[];
  events: readonly CampaignTargetEvent[];
}): RunProgress {
  const runEvents = input.events.filter(
    event => event.campaignRunId === input.campaignRunId
  );
  const presenceEventIds = new Set(
    runEvents.filter(isPresenceEvent).map(event => event.eventId)
  );

  const replacedBy = new Map<string, string>();
  for (const event of runEvents) {
    if (event.kind === "target_replaced" && event.targetId) {
      replacedBy.set(event.targetId, event.replacementTargetId ?? "");
    }
  }

  const activeTargets = input.targets.filter(
    target => !replacedBy.has(target.targetId)
  );

  const unqualifiedPlacementTargetIds: string[] = [];
  const targets: TargetProgress[] = activeTargets.map(target => {
    const forTarget = runEvents.filter(event => event.targetId === target.targetId);

    const qualifyingPlacement = forTarget.find(
      event =>
        event.kind === "placement_reported" &&
        event.supportingPresenceEventId != null &&
        presenceEventIds.has(event.supportingPresenceEventId)
    );

    const anyPlacement = forTarget.find(
      event => event.kind === "placement_reported"
    );

    if (!qualifyingPlacement && anyPlacement) {
      unqualifiedPlacementTargetIds.push(target.targetId);
    }

    return {
      targetId: target.targetId,
      qualified: qualifyingPlacement != null,
      placementReportedAt: qualifyingPlacement?.occurredAt ?? null,
      presenceEventId: qualifyingPlacement?.supportingPresenceEventId ?? null,
      hasSupportingPhoto: forTarget.some(
        event => event.kind === "supporting_photo"
      ),
      replacedByTargetId: null,
    };
  });

  const qualified = targets.filter(target => target.qualified).length;
  const total = targets.length;

  return {
    campaignRunId: input.campaignRunId,
    qualified,
    total,
    fraction: total === 0 ? 0 : qualified / total,
    complete: total > 0 && qualified === total,
    targets,
    unqualifiedPlacementTargetIds,
  };
}

/**
 * Cadence, for tempo grading (FICTION_PACKS.md §6). Sessions are distinct
 * calendar days on which at least one qualifying placement was recorded —
 * deliberately cadence, not calendar, so a bad month costs the rare ending and
 * never the win.
 */
export type RunCadence = {
  sessionCount: number;
  firstQualifiedAt: string | null;
  lastQualifiedAt: string | null;
  /** Largest number of days between consecutive sessions. 0 for one session. */
  largestGapDays: number;
};

export function deriveRunCadence(progress: RunProgress): RunCadence {
  const stamps = progress.targets
    .map(target => target.placementReportedAt)
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

  const days = [...new Set(stamps.map(stamp => stamp.slice(0, 10)))].sort();
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
