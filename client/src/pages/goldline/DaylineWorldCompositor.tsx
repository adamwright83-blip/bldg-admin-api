import React, { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, ChevronRight, Compass, Leaf, Package } from "lucide-react";
import type { DayPlanStop } from "../driver/goldlineDayPlanModel";
import {
  climbAvatarPosition,
  groupConsecutiveActionSlots,
  shouldPlayClimb,
  visualStateForStop,
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

// Cache successfully decoded sources across async day changes. Keep the current
// scene visible while new categories load; a failed image is never "ready".
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
    `${RESTORED_ROOT}/background/world-clean.webp`,
    `${ART_ROOT}/avatar/idle.png`,
    ...(groups.some(group =>
      ["pickup", "dropoff", "growth"].includes(group.kind)
    )
      ? [`${RESTORED_ROOT}/scenery/foreground-cutouts-atlas.webp`]
      : []),
    ...(groups.some(group => group.kind === "sales" && group.items.length === 1)
      ? [`${RESTORED_ROOT}/states/sales-open.webp`]
      : []),
    ...[
      ...new Set(
        groups.flatMap(group => {
          const source =
            group.kind === "sales" && group.items.length > 1
              ? `${RESTORED_ROOT}/objects/sales-four.webp`
              : daylineObjectSource(group.kind);
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

type Props = {
  stops: readonly DayPlanStop[];
  onSelect: (stop: DayPlanStop) => void;
  allowWalkingAnimation?: boolean;
  isDriving?: boolean;
  onEnterExistingChapter?: () => void;
  isLoading?: boolean;
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
  const Icon =
    kind === "sales"
      ? BarChart3
      : kind === "growth"
        ? Leaf
        : kind === "marketing"
          ? Compass
          : Package;
  return <Icon aria-hidden="true" />;
}

/** The button IS the illustrated object. All mission copy is inside its own
 * measured physical surface. No sibling cards or common material rectangle. */
function ActionObject({
  stop,
  nextId,
  kind,
  index,
  onSelect,
  inscriptionOnly = false,
}: {
  stop: DayPlanStop;
  nextId: string | null;
  kind: ActionSlotArt;
  index: number;
  onSelect: Props["onSelect"];
  inscriptionOnly?: boolean;
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
      className={`gdp-object gdp-object--${kind}${inscriptionOnly ? ` gdp-sales-interaction gdp-sales-interaction--${index % 4}` : ""}`}
      data-testid={`day-plan-stop-${stop.id}`}
      data-action-slot-id={stop.id}
      data-object-kind={kind}
      data-visual-state={state}
      data-object-ready={
        inscriptionOnly
          ? decoded.has(`${RESTORED_ROOT}/objects/sales-four.webp`)
          : !source || decoded.has(source)
      }
      aria-label={`${artLabel(kind)}: ${stop.title}. ${address ?? ""} ${stop.timeLabel}. ${stop.status === "completed" ? "Verified complete" : stop.status}`}
      onClick={() => onSelect(stop)}
    >
      {kind !== "sales" && kind !== "marketing" && kind !== "generic" && (
        <span
          className="gdp-terrain gdp-terrain--platform"
          aria-hidden="true"
        />
      )}
      {source && !inscriptionOnly && (
        <img
          className="gdp-object-art"
          src={source}
          alt=""
          loading="eager"
          decoding="sync"
          draggable={false}
        />
      )}
      <span className="gdp-object-surface">
        <span className="gdp-object-category">
          <KindIcon kind={kind} />
          <b>{artLabel(kind)}</b>
          <ChevronRight />
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
      {kind === "growth" && (
        <span className="gdp-terrain gdp-terrain--foliage" aria-hidden="true" />
      )}
    </button>
  );
}

export function DaylineWorldCompositor({
  stops,
  onSelect,
  allowWalkingAnimation = false,
  isDriving = true,
  onEnterExistingChapter,
  isLoading = false,
}: Props) {
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
  const avatar = climbAvatarPosition(completed, stops.length);
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
        {onEnterExistingChapter && (
          <button
            className="gdp-world-chapter"
            onClick={onEnterExistingChapter}
          >
            CHAPTER UNLOCKED · ENTER ›
          </button>
        )}
        <div className="gdp-climb-route" aria-hidden="true">
          <svg viewBox="0 0 70 400" preserveAspectRatio="none">
            <path d="M35 0 C8 55 63 90 35 140 S8 230 35 280 S63 360 35 400" />
          </svg>
        </div>
        {decoded.has(`${ART_ROOT}/avatar/idle.png`) && (
          <div
            className="gdp-world-avatar"
            role="img"
            aria-label={`Explorer: ${completed} of ${stops.length} verified Action Slots`}
            data-verified-progress={avatar.fraction}
            style={{
              top: `${56 - 28 * avatar.fraction}dvh`,
              transform: `scale(${avatar.scale})`,
              transition: walking && animate ? undefined : "none",
            }}
          >
            <img
              src={`${ART_ROOT}/avatar/${walking ? `walk-0${walkerFrame}` : "idle"}.png`}
              alt=""
              draggable={false}
            />
          </div>
        )}
        <div className="gdp-world-objects">
          {groups.map(group => (
            <section
              key={group.key}
              className={`gdp-object-environment gdp-object-environment--${group.kind}${group.kind === "sales" && group.items.length > 1 ? " gdp-sales-environment" : ""}`}
              data-art-landmark={group.kind}
              data-group-ids={group.items.map(({ stop }) => stop.id).join(",")}
            >
              {group.kind === "sales" && group.items.length > 1 ? (
                Array.from(
                  { length: Math.ceil(group.items.length / 4) },
                  (_, chunk) => (
                    <div
                      className="gdp-sales-structure"
                      key={group.items[chunk * 4].stop.id}
                    >
                      <img
                        className="gdp-sales-structure-art"
                        src={`${RESTORED_ROOT}/objects/sales-four.webp`}
                        alt=""
                        loading="eager"
                        decoding="sync"
                        draggable={false}
                      />
                      {group.items
                        .slice(chunk * 4, chunk * 4 + 4)
                        .map(({ stop }, bay) => (
                          <ActionObject
                            key={stop.id}
                            stop={stop}
                            kind="sales"
                            index={bay}
                            nextId={nextId}
                            onSelect={onSelect}
                            inscriptionOnly
                          />
                        ))}
                    </div>
                  )
                )
              ) : (
                <>
                  {group.kind === "sales" && (
                    <>
                      <span className="gdp-sales-launch" aria-hidden="true" />
                      <span
                        className="gdp-sales-watercourse"
                        aria-hidden="true"
                      />
                    </>
                  )}
                  {group.items.map(({ stop, index }) => (
                    <ActionObject
                      key={stop.id}
                      stop={stop}
                      kind={group.kind}
                      index={index}
                      nextId={nextId}
                      onSelect={onSelect}
                    />
                  ))}
                  {group.kind === "sales" && (
                    <span className="gdp-sales-basin" aria-hidden="true" />
                  )}
                </>
              )}
            </section>
          ))}
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
