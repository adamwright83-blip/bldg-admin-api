/**
 * Driver card for Weekly Mission Readiness.
 * Display only. No session, no Day Director writes.
 */

import {
  MAX_READINESS_PER_DAY,
  proactiveWeeklyLine,
  type RemainingWeekHorizon,
  type WeekStatus,
  type WeeklyIntentDay,
} from "./weeklyMissionReadiness";

export const PLAN_WEEK_CTA = "Plan the week with Claire.";
export const RESUME_WEEK_CTA = "Resume";
export const ADJUST_WEEK_CTA = "Adjust with Claire";
export const DECLINE_WEEK_CTA = "Not this week";

export type WeeklyMissionDayCard = {
  businessDate: string;
  weekday: string;
  isToday: boolean;
  primary: string | null;
  fixedConstraints: string[];
  readiness: string[];
  status: string;
};

export type WeeklyMissionCardModel = {
  status: WeekStatus;
  weekStart: string;
  showCard: boolean;
  proactiveLine: string | null;
  cta: "plan" | "resume" | "adjust" | null;
  canBegin: boolean;
  days: WeeklyMissionDayCard[];
  emphasizeTodayStart: boolean;
};

export function buildWeeklyMissionCard(input: {
  status: WeekStatus;
  weekStart: string;
  horizon: RemainingWeekHorizon;
  declined: boolean;
  days: WeeklyIntentDay[];
}): WeeklyMissionCardModel {
  const remaining = input.horizon.remainingDates.length > 0;
  const unplannedPitch = input.status === "UNPLANNED" && !input.declined && remaining;
  const days = input.status === "LOCKED" ? input.days.map(day => dayCard(day, input.horizon.businessDate)) : [];
  const emphasizeTodayStart = days.some(day => day.isToday && day.primary);
  return {
    status: input.status,
    weekStart: input.weekStart,
    showCard: unplannedPitch || input.status === "IN_PROGRESS" || days.length > 0,
    proactiveLine: unplannedPitch ? proactiveWeeklyLine(input.horizon) : null,
    cta: unplannedPitch ? "plan" : input.status === "IN_PROGRESS" ? "resume" : days.length > 0 ? "adjust" : null,
    canBegin: unplannedPitch,
    days,
    emphasizeTodayStart,
  };
}

function dayCard(day: WeeklyIntentDay, businessDate: string): WeeklyMissionDayCard {
  const readiness = day.readinessRequirements.slice(0, MAX_READINESS_PER_DAY).map(item => item.text);
  return {
    businessDate: day.businessDate,
    weekday: day.weekday,
    isToday: day.businessDate === businessDate,
    primary: day.primary?.text ?? null,
    fixedConstraints: day.fixedConstraints.map(item => `${item.title} ${item.scheduleLabel}`),
    readiness,
    status: day.disposition === "stand_down" ? "Stood down" : day.primary ? "Primary locked" : "Open",
  };
}
