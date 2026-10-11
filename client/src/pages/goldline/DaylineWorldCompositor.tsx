import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { DayPlanStop } from "../driver/goldlineDayPlanModel";
import {
  actionSlotArtScale,
  artForDayPlanKind,
  climbAvatarPosition,
  goldenTrailGeometry,
  groupConsecutiveActionSlots,
  shouldPlayClimb,
  visualStateForStop,
} from "./daylineWorldComposition";
import "./dayline-world-compositor.css";

const ART_ROOT = "/goldline/dayline-v1";

/**
 * Only preload types present in today's canonical projection. Empty-to-full
 * async changes immediately hide the complete scene until the new artwork has
 * decoded; neither the climber nor the objects can pop independently.
 */
function useDaylineArtReady(stops: readonly DayPlanStop[]) {
  const sources = [
    `${ART_ROOT}/avatar/idle.png`,
    ...[...new Set(stops.map(stop => artForDayPlanKind(stop.kind)))]
      .filter(kind => kind !== "generic")
      .map(kind => `${ART_ROOT}/objects/${kind}.png`),
  ];
  const key = sources.join("|");
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all(sources.map(source => {
      const image = new Image();
      image.src = source;
      return typeof image.decode === "function"
        ? image.decode().catch(() => undefined)
        : new Promise<void>(resolve => {
            image.onload = () => resolve();
            image.onerror = () => resolve();
          });
    })).then(() => {
      if (!cancelled) setLoadedKey(key);
    });
    return () => { cancelled = true; };
  }, [key]);
  return loadedKey === key;
}
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
function displayAddress(stop: DayPlanStop) {
  return stop.address && stop.address.trim() !== stop.title.trim() ? stop.address : null;
}
function artLabel(kind: ReturnType<typeof artForDayPlanKind>) {
  switch (kind) {
    case "sales": return "SALES MISSION";
    case "pickup": return "PICKUP";
    case "dropoff": return "DROPOFF";
    case "growth": return "GROWTH";
    case "marketing": return "MARKETING CHALLENGE";
    default: return "ACTION SLOT";
  }
}

/**
 * The original daily projection keeps control of order, mission eligibility
 * and completion. This renderer only groups adjacent same-type entries into
 * ONE landmark. Every action remains separately selectable by its original id.
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
  const artReady = useDaylineArtReady(stops);
  const completed = stops.filter(stop => stop.status === "completed").length;
  const previousCompleted = useRef(completed);
  const geometry = useMemo(() => goldenTrailGeometry(stops.length), [stops.length]);
  const groups = useMemo(() => groupConsecutiveActionSlots(stops), [stops]);
  const nextId = stops.find(
    stop => stop.status !== "completed" && stop.status !== "cancelled" && stop.status !== "blocked",
  )?.id ?? null;
  const avatar = climbAvatarPosition(completed, stops.length);
  // Place the adventurer's feet on the independently rendered gold trail,
  // reversing the vertical index because the operator climbs UP as the
  // chronological schedule scrolls DOWN.
  const climbAnchor = geometry.anchors[Math.max(
    0, Math.min(geometry.anchors.length - 1, Math.round((1 - avatar.fraction) * (stops.length - 1))),
  )];
  const avatarLeftPercent = climbAnchor ? 1 + climbAnchor.x * 0.57 - 12 : 8;
  // A sticky viewport anchor is crucial: the async day projection increases the
  // route height by thousands of pixels. A bottom-% absolute element disappears
  // below the fold as soon as those mission rows arrive.
  const avatarTopVh = 55 - 30 * avatar.fraction;

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

  const toggleOpened = (stopId: string) => {
    setOpened(previous => {
      const next = new Set(previous);
      if (next.has(stopId)) next.delete(stopId);
      else next.add(stopId);
      return next;
    });
  };

  return (
    <section className="gdp-v2-world gdp-v3-world" aria-label="Your GOLDLINE Action Slots" data-art-ready={artReady}>
      {!artReady && <div className="gdp-v4-art-wait" role="status">Assembling your Day Line…</div>}
      <div className={artReady ? "gdp-v4-art-scene is-ready" : "gdp-v4-art-scene"}>
      {onEnterExistingChapter && (
        <button
          type="button"
          className="gdp-v3-chapter"
          onClick={onEnterExistingChapter}
          aria-label="Enter unlocked GOLDLINE chapter"
        >
          <span>CHAPTER UNLOCKED</span>
          <strong>ENTER ›</strong>
        </button>
      )}
      {stops.length > 0 && (
        <svg
          className="gdp-v2-trail gdp-v3-trail"
          viewBox={`0 0 100 ${geometry.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path className="gdp-v2-trail-halo" d={geometry.path} />
          <path className="gdp-v2-trail-core" d={geometry.path} />
          {geometry.anchors.map((anchor, index) => (
            <circle
              key={stops[index].id}
              cx={anchor.x} cy={anchor.y} r={4}
              className={stops[index].status === "completed" ? "is-verified" : undefined}
            />
          ))}
        </svg>
      )}
      <div
        className={`gdp-v2-avatar gdp-v3-avatar gdp-v4-avatar${walking ? " is-walking" : ""}`}
        style={{
          top: `${avatarTopVh}dvh`,
          left: `${avatarLeftPercent}%`,
          transform: `scale(${avatar.scale})`,
          transition: isDriving || reducedMotion ? "none" : undefined,
        }}
        aria-label={`Explorer: ${completed} of ${stops.length} verified Action Slots`}
        role="img"
      >
        <img
          src={`${ART_ROOT}/avatar/${walking ? `walk-${String(walkerFrame).padStart(2, "0")}` : "idle"}.png`}
          alt=""
        />
      </div>
      <div className="gdp-v3-landmarks">
        {groups.map((group, groupIndex) => {
          const featured = group.items.find(({ stop }) => stop.status !== "completed" && stop.status !== "cancelled")?.stop
            ?? group.items[0].stop;
          const allCompleted = group.items.every(({ stop }) => stop.status === "completed");
          const groupOpened = allCompleted && group.items.every(({ stop }) => opened.has(stop.id));
          const image = objectImage(group.kind, groupOpened);
          const scale = actionSlotArtScale(group.items[0].index, stops.length);
          const layoutStyle = {
            "--group-size": group.items.length,
            "--landmark-scale": scale,
          } as CSSProperties;
          return (
            <section
              key={group.key}
              className={`gdp-v3-landmark gdp-v3-landmark--${group.kind} gdp-v3-landmark--variant-${groupIndex % 3}`}
              style={layoutStyle}
              data-art-landmark={group.kind}
              data-group-ids={group.items.map(({ stop }) => stop.id).join(",")}
            >
              <button
                type="button"
                className="gdp-v3-landmark-object"
                aria-label={`Enter ${artLabel(group.kind)}: ${featured.title}`}
                onClick={() => onSelect(featured)}
              >
                <span className="gdp-v4-object-platform" aria-hidden="true" />
                {image ? (
                  <img src={image} alt="" loading="eager" decoding="sync" />
                ) : (
                  <span className="gdp-v3-generic-object" aria-hidden="true">✦</span>
                )}
                <span className="gdp-v4-object-foreground" aria-hidden="true" />
              </button>
              {group.items.length > 1 && (
                <span className="gdp-v3-landmark-count">
                  {group.items.length} {artLabel(group.kind)} OBJECTIVES
                </span>
              )}
              <div className="gdp-v3-inscriptions">
                {group.items.map(({ stop, index }) => {
                  const state = visualStateForStop(stop, nextId, opened.has(stop.id));
                  return (
                    <div
                      key={stop.id}
                      className={`gdp-v3-action gdp-v3-action--${state}`}
                      data-testid={`day-plan-stop-${stop.id}`}
                      data-action-slot-id={stop.id}
                      data-action-art-scale={actionSlotArtScale(index, stops.length).toFixed(3)}
                      data-visual-state={state}
                    >
                      <button
                        className="gdp-v3-action-entry"
                        type="button"
                        onClick={() => onSelect(stop)}
                        aria-label={`Open ${stop.title}`}
                      >
                        <span className="gdp-v3-action-stamp">
                          <span>{stop.timeLabel}</span>
                          <b>{artLabel(group.kind)}</b>
                          {state === "up_next" && <em>NEXT</em>}
                        </span>
                        <strong>{stop.title}</strong>
                        {displayAddress(stop) && <small>{stop.address}</small>}
                        {stop.attentionState === "needs_details" && <small>LOCATION NEEDS DETAILS</small>}
                        {stop.status === "completed" && <small className="gdp-v3-completion">✓ VERIFIED COMPLETE</small>}
                      </button>
                      {stop.status === "completed" && (
                        <button
                          type="button"
                          className="gdp-v3-unseal"
                          onClick={() => toggleOpened(stop.id)}
                          aria-label={`${opened.has(stop.id) ? "Close" : "Open"} verified object for ${stop.title}`}
                          aria-pressed={opened.has(stop.id)}
                        >{opened.has(stop.id) ? "CLOSE" : "UNSEAL"} ✧</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      </div>
    </section>
  );
}
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}
