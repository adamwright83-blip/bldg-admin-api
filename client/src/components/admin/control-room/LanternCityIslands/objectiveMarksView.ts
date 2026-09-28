/**
 * What the Islands board draws for the one-loop proof, as plain data.
 *
 * Input is the server's `lanternCity.objectiveMarks` projection and nothing
 * else: no sample customers, no browser storage, no memory of an animation
 * having fired. The same query result always yields the same markers, which is
 * what makes the map survive a reload.
 */
import type {
  LanternEvidenceRef,
  LanternObjectiveMarks,
  LanternTargetLevel,
  LanternTodayStatus,
} from "@shared/lanternCityObjectiveMarks";

export type ObjectiveMarker =
  | {
      key: string;
      kind: "presence";
      latitude: number;
      longitude: number;
      eventId: string;
      occurredAt: string;
      accuracyMeters: number | null;
    }
  | {
      key: string;
      kind: "target";
      latitude: number;
      longitude: number;
      targetId: string;
      label: string;
      campaignRunId: string;
      /** Part of today's Day Line primary run. */
      today: boolean;
      level: LanternTargetLevel | null;
      evidence: LanternEvidenceRef[];
    };

export const LEVEL_LABEL: Record<LanternTargetLevel, string> = {
  reported: "Placement reported",
  evidenced: "Placement reported · photo on file",
  completed: "Slot complete · backed by measured presence",
};

export const TODAY_STATUS_LINE: Record<LanternTodayStatus, string | null> = {
  ok: null,
  day_line_unavailable: "Today's Day Line is unavailable, so no target is lit.",
  no_primary: "No ranked Day Line today, so no target is lit.",
  remote_objective: "Today's primary is remote work. Nothing to light on the map.",
  no_active_run: "Today's primary has no active run with targets yet.",
  ambiguous_runs: "Today's primary has more than one active run. Nothing is lit until that is resolved.",
  no_coordinates: "Today's run has no targets with real coordinates yet.",
};

export function buildObjectiveMarkers(data: LanternObjectiveMarks | null | undefined): ObjectiveMarker[] {
  if (!data) return [];
  const markers: ObjectiveMarker[] = [];
  const todayRun = data.today?.campaignRunId ?? null;
  const todayTargets = new Set((data.today?.targets ?? []).map(t => t.targetId));
  const evidenceByTarget = new Map(
    data.targets.map(t => [`${t.campaignRunId}:${t.targetId}`, t])
  );

  for (const p of data.presence) {
    markers.push({
      key: `presence:${p.eventId}`,
      kind: "presence",
      latitude: p.latitude,
      longitude: p.longitude,
      eventId: p.eventId,
      occurredAt: p.occurredAt,
      accuracyMeters: p.accuracyMeters,
    });
  }

  for (const t of data.today?.targets ?? []) {
    const marked = evidenceByTarget.get(`${todayRun}:${t.targetId}`);
    markers.push({
      key: `target:${todayRun}:${t.targetId}`,
      kind: "target",
      latitude: t.latitude,
      longitude: t.longitude,
      targetId: t.targetId,
      label: t.label,
      campaignRunId: todayRun!,
      today: true,
      level: t.level,
      evidence: marked?.evidence ?? [],
    });
  }

  for (const t of data.targets) {
    if (t.campaignRunId === todayRun && todayTargets.has(t.targetId)) continue;
    markers.push({
      key: `target:${t.campaignRunId}:${t.targetId}`,
      kind: "target",
      latitude: t.latitude,
      longitude: t.longitude,
      targetId: t.targetId,
      label: t.label,
      campaignRunId: t.campaignRunId,
      today: false,
      level: t.level,
      evidence: t.evidence,
    });
  }

  return markers;
}

/**
 * Driver's own launch parameter for a Campaign Run. Driver opens the mission
 * only when this id is the run it already carries for the signed-in driver;
 * otherwise Driver opens as usual. Nothing is created by following the link.
 */
export function driverLinkForRun(campaignRunId: string): string {
  return `/driver?lanternCampaignRun=${encodeURIComponent(campaignRunId)}`;
}
