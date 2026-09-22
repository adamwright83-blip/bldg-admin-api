import { formatInTimeZone } from "date-fns-tz";
import {
  getDashboardTimeZone,
  zonedDayStartUtc,
  zonedNextDayYmd,
  zonedYmd,
} from "../dashboardZoned";
import type {
  CommunicationsAnalyticsWindowDays,
  CommunicationsObservationWindow,
} from "@shared/communicationsAnalytics";

function previousZonedYmd(ymd: string, timeZone: string): string {
  const start = zonedDayStartUtc(ymd, timeZone);
  return formatInTimeZone(new Date(start.getTime() - 1), timeZone, "yyyy-MM-dd");
}

function subtractZonedCalendarDays(
  ymd: string,
  days: number,
  timeZone: string
): string {
  let current = ymd;
  for (let i = 0; i < days; i += 1) {
    current = previousZonedYmd(current, timeZone);
  }
  return current;
}

/**
 * Last `windowDays` Goldline/admin business calendar days in the dashboard
 * timezone, including today. Bounds are exact UTC instants [start, end).
 */
export function getCommunicationsObservationWindow(input: {
  windowDays: CommunicationsAnalyticsWindowDays;
  now?: Date;
  timeZone?: string;
}): CommunicationsObservationWindow {
  const timeZone = input.timeZone?.trim() || getDashboardTimeZone();
  const now = input.now ?? new Date();
  const todayYmd = zonedYmd(now, timeZone);
  const startYmd = subtractZonedCalendarDays(
    todayYmd,
    input.windowDays - 1,
    timeZone
  );
  const startUtc = zonedDayStartUtc(startYmd, timeZone);
  const endExclusiveUtc = zonedDayStartUtc(
    zonedNextDayYmd(todayYmd, timeZone),
    timeZone
  );
  return {
    windowDays: input.windowDays,
    timeZone,
    startUtc: startUtc.toISOString(),
    endExclusiveUtc: endExclusiveUtc.toISOString(),
  };
}

export function instantInObservationWindow(
  iso: string,
  window: CommunicationsObservationWindow
): boolean {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return false;
  return (
    ms >= new Date(window.startUtc).getTime() &&
    ms < new Date(window.endExclusiveUtc).getTime()
  );
}
