import {
  isLockedWeeklyIntent,
  type MissionReadinessRequirement,
  type ReadinessStatus,
  type WeeklyFixedConstraint,
  type WeeklyIntent,
  type WeeklyPrimaryPosture,
} from "./weeklyIntentContract";

/**
 * Pure projection of a LOCKED WeeklyIntent into the brochure view model.
 * No presentation-skin fields. No planning. No primary assignment. No Daily Command.
 */

export class WeekIntentNotLockedError extends Error {
  constructor() {
    super("WeeklyIntent is not locked");
    this.name = "WeekIntentNotLockedError";
  }
}

export type WeekArtifactReadiness = {
  text: string;
  kind: MissionReadinessRequirement["kind"];
  status: ReadinessStatus;
  neededForDate: string;
  completeByDate: string;
};

export type WeekArtifactDay = {
  businessDate: string;
  weekdayLabel: string;
  realPrimaryTitle: string;
  realPrimaryRef: string | null;
  /** Copied from the locked primary. Stand-down is not a startable mission. */
  realPrimaryPosture: WeeklyPrimaryPosture | null;
  fixedConstraints: WeeklyFixedConstraint[];
  readiness: WeekArtifactReadiness[];
};

export type WeekArtifactViewModel = {
  weekStart: string;
  revision: number;
  lockedAt: string;
  currentBusinessDate: string;
  days: WeekArtifactDay[];
};

export function businessDateInTimeZone(
  now: Date,
  timeZone = "America/Los_Angeles"
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function weekdayLabel(
  businessDate: string,
  timeZone = "America/Los_Angeles"
): string {
  const [year, month, day] = businessDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 20, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
  }).format(date);
}

export function shortWeekday(businessDate: string): string {
  return weekdayLabel(businessDate).slice(0, 3).toUpperCase();
}

export function lockedWeeklyIntentToWeekArtifact(
  intent: WeeklyIntent,
  now: Date,
  timeZone = "America/Los_Angeles"
): WeekArtifactViewModel {
  if (!isLockedWeeklyIntent(intent) || !intent.lockedAt) {
    throw new WeekIntentNotLockedError();
  }
  const currentBusinessDate = businessDateInTimeZone(now, timeZone);
  const days = intent.days
    .filter(day => day.businessDate >= currentBusinessDate)
    .slice()
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate))
    .map(day => ({
      businessDate: day.businessDate,
      weekdayLabel: weekdayLabel(day.businessDate, timeZone),
      realPrimaryTitle: day.primary?.title ?? "",
      realPrimaryRef: day.primary?.ref ?? null,
      realPrimaryPosture: day.primary?.posture ?? null,
      fixedConstraints: day.fixedConstraints.map(constraint => ({
        text: constraint.text,
      })),
      readiness: day.readiness.map(item => ({
        text: item.text,
        kind: item.kind,
        status: item.status,
        neededForDate: item.neededForDate,
        completeByDate: item.completeByDate,
      })),
    }));
  return {
    weekStart: intent.weekStart,
    revision: intent.revision,
    lockedAt: intent.lockedAt,
    currentBusinessDate,
    days,
  };
}

/** Existing playable mission routes only. Anything else is a no-write callback. */
const AUTHORIZED_MISSION_ROUTE = /^\/driver\/sales-mission\/\d+$/;

export function authorizedMissionHref(ref: string | null): string | null {
  if (!ref || !AUTHORIZED_MISSION_ROUTE.test(ref)) return null;
  return ref;
}

export function dayGetsPrimaryCta(
  day: WeekArtifactDay,
  currentBusinessDate: string
): boolean {
  return (
    day.businessDate === currentBusinessDate &&
    day.realPrimaryPosture === "mission" &&
    day.realPrimaryTitle.trim().length > 0
  );
}

/** Weekday comes from the locked day, never a hardcoded mission sentence. */
export function startCtaLabel(day: WeekArtifactDay): string {
  return `Start ${day.weekdayLabel}`;
}

export type ForwardingTag = {
  owningBusinessDate: string;
  neededForDate: string;
  completeByDate: string;
  status: ReadinessStatus;
  label: string;
};

/**
 * A physical forwarding tag on the day the prep is due, when that day is not
 * the day that owns the mission. The requirement itself stays on the owner.
 */
export function forwardingTagsForDay(
  days: readonly WeekArtifactDay[],
  businessDate: string
): ForwardingTag[] {
  const tags: ForwardingTag[] = [];
  for (const owner of days) {
    for (const item of owner.readiness) {
      if (
        item.completeByDate !== businessDate ||
        item.neededForDate === businessDate
      ) {
        continue;
      }
      const packFor = shortWeekday(item.neededForDate);
      const due = shortWeekday(item.completeByDate);
      const statusLine =
        item.status === "ready"
          ? `READY ${due}`
          : item.status === "blocked"
            ? "HOLD"
            : `DUE ${due}`;
      tags.push({
        owningBusinessDate: owner.businessDate,
        neededForDate: item.neededForDate,
        completeByDate: item.completeByDate,
        status: item.status,
        label: `PACK FOR ${packFor} / ${statusLine}`,
      });
    }
  }
  return tags;
}

/** Phone fold: one peeking wing per side, current panel dominant. */
export function weekFoldLayout(viewportWidth: number): {
  peekWingsPerSide: number;
  currentPanelPx: number;
  peekPx: number;
  touchTargetPx: number;
} {
  const peekPx =
    viewportWidth <= 320 ? 28 : viewportWidth <= 375 ? 36 : viewportWidth <= 390 ? 42 : 48;
  const peekWingsPerSide = 1;
  const currentPanelPx = Math.max(200, viewportWidth - peekPx * 2 - 16);
  return {
    peekWingsPerSide,
    currentPanelPx,
    peekPx,
    touchTargetPx: 48,
  };
}
