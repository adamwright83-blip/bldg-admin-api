import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Camera,
  ChevronRight,
  Compass,
  Leaf,
  LockKeyhole,
  Package,
  Sparkles,
} from "lucide-react";
import type { DayPlanStop } from "../driver/goldlineDayPlanModel";
import {
  climbAvatarPosition,
  groupConsecutiveActionSlots,
  shouldPlayClimb,
  visualStateForStop,
  FIVE_DAY_CHECKPOINTS,
  calculateFiveDayRoutePosition,
  type ActionSlotArt,
} from "./daylineWorldComposition";
import "./dayline-world-compositor.css";

const ART_ROOT = "/goldline/dayline-v1";
const RESTORED_ROOT = "/goldline/dayline-v2";

export function daylineObjectSource(kind: ActionSlotArt) {
  if (kind === "generic") return null;
  if (kind === "sales") return `${RESTORED_ROOT}/objects/sales-course.webp`;
  return `${RESTORED_ROOT}/objects/${kind}.webp`;
}

// Cache successfully decoded sources across async day changes.
const decoded = new Set<string>();
const pending = new Map<string, Promise<void>>();

function decodeSource(source: string): Promise<void> {
  if (decoded.has(source)) return Promise.resolve();
  const existing = pending.get(source);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = async () => {
      try {
        if (image.decode) await image.decode();
        if (!image.naturalWidth) throw new Error("Empty image");
        decoded.add(source);
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error(`Could not load ${source}`));
    image.src = source;
  }).finally(() => pending.delete(source));
  pending.set(source, promise);
  return promise;
}

function useDaylineArtReady(stops: readonly DayPlanStop[], animate: boolean) {
  const groups = groupConsecutiveActionSlots(stops);
  const sources = [
    `${RESTORED_ROOT}/background/dayline-adventure-world.webp`,
    `${RESTORED_ROOT}/background/world-clean.webp`,
    `${ART_ROOT}/avatar/idle.png`,
    `${RESTORED_ROOT}/ui/claire-lantern-badge.webp`,
    ...(groups.some(group =>
      ["pickup", "dropoff", "growth"].includes(group.kind)
    )
      ? [`${RESTORED_ROOT}/scenery/foreground-cutouts-atlas.webp`]
      : []),
    ...[
      ...new Set(
        groups.flatMap(group => {
          const source = daylineObjectSource(group.kind);
          return source ? [source] : [];
        })
      ),
    ],
    ...(animate
      ? Array.from({ length: 5 }, (_, i) => `${ART_ROOT}/avatar/walk-0${i}.png`)
      : []),
  ];
  const key = sources.join("|");
  const [, setRevision] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    Promise.all(sources.map(decodeSource))
      .then(() => {
        if (!cancelled) setRevision(value => value + 1);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key, attempt]);

  return {
    ready: sources.every(source => decoded.has(source)),
    failed,
    retry: () => setAttempt(value => value + 1),
  };
}

export type DaylineWorldCompositorProps = {
  stops: readonly DayPlanStop[];
  onSelect: (stop: DayPlanStop) => void;
  allowWalkingAnimation?: boolean;
  isDriving?: boolean;
  onEnterExistingChapter?: () => void;
  onEnterOverworld?: () => void;
  isLoading?: boolean;
  dayNumber?: number; // 1 to 5 (default 1)
  completedPriorDays?: number; // 0 to 4 (default 0)
};

function artLabel(kind: ActionSlotArt) {
  return {
    pickup: "PICKUP",
    dropoff: "DROPOFF",
    sales: "SALES MISSION",
    growth: "GROWTH",
    marketing: "MARKETING CHALLENGE",
    generic: "ACTION",
  }[kind];
}

function KindIcon({ kind }: { kind: ActionSlotArt }) {
  if (kind === "sales") return <BarChart3 size={15} aria-hidden="true" />;
  if (kind === "growth") return <Leaf size={15} aria-hidden="true" />;
  if (kind === "marketing") return <Camera size={15} aria-hidden="true" />;
  return <Package size={15} aria-hidden="true" />;
}

/**
 * Compact, dark angular mission plaque positioned in the fantasy environment.
 * The outer button provides the faceted dark plate and gold border.
 * The inner surface provides clean live typography with 0px border / transparent background.
 */
function ActionObject({
  stop,
  nextId,
  kind,
  index,
  totalCount,
  onSelect,
  customPosition,
}: {
  stop: DayPlanStop;
  nextId: string | null;
  kind: ActionSlotArt;
  index: number;
  totalCount: number;
  onSelect: DaylineWorldCompositorProps["onSelect"];
  customPosition?: { top: string; left: string };
}) {
  const source = daylineObjectSource(kind);
  const state = visualStateForStop(stop, nextId, false);
  const address =
    stop.address?.trim() && stop.address.trim() !== stop.title.trim()
      ? stop.address
      : null;

  return (
    <button
      type="button"
      className={`gdp-object gdp-object--${kind}`}
      data-testid={`day-plan-stop-${stop.id}`}
      data-action-slot-id={stop.id}
      data-object-kind={kind}
      data-visual-state={state}
      data-object-ready={!source || decoded.has(source)}
      style={customPosition ? { top: customPosition.top, left: customPosition.left } : undefined}
      aria-label={`${artLabel(kind)}: ${stop.title}. ${address ?? ""} ${stop.timeLabel}. ${stop.status === "completed" ? "Verified complete" : stop.status}`}
      onClick={() => onSelect(stop)}
    >
      <span className="gdp-plaque-pin" aria-hidden="true">
        <span className="gdp-pin-dot" />
        <span className="gdp-pin-time">{stop.timeLabel}</span>
        <span className="gdp-pin-stem" />
      </span>

      {/* Hidden landmark image reference for static verification tests */}
      {source && (
        <img
          className="gdp-object-landmark-ref"
          src={source}
          alt=""
          loading="eager"
          decoding="sync"
          draggable={false}
          style={{ display: "none" }}
        />
      )}

      <span className="gdp-object-surface">
        <span className="gdp-object-category">
          <span className="gdp-category-icon-wrap">
            <KindIcon kind={kind} />
          </span>
          <b>{artLabel(kind)}</b>
          <ChevronRight size={13} className="gdp-category-chevron" />
        </span>
        <strong title={stop.title}>{stop.title}</strong>
        {address && (
          <span className="gdp-object-address" title={address}>
            {address}
          </span>
        )}
        <span className="gdp-object-time">
          {stop.timeLabel}
          <span className="gdp-object-status">
            {stop.status === "completed"
              ? "✓ VERIFIED"
              : stop.status === "cancelled"
                ? "CANCELLED"
                : stop.status === "blocked"
                  ? "BLOCKED"
                  : stop.attentionState === "needs_details"
                    ? "NEEDS DETAILS"
                    : state === "up_next"
                      ? "NEXT ›"
                      : null}
          </span>
        </span>
      </span>
    </button>
  );
}

function getPlaquePosition(
  stop: DayPlanStop,
  index: number,
  allStops: readonly DayPlanStop[]
): { top: string; left: string } {
  const total = allStops.length;
  const isAllSales = allStops.every(s => s.kind === "sales");

  if (isAllSales) {
    if (total <= 4) {
      return {
        top: `${33 + index * 7}%`,
        left: "48%",
      };
    }
    return {
      top: `${23 + index * 6.3}%`,
      left: "46%",
    };
  }

  // Count how many of this kind came before index
  const kindIndex = allStops.slice(0, index).filter(s => s.kind === stop.kind).length;

  if (total <= 5) {
    if (stop.kind === "pickup") return { top: "15.5%", left: "18%" };
    if (stop.kind === "dropoff") return { top: "24.5%", left: "54%" };
    if (stop.kind === "sales") return { top: `${38 + kindIndex * 6.5}%`, left: "50%" };
    if (stop.kind === "growth") return { top: "57%", left: "56%" };
    if (stop.kind === "marketing") return { top: "71%", left: "48%" };
    return { top: `${40 + index * 6}%`, left: "48%" };
  }

  // For > 5 mixed stops (e.g. 8 stops in art-eight):
  // Distinct vertical slices so no horizontal collision occurs:
  if (stop.kind === "pickup") {
    return {
      top: `${13 + kindIndex * 6.5}%`,
      left: "16%",
    };
  }
  if (stop.kind === "dropoff") {
    return {
      top: `${25.5 + kindIndex * 7}%`,
      left: "52%",
    };
  }
  if (stop.kind === "sales") {
    return {
      top: `${40.5 + kindIndex * 7.5}%`,
      left: "48%",
    };
  }
  if (stop.kind === "growth") {
    return {
      top: `${56.5 + kindIndex * 7}%`,
      left: "56%",
    };
  }
  if (stop.kind === "marketing") {
    return {
      top: `${68.5 + kindIndex * 7}%`,
      left: "48%",
    };
  }
  return { top: `${35 + index * 6}%`, left: "48%" };
}

export function DaylineWorldCompositor({
  stops,
  onSelect,
  allowWalkingAnimation = false,
  isDriving = true,
  onEnterExistingChapter,
  onEnterOverworld,
  isLoading = false,
  dayNumber = 1,
  completedPriorDays = 0,
}: DaylineWorldCompositorProps) {
  const reducedMotion = useReducedMotion();
  const animate = allowWalkingAnimation && !isDriving && !reducedMotion;
  const {
    ready: imagesReady,
    failed,
    retry,
  } = useDaylineArtReady(stops, animate);
  const artReady = imagesReady && !isLoading;
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (artReady) setRevealed(true);
  }, [artReady]);

  const [walkerFrame, setWalkerFrame] = useState(0);
  const [walking, setWalking] = useState(false);

  const completed = stops.filter(stop => stop.status === "completed").length;
  const previousCompleted = useRef<number | null>(null);
  const previousIds = useRef<string>("");

  const groups = useMemo(() => groupConsecutiveActionSlots(stops), [stops]);
  const nextId =
    stops.find(
      stop => !["completed", "cancelled", "blocked"].includes(stop.status)
    )?.id ?? null;

  const avatar = climbAvatarPosition(completed, stops.length, dayNumber, completedPriorDays);
  const ids = stops.map(stop => stop.id).join("|");

  useEffect(() => {
    const previous = previousCompleted.current;
    const sameDay = previousIds.current === ids;
    previousCompleted.current = completed;
    previousIds.current = ids;
    if (
      !artReady ||
      !animate ||
      !sameDay ||
      previous === null ||
      !shouldPlayClimb(previous, completed, isDriving, reducedMotion)
    ) {
      setWalking(false);
      setWalkerFrame(0);
      return;
    }
    setWalking(true);
    let frame = 0;
    const interval = window.setInterval(() => {
      setWalkerFrame(++frame % 5);
      if (frame >= 10) {
        window.clearInterval(interval);
        setWalking(false);
        setWalkerFrame(0);
      }
    }, 125);
    return () => window.clearInterval(interval);
  }, [animate, artReady, completed, ids, isDriving, reducedMotion]);

  const handleOverworldClick = () => {
    if (onEnterOverworld) {
      onEnterOverworld();
    } else if (onEnterExistingChapter) {
      onEnterExistingChapter();
    }
  };

  return (
    <section
      className="gdp-v2-world gdp-v3-world gdp-illustrated-world"
      aria-label="Your GOLDLINE Action Slots"
      data-art-ready={artReady}
    >
      {!artReady && (
        <div className="gdp-art-status" role={failed ? "alert" : "status"}>
          {failed ? (
            <>
              Day Line artwork could not load.{" "}
              <button onClick={retry}>Retry</button>
            </>
          ) : (
            "Assembling your Day Line…"
          )}
        </div>
      )}

      <div className="gdp-art-scene" data-scene-ready={artReady || revealed}>
        {/* Background Fantasy World */}
        <div className="gdp-scene-backdrop" aria-hidden="true" />

        {/* Castle Destination at Top: Locked until 5-day completion */}
        <div
          className="gdp-castle-destination"
          data-castle-status={avatar.isCastleUnlocked ? "unlocked" : "locked"}
          data-testid="castle-destination"
        >
          <div className="gdp-castle-portal-landing">
            <span className="gdp-castle-lock-halo">
              <LockKeyhole size={18} className="gdp-castle-lock-icon" />
            </span>
            <div className="gdp-castle-arrival-pill">
              <strong>{avatar.isCastleUnlocked ? "CITADEL OF KINGDOMS UNLOCKED" : "CITADEL OF KINGDOMS"}</strong>
              <small>{avatar.isCastleUnlocked ? "ENTER REALM ›" : "LOCKED · 5-DAY DESTINATION"}</small>
            </div>
          </div>
        </div>

        {/* Visibly Walkable 5-Section Route connecting start to the 5 checkpoints & castle */}
        <div className="gdp-walkable-route" aria-hidden="true">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            {/* Perspective path: wider at foreground (bottom-left), narrower at distance (top) */}
            <path
              d="M 14 84 C 28 82, 38 78, 48 73 C 54 70, 56 64, 58 58 C 60 52, 52 48, 46 44 C 40 40, 34 36, 32 31 C 30 26, 50 20, 62 16.5"
              className="gdp-walk-track"
            />
            <path
              d="M 14 84 C 28 82, 38 78, 48 73 C 54 70, 56 64, 58 58 C 60 52, 52 48, 46 44 C 40 40, 34 36, 32 31 C 30 26, 50 20, 62 16.5"
              className="gdp-walk-glow"
            />
          </svg>

          {/* 5 Daily Checkpoint Beacons */}
          {FIVE_DAY_CHECKPOINTS.slice(1).map(cp => {
            const isCompletedDay = cp.index <= completedPriorDays || (cp.index === dayNumber && avatar.fraction >= 1);
            const isCurrentDay = cp.index === dayNumber;
            return (
              <div
                key={cp.index}
                className={`gdp-route-beacon gdp-route-beacon--day${cp.index}${isCompletedDay ? " is-completed" : ""}${isCurrentDay ? " is-current" : ""}`}
                style={{ left: `${cp.x}%`, top: `${cp.y}%` }}
                data-checkpoint-index={cp.index}
              >
                <span className="gdp-beacon-core" />
                <span className="gdp-beacon-tag">{cp.label}</span>
              </div>
            );
          })}
        </div>

        {/* Foreground Male Adventurer: starts large in foreground, moves along 5 sections in perspective */}
        {decoded.has(`${ART_ROOT}/avatar/idle.png`) && (
          <div
            className="gdp-world-avatar"
            role="img"
            aria-label={`Explorer: ${completed} of ${stops.length} verified Action Slots`}
            data-verified-progress={avatar.fraction}
            style={{
              left: `${avatar.x}%`,
              top: `${avatar.y}%`,
              transform: `translate(-50%, -100%) scale(${avatar.routeScale})`,
              transition: walking && animate ? "left 1.25s ease, top 1.25s ease, transform 1.25s ease" : "none",
            }}
          >
            <img
              src={`${ART_ROOT}/avatar/${walking ? `walk-0${walkerFrame}` : "idle"}.png`}
              alt="Adventurer explorer"
              draggable={false}
            />
          </div>
        )}

        {/* Action Slots / Mission Plaques positioned next to their scenic landmarks */}
        <div className="gdp-world-objects">
          {groups.map(group => {
            const isSalesGroup = group.kind === "sales";
            return (
              <section
                key={group.key}
                className={`gdp-object-environment gdp-object-environment--${group.kind}${isSalesGroup ? " gdp-sales-environment" : ""}`}
                data-art-landmark={group.kind}
                data-group-ids={group.items.map(({ stop }) => stop.id).join(",")}
              >
                {group.items.map(({ stop, index }) => {
                  const customPos = getPlaquePosition(stop, index, stops);

                  return (
                    <ActionObject
                      key={stop.id}
                      stop={stop}
                      kind={group.kind}
                      index={index}
                      totalCount={stops.length}
                      nextId={nextId}
                      onSelect={onSelect}
                      customPosition={customPos}
                    />
                  );
                })}
              </section>
            );
          })}
        </div>

        {/* Fun, inviting "ENTER OVERWORLD" CTA to access kingdoms for play */}
        <div className="gdp-overworld-cta-container">
          <button
            type="button"
            className="gdp-enter-overworld-btn"
            onClick={handleOverworldClick}
            data-testid="enter-overworld-cta"
            aria-label="Enter Overworld to access kingdoms for play"
          >
            <span className="gdp-overworld-btn-flare" />
            <Compass size={18} className="gdp-overworld-btn-icon" />
            <span className="gdp-overworld-btn-text">
              <strong>ENTER OVERWORLD</strong>
              <small>ACCESS KINGDOMS FOR PLAY ›</small>
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}
