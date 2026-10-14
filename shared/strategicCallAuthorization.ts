import { formatInTimeZone } from "date-fns-tz";
export const WEEKDAY_STRATEGIC_PLANNING_ACTION =
  "claire.strategic_planning.call";
export type StrategicCallAuthorization = {
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
export function validStrategicCallBounds(
  a: StrategicCallAuthorization
): boolean {
  const days =
    typeof a.allowedWeekdaysJson === "string"
      ? (() => {
          try {
            return JSON.parse(a.allowedWeekdaysJson);
          } catch {
            return null;
          }
        })()
      : a.allowedWeekdaysJson;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: a.timeZone }).format();
  } catch {
    return false;
  }
  return (
    a.channel === "call" &&
    a.exactAction === WEEKDAY_STRATEGIC_PLANNING_ACTION &&
    !a.revokedAt &&
    Array.isArray(days) &&
    days.length > 0 &&
    days.every(d => Number.isInteger(d) && d >= 1 && d <= 5) &&
    Boolean(
      a.allowedLocalStart &&
        /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(a.allowedLocalStart)
    ) &&
    Boolean(
      a.allowedLocalEnd && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(a.allowedLocalEnd)
    ) &&
    a.allowedLocalStart! < a.allowedLocalEnd! &&
    Number.isInteger(a.dailyLimit) &&
    a.dailyLimit >= 1 &&
    a.dailyLimit <= 3 &&
    Boolean(
      a.sourceReference.trim() &&
        a.authorizedByUserId.trim() &&
        a.tenantId.trim() &&
        a.canonicalOperatorId.trim()
    )
  );
}
export function strategicCallAuthorizedNow(
  a: StrategicCallAuthorization,
  now: Date,
  timeZone?: string
): boolean {
  if (!validStrategicCallBounds(a) || (timeZone && timeZone !== a.timeZone))
    return false;
  const days: number[] =
    typeof a.allowedWeekdaysJson === "string"
      ? JSON.parse(a.allowedWeekdaysJson)
      : a.allowedWeekdaysJson;
  const day = Number(formatInTimeZone(now, a.timeZone, "i"));
  const hm = formatInTimeZone(now, a.timeZone, "HH:mm");
  return (
    days.includes(day) && hm >= a.allowedLocalStart! && hm <= a.allowedLocalEnd!
  );
}
