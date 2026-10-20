/**
 * Pacific send-time slots for the Letter Desk. A slot is the NEXT time the clock reads that hour in Los Angeles:
 * at 2 AM Tuesday, "10:00 AM" means this morning, not Wednesday. Values are Pacific wall time ("YYYY-MM-DDTHH:mm"),
 * which the schedule mutation reads with timezone America/Los_Angeles.
 */
const TZ = "America/Los_Angeles";

export type PacificSlot = {
  /** Pacific wall time, e.g. "2026-10-20T10:00". */
  value: string;
  /** "Today" or "Tomorrow". */
  dayWord: "Today" | "Tomorrow";
  /** e.g. "Tue, Oct 20 · 10:00 AM". */
  label: string;
};

function pacificParts(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map(p => [p.type, p.value])
  );
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), hh: Number(parts.hour), mm: Number(parts.minute) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * "2026-10-20T10:00" (Pacific wall time) → "Tue, Oct 20 · 10:00 AM". An instant with a zone ("…Z", "+00:00") is first
 * read as Pacific wall time.
 */
export function describePacificWallTime(value: string): string {
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(value) && !Number.isNaN(Date.parse(value))) {
    const p = pacificParts(new Date(value));
    value = `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}`;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return value;
  const [, y, m, d, hh, mm] = match.map(Number) as unknown as number[];
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(date);
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${day} · ${hour12}:${pad(mm)} ${hh < 12 ? "AM" : "PM"}`;
}

/** The next Pacific occurrence of hour:minute. */
export function nextPacificSlot(hour: number, minute = 0, now: Date = new Date()): PacificSlot {
  const p = pacificParts(now);
  const passed = p.hh > hour || (p.hh === hour && p.mm >= minute);
  const day = new Date(Date.UTC(p.y, p.m - 1, p.d + (passed ? 1 : 0), 12));
  const value = `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}T${pad(hour)}:${pad(minute)}`;
  return { value, dayWord: passed ? "Tomorrow" : "Today", label: describePacificWallTime(value) };
}
