import type {
  ActionDetailState,
  ActionScheduleKind,
  UnifiedWorkItem,
} from "./claireRuntime";
import type { GoldlineAuthority } from "./goldlineActionContract";

export const CLAIRE_WORKDAY_PLAN_KEY = "claire-workday-plan";

export type WorkdayPlanItem = {
  id: string;
  source: string;
  title: string;
  status: string;
  alreadyExists: boolean;
  permissionLevel: GoldlineAuthority;
  detailState: ActionDetailState;
  missingDetails: string[];
  scheduleKind: ActionScheduleKind;
  scheduledAt: string | null;
  provenance: string;
};

export type ConfirmedWorkdayPlan = {
  businessDate: string;
  confirmedAt: string;
  actorId: string;
  items: WorkdayPlanItem[];
  missingQuestion: string | null;
};

export type WorkdayDeltaKind =
  | "ADDED"
  | "REMOVED"
  | "CHANGED"
  | "CONFIRMED"
  | "UNCONFIRMED"
  | "BECAME_OVERDUE"
  | "DETAILS_RESOLVED";

export type WorkdayDelta = {
  kind: WorkdayDeltaKind;
  itemId: string;
  title: string;
};

export function scheduleKindFromItem(item: Pick<UnifiedWorkItem, "scheduledAt">): ActionScheduleKind {
  return item.scheduledAt ? "EXACT_TIME" : "UNSCHEDULED";
}

export function workdayItemFromUnified(item: UnifiedWorkItem): WorkdayPlanItem {
  return {
    id: item.id,
    source: item.source,
    title: item.title,
    status: item.staleness === "overdue" || item.staleness === "very_old" ? "overdue" : item.status,
    alreadyExists: item.alreadyExists,
    permissionLevel: item.permissionLevel,
    detailState: item.detailState,
    missingDetails: item.missingDetails,
    scheduleKind: scheduleKindFromItem(item),
    scheduledAt: item.scheduledAt,
    provenance: item.sourceRef,
  };
}

export function detectWorkdaySession(input: {
  fieldSalesDayState?: string | null;
  daypart?: string | null;
}): "evening_planning" | "morning_reconciliation" | "field_debrief" | "pre_drive" {
  if (input.fieldSalesDayState === "over" || input.daypart === "evening" || input.daypart === "late_night") {
    return "evening_planning";
  }
  if (input.daypart === "early_morning" || input.daypart === "morning") {
    return "morning_reconciliation";
  }
  return "pre_drive";
}

export function confirmTomorrowUtterance(utterance: string): boolean {
  return /\b(confirm tomorrow|lock tomorrow|that's tomorrow|that is tomorrow|yes,? (?:that's|that is) (?:the )?plan|looks (?:good|right)|ship it)\b/i.test(
    utterance
  );
}

export function staleFollowUpLine(items: Array<Pick<WorkdayPlanItem, "title" | "status">>): string | null {
  const stale = items.find(item => item.status === "overdue");
  return stale ? `${stale.title} still hasn't had a meaningful follow-up.` : null;
}

export function proposeTomorrowDraft(items: WorkdayPlanItem[]): WorkdayPlanItem[] {
  return [...items]
    .sort((left, right) => {
      const rank = (item: WorkdayPlanItem) => {
        if (item.permissionLevel === "HUMAN_EXECUTION") return 0;
        if (item.scheduleKind === "EXACT_TIME") return 1;
        if (item.detailState === "NEEDS_DETAILS") return 3;
        return 2;
      };
      return rank(left) - rank(right);
    })
    .slice(0, 12);
}

export function diffWorkdayPlans(input: {
  confirmed: ConfirmedWorkdayPlan | null;
  current: WorkdayPlanItem[];
}): WorkdayDelta[] {
  if (!input.confirmed) {
    return input.current.map(item => ({
      kind: "ADDED" as const,
      itemId: item.id,
      title: item.title,
    }));
  }
  const previous = new Map(input.confirmed.items.map(item => [item.id, item]));
  const next = new Map(input.current.map(item => [item.id, item]));
  const deltas: WorkdayDelta[] = [];
  for (const item of input.current) {
    const was = previous.get(item.id);
    if (!was) {
      deltas.push({ kind: "ADDED", itemId: item.id, title: item.title });
      continue;
    }
    if (was.detailState === "NEEDS_DETAILS" && item.detailState === "COMPLETE") {
      deltas.push({ kind: "DETAILS_RESOLVED", itemId: item.id, title: item.title });
    } else if (was.scheduledAt !== item.scheduledAt || was.status !== item.status) {
      deltas.push({ kind: "CHANGED", itemId: item.id, title: item.title });
    }
    if (item.status === "overdue" && was.status !== "overdue") {
      deltas.push({ kind: "BECAME_OVERDUE", itemId: item.id, title: item.title });
    }
  }
  for (const item of input.confirmed.items) {
    if (!next.has(item.id)) {
      deltas.push({ kind: "REMOVED", itemId: item.id, title: item.title });
    }
  }
  return deltas;
}

export function speakEveningPlan(items: WorkdayPlanItem[]): string {
  if (!items.length) {
    return "I don't have tomorrow built yet. What am I missing?";
  }
  const titles = items.slice(0, 3).map(item => item.title);
  const rest = items.length - titles.length;
  const needs = items.filter(item => item.detailState === "NEEDS_DETAILS");
  const stale = staleFollowUpLine(items);
  return [
    "I have tomorrow mostly built.",
    `Known: ${titles.join("; ")}${rest > 0 ? `; plus ${rest} more` : ""}.`,
    stale ?? (needs.length ? `${needs[0]!.title} still needs details.` : "What am I missing?"),
  ].join(" ");
}

export function speakMorningDelta(deltas: WorkdayDelta[]): string {
  if (!deltas.length) {
    return "Nothing material changed overnight. Anything else before we lock today?";
  }
  const first = deltas.slice(0, 2);
  const summary = first
    .map(delta => `${delta.kind.toLowerCase().replaceAll("_", " ")}: ${delta.title}`)
    .join("; ");
  return `${deltas.length === 1 ? "One thing" : `${Math.min(deltas.length, 2)} things`} changed overnight. ${summary}. Anything else before we lock today?`;
}

export function campaignHostCta(binding: string): string {
  switch (binding) {
    case "expedition":
      return "CONTINUE";
    case "authoritative_visit_route":
      return "START MISSION";
    case "local_target_run":
      return "CONTINUE";
    case "action_grammar":
      return "START";
    case "field_journal":
      return "REVIEW WITH CLAIRE";
    case "direct_real_action":
      return "START";
    default:
      return "CONTINUE";
  }
}
