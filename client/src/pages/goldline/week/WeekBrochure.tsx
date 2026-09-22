import React, { lazy, Suspense } from "react";
import claireMark from "@/assets/goldline/generated/claire-hologram.webp";
import { GoldlineGameNav } from "../GoldlineGameNav";
import { isLockedWeeklyIntent } from "./weeklyIntentContract";
import type { WeekVisit } from "./readWeekVisit";
import "./week-brochure.css";

const LockedWeekBrochure = lazy(() => import("./LockedWeekBrochure"));

export type WeekBrochureProps = {
  visit: WeekVisit;
  now: Date;
  timeZone?: string;
  initialFocusDate?: string | null;
  onReturnToDay: () => void;
  onStartMission?: (day: import("./lockedWeeklyIntentToWeekArtifact").WeekArtifactDay) => void;
  onAdjustWeek?: () => void;
  onPlay?: () => void;
  onJournal?: () => void;
  planningHref?: string | null;
};

/**
 * Week is a place you visit. It renders the locked agreement, or a restrained
 * waiting state. It does not plan, lock, or rewrite today's Day Line.
 */
export default function WeekBrochure(props: WeekBrochureProps) {
  if (props.visit.phase === "LOCKED" && isLockedWeeklyIntent(props.visit.intent)) {
    return (
      <Suspense fallback={<div className="wb-shell" data-testid="week-brochure-loading" />}>
        <LockedWeekBrochure
          intent={props.visit.intent}
          overlay={props.visit.overlay}
          now={props.now}
          timeZone={props.timeZone}
          initialFocusDate={props.initialFocusDate}
          onReturnToDay={props.onReturnToDay}
          onStartMission={props.onStartMission}
          onAdjustWeek={props.onAdjustWeek}
          onPlay={props.onPlay}
          onJournal={props.onJournal}
          planningHref={props.planningHref}
        />
      </Suspense>
    );
  }

  const inProgress = props.visit.phase === "IN_PROGRESS";
  return (
    <main
      className="wb-shell"
      data-testid="week-brochure"
      data-week-phase={inProgress ? "IN_PROGRESS" : "UNPLANNED"}
    >
      <header className="wb-mast">
        <img className="wb-claire" src={claireMark} alt="Claire" width={42} height={42} />
        <div>
          <p className="wb-kicker">{inProgress ? "WEEK IN PROGRESS" : "WEEK"}</p>
          <p className="wb-sub">
            {inProgress ? "Continue with Claire" : "Day Line is where you stand"}
          </p>
        </div>
      </header>
      <section className="wb-closed" aria-label={inProgress ? "Week in progress" : "No locked week"}>
        {inProgress ? (
          <>
            <h1>WEEK IN PROGRESS</h1>
            <p>Claire is still building the week with you.</p>
            <button type="button" className="wb-continue" onClick={() => props.onAdjustWeek?.()}>
              Continue with Claire
            </button>
          </>
        ) : (
          <>
            <h1>No week is locked</h1>
            <p>Your day stays on the Day Line.</p>
          </>
        )}
      </section>
      <GoldlineGameNav
        active="week"
        onYourDay={props.onReturnToDay}
        onWeek={() => undefined}
        onPlay={props.onPlay ?? (() => undefined)}
        onJournal={props.onJournal ?? (() => undefined)}
      />
    </main>
  );
}
