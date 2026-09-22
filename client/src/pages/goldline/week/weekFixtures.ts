import type { WeekPresentationOverlay } from "./weekPresentationOverlay";
import type {
  MissionReadinessRequirement,
  PrimarySource,
  RemnantDisposition,
  WeekdayName,
  WeeklyFixedConstraint,
  WeeklyIntentDay,
  WeeklyIntentRecord,
} from "./weeklyIntentContract";

/**
 * Fixture-only weeks in the frozen agreement shape.
 * Fiction titles in the overlay are not business data and are not persisted.
 * No invented company or location names.
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

function record(
  id: string,
  revision: number,
  lockedAt: string,
  weekStart: string,
  days: WeeklyIntentDay[]
): WeeklyIntentRecord {
  return {
    id,
    tenantId: "fixture-tenant",
    operatorId: "fixture-operator",
    weekStart,
    revision,
    source: "operator_confirmed_proposal",
    lockedAt,
    days,
  };
}

function day(
  businessDate: string,
  weekday: WeekdayName,
  disposition: RemnantDisposition,
  primary: WeeklyIntentDay["primary"],
  fixedConstraints: WeeklyFixedConstraint[],
  readinessRequirements: MissionReadinessRequirement[]
): WeeklyIntentDay {
  return {
    businessDate,
    weekday,
    disposition,
    primary,
    fixedConstraints,
    readinessRequirements,
  };
}

function primary(
  text: string,
  commitmentId: string,
  source: PrimarySource = "operator_stated"
): NonNullable<WeeklyIntentDay["primary"]> {
  return { text, source, commitmentId };
}

function constraint(
  sourceRef: string,
  title: string,
  businessDate: string,
  scheduleLabel: string
): WeeklyFixedConstraint {
  return { sourceRef, title, businessDate, scheduleLabel };
}

export const fixtureFullLockedWeek: WeeklyIntentRecord = record(
  "weekly-intent-fixture-full",
  3,
  "2026-09-21T16:00:00.000Z",
  FIXTURE_WEEK_START,
  [
    day(
      MON,
      "Monday",
      "primary",
      primary("Launch the ad", "mon-launch-ad"),
      [constraint("fixture:mon-morning", "Clear morning", MON, "Morning")],
      [
        {
          text: "Field jacket",
          kind: "physical",
          neededForDate: MON,
          completeByDate: MON,
          status: "open",
        },
      ]
    ),
    day(TUE, "Tuesday", "primary", primary("Complete required sales follow-up", "tue-follow-up"), [], []),
    day(
      WED,
      "Wednesday",
      "primary",
      primary("Interview 6 property GMs", "wed-interviews"),
      [constraint("fixture:wed-afternoon", "Afternoon only", WED, "Afternoon")],
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
    day(THU, "Thursday", "primary", primary("Return to qualified properties", "thu-return"), [], [
      {
        text: "Site permit",
        kind: "approval",
        neededForDate: THU,
        completeByDate: THU,
        status: "blocked",
      },
    ]),
    day(FRI, "Friday", "primary", primary("Close open sales loops", "fri-close"), [], [
      {
        text: "Return map",
        kind: "location",
        neededForDate: FRI,
        completeByDate: FRI,
        status: "ready",
      },
    ]),
  ]
);

/** Agreement that only still contains Monday. Do not invent the rest of the week. */
export const fixtureMondayRemnant: WeeklyIntentRecord = record(
  "weekly-intent-fixture-monday",
  1,
  "2026-09-21T16:00:00.000Z",
  FIXTURE_WEEK_START,
  [day(MON, "Monday", "primary", primary("Launch the ad", "mon-launch-ad"), [], [])]
);

/** The agreement itself is two days. Not a five-day week with blanks. */
export const fixtureTwoDayWeek: WeeklyIntentRecord = record(
  "weekly-intent-fixture-two-day",
  2,
  "2026-09-24T15:00:00.000Z",
  THU,
  [
    day(THU, "Thursday", "primary", primary("Return to qualified properties", "thu-return"), [], []),
    day(FRI, "Friday", "primary", primary("Close open sales loops", "fri-close"), [], []),
  ]
);

export const fixtureStandDownDay: WeeklyIntentRecord = record(
  "weekly-intent-fixture-stand-down",
  1,
  "2026-09-21T16:00:00.000Z",
  FIXTURE_WEEK_START,
  [day(WED, "Wednesday", "stand_down", null, [], [])]
);

/**
 * FIXTURE_ONLY fiction skin. These titles are not objectives and are not
 * written onto the agreement.
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
