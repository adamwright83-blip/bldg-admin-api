import { useEffect, useMemo, useRef, useState } from "react";
import type { DayPlanStop } from "../driver/goldlineDayPlanModel";
import {
  actionSlotArtScale,
  artForDayPlanKind,
  climbAvatarPosition,
  goldenTrailGeometry,
  shouldPlayClimb,
  visualStateForStop,
} from "./daylineWorldComposition";
import "./dayline-world-compositor.css";

const ART_ROOT = "/goldline/dayline-v1";
type Props = {
  stops: readonly DayPlanStop[];
  onSelect: (stop: DayPlanStop) => void;
  /** Must be explicitly provided by a trusted driving-state signal. */
  allowWalkingAnimation?: boolean;
  isDriving?: boolean;
  onEnterExistingChapter?: () => void;
};
function objectImage(kind: ReturnType<typeof artForDayPlanKind>, open: boolean): string | null {
  if (kind === "generic") return null;
  return `${ART_ROOT}/${open ? "states" : "objects"}/${kind}${open ? "-open" : ""}.png`;
}
function isDisplayableAddress(stop: DayPlanStop) {
  return stop.address && stop.address.trim() !== stop.title.trim() ? stop.address : null;
}

/**
 * Existing day projection in, immersive artwork out.
 *
 * The component has no write path; tapping an object opens the real stop
 * action via its original handler. Opening a completed object is local display
 * state only and cannot complete work or grant a reward.
 */
export function DaylineWorldCompositor({
  stops,
  onSelect,
  allowWalkingAnimation = false,
  isDriving = true,
  onEnterExistingChapter,
}: Props) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [walkerFrame, setWalkerFrame] = useState(0);
  const [walking, setWalking] = useState(false);
  const reducedMotion = useReducedMotion();
  const completed = stops.filter(stop => stop.status === "completed").length;
  const previousCompleted = useRef(completed);
  const geometry = useMemo(() => goldenTrailGeometry(stops.length), [stops.length]);
  const active = stops.find(
    stop => stop.status !== "completed" && stop.status !== "cancelled" && stop.status !== "blocked",
  )?.id ?? null;
  const avatar = climbAvatarPosition(completed, stops.length);

  useEffect(() => {
    const previous = previousCompleted.current;
    previousCompleted.current = completed;
    if (!allowWalkingAnimation || !shouldPlayClimb(previous, completed, isDriving, reducedMotion)) {
      setWalking(false);
      setWalkerFrame(0);
      return;
    }
    setWalking(true);
    let count = 0;
    const interval = window.setInterval(() => {
      count += 1;
      setWalkerFrame(count % 5);
      if (count >= 7) {
        window.clearInterval(interval);
        setWalking(false);
        setWalkerFrame(0);
      }
    }, 125);
    return () => window.clearInterval(interval);
  }, [allowWalkingAnimation, completed, isDriving, reducedMotion]);

  return (
    <section className="gdp-v2-world" aria-label="Your Goldline Action Slots">
      <div className="gdp-v2-summit" aria-hidden={!onEnterExistingChapter}>
        {onEnterExistingChapter ? (
          <button type="button" onClick={onEnterExistingChapter} aria-label="Enter available Goldline chapter">
            <span>CHAPTER AVAILABLE</span>
          </button>
        ) : null}
      </div>
      {stops.length > 0 && (
        <svg
          className="gdp-v2-trail"
          viewBox={`0 0 100 ${geometry.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path className="gdp-v2-trail-halo" d={geometry.path} />
          <path className="gdp-v2-trail-core" d={geometry.path} />
          {geometry.anchors.map((anchor, index) => (
            <circle key={index} cx={anchor.x} cy={anchor.y} r={5}
              className={index < completed ? "is-verified" : undefined}
            />
          ))}
        </svg>
      )}
      <div
        className={`gdp-v2-avatar${walking ? " is-walking" : ""}`}
        style={{
          bottom: `${avatar.bottomPercent}%`,
          transform: `scale(${avatar.scale})`,
          transition: isDriving || reducedMotion ? "none" : undefined,
        }}
        aria-label={`Explorer: ${completed} of ${stops.length} Action Slots verified complete`}
        role="img"
      >
        <img
          src={`${ART_ROOT}/avatar/${walking ? `walk-${String(walkerFrame).padStart(2, "0")}` : "idle"}.png`}
          alt=""
        />
      </div>
      <div className="gdp-v2-slots">
        {stops.map((stop, index) => {
          const art = artForDayPlanKind(stop.kind);
          const isOpened = opened.has(stop.id) && stop.status === "completed";
          const visualState = visualStateForStop(stop, active, isOpened);
          const image = objectImage(art, isOpened);
          return (
            <article
              key={stop.id}
              className={`gdp-v2-slot gdp-v2-slot--${art} gdp-v2-slot--${visualState}`}
              data-testid={`day-plan-stop-${stop.id}`}
              data-action-slot-id={stop.id}
              data-action-art-scale={actionSlotArtScale(index, stops.length).toFixed(3)}
              data-visual-state={visualState}
            >
              <div className="gdp-v2-art" aria-hidden="true" style={{
                transform: `scale(${actionSlotArtScale(index, stops.length)})`,
              }}>
                {image ? <img src={image} alt="" loading={index > 1 ? "lazy" : "eager"} /> : (
                  <span className="gdp-v2-generic-art">◆</span>
                )}
              </div>
              <div className="gdp-v2-inscription">
                <span className="gdp-v2-time">{stop.timeLabel}</span>
                <span className="gdp-v2-category">{stop.kind === "sales" ? "SALES MISSION" : stop.kind.toUpperCase()}</span>
                {visualState === "now" && <b className="gdp-v2-now">NOW</b>}
                <button type="button" onClick={() => onSelect(stop)} aria-label={`Open ${stop.title}`}>
                  <strong>{stop.title}</strong>
                  <span aria-hidden="true">›</span>
                </button>
                {isDisplayableAddress(stop) && <small>{stop.address}</small>}
                {stop.status === "completed" && <span className="gdp-v2-verified">VERIFIED COMPLETE</span>}
                {stop.status === "blocked" && <span className="gdp-v2-warning">BLOCKED</span>}
                {stop.attentionState === "needs_details" && <span className="gdp-v2-warning">NEEDS DETAILS</span>}
                {stop.status === "completed" && (
                  <button
                    type="button"
                    className="gdp-v2-open-object"
                    onClick={() => setOpened(old => {
                      const next = new Set(old);
                      if (next.has(stop.id)) next.delete(stop.id);
                      else next.add(stop.id);
                      return next;
                    })}
                    aria-label={`${isOpened ? "Close" : "Open"} ${stop.kind} art for ${stop.title}`}
                    aria-pressed={isOpened}
                  >
                    {isOpened ? "CLOSE OBJECT" : "OPEN OBJECT"}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}
