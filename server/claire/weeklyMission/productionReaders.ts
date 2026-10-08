/**
 * Production dossier reads.
 * Recurrence is a rule list. This module must not project those rules into Day Director rows.
 * Do not call a Daily Command loader.
 */

import type { WeeklyGrowthCandidate } from "../../../shared/weeklyGrowthCandidates";
import type { WeeklyDossierFact } from "../../../shared/weeklyMissionReadiness";
import { getClaireCampaignSummary } from "../campaignAwareness";
import { getActiveMacroGoalForOperators } from "../macroGoalService";
import { getDayDirectorState } from "../../planning/dayDirector/dayDirectorService";
import { listActiveRecurrenceRules } from "../workdayRecurrenceService";
import { getFieldToday } from "../../field/fieldTodayService";
import { loadWeeklyGrowthCandidates } from "../../weeklyGrowthCandidates/loadWeeklyGrowthCandidates";
import type { FieldTodayItem } from "../../field/types";

const WEEKDAY_TO_NAME: Record<string, string> = {
  sunday: "Sunday",
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
};

function fieldClass(kind: FieldTodayItem["kind"]): WeeklyDossierFact["class"] {
  if (kind === "pickup") return "pickup";
  if (kind === "delivery") return "dropoff";
  if (kind === "job") return "job";
  if (kind === "commercial_visit" || kind === "commercial_call" || kind === "mission_dispatch") return "sales_work";
  if (kind === "field_commitment" || kind === "payment_blocker") return "external_promise";
  if (kind === "follow_up" || kind === "customer_recovery") return "follow_up";
  return "follow_up";
}

export async function readWeeklyDossierFacts(input: {
  tenantId: string;
  operatorId: string;
  operatorUserIds?: readonly string[];
  dayDirectorActorId: string;
  dayDirectorActorIds?: readonly string[];
  dates: readonly string[];
  now: Date;
  timeZone: string;
}): Promise<WeeklyDossierFact[]> {
  const facts: WeeklyDossierFact[] = [];
  for (const businessDate of input.dates) {
    const state = await getDayDirectorState({
      tenantId: input.tenantId,
      actorId: input.dayDirectorActorId,
      actorIds: input.dayDirectorActorIds ? [...input.dayDirectorActorIds] : undefined,
      businessDate,
    });
    for (const commitment of state?.commitments ?? []) {
      const scheduleLabel = commitment.scheduleLabel ?? commitment.command?.constraints.scheduleLabel ?? null;
      const factClass: WeeklyDossierFact["class"] = scheduleLabel
        ? "fixed_window"
        : commitment.kind === "prep"
          ? "known_prep"
          : commitment.kind === "growth" && commitment.status === "open"
            ? "growth_work"
            : "day_director_commitment";
      facts.push({
        id: `day-director:${commitment.id}`,
        class: factClass,
        businessDate,
        title: commitment.title,
        scheduleLabel,
        weekday: null,
        provenance: {
          reader: "dayDirector.getDayDirectorState",
          sourceType: "day_director",
          sourceIds: [commitment.id],
          quote: commitment.title,
        },
      });
    }

    const field = await getFieldToday({
      tenantId: input.tenantId,
      userId: input.operatorId,
      includeAllAssignees: true,
      businessDate,
      timeZone: input.timeZone,
      now: input.now,
    });
    for (const item of field?.timeline ?? []) {
      const scheduleLabel = item.scheduledAt ? item.scheduledAt.slice(11, 16) : null;
      facts.push({
        id: `field:${item.id}`,
        class: item.scheduledAt && (item.kind === "pickup" || item.kind === "delivery" || item.kind === "job")
          ? "fixed_window"
          : fieldClass(item.kind),
        businessDate,
        title: item.title,
        scheduleLabel: scheduleLabel && scheduleLabel.length === 5 ? scheduleLabel : item.scheduledAt,
        weekday: null,
        provenance: {
          reader: "field.getFieldToday",
          sourceType: item.kind,
          sourceIds: [item.id],
          quote: item.whySurfaced ?? item.title,
        },
      });
    }
  }

  const actorIds = [...new Set(
    [input.dayDirectorActorId, ...(input.dayDirectorActorIds ?? [])]
      .map(actorId => actorId.trim())
      .filter(Boolean)
  )];
  const ruleGroups = await Promise.all(
    actorIds.map(actorId =>
      listActiveRecurrenceRules({
        tenantId: input.tenantId,
        actorId,
      })
    )
  );
  const rules = [...new Map(
    ruleGroups.flat().map(rule => [rule.id, rule] as const)
  ).values()];
  for (const rule of rules) {
    const window = [rule.windowStart, rule.windowEnd].filter(Boolean).join("–");
    facts.push({
      id: `recurrence-rule:${rule.id}`,
      class: "recurrence_rule",
      businessDate: null,
      title: rule.title,
      scheduleLabel: window || null,
      weekday: WEEKDAY_TO_NAME[rule.weekday.toLowerCase()] ?? rule.weekday,
      provenance: {
        reader: "workdayRecurrence.listActiveRecurrenceRules",
        sourceType: "recurrence_rule",
        sourceIds: [rule.id],
        quote: rule.sourceText ?? rule.title,
      },
    });
  }

  const campaign = await getClaireCampaignSummary({
    tenantId: input.tenantId,
    actorId: input.dayDirectorActorId,
    actorIds: input.dayDirectorActorIds,
  });
  if (campaign) {
    facts.push({
      id: "campaign:active",
      class: "campaign",
      businessDate: null,
      title: campaign.active
        ? `${campaign.campaignName}: ${campaign.remainingCount} remaining`
        : `${campaign.campaignName} is not active`,
      scheduleLabel: null,
      weekday: null,
      provenance: {
        reader: "campaignAwareness.getClaireCampaignSummary",
        sourceType: "campaign",
        sourceIds: [campaign.campaignName],
        quote: campaign.realWorldExtension,
      },
    });
  }

  const goal = await getActiveMacroGoalForOperators({
    tenantId: input.tenantId,
    operatorUserIds: input.operatorUserIds?.length
      ? input.operatorUserIds
      : [input.operatorId],
  });
  if (goal) {
    facts.push({
      id: `macro-goal:${goal.id}`,
      class: "macro_goal",
      businessDate: null,
      title: goal.objective,
      scheduleLabel: null,
      weekday: null,
      provenance: {
        reader: "macroGoal.getActiveMacroGoal",
        sourceType: "macro_goal",
        sourceIds: [String(goal.id)],
        quote: goal.objective,
      },
    });
  }

  return facts;
}

/**
 * Canonical Project B port. Candidates stay on the dossier for the private hypothesis.
 * No database means an empty menu. A missing table is not rewritten into an empty week.
 */
export async function readWeeklyGrowthCandidatesForDossier(input: {
  tenantId: string;
  operatorId: string;
  operatorUserIds?: readonly string[];
  dayDirectorActorId: string;
  dayDirectorActorIds?: readonly string[];
  dates: readonly string[];
  now: Date;
  timeZone: string;
}): Promise<WeeklyGrowthCandidate[]> {
  const feed = await loadWeeklyGrowthCandidates({
    tenantId: input.tenantId,
    operatorUserId: input.operatorId,
    ...(input.operatorUserIds?.length ? { operatorUserIds: input.operatorUserIds } : {}),
    dayDirectorActorId: input.dayDirectorActorId,
    ...(input.dayDirectorActorIds?.length ? { dayDirectorActorIds: input.dayDirectorActorIds } : {}),
    remainingDates: input.dates,
    now: input.now,
    timeZone: input.timeZone,
  });
  return feed.candidates;
}
