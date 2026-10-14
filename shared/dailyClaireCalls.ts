import { formatInTimeZone } from "date-fns-tz";

/**
 * Two daily Claire call purposes, each with its own exact action, appointment
 * kind and standing grant. Neither is implied by the other, by the Sunday
 * planning grant, or by the weekday strategic-planning grant.
 */
export const DAILY_CLAIRE_CALLS = {
  morning_readiness: {
    exactAction: "claire.morning_readiness.call",
    appointmentKind: "daily_morning_readiness",
    label: "Morning readiness",
  },
  evening_debrief: {
    exactAction: "claire.evening_debrief.call",
    appointmentKind: "daily_evening_debrief",
    label: "Evening debrief",
  },
} as const;

export type DailyClairePurpose = keyof typeof DAILY_CLAIRE_CALLS;
export type DailyClaireAppointmentKind =
  (typeof DAILY_CLAIRE_CALLS)[DailyClairePurpose]["appointmentKind"];

export const DAILY_CLAIRE_PURPOSES = Object.keys(DAILY_CLAIRE_CALLS) as DailyClairePurpose[];

export function dailyPurposeForKind(kind: string): DailyClairePurpose | null {
  return DAILY_CLAIRE_PURPOSES.find(p => DAILY_CLAIRE_CALLS[p].appointmentKind === kind) ?? null;
}

export function dailyPurposeForAction(action: string): DailyClairePurpose | null {
  return DAILY_CLAIRE_PURPOSES.find(p => DAILY_CLAIRE_CALLS[p].exactAction === action) ?? null;
}

export type DailyCallAuthorization = {
  tenantId: string;
  canonicalOperatorId: string;
  operatorUserId: string;
  channel: string;
  exactAction: string;
  allowedWeekdaysJson: unknown;
  allowedLocalStart: string | null;
  allowedLocalEnd: string | null;
  timeZone: string;
  dailyLimit: number;
  sourceReference: string;
  authorizedByUserId: string;
  revokedAt: unknown;
};

const HM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function days(a: DailyCallAuthorization): number[] | null {
  const v =
    typeof a.allowedWeekdaysJson === "string"
      ? (() => {
          try {
            return JSON.parse(a.allowedWeekdaysJson);
          } catch {
            return null;
          }
        })()
      : a.allowedWeekdaysJson;
  return Array.isArray(v) ? v : null;
}

/** A grant is valid only for its own purpose's exact action. */
export function validDailyCallBounds(a: DailyCallAuthorization, purpose: DailyClairePurpose): boolean {
  const d = days(a);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: a.timeZone }).format();
  } catch {
    return false;
  }
  return (
    a.channel === "call" &&
    a.exactAction === DAILY_CLAIRE_CALLS[purpose].exactAction &&
    !a.revokedAt &&
    Array.isArray(d) &&
    d.length > 0 &&
    d.every(x => Number.isInteger(x) && x >= 1 && x <= 7) &&
    Boolean(a.allowedLocalStart && HM.test(a.allowedLocalStart)) &&
    Boolean(a.allowedLocalEnd && HM.test(a.allowedLocalEnd)) &&
    a.allowedLocalStart! < a.allowedLocalEnd! &&
    a.dailyLimit === 1 &&
    Boolean(a.sourceReference.trim() && a.authorizedByUserId.trim() && a.tenantId.trim() && a.canonicalOperatorId.trim())
  );
}

export function dailyCallAuthorizedNow(
  a: DailyCallAuthorization,
  purpose: DailyClairePurpose,
  now: Date,
  timeZone?: string
): boolean {
  if (!validDailyCallBounds(a, purpose) || (timeZone && timeZone !== a.timeZone)) return false;
  const day = Number(formatInTimeZone(now, a.timeZone, "i"));
  const hm = formatInTimeZone(now, a.timeZone, "HH:mm");
  return days(a)!.includes(day) && hm >= a.allowedLocalStart! && hm <= a.allowedLocalEnd!;
}

/** Whether today (business-local) is an allowed day whose window has not yet ended. */
export function dailyCallStillDueToday(a: DailyCallAuthorization, purpose: DailyClairePurpose, now: Date): boolean {
  if (!validDailyCallBounds(a, purpose)) return false;
  const day = Number(formatInTimeZone(now, a.timeZone, "i"));
  return days(a)!.includes(day) && formatInTimeZone(now, a.timeZone, "HH:mm") <= a.allowedLocalEnd!;
}

/** Morning and evening windows may not overlap, so the two calls never collide. */
export function windowsOverlap(
  a: { allowedLocalStart: string | null; allowedLocalEnd: string | null },
  b: { allowedLocalStart: string | null; allowedLocalEnd: string | null }
): boolean {
  if (!a.allowedLocalStart || !a.allowedLocalEnd || !b.allowedLocalStart || !b.allowedLocalEnd) return false;
  return a.allowedLocalStart <= b.allowedLocalEnd && b.allowedLocalStart <= a.allowedLocalEnd;
}
