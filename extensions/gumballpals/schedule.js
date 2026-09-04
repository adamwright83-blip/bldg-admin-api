export const SCHEDULE_NAME = "gumballpals-daily";
const parts = time =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(time))
      .map(part => [part.type, part.value])
  );
// Search UTC hours so DST days remain calendar days, not fixed 24-hour periods.
export function nextDailyRun(now = Date.now()) {
  for (
    let time = Math.floor(now / 3600000) * 3600000 + 3600000;
    time < now + 49 * 3600000;
    time += 3600000
  ) {
    if (parts(time).hour === "18") return time;
  }
  throw new Error("Cannot resolve the next Pacific schedule.");
}
export function scheduleDue(schedule, now = Date.now()) {
  return Boolean(
    schedule?.enabled &&
      Number.isFinite(schedule.nextRunAt) &&
      schedule.nextRunAt <= now
  );
}
