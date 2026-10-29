/**
 * Claire acceptance scenario — the LOCKED contract for the native-tool prototype
 * evaluation (2026-10-29).
 *
 * A scenario is a business situation, not a dialogue script for Claire. The
 * operator's side is either a fixed list of lines (production regressions, where
 * the lines are what the operator actually said) or a goal-driven simulated
 * operator (a second model playing the operator, so a different Claire gets a
 * different conversation). Claire's side is always produced live by the system
 * under test.
 *
 * Grading is on the FINAL STATE of the disposable database plus a small number
 * of transcript checks. Passing requires: every expected row present exactly
 * once, nothing forbidden written, seeded rows intact, no false save claims,
 * and no re-asking for authorization already given.
 *
 * Dates are relative to the run's real "today" in the tenant time zone, so the
 * same scenario file is valid on any day and both systems under test (the
 * prototype and production Brain V2) see the same calendar.
 */

export type DateRef =
  | "today"
  | "tomorrow"
  | "day_after_tomorrow"
  | `today+${number}`
  | `today-${number}`
  /** The next such weekday strictly after today: what a bare "Saturday" means on a call. */
  | "coming_monday" | "coming_tuesday" | "coming_wednesday" | "coming_thursday" | "coming_friday" | "coming_saturday" | "coming_sunday"
  /** The weekday of NEXT week (Monday-start), the same rule the prototype applies to "next Friday". */
  | "next_monday" | "next_tuesday" | "next_wednesday" | "next_thursday" | "next_friday" | "next_saturday" | "next_sunday";

export type SeedDayLineRow = {
  title: string;
  businessDate: DateRef;
  /** Free text the Day Line shows under the title (timing, notes). */
  detailNote?: string;
};

export type SeedStandingInstruction = {
  kind: "call_rule";
  /** The rule in Claire's terms, as the prompt states it. */
  text: string;
  /** The operator's words. */
  quote: string;
};

export type ScriptedOperator = {
  mode: "scripted";
  /** Spoken in order. The run ends after the last line or when Claire ends the call. */
  turns: string[];
};

export type SimulatedOperator = {
  mode: "simulated";
  /** Who the operator is and how they talk. No instructions about Claire's software. */
  persona: string;
  /** What the operator wants out of the call, in their own terms. */
  goals: string[];
  /** The simulated operator says exactly this to end the call once goals are met or it gives up. */
  maxTurns: number;
  /** The first thing the operator says. Fixed so every trial starts the same way. */
  opening: string;
};

export type ExpectedRow = {
  /** Accepts a single date or any of several (when either placement is correct). */
  businessDate: DateRef | DateRef[];
  /** Case-insensitive regular expression tested against the row title. */
  titleMatches: string;
  /** Exact number of rows matching, default 1. */
  count?: number;
  /** Row status that counts, default "open". "completed" asserts the operator's finished work was marked done. */
  status?: "open" | "completed";
  /** Case-insensitive regular expression tested against title + detail note. */
  detailMatches?: string;
};

export type ForbiddenRow = {
  businessDate?: DateRef | DateRef[];
  titleMatches: string;
};

export type ScenarioExpectation = {
  /** Open rows that must exist at the end. */
  dayLine: ExpectedRow[];
  /** Rows that must NOT exist at the end (unauthorized or wrong-day writes). */
  absent?: ForbiddenRow[];
  /** Seeded rows must still be present, open, on their seeded date. Default true. */
  seededRowsIntact?: boolean;
  /** Seeded rows that are allowed to have moved or been completed/removed by the conversation. */
  seededRowsMayChange?: string[];
  /**
   * Upper bound on rows added during the call. Default: number of expected rows.
   * Every added row must also match some expected row, or it counts as unauthorized.
   */
  maxRowsAdded?: number;
  /** Standing instructions that must be active at the end (regex on text or quote). */
  standingInstructions?: Array<{ matches: string }>;
  speech?: {
    /** Regexes that must not appear in ANY Claire line, unless the operator said the word first in that call. */
    mustNotRaise?: string[];
    /** Regexes that must appear in at least one Claire line. */
    mustMention?: string[];
  };
  /**
   * Maximum number of Claire lines that ask the operator to authorize Day Line
   * work ("want me to put that on…", "say yes and I'll…"). After an explicit
   * instruction, zero is correct. Default 1.
   */
  maxAuthorizationAsks?: number;
  /** When false, Claire claiming a save that produced no receipt is still recorded but does not fail the trial. */
  falseClaimFails?: boolean;
};

export type Scenario = {
  id: string;
  title: string;
  provenance: "production_call" | "derived_from_production" | "authored";
  /** Where the situation came from; production ids when it was a real call. */
  source?: string;
  /** Local wall-clock time of the call, HH:mm in the tenant time zone. Informs the prototype only. */
  localTime?: string;
  seed: {
    operatorName?: string;
    dayLine: SeedDayLineRow[];
    standingInstructions?: SeedStandingInstruction[];
  };
  operator: ScriptedOperator | SimulatedOperator;
  expect: ScenarioExpectation;
  /** Why this scenario exists; what failure it guards. */
  notes?: string;
};

import { resolveWeekday } from "../spokenDate";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

function ymdToUtcDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

export function addDays(ymd: string, days: number): string {
  const date = ymdToUtcDate(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Resolve a DateRef against the run's business "today" (YYYY-MM-DD). */
export function resolveDateRef(ref: DateRef, today: string): string {
  if (ref === "today") return today;
  if (ref === "tomorrow") return addDays(today, 1);
  if (ref === "day_after_tomorrow") return addDays(today, 2);
  const offset = /^today([+-]\d+)$/.exec(ref);
  if (offset) return addDays(today, Number(offset[1]));
  const weekday = /^(next|coming)_(\w+)$/.exec(ref);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[2] as (typeof WEEKDAYS)[number]);
    if (target < 0) throw new Error(`unknown weekday in DateRef: ${ref}`);
    return resolveWeekday(today, target, weekday[1] === "next" ? "next" : "coming");
  }
  throw new Error(`unknown DateRef: ${ref}`);
}

export function resolveDateRefs(ref: DateRef | DateRef[], today: string): string[] {
  return (Array.isArray(ref) ? ref : [ref]).map(item => resolveDateRef(item, today));
}

/** Structural validation so a sealed scenario cannot silently grade as vacuous. */
export function validateScenario(scenario: Scenario): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9_]+$/.test(scenario.id)) problems.push("id must be snake_case");
  if (!scenario.title) problems.push("title required");
  if (scenario.operator.mode === "scripted" && scenario.operator.turns.length === 0) problems.push("scripted operator needs turns");
  if (scenario.operator.mode === "simulated") {
    if (!scenario.operator.goals.length) problems.push("simulated operator needs goals");
    if (!scenario.operator.opening) problems.push("simulated operator needs an opening line");
    if (!(scenario.operator.maxTurns >= 2 && scenario.operator.maxTurns <= 30)) problems.push("maxTurns must be 2..30");
  }
  const checks =
    scenario.expect.dayLine.length +
    (scenario.expect.absent?.length ?? 0) +
    (scenario.expect.standingInstructions?.length ?? 0) +
    (scenario.expect.speech?.mustNotRaise?.length ?? 0) +
    (scenario.expect.speech?.mustMention?.length ?? 0);
  if (checks === 0) problems.push("a scenario must assert at least one outcome");
  for (const row of [...scenario.seed.dayLine]) {
    try {
      resolveDateRefs(row.businessDate, "2026-01-01");
    } catch (error) {
      problems.push(`seed row "${row.title}": ${(error as Error).message}`);
    }
  }
  for (const row of scenario.expect.dayLine) {
    try {
      new RegExp(row.titleMatches, "i");
      resolveDateRefs(row.businessDate, "2026-01-01");
    } catch (error) {
      problems.push(`expected row "${row.titleMatches}": ${(error as Error).message}`);
    }
  }
  return problems;
}
