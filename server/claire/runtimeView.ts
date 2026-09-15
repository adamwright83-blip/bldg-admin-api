import type { ClaireDriveContext, ClaireTimelineItem } from "./contextAssembler";
import {
  assessPictureCompleteness,
  categoryForKind,
  deriveStaleness,
  relationToActiveCustomerGoal,
  type PictureCompleteness,
  type UnifiedWorkItem,
} from "../../shared/claireRuntime";
import { defaultPermissionForWorkKind } from "../../shared/claireRuntime";

function permissionForItem(kind: ClaireTimelineItem["kind"]) {
  if (kind === "pickup") return defaultPermissionForWorkKind("pickup");
  if (kind === "delivery") return defaultPermissionForWorkKind("delivery");
  if (kind === "commercial_visit") return defaultPermissionForWorkKind("commercial_visit");
  if (kind === "commercial_call") return defaultPermissionForWorkKind("commercial_call");
  if (kind === "follow_up" || kind === "field_commitment") return defaultPermissionForWorkKind("follow_up");
  return defaultPermissionForWorkKind("research");
}

export function unifiedWorkFromTimeline(input: {
  items: ClaireTimelineItem[];
  now: Date;
  sourceDay: "today" | "tomorrow";
}): UnifiedWorkItem[] {
  return input.items.slice(0, 12).map(item => {
    const relation = relationToActiveCustomerGoal(item.kind);
    const staleness = deriveStaleness({
      now: input.now,
      scheduledAt: item.scheduledAt,
      createdAt: item.scheduledAt,
      status: "open",
      urgency: item.urgency,
    });
    return {
      id: item.id,
      source: `${input.sourceDay}:${item.sourceReference}`,
      category: categoryForKind(item.kind, staleness.band, relation),
      title: item.title,
      status: item.urgency,
      alreadyExists: true,
      scheduledAt: item.scheduledAt,
      ageDays: staleness.ageDays,
      overdueDays: staleness.overdueDays,
      lastMeaningfulActivityAt: item.scheduledAt,
      staleness: staleness.band,
      relationToMacroGoal: relation,
      permissionLevel: permissionForItem(item.kind),
      detailState: "COMPLETE",
      missingDetails: [],
      sourceRef: item.sourceReference,
    };
  });
}

export function assembleClaireRuntimeView(context: ClaireDriveContext, now = new Date()) {
  const todayItems = unifiedWorkFromTimeline({
    items: context.workPicture?.today.items ?? context.relevantTimeline,
    now,
    sourceDay: "today",
  });
  const tomorrowItems = unifiedWorkFromTimeline({
    items: context.workPicture?.tomorrow.items ?? [],
    now,
    sourceDay: "tomorrow",
  });
  const campaignRemaining = context.campaign?.remainingCount ?? 0;
  if (context.campaign?.active && campaignRemaining > 0) {
    todayItems.unshift({
      id: "campaign:colosseum",
      source: "openChannel:day1TenDoors",
      category: "macro_goal_work",
      title: `${campaignRemaining} Greystar property visits remaining`,
      status: "open",
      alreadyExists: true,
      scheduledAt: null,
      ageDays: null,
      overdueDays: null,
      lastMeaningfulActivityAt: null,
      staleness: "fresh",
      relationToMacroGoal: "direct",
      permissionLevel: "HUMAN_EXECUTION",
      detailState: "COMPLETE",
      missingDetails: [],
      sourceRef: "campaign:colosseum",
    });
  }
  const picture: PictureCompleteness = assessPictureCompleteness({
    items: [...todayItems, ...tomorrowItems],
    campaignRemaining,
    macroGoalKnown: context.macroGoalKnown === true,
    hasScheduledRouteWork: Boolean(
      (context.workPicture?.today.counts.pickups ?? 0) +
        (context.workPicture?.today.counts.dropoffs ?? 0) +
        (context.workPicture?.tomorrow.counts.pickups ?? 0) +
        (context.workPicture?.tomorrow.counts.dropoffs ?? 0) +
        (context.workPicture?.today.counts.commercialVisits ?? 0) +
        (context.workPicture?.tomorrow.counts.commercialVisits ?? 0)
    ),
  });
  return {
    workItems: [...todayItems, ...tomorrowItems].slice(0, 16),
    picture,
  };
}
