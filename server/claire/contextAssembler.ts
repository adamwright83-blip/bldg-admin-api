import { getCommercialMissionFieldState } from "../commercialMissions/commercialMissionFieldService";
import { getFieldToday } from "../field/fieldTodayService";
import type { FieldTodayItem } from "../field/types";

export type ClairePhase = "pre_drive" | "post_stop";

export type ClaireTimelineItem = {
  id: string;
  kind: FieldTodayItem["kind"];
  title: string;
  subtitle: string;
  urgency: FieldTodayItem["urgency"];
  scheduledAt: string | null;
  destination: string | null;
  sourceReference: string;
  whySurfaced: string | null;
  actions: Array<{ type: string; label: string }>;
};

export type ClaireDriveContext = {
  phase: ClairePhase;
  generatedAt: string;
  businessDate: string;
  actorId: string;
  truthLaw: "game_projection_never_creates_business_truth";
  nextFixedCommitment: ClaireTimelineItem | null;
  blockers: ClaireTimelineItem[];
  relevantTimeline: ClaireTimelineItem[];
  mission: null | {
    id: number;
    version: number;
    status: string;
    accountName: string;
    address: string | null;
    field: null | {
      version: number;
      preparationStartedAt: string | null;
      departedAt: string | null;
      arrivedAt: string | null;
      checkInMethod: string | null;
    };
    visitOutcome: null | {
      outcome: string;
      notes: string;
      followUpAt: string | null;
      decisionMakerStatus: string;
    };
  };
};

function simplify(item: FieldTodayItem): ClaireTimelineItem {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    subtitle: item.subtitle,
    urgency: item.urgency,
    scheduledAt: item.scheduledAt,
    destination: item.destination?.address ?? null,
    sourceReference: item.source.sourceReference,
    whySurfaced: item.whySurfaced ?? null,
    actions: item.actions.map(action => ({
      type: action.type,
      label: action.label,
    })),
  };
}

export async function assembleClaireDriveContext(input: {
  tenantId: string;
  actorId: string;
  phase: ClairePhase;
  missionId?: number;
  now?: Date;
  timeZone?: string;
}): Promise<ClaireDriveContext> {
  const today = await getFieldToday({
    tenantId: input.tenantId,
    userId: input.actorId,
    includeAllAssignees: false,
    now: input.now,
    timeZone: input.timeZone,
  });

  const missionState =
    input.missionId == null
      ? null
      : await getCommercialMissionFieldState({
          tenantId: input.tenantId,
          missionId: input.missionId,
        });

  const mission = missionState
    ? {
        id: missionState.mission.id,
        version: missionState.mission.version,
        status: missionState.mission.status,
        accountName: missionState.mission.account.name,
        address: missionState.mission.account.address ?? null,
        field: missionState.field
          ? {
              version: missionState.field.version,
              preparationStartedAt: missionState.field.preparationStartedAt,
              departedAt: missionState.field.departedAt,
              arrivedAt: missionState.field.arrivedAt,
              checkInMethod: missionState.field.checkInMethod,
            }
          : null,
        visitOutcome: missionState.visitOutcome
          ? {
              outcome: missionState.visitOutcome.outcome,
              notes: missionState.visitOutcome.notes,
              followUpAt: missionState.visitOutcome.followUpAt,
              decisionMakerStatus:
                missionState.visitOutcome.decisionMakerStatus,
            }
          : null,
      }
    : null;

  return {
    phase: input.phase,
    generatedAt: new Date().toISOString(),
    businessDate: today.businessDate,
    actorId: input.actorId,
    truthLaw: "game_projection_never_creates_business_truth",
    nextFixedCommitment: today.nextFixedCommitment
      ? simplify(today.nextFixedCommitment)
      : null,
    blockers: today.blockers.slice(0, 3).map(simplify),
    relevantTimeline: today.timeline.slice(0, 8).map(simplify),
    mission,
  };
}
