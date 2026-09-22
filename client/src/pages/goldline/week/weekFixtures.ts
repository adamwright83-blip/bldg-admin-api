import type { WeekPresentationOverlay } from "./weekPresentationOverlay";
import type {
  MissionReadinessRequirement,
  WeeklyFixedConstraint,
  WeeklyIntent,
  WeeklyIntentDay,
  WeeklyIntentPrimary,
} from "./weeklyIntentContract";

/**
 * Fixture-only weeks. Fiction titles in the overlay are not business data
 * and are not persisted. No invented company or location names.
 */

export const FIXTURE_WEEK_START = "2026-09-21";

export const MON = "2026-09-21";
export const TUE = "2026-09-22";
export const WED = "2026-09-23";
export const THU = "2026-09-24";
export const FRI = "2026-09-25";

/** Noon Pacific, so the business date does not slip. */
export function fixtureNow(businessDate: string): Date {
  const [year, month, day] = businessDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 19, 0, 0));
}

function day(
  businessDate: string,
  primary: WeeklyIntentPrimary | null,
  fixedConstraints: WeeklyFixedConstraint[],
  readiness: MissionReadinessRequirement[]
): WeeklyIntentDay {
  return { businessDate, primary, fixedConstraints, readiness };
}

const mission = (title: string, ref: string | null = null): WeeklyIntentPrimary => ({
  title,
  ref,
  posture: "mission",
});

export const fixtureFullLockedWeek: WeeklyIntent = {
  weekStart: FIXTURE_WEEK_START,
  revision: 3,
  source: "locked",
  lockedAt: "2026-09-21T16:00:00.000Z",
  days: [
    day(MON, mission("Launch the ad", "/driver/sales-mission/6"), [{ text: "Clear morning" }], [
      {
        text: "Field jacket",
        kind: "physical",
        neededForDate: MON,
        completeByDate: MON,
        status: "open",
      },
    ]),
    day(TUE, mission("Complete required sales follow-up"), [], []),
    day(
      WED,
      mission("Interview 6 property GMs"),
      [{ text: "Afternoon only" }],
      [
        {
          text: "Print collateral",
          kind: "document",
          neededForDate: WED,
          completeByDate: TUE,
          status: "ready",
        },
        {
          text: "Property list",
          kind: "information",
          neededForDate: WED,
          completeByDate: WED,
          status: "open",
        },
      ]
    ),
    day(THU, mission("Return to qualified properties"), [], [
      {
        text: "Site permit",
        kind: "approval",
        neededForDate: THU,
        completeByDate: THU,
        status: "blocked",
      },
    ]),
    day(FRI, mission("Close open sales loops"), [], [
      {
        text: "Return map",
        kind: "location",
        neededForDate: FRI,
        completeByDate: FRI,
        status: "ready",
      },
    ]),
  ],
};

/** Intent that only still contains Monday. Do not invent the rest of the week. */
export const fixtureMondayRemnant: WeeklyIntent = {
  weekStart: FIXTURE_WEEK_START,
  revision: 1,
  source: "locked",
  lockedAt: "2026-09-21T16:00:00.000Z",
  days: [
    day(MON, mission("Launch the ad", "/driver/sales-mission/6"), [], []),
  ],
};

/** The agreement itself is two days. Not a five-day week with blanks. */
export const fixtureTwoDayWeek: WeeklyIntent = {
  weekStart: THU,
  revision: 2,
  source: "locked",
  lockedAt: "2026-09-24T15:00:00.000Z",
  days: [
    day(THU, mission("Return to qualified properties"), [], []),
    day(FRI, mission("Close open sales loops"), [], []),
  ],
};

export const fixtureStandDownDay: WeeklyIntent = {
  weekStart: FIXTURE_WEEK_START,
  revision: 1,
  source: "locked",
  lockedAt: "2026-09-21T16:00:00.000Z",
  days: [
    day(
      WED,
      { title: "Stand down", ref: null, posture: "stand_down" },
      [],
      []
    ),
  ],
};

export const fixtureUnconfirmedDraft: WeeklyIntent = {
  weekStart: FIXTURE_WEEK_START,
  revision: 0,
  source: "draft",
  lockedAt: null,
  days: [
    day(MON, mission("Launch the ad"), [], []),
    day(WED, mission("Interview 6 property GMs"), [], []),
  ],
};

/**
 * FIXTURE_ONLY fiction skin. These titles are not objectives and are not
 * written onto the WeeklyIntent.
 */
export const fixtureFictionOverlay: WeekPresentationOverlay = {
  [MON]: {
    fictionTitle: "THE SIGNAL",
    artVariant: "ruins",
    chapterSkinId: "signal",
  },
  [TUE]: {
    fictionTitle: "THE RUN",
    artVariant: "river",
    chapterSkinId: "run",
  },
  [WED]: {
    fictionTitle: "THE SIX SUSPECTS",
    artVariant: "village",
    chapterSkinId: "suspects",
  },
  [THU]: {
    fictionTitle: "SECOND CONTACT",
    artVariant: "cliff",
    chapterSkinId: "contact",
  },
  [FRI]: {
    fictionTitle: "CLAIM",
    artVariant: "jungle",
    chapterSkinId: "claim",
  },
};

export const fixtureEmptyOverlay: WeekPresentationOverlay = {};
