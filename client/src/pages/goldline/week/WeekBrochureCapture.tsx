import React from "react";
import WeekBrochure from "./WeekBrochure";
import {
  fixtureEmptyOverlay,
  fixtureFictionOverlay,
  fixtureFullLockedWeek,
  fixtureNow,
  fixtureTwoDayWeek,
  MON,
  THU,
  WED,
} from "./weekFixtures";
import type { WeekVisit } from "./readWeekVisit";

/**
 * Harness entry for screenshots. Fixture data only. No business writes.
 */
export default function WeekBrochureCapture({ fixture }: { fixture: string }) {
  const spec = captureSpec(fixture);
  return (
    <WeekBrochure
      visit={spec.visit}
      now={spec.now}
      initialFocusDate={spec.focus}
      onReturnToDay={() => undefined}
      onStartMission={() => undefined}
      onAdjustWeek={() => undefined}
      onPlay={() => undefined}
      onJournal={() => undefined}
    />
  );
}

function captureSpec(fixture: string): {
  visit: WeekVisit;
  now: Date;
  focus: string | null;
} {
  switch (fixture) {
    case "wednesday":
      return {
        visit: { phase: "LOCKED", intent: fixtureFullLockedWeek, overlay: fixtureFictionOverlay },
        now: fixtureNow(WED),
        focus: WED,
      };
    case "two-day":
      return {
        visit: { phase: "LOCKED", intent: fixtureTwoDayWeek, overlay: fixtureFictionOverlay },
        now: fixtureNow(THU),
        focus: THU,
      };
    case "prep-earlier":
      return {
        visit: { phase: "LOCKED", intent: fixtureFullLockedWeek, overlay: fixtureFictionOverlay },
        now: fixtureNow(MON),
        focus: WED,
      };
    case "blocked":
      return {
        visit: { phase: "LOCKED", intent: fixtureFullLockedWeek, overlay: fixtureFictionOverlay },
        now: fixtureNow(MON),
        focus: THU,
      };
    case "unplanned":
      return { visit: { phase: "UNPLANNED" }, now: fixtureNow(MON), focus: null };
    case "in-progress":
      return { visit: { phase: "IN_PROGRESS" }, now: fixtureNow(MON), focus: null };
    case "empty-overlay":
      return {
        visit: { phase: "LOCKED", intent: fixtureFullLockedWeek, overlay: fixtureEmptyOverlay },
        now: fixtureNow(MON),
        focus: MON,
      };
    case "locked-full":
    case "narrow":
    default:
      return {
        visit: { phase: "LOCKED", intent: fixtureFullLockedWeek, overlay: fixtureFictionOverlay },
        now: fixtureNow(MON),
        focus: MON,
      };
  }
}
