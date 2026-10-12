import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { useVisualViewportSize } from "@/game/session/useVisualViewportSize";
import { Package } from "lucide-react";
import type { DayPlanStop } from "../driver/goldlineDayPlanModel";
import {
  climbAvatarPosition,
  groupConsecutiveActionSlots,
  shouldPlayClimb,
  visualStateForStop,
  type ActionSlotArt,
} from "./daylineWorldComposition";
import { approvedDaylinePlacements } from "./approvedDaylineLayout";
import "./dayline-world-compositor.css";

const RESTORED_ROOT = "/goldline/dayline-v2";
const APPROVED = `${RESTORED_ROOT}/ui/approved-reference.png`;
const BACKDROP = `${RESTORED_ROOT}/background/dayline-adventure-world.webp`;

/** Retained asset catalog for other Day Line surfaces. The scene plate already
 * contains these landmarks, so this compositor paints each landmark once. */
export function daylineObjectSource(kind: ActionSlotArt) {
  if (kind === "generic") return null;
  if (kind === "sales") return `${RESTORED_ROOT}/objects/sales-course.webp`;
  return `${RESTORED_ROOT}/objects/${kind}.webp`;
}

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
function useDaylineArtReady() {
  const [, setRevision] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    Promise.all([BACKDROP, APPROVED].map(decodeSource))
      .then(() => {
        if (!cancelled) setRevision(value => value + 1);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  return {
    ready: decoded.has(BACKDROP) && decoded.has(APPROVED),
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
  dayNumber?: number;
  completedPriorDays?: number;
  sceneHeader?: React.ReactNode;
  sceneFooter?: React.ReactNode;
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
  const boxes = {
    pickup: [208, 267, 66, 68],
    dropoff: [642, 414, 70, 70],
    sales: [571, 693, 70, 70],
    growth: [641, 973, 68, 70],
    marketing: [572, 1246, 67, 68],
  };
  if (kind === "generic") return <Package aria-hidden="true" />;
  return (
    <svg viewBox={boxes[kind].join(" ")} aria-hidden="true">
      <image href={APPROVED} width="941" height="1672" />
    </svg>
  );
}
function CategoryHeading({ kind }: { kind: ActionSlotArt }) {
  const id = `dayline-category-${useId().replace(/:/g, "")}`;
  const boxes = {
    pickup: [283, 265, 123, 29],
    dropoff: [728, 413, 131, 31],
    sales: [658, 694, 177, 31],
    growth: [725, 979, 126, 31],
    marketing: [658, 1260, 224, 30],
  };
  if (kind === "generic") return <>{artLabel(kind)}</>;
  const [x, y, width, height] = boxes[kind];
  return (
    <svg
      viewBox={`${x} ${y} ${width} ${height}`}
      style={{
        width: `${(width / 941) * 100}cqw`,
        height: `${(height / 941) * 100}cqw`,
      }}
      role="img"
      aria-label={artLabel(kind)}
    >
      <defs>
        <filter id={id} colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  .8 .8 .8 0 -.5"
          />
        </filter>
      </defs>
      <image href={APPROVED} width="941" height="1672" filter={`url(#${id})`} />
    </svg>
  );
}
function PinArtwork({ kind }: { kind: ActionSlotArt }) {
  const boxes = {
    pickup: [85, 283, 34, 34],
    dropoff: [526, 432, 34, 34],
    sales: [307, 684, 34, 34],
    growth: [498, 1013, 34, 34],
    marketing: [483, 1246, 34, 34],
    generic: [85, 283, 34, 34],
  };
  return (
    <svg viewBox={boxes[kind].join(" ")} aria-hidden="true">
      <image href={APPROVED} width="941" height="1672" />
    </svg>
  );
}

/** Compact a real time window for its two-line marker; never supply a time that
 * is absent from the projection. The full source label remains in aria-label. */
export function daylinePinLabel(value: string) {
  if (/^flexible (today|window)$/i.test(value)) return "FLEX\nTODAY";
  const window = value.match(
    /^(\d{1,2})(?::00)?\s*(AM|PM)?\s*[–—-]\s*(\d{1,2})(?::00)?\s*(AM|PM)$/i
  );
  if (window) {
    const [, start, startPeriod, end, endPeriod] = window;
    return startPeriod && startPeriod.toUpperCase() !== endPeriod.toUpperCase()
      ? `${start} ${startPeriod.toUpperCase()}–\n${end} ${endPeriod.toUpperCase()}`
      : `${start}–${end}\n${endPeriod.toUpperCase()}`;
  }
  return value.replace(/\s+(AM|PM)$/i, "\n$1");
}

function ActionObject({
  stop,
  kind,
  nextId,
  placement,
  onSelect,
  originTop = 0,
}: {
  stop: DayPlanStop;
  kind: ActionSlotArt;
  nextId: string | null;
  placement: ReturnType<typeof approvedDaylinePlacements>[number];
  onSelect: DaylineWorldCompositorProps["onSelect"];
  originTop?: number;
}) {
  const state = visualStateForStop(stop, nextId, false);
  const address =
    stop.address?.trim() && stop.address.trim() !== stop.title.trim()
      ? stop.address
      : null;
  const status =
    stop.status === "completed"
      ? "✓ VERIFIED"
      : stop.status === "cancelled"
        ? "CANCELLED"
        : stop.status === "blocked"
          ? "BLOCKED"
          : stop.attentionState === "needs_details"
            ? "NEEDS DETAILS"
            : null;
  return (
    <>
      <span
        className={`gdp-plaque-pin gdp-plaque-pin--${kind}`}
        data-pin-layout={placement.height === 110 ? "list" : "landmark"}
        style={{
          left: `${(placement.pinLeft / 941) * 100}%`,
          top: originTop
            ? `${((placement.pinTop - originTop) / 941) * 100}cqw`
            : `${(placement.pinTop / 1672) * 100}%`,
        }}
        aria-hidden="true"
      >
        <span className="gdp-pin-stem" />
        <span className="gdp-pin-dot">
          <PinArtwork kind={kind} />
        </span>
        <span className="gdp-pin-time">{daylinePinLabel(stop.timeLabel)}</span>
      </span>
      <button
        type="button"
        className={`gdp-object gdp-object--${kind}`}
        data-testid={`day-plan-stop-${stop.id}`}
        data-action-slot-id={stop.id}
        data-object-kind={kind}
        data-layout={placement.height === 110 ? "list" : "landmark"}
        data-visual-state={state}
        data-object-ready="true"
        style={{
          left: `${(placement.left / 941) * 100}%`,
          top: originTop
            ? `${((placement.top - originTop) / 941) * 100}cqw`
            : `${(placement.top / 1672) * 100}%`,
          width: `${(placement.width / 941) * 100}%`,
          minHeight: `${(placement.height / 941) * 100}cqw`,
        }}
        aria-label={`${artLabel(kind)}: ${stop.title}. ${address ?? ""} ${stop.timeLabel}. ${status ?? stop.status}`}
        onClick={() => onSelect(stop)}
      >
        <svg
          className="gdp-plaque-art"
          viewBox="0 0 320 128"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M64 1H273L319 44V90L282 127H64C29 127 1 99 1 64S29 1 64 1Z" />
        </svg>
        <span className="gdp-category-icon-wrap">
          <KindIcon kind={kind} />
        </span>
        <span className="gdp-object-surface">
          <b className="gdp-object-category">
            <CategoryHeading kind={kind} />
          </b>
          <strong title={stop.title}>{stop.title}</strong>
          {address && (
            <span className="gdp-object-address" title={address}>
              {address}
            </span>
          )}
          {stop.displayDetail && (
            <span className="gdp-object-detail">{stop.displayDetail}</span>
          )}
          {status && <span className="gdp-object-status">{status}</span>}
        </span>
      </button>
    </>
  );
}

const HERO_OUTLINE =
  "M186 797L212 791L242 800L253 817L251 840L242 858L265 878L281 882L298 905L305 951L315 976L320 1008L326 1026L331 1049L327 1075L322 1090L311 1096L302 1070L293 1037L275 1002L276 1055L284 1102L270 1151L282 1204L276 1240L262 1282L261 1320L254 1354L241 1383L211 1396L193 1398L178 1391L179 1371L190 1341L195 1299L197 1251L178 1229L162 1263L133 1303L115 1329L109 1363L98 1382L90 1415L76 1448L81 1472L67 1508L52 1507L39 1478L32 1453L40 1428L45 1398L58 1369L67 1329L78 1281L88 1232L103 1187L104 1147L82 1127L68 1114L56 1094L51 1070L55 1037L58 1005L61 973L75 940L85 925L107 905L127 890L145 879L162 875L174 858L171 837L176 815Z";

// Preserve the approved painted environment, route, light, hero and static
// chrome exactly. Always erase its sample business plaques and time/date text,
// even on an empty day, before rendering real source data in their place.
const SAMPLE_FIELDS = [
  [196, 254, 280, 124],
  [629, 400, 272, 123],
  [557, 675, 306, 135],
  [627, 959, 243, 113],
  [557, 1236, 338, 88],
  [110, 254, 77, 75],
  [553, 405, 77, 69],
  [330, 655, 98, 73],
  [530, 992, 89, 64],
  [508, 1221, 54, 65],
  [285, 187, 178, 36],
  [90, 18, 71, 38],
  [725, 16, 165, 38],
] as const;

export function DaylineWorldCompositor({
  stops,
  onSelect,
  allowWalkingAnimation = false,
  isDriving = true,
  isLoading = false,
  dayNumber = 1,
  completedPriorDays = 0,
  sceneHeader,
  sceneFooter,
}: DaylineWorldCompositorProps) {
  const [worldElement, setWorldElement] = useState<HTMLElement | null>(null);
  useVisualViewportSize(
    worldElement?.closest<HTMLElement>(".gdp-shell") ?? worldElement
  );
  const reducedMotion = useReducedMotion();
  const { ready: imagesReady, failed, retry } = useDaylineArtReady();
  const artReady = imagesReady && !isLoading;
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (artReady) setRevealed(true);
  }, [artReady]);
  const completed = stops.filter(stop => stop.status === "completed").length;
  const previousCompleted = useRef<number | null>(null);
  const previousIds = useRef("");
  const [walking, setWalking] = useState(false);
  const ids = stops.map(stop => stop.id).join("|");
  const animate = allowWalkingAnimation && !isDriving && !reducedMotion;
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
      return;
    }
    setWalking(true);
    const timer = window.setTimeout(() => setWalking(false), 1250);
    return () => window.clearTimeout(timer);
  }, [animate, artReady, completed, ids, isDriving, reducedMotion]);
  const avatar = climbAvatarPosition(
    completed,
    stops.length,
    dayNumber,
    completedPriorDays
  );
  const groups = useMemo(() => groupConsecutiveActionSlots(stops), [stops]);
  const placements = useMemo(() => approvedDaylinePlacements(stops), [stops]);
  const nextId =
    stops.find(
      stop => !["completed", "cancelled", "blocked"].includes(stop.status)
    )?.id ?? null;
  const clipId = `dayline-explorer-${useId().replace(/:/g, "")}`;
  const sceneMask = `${clipId}-scene`;
  const continuation = placements.findIndex(placement => placement.top > 1320);
  const continuationTop =
    continuation >= 0 ? placements[continuation].top - 30 : 0;
  return (
    <section
      ref={setWorldElement}
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
      <div
        className="gdp-viewport-frame"
        data-scene-ready={artReady || revealed}
      >
        <div className="gdp-viewport-backdrop" aria-hidden="true" />
        <div className="gdp-art-scene" data-scene-ready={artReady || revealed}>
          <div className="gdp-scene-backdrop" aria-hidden="true" />
          <svg
            className="gdp-approved-art-layer"
            viewBox="0 0 941 1672"
            aria-hidden="true"
          >
            <defs>
              <mask
                id={sceneMask}
                maskUnits="userSpaceOnUse"
                x="0"
                y="0"
                width="941"
                height="1672"
              >
                <rect width="941" height="1672" fill="white" />
                {SAMPLE_FIELDS.map(([x, y, width, height], index) => (
                  <rect
                    key={`${x}-${y}`}
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    fill="black"
                    filter={
                      index >= 5 ? `url(#${sceneMask}-feather)` : undefined
                    }
                  />
                ))}
                {/* The responsive dock is native chrome at the frame bottom. */}
                <rect x="0" y="1508" width="941" height="128" fill="black" />
                <circle cx="375" cy="1537" r="64" fill="black" />
                {avatar.fraction > 0 && (
                  <rect x="32" y="790" width="305" height="720" fill="black" />
                )}
              </mask>
              <filter
                id={`${sceneMask}-feather`}
                x="-50%"
                y="-50%"
                width="200%"
                height="200%"
              >
                <feGaussianBlur stdDeviation="3" />
              </filter>
            </defs>
            <image
              href={APPROVED}
              width="941"
              height="1672"
              mask={`url(#${sceneMask})`}
            />
          </svg>
          {sceneHeader}
          <svg
            className="gdp-world-avatar"
            viewBox="0 0 941 1672"
            role="img"
            aria-label={`Explorer: ${completed} of ${stops.length} verified Action Slots`}
            data-verified-progress={avatar.fraction}
            style={{
              transform: `translate(${avatar.x - 14}%, ${avatar.y - 84}%) scale(${avatar.routeScale / 1.15})`,
              transition: walking && animate ? "transform 1.25s ease" : "none",
            }}
          >
            <defs>
              <clipPath id={clipId}>
                <path d={HERO_OUTLINE} />
              </clipPath>
            </defs>
            {avatar.fraction > 0 && (
              <image
                href={APPROVED}
                width="941"
                height="1672"
                clipPath={`url(#${clipId})`}
              />
            )}
          </svg>
          <div className="gdp-world-objects">
            {groups.map(group => (
              <section
                key={group.key}
                className={`gdp-object-environment gdp-object-environment--${group.kind}`}
                data-art-landmark={group.kind}
                data-group-ids={group.items
                  .map(({ stop }) => stop.id)
                  .join(",")}
              >
                {group.items
                  .filter(({ index }) => placements[index].top <= 1320)
                  .map(({ stop, index }) => (
                    <ActionObject
                      key={stop.id}
                      stop={stop}
                      kind={group.kind}
                      nextId={nextId}
                      placement={placements[index]}
                      onSelect={onSelect}
                    />
                  ))}
              </section>
            ))}
          </div>
        </div>
        {sceneFooter}
      </div>
      {continuation >= 0 && (
        <div
          className="gdp-dayline-continuation"
          data-scene-ready={artReady || revealed}
          style={{
            height: `${((placements.at(-1)!.top - continuationTop + 180) / 941) * 100}cqw`,
          }}
          aria-label="More Day Line actions"
        >
          {groups.map(group => (
            <React.Fragment key={group.key}>
              {group.items
                .filter(({ index }) => placements[index].top > 1320)
                .map(({ stop, index }) => (
                  <ActionObject
                    key={stop.id}
                    stop={stop}
                    kind={group.kind}
                    nextId={nextId}
                    placement={placements[index]}
                    originTop={continuationTop}
                    onSelect={onSelect}
                  />
                ))}
            </React.Fragment>
          ))}
        </div>
      )}
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
