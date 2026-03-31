import { formatInTimeZone } from "date-fns-tz";

const DEFAULT_TZ = "America/Los_Angeles";

export function getDashboardTimeZone(): string {
  return process.env.ADMIN_DASHBOARD_TIMEZONE?.trim() || DEFAULT_TZ;
}

export function zonedYmd(now: Date, timeZone: string): string {
  return formatInTimeZone(now, timeZone, "yyyy-MM-dd");
}

/** First instant (UTC) when `timeZone`'s calendar reads `ymd`. */
export function zonedDayStartUtc(ymd: string, timeZone: string): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  const base = Date.UTC(y, mo - 1, d, 0, 0, 0) - 36 * 3600 * 1000;
  for (let h = 0; h < 96; h++) {
    const t = new Date(base + h * 3600 * 1000);
    if (formatInTimeZone(t, timeZone, "yyyy-MM-dd") === ymd) {
      let u = t.getTime();
      while (u > base && formatInTimeZone(new Date(u - 1), timeZone, "yyyy-MM-dd") === ymd) {
        u -= 1;
      }
      return new Date(u);
    }
  }
  throw new Error(`zonedDayStartUtc: could not resolve ${ymd} in ${timeZone}`);
}

export function zonedNextDayYmd(ymd: string, timeZone: string): string {
  const start = zonedDayStartUtc(ymd, timeZone);
  return formatInTimeZone(new Date(start.getTime() + 24 * 3600 * 1000), timeZone, "yyyy-MM-dd");
}

/** Monday 00:00 through next Monday 00:00 in `timeZone`, as UTC Date bounds [start, end). */
export function zonedWeekRangeUtcContaining(now: Date, timeZone: string): { start: Date; end: Date } {
  const todayYmd = zonedYmd(now, timeZone);
  let d = zonedDayStartUtc(todayYmd, timeZone);
  for (let guard = 0; guard < 8; guard++) {
    const dow = parseInt(formatInTimeZone(d, timeZone, "i"), 10);
    if (dow === 1) break;
    const prevYmd = formatInTimeZone(new Date(d.getTime() - 1), timeZone, "yyyy-MM-dd");
    d = zonedDayStartUtc(prevYmd, timeZone);
  }
  const start = d;
  let ymd = formatInTimeZone(start, timeZone, "yyyy-MM-dd");
  for (let i = 0; i < 7; i++) {
    ymd = zonedNextDayYmd(ymd, timeZone);
  }
  const end = zonedDayStartUtc(ymd, timeZone);
  return { start, end };
}

/** First day of month through first day of next month in `timeZone`, [start, end). */
export function zonedMonthRangeUtcContaining(now: Date, timeZone: string): { start: Date; end: Date } {
  const ymd = zonedYmd(now, timeZone);
  const [yStr, mStr] = ymd.split("-");
  const y = parseInt(yStr!, 10);
  const m = parseInt(mStr!, 10);
  const firstThis = `${y}-${String(m).padStart(2, "0")}-01`;
  const start = zonedDayStartUtc(firstThis, timeZone);
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  const firstNext = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
  const end = zonedDayStartUtc(firstNext, timeZone);
  return { start, end };
}
