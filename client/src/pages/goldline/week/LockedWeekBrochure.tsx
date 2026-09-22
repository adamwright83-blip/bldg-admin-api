import React, { useMemo, useRef, useState } from "react";
import claireMark from "@/assets/goldline/generated/claire-hologram.webp";
import { GoldlineGameNav } from "../GoldlineGameNav";
import {
  dayGetsPrimaryCta,
  forwardingTagsForDay,
  lockedWeeklyIntentToWeekArtifact,
  missionHrefForCommitment,
  startCtaLabel,
  type WeekArtifactDay,
  type WeekArtifactViewModel,
} from "./lockedWeeklyIntentToWeekArtifact";
import { weekArtSrc } from "./weekArt";
import { ForwardingTagMark, WeekLoadoutItem } from "./WeekLoadout";
import {
  presentationForDay,
  type WeekPresentationOverlay,
} from "./weekPresentationOverlay";
import type { WeeklyIntentRecord } from "./weeklyIntentContract";
import "./week-brochure.css";

export type LockedWeekBrochureProps = {
  intent: WeeklyIntentRecord;
  overlay?: WeekPresentationOverlay;
  now: Date;
  timeZone?: string;
  initialFocusDate?: string | null;
  onReturnToDay: () => void;
  onStartMission?: (day: WeekArtifactDay) => void;
  onAdjustWeek?: () => void;
  onPlay?: () => void;
  onJournal?: () => void;
  planningHref?: string | null;
};

export default function LockedWeekBrochure(props: LockedWeekBrochureProps) {
  const model = useMemo(
    () =>
      lockedWeeklyIntentToWeekArtifact(
        props.intent,
        props.now,
        props.timeZone
      ),
    [props.intent, props.now, props.timeZone]
  );
  return (
    <LockedWeekView
      model={model}
      overlay={props.overlay}
      initialFocusDate={props.initialFocusDate}
      onReturnToDay={props.onReturnToDay}
      onStartMission={props.onStartMission}
      onAdjustWeek={props.onAdjustWeek}
      onPlay={props.onPlay}
      onJournal={props.onJournal}
      planningHref={props.planningHref}
    />
  );
}

function LockedWeekView({
  model,
  overlay,
  initialFocusDate,
  onReturnToDay,
  onStartMission,
  onAdjustWeek,
  onPlay,
  onJournal,
  planningHref,
}: {
  model: WeekArtifactViewModel;
  overlay?: WeekPresentationOverlay;
  initialFocusDate?: string | null;
  onReturnToDay: () => void;
  onStartMission?: (day: WeekArtifactDay) => void;
  onAdjustWeek?: () => void;
  onPlay?: () => void;
  onJournal?: () => void;
  planningHref?: string | null;
}) {
  const [focus, setFocus] = useState<string | null>(() => {
    if (
      initialFocusDate &&
      model.days.some(day => day.businessDate === initialFocusDate)
    ) {
      return initialFocusDate;
    }
    if (model.days.some(day => day.businessDate === model.currentBusinessDate)) {
      return model.currentBusinessDate;
    }
    return model.days[0]?.businessDate ?? null;
  });
  const index = model.days.findIndex(day => day.businessDate === focus);
  const pointerX = useRef<number | null>(null);

  function move(step: number) {
    const next = model.days[index + step];
    if (next) setFocus(next.businessDate);
  }

  const todayOutside =
    model.days.length > 0 &&
    !model.days.some(day => day.businessDate === model.currentBusinessDate);

  return (
    <main className="wb-shell" data-testid="week-brochure" data-week-phase="LOCKED">
      <header className="wb-mast">
        <img className="wb-claire" src={claireMark} alt="Claire" width={42} height={42} />
        <div>
          <p className="wb-kicker">WEEK LOCKED</p>
          <p className="wb-sub">Planned with Claire</p>
        </div>
        <p className="wb-rev">REV {model.revision}</p>
      </header>
      {todayOutside && (
        <p className="wb-note">Today is not on this locked week.</p>
      )}
      {model.days.length === 0 ? (
        <section className="wb-closed" aria-label="No remaining days">
          <h2>No remaining days</h2>
          <p>This locked week has nothing left on the horizon.</p>
        </section>
      ) : (
        <>
          <div
            className="wb-viewport"
            data-testid="week-fold"
            onPointerDown={event => {
              pointerX.current = event.clientX;
            }}
            onPointerUp={event => {
              if (pointerX.current == null) return;
              const delta = event.clientX - pointerX.current;
              pointerX.current = null;
              if (delta > 48) move(-1);
              else if (delta < -48) move(1);
            }}
          >
            <div className="wb-fold" role="group" aria-label="Locked week brochure">
              {index > 1 && <div className="wb-stack wb-stack--before" aria-hidden="true" />}
              {index > 0 && (
                <FoldPanel
                  day={model.days[index - 1]}
                  model={model}
                  overlay={overlay}
                  place="before"
                  onOpen={() => setFocus(model.days[index - 1].businessDate)}
                />
              )}
              <FoldPanel
                day={model.days[index]}
                model={model}
                overlay={overlay}
                place="current"
                onStartMission={onStartMission}
              />
              {index < model.days.length - 1 && (
                <FoldPanel
                  day={model.days[index + 1]}
                  model={model}
                  overlay={overlay}
                  place="after"
                  onOpen={() => setFocus(model.days[index + 1].businessDate)}
                />
              )}
              {index < model.days.length - 2 && (
                <div className="wb-stack wb-stack--after" aria-hidden="true" />
              )}
            </div>
          </div>
          <div className="wb-pager">
            <button type="button" onClick={() => move(-1)} disabled={index <= 0} aria-label="Previous day">
              Previous day
            </button>
            <button
              type="button"
              onClick={() => move(1)}
              disabled={index >= model.days.length - 1}
              aria-label="Next day"
            >
              Next day
            </button>
          </div>
        </>
      )}
      <AdjustSlip planningHref={planningHref} onAdjustWeek={onAdjustWeek} />
      <GoldlineGameNav
        active="week"
        onYourDay={onReturnToDay}
        onWeek={() => undefined}
        onPlay={onPlay ?? (() => undefined)}
        onJournal={onJournal ?? (() => undefined)}
      />
    </main>
  );
}

function FoldPanel({
  day,
  model,
  overlay,
  place,
  onOpen,
  onStartMission,
}: {
  day: WeekArtifactDay;
  model: WeekArtifactViewModel;
  overlay?: WeekPresentationOverlay;
  place: "before" | "current" | "after";
  onOpen?: () => void;
  onStartMission?: (day: WeekArtifactDay) => void;
}) {
  const skin = presentationForDay(overlay, day.businessDate);
  const showCta =
    place === "current" && dayGetsPrimaryCta(day, model.currentBusinessDate);
  const href = showCta ? missionHrefForCommitment(day.commitmentId) : null;
  const objectiveLabel = day.realPrimaryTitle || (day.disposition === "stand_down" ? "Stand down" : "");
  const tags = place === "current" ? forwardingTagsForDay(model.days, day.businessDate) : [];
  const face = (
    <>
      <span className="wb-seam wb-seam--left" aria-hidden="true" />
      <span className="wb-seam wb-seam--right" aria-hidden="true" />
      <div className="wb-plate">
        <img src={weekArtSrc(skin.artVariant)} alt="" />
        <p className="wb-weekday">{day.weekdayLabel.toUpperCase()}</p>
        {day.businessDate === model.currentBusinessDate && place === "current" && (
          <p className="wb-today">TODAY</p>
        )}
      </div>
      {place === "current" && (
        <>
          {skin.fictionTitle ? (
            <p className="wb-fiction" aria-hidden="true">
              {skin.fictionTitle}
            </p>
          ) : null}
          {day.realPrimaryTitle ? (
            <h2 className="wb-objective">{day.realPrimaryTitle}</h2>
          ) : day.disposition === "stand_down" ? (
            <p className="wb-disposition">Stand down</p>
          ) : null}
          {day.fixedConstraints.length > 0 && (
            <ul className="wb-constraints">
              {day.fixedConstraints.map(constraint => (
                <li key={constraint.sourceRef}>{constraint.title}</li>
              ))}
            </ul>
          )}
          <div className="wb-pocket" data-testid="week-loadout">
            {tags.map(tag => (
              <ForwardingTagMark key={tag.label} label={tag.label} />
            ))}
            {day.readiness.map(item => (
              <WeekLoadoutItem key={`${item.kind}-${item.text}`} item={item} />
            ))}
          </div>
          {showCta &&
            (href ? (
              <a className="wb-start" href={href} data-testid="week-start">
                {startCtaLabel(day)}
              </a>
            ) : (
              <button
                type="button"
                className="wb-start"
                data-testid="week-start"
                onClick={() => onStartMission?.(day)}
              >
                {startCtaLabel(day)}
              </button>
            ))}
        </>
      )}
    </>
  );
  const shared = {
    className: `wb-panel wb-panel--${place === "current" ? "current" : `peek wb-panel--peek-${place}`}`,
    "data-business-date": day.businessDate,
    "data-place": place,
    "data-fiction": skin.fictionTitle ?? "",
    "data-art-variant": skin.artVariant ?? "default",
    "data-chapter-skin": skin.chapterSkinId ?? "",
  };
  if (place === "current") {
    return (
      <article
        {...shared}
        aria-current="date"
        aria-label={`${day.weekdayLabel}. ${objectiveLabel}`}
      >
        {face}
      </article>
    );
  }
  return (
    <div
      {...shared}
      role="button"
      tabIndex={0}
      aria-label={`Show ${day.weekdayLabel}. ${objectiveLabel}`}
      onClick={onOpen}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen?.();
        }
      }}
    >
      {face}
    </div>
  );
}

export function AdjustSlip({
  planningHref,
  onAdjustWeek,
}: {
  planningHref?: string | null;
  onAdjustWeek?: () => void;
}) {
  if (planningHref) {
    return (
      <a className="wb-adjust" href={planningHref}>
        Adjust with Claire
      </a>
    );
  }
  return (
    <button type="button" className="wb-adjust" data-testid="week-adjust" onClick={() => onAdjustWeek?.()}>
      Adjust with Claire
    </button>
  );
}
