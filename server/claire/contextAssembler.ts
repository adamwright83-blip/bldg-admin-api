import { getCommercialMissionFieldState } from "../commercialMissions/commercialMissionFieldService";
import { getFieldToday } from "../field/fieldTodayService";
import type { FieldTodayItem } from "../field/types";
import { ensureCurrentMissionSalesBrief } from "../missionSalesBrief/missionSalesBriefService";
import {
  toCompactMissionSalesBriefForClaire,
  type CompactMissionSalesBriefForClaire,
} from "../../shared/missionSalesBrief";
import { getActiveMacroGoal, type MacroGoal } from "./macroGoalService";
import type { ActiveCustomerMetric } from "./activeCustomerMetric";
import { getClaireCampaignSummary, type ClaireCampaignSummary } from "./campaignAwareness";
import { assembleClaireRuntimeView } from "./runtimeView";
import type { PictureCompleteness, UnifiedWorkItem } from "../../shared/claireRuntime";

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

export const CLAIRE_BUSINESS_TIME_ZONE = "America/Los_Angeles";
export const FIELD_SALES_OPEN_MINUTE = 8 * 60;
export const FIELD_SALES_WINDING_DOWN_MINUTE = 17 * 60 + 30;
export const FIELD_SALES_OVER_MINUTE = 18 * 60;

export type ClaireClock = {
  isoTimestamp: string;
  timeZone: string;
  businessDate: string;
  weekday: string;
  localTime: string;
  daypart:
    | "early_morning"
    | "morning"
    | "midday"
    | "afternoon"
    | "evening"
    | "late_night";
  fieldSalesDayState: "before" | "open" | "winding_down" | "over";
  tomorrowBusinessDate: string;
};

export type ClaireWorkCounts = {
  pickups: number;
  dropoffs: number;
  commercialVisits: number;
  commercialCalls: number;
  followUps: number;
  dayDirectorCommitments: number;
  blockers: number;
  campaignWorkReferences: number;
};

export type ClaireWorkDay = {
  businessDate: string;
  counts: ClaireWorkCounts;
  items: ClaireTimelineItem[];
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
      notes: string | null;
      followUpAt: string | null;
      decisionMakerStatus: string;
    };
  };
  /**
   * The same MissionSalesBrief the FIELD BRIEF surface renders (Claire
   * Pass 2) — optional so existing ClaireDriveContext literals stay valid.
   * Absent (not merely null) whenever no mission is in play or the brief
   * could not be produced, so it never appears in the serialized prompt
   * unless it is real.
   */
  missionSalesBrief?: CompactMissionSalesBriefForClaire | null;
  /** Optional during rollout so older frozen-context literals remain valid. */
  clock?: ClaireClock;
  /** Bounded, authoritative today/tomorrow view assembled from Field Today. */
  workPicture?: { today: ClaireWorkDay; tomorrow: ClaireWorkDay };
  macroGoalKnown?: boolean;
  macroGoal?: MacroGoal | null;
  verifiedMetrics?: { activeCustomers: ActiveCustomerMetric };
  campaign?: ClaireCampaignSummary | null;
  runtime?: { workItems: UnifiedWorkItem[]; picture: PictureCompleteness };
  workday?: {
    session: "evening_planning" | "morning_reconciliation" | "field_debrief" | "pre_drive";
    eveningSpeak: string;
    morningSpeak: string;
    tomorrowCount: number;
    deltaCount: number;
    hasConfirmedPlan: boolean;
  };
};

const PRE_DRIVE_KINDS = new Set<FieldTodayItem["kind"]>([
  "job",
  "pickup",
  "delivery",
  "follow_up",
  "commercial_visit",
  "commercial_call",
  "mission_dispatch",
  "customer_recovery",
  "field_commitment",
  "payment_blocker",
  "route_exception",
]);

const WORK_PICTURE_KINDS = new Set<FieldTodayItem["kind"]>([
  "pickup",
  "delivery",
  "commercial_visit",
  "commercial_call",
  "follow_up",
  "field_commitment",
  "payment_blocker",
  "route_exception",
  "mission_dispatch",
]);

function dateTimeParts(now: Date, timeZone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map(part => [part.type, part.value])
  );
}

function nextCalendarDate(businessDate: string): string {
  const [year, month, day] = businessDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1, 12)).toISOString().slice(0, 10);
}

export function buildClaireClock(
  now: Date,
  timeZone = CLAIRE_BUSINESS_TIME_ZONE
): ClaireClock {
  const parts = dateTimeParts(now, timeZone);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const minuteOfDay = hour * 60 + minute;
  const businessDate = `${parts.year}-${parts.month}-${parts.day}`;
  const daypart: ClaireClock["daypart"] =
    hour >= 5 && hour < 8
      ? "early_morning"
      : hour >= 8 && hour < 12
        ? "morning"
        : hour >= 12 && hour < 14
          ? "midday"
          : hour >= 14 && hour < 18
            ? "afternoon"
            : hour >= 18 && hour < 22
              ? "evening"
              : "late_night";
  const fieldSalesDayState: ClaireClock["fieldSalesDayState"] =
    minuteOfDay < FIELD_SALES_OPEN_MINUTE
      ? "before"
      : minuteOfDay < FIELD_SALES_WINDING_DOWN_MINUTE
        ? "open"
        : minuteOfDay < FIELD_SALES_OVER_MINUTE
          ? "winding_down"
          : "over";

  return {
    isoTimestamp: now.toISOString(),
    timeZone,
    businessDate,
    weekday: parts.weekday,
    localTime: new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(now),
    daypart,
    fieldSalesDayState,
    tomorrowBusinessDate: nextCalendarDate(businessDate),
  };
}

function relevantToDriveBrief(item: FieldTodayItem): boolean {
  if (!PRE_DRIVE_KINDS.has(item.kind)) return false;
  if (item.kind === "job") return Boolean(item.destination);
  return true;
}

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

function countKinds(items: FieldTodayItem[], kinds: FieldTodayItem["kind"][]): number {
  const allowed = new Set(kinds);
  return items.filter(item => allowed.has(item.kind)).length;
}

export function buildClaireWorkDay(input: {
  businessDate: string;
  timeline: FieldTodayItem[];
  blockers: FieldTodayItem[];
}): ClaireWorkDay {
  const { timeline, blockers } = input;
  return {
    businessDate: input.businessDate,
    counts: {
      pickups: countKinds(timeline, ["pickup"]),
      dropoffs: countKinds(timeline, ["delivery"]),
      commercialVisits: countKinds(timeline, ["commercial_visit"]),
      commercialCalls: countKinds(timeline, ["commercial_call"]),
      followUps: countKinds(timeline, ["follow_up"]),
      dayDirectorCommitments: countKinds(timeline, ["field_commitment"]),
      blockers: blockers.length,
      campaignWorkReferences: countKinds(timeline, ["mission_dispatch"]),
    },
    items: timeline.filter(item => WORK_PICTURE_KINDS.has(item.kind)).slice(0, 8).map(simplify),
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
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? CLAIRE_BUSINESS_TIME_ZONE;
  const clock = buildClaireClock(now, timeZone);
  const today = await getFieldToday({
    tenantId: input.tenantId,
    userId: input.actorId,
    includeAllAssignees: false,
    now,
    timeZone,
  });
  const tomorrow = await getFieldToday({
    tenantId: input.tenantId,
    userId: input.actorId,
    includeAllAssignees: false,
    now,
    timeZone,
    businessDate: clock.tomorrowBusinessDate,
  });
  const macroGoal = await getActiveMacroGoal({
    tenantId: input.tenantId,
    operatorUserId: input.actorId,
  });
  const campaign = await getClaireCampaignSummary({
    tenantId: input.tenantId,
    actorId: input.actorId,
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

  let missionSalesBrief: CompactMissionSalesBriefForClaire | null | undefined;
  if (input.missionId != null) {
    try {
      const brief = await ensureCurrentMissionSalesBrief({
        tenantId: input.tenantId,
        missionId: input.missionId,
      });
      missionSalesBrief = brief ? toCompactMissionSalesBriefForClaire(brief) : undefined;
    } catch (error) {
      // Never let a mission-brief failure block Claire's core business-truth
      // generation (Slice 16 / Pass 1's fail-closed-never-fatal pattern).
      console.warn("[Claire] mission sales brief unavailable", error);
      missionSalesBrief = undefined;
    }
  }

  const driveTimeline =
    input.phase === "pre_drive"
      ? today.timeline.filter(relevantToDriveBrief)
      : today.timeline;
  const nextFixedCommitment =
    today.nextFixedCommitment &&
    (input.phase !== "pre_drive" || relevantToDriveBrief(today.nextFixedCommitment))
      ? simplify(today.nextFixedCommitment)
      : null;
  const blockers = today.blockers
    .filter(item => input.phase !== "pre_drive" || relevantToDriveBrief(item))
    .slice(0, 3)
    .map(simplify);

  const assembled: ClaireDriveContext = {
    phase: input.phase,
    generatedAt: now.toISOString(),
    businessDate: today.businessDate,
    actorId: input.actorId,
    truthLaw: "game_projection_never_creates_business_truth",
    nextFixedCommitment,
    blockers,
    relevantTimeline: driveTimeline.slice(0, 8).map(simplify),
    mission: mission
      ? {
          id: mission.id,
          version: mission.version,
          status: mission.status,
          accountName: mission.accountName,
          address: mission.address,
          field: mission.field,
          visitOutcome: mission.visitOutcome,
        }
      : null,
    clock,
    workPicture: {
      today: buildClaireWorkDay(today),
      tomorrow: buildClaireWorkDay(tomorrow),
    },
    macroGoalKnown: macroGoal !== null,
    macroGoal,
    campaign,
    ...(missionSalesBrief !== undefined ? { missionSalesBrief } : {}),
  };
  assembled.runtime = assembleClaireRuntimeView(assembled, now);
  return assembled;
}
