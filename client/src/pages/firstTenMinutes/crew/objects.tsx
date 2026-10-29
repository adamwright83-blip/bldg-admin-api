import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import type { PlacePin } from "@shared/firstTenMinutesCrew";
import { WEEKDAY_NAMES } from "@shared/firstTenMinutesCrew";
import type { RouteStop } from "@shared/firstTenMinutesFindings";
import { sourceDate } from "../SourceNote";
import { askedLine, leaderEnd, placeMapLabels, projector, titleSlip, unpinnedNote } from "./mapLabels";
import styles from "./crew.module.css";

/**
 * The person's own things, which carry the information. The crew only points at them. Each object is a button: tap it
 * for where it came from, and to say it isn't right.
 */
export function ObjectFrame({
  label,
  big,
  onOpen,
  corrected,
  children,
  testId,
}: {
  label: string;
  big: boolean;
  onOpen: () => void;
  corrected?: boolean;
  children: ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      className={`${styles.objectFrame} ${big ? styles.big : styles.small} ${corrected ? styles.corrected : ""}`}
      onClick={onOpen}
      aria-label={`${label}. Where this came from`}
      data-testid={testId}
      data-corrected={corrected ? "yes" : "no"}
    >
      {children}
    </button>
  );
}

/** Sable's: the person's own words on stationery. It straightens when she arrives. */
export function RuleSheet({
  quote,
  to,
  at,
  straight,
  struck,
  pinned,
}: {
  quote: string;
  to: string | null;
  at: string;
  straight: boolean;
  struck: boolean;
  pinned: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={styles.ruleSheet}
      initial={reduce ? false : { rotate: -5 }}
      animate={{ rotate: straight ? 0 : -5 }}
      transition={{ type: "spring", stiffness: 90, damping: 14 }}
    >
      {pinned ? <span className={styles.pin} aria-hidden="true" /> : null}
      <p className={`${styles.ruleWords} ${struck ? styles.struck : ""}`}>{quote}</p>
      <p className={styles.ruleSource}>
        {to ? `You, to ${to}` : "You"} · {sourceDate(at)}
      </p>
    </motion.div>
  );
}

// ------------------------------------------------------------------ Mara's map, with Orren's route on it

export function PlacesMap({
  title,
  pins,
  unpinned,
  clustered,
  route,
  highlight,
  showRoute,
  threadFrom,
  crossing = null,
}: {
  title: string | null;
  pins: PlacePin[];
  unpinned: string[];
  clustered: boolean;
  route: RouteStop[] | null;
  highlight: string | null;
  showRoute: boolean;
  /** Ilex: the pin a thread leaves from */
  threadFrom: string | null;
  /** the chapter's crossing: a paper bridge from the route to a pin, folded shut (with its sign) or open */
  crossing?: { pinId: string; open: boolean; sign: string | null } | null;
}) {
  const reduce = useReducedMotion();
  const width = 600;
  const height = 380;
  const stops = (route ?? []).filter((stop): stop is RouteStop & { lat: number; lng: number } => stop.lat !== null && stop.lng !== null);
  const all: Array<{ lat: number; lng: number }> = [...pins, ...(showRoute ? stops : [])];
  const project = all.length ? projector(all, width, height, 70) : null;
  const pinPoints = project ? pins.map(pin => ({ pin, ...project(pin) })) : [];
  const stopPoints = project && showRoute ? stops.map(stop => ({ stop, ...project(stop) })) : [];
  const slip = title ? titleSlip(title, { width, height }) : null;
  const note = unpinned.length ? unpinnedNote(unpinned.join(" · "), { width, height }) : null;
  const labels = placeMapLabels(
    { width, height },
    pinPoints.map(point => ({ x: point.x, y: point.y, name: point.pin.name, asked: askedLine(point.pin.asked) })),
    stopPoints.map(point => ({ x: point.x, y: point.y, label: point.stop.label })),
    [...(slip ? [slip.box] : []), ...(note ? [note.box] : [])]
  );
  const cluster = clustered && pinPoints.length >= 2
    ? (() => {
        const xs = pinPoints.map(point => point.x);
        const ys = pinPoints.map(point => point.y);
        return {
          cx: (Math.min(...xs) + Math.max(...xs)) / 2,
          cy: (Math.min(...ys) + Math.max(...ys)) / 2,
          rx: (Math.max(...xs) - Math.min(...xs)) / 2 + 70,
          ry: (Math.max(...ys) - Math.min(...ys)) / 2 + 46,
        };
      })()
    : null;
  return (
    <div className={styles.map} data-route={showRoute ? "drawn" : "none"}>
      <svg viewBox={`0 0 ${width} ${height}`} className={styles.mapSvg} role="img" aria-label={`Map: ${pins.map(pin => pin.name).join(", ")}`}>
        <g className={styles.mapStreets} aria-hidden="true">
          <path d="M20 300 C 140 250, 230 290, 330 220 S 520 120, 590 140" />
          <path d="M60 40 L 200 160 L 190 370" />
          <path d="M380 10 L 400 180 L 560 340" />
          <path d="M0 190 L 600 215" />
        </g>
        {cluster ? (
          <motion.ellipse
            className={styles.pencilRing}
            cx={cluster.cx}
            cy={cluster.cy}
            rx={cluster.rx}
            ry={cluster.ry}
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.4, delay: 0.6 }}
          />
        ) : null}
        {stopPoints.length >= 2 ? (
          <motion.polyline
            className={styles.routeLine}
            points={stopPoints.map(point => `${point.x},${point.y}`).join(" ")}
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 2, ease: "easeInOut" }}
          />
        ) : null}
        {stopPoints.map((point, index) => {
          const spot = labels.stops[index];
          const end = spot?.leader ? leaderEnd(spot) : null;
          return (
            <g key={`${point.stop.label}:${point.x}`} transform={`translate(${point.x} ${point.y})`} data-stop={point.stop.label}>
              {end ? <line x1={0} y1={0} x2={end.x} y2={end.y} className={styles.stopLeader} /> : null}
              <rect x={-5} y={-5} width={10} height={10} className={styles.stopMark} />
              {spot ? (
                <text x={spot.dx} y={spot.dy} className={styles.stopLabel} textAnchor={spot.anchor}>
                  {point.stop.label}
                </text>
              ) : (
                <title>{point.stop.label}</title>
              )}
            </g>
          );
        })}
        {pinPoints.map((point, index) => (
          <g key={point.pin.findingId} transform={`translate(${point.x} ${point.y})`} data-pin={point.pin.name}>
            {labels.pins[index].leader ? (
              <line
                x1={0}
                y1={0}
                x2={leaderEnd(labels.pins[index].name, 18).x}
                y2={leaderEnd(labels.pins[index].name, 18).y}
                className={styles.pinLeader}
              />
            ) : null}
            <motion.circle
              r={highlight === point.pin.findingId ? 11 : 8}
              className={highlight === point.pin.findingId ? styles.pinHot : styles.pinDot}
              initial={reduce ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.3 }}
            />
            {threadFrom === point.pin.findingId ? <circle r={4} className={styles.threadKnot} data-thread-anchor="pin" /> : null}
            <text x={labels.pins[index].name.dx} y={labels.pins[index].name.dy} className={styles.pinName} textAnchor={labels.pins[index].name.anchor}>
              {point.pin.name}
            </text>
            {askedLine(point.pin.asked) ? (
              <text x={labels.pins[index].asked.dx} y={labels.pins[index].asked.dy} className={styles.pinAsked} textAnchor={labels.pins[index].asked.anchor}>
                {askedLine(point.pin.asked)}
              </text>
            ) : null}
          </g>
        ))}
        {crossing ? <Crossing crossing={crossing} pins={pinPoints} stops={stopPoints} reduce={reduce} /> : null}
        {slip && title ? (
          <g className={styles.mapTitle}>
            <rect x={slip.x} y={slip.y} width={slip.width} height={slip.height} />
            <text x={width / 2} y={slip.baseline} textAnchor="middle">
              {title}
            </text>
          </g>
        ) : null}
        {note ? (
          <text x={note.x} y={note.baseline} className={styles.mapUnpinned}>
            {unpinned.join(" · ")}
          </text>
        ) : null}
      </svg>
    </div>
  );
}

/**
 * The crossing between the route and a place: a paper plank from the nearest stop (or from the road's edge, before
 * there was a route) to the pin. Folded shut it stands on end with its sign; open, it lies flat across.
 */
function Crossing({
  crossing,
  pins,
  stops,
  reduce,
}: {
  crossing: { pinId: string; open: boolean; sign: string | null };
  pins: Array<{ pin: PlacePin; x: number; y: number }>;
  stops: Array<{ x: number; y: number }>;
  reduce: boolean | null;
}) {
  const pin = pins.find(point => point.pin.findingId === crossing.pinId);
  if (!pin) return null;
  const nearest = [...stops].sort((a, b) => Math.hypot(a.x - pin.x, a.y - pin.y) - Math.hypot(b.x - pin.x, b.y - pin.y))[0];
  const from = nearest && Math.hypot(nearest.x - pin.x, nearest.y - pin.y) > 14 ? nearest : { x: pin.x - 48, y: pin.y + 14 };
  const length = Math.max(Math.hypot(pin.x - from.x, pin.y - from.y) - 10, 12);
  const angle = (Math.atan2(pin.y - from.y, pin.x - from.x) * 180) / Math.PI;
  return (
    <g data-crossing={crossing.open ? "open" : "closed"} data-testid="first-ten-crossing">
      <g transform={`translate(${from.x} ${from.y}) rotate(${angle})`}>
        <motion.rect
          className={styles.crossingPlank}
          y={-5}
          height={10}
          rx={2}
          initial={false}
          animate={{ width: crossing.open ? length : 9 }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 90, damping: 11 }}
        />
      </g>
      {!crossing.open && crossing.sign ? (
        <g transform={`translate(${from.x} ${from.y - 16})`} className={styles.crossingSign}>
          <path d="M0 0 L 0 16" />
          <rect x={-(crossing.sign.length * 3.4 + 10)} y={-22} width={crossing.sign.length * 6.8 + 20} height={20} rx={2} />
          <text y={-8} textAnchor="middle">
            {crossing.sign}
          </text>
        </g>
      ) : null}
    </g>
  );
}

/** Rook's: two endings cut from the person's own sent mail, the question marks ringed. */
export function HabitStrips({ examples }: { examples: string[] }) {
  return (
    <div className={styles.strips}>
      {examples.map((example, index) => (
        <p key={example} className={styles.strip} style={{ rotate: `${index ? 2.5 : -2}deg` }}>
          {example.replace(/\?$/, "")}
          <span className={styles.ringed}>?</span>
        </p>
      ))}
    </div>
  );
}

/** Bront's: two requests side by side, each labelled with what that kind of customer is buying, when he says it. */
export function ContrastCards({
  a,
  b,
  showA,
  showB,
}: {
  a: { line: string; quote: string; who: string | null };
  b: { line: string; quote: string; who: string | null };
  showA: boolean;
  showB: boolean;
}) {
  return (
    <div className={styles.cards}>
      {[
        { side: a, shown: showA, tilt: -2.5 },
        { side: b, shown: showB, tilt: 2 },
      ].map(({ side, shown, tilt }) => (
        <div key={side.quote} className={styles.card} style={{ rotate: `${tilt}deg` }}>
          <p className={styles.cardQuote}>“{side.quote}”</p>
          {side.who ? <p className={styles.cardWho}>{side.who}</p> : null}
          {shown ? (
            <motion.p className={styles.cardLabel} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
              {side.line}
            </motion.p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Luma's: the person's own photograph. */
export function Photograph({ src, caption }: { src: string | null; caption: string | null }) {
  return (
    <div className={styles.photo}>
      {src ? <img src={src} alt={caption ?? "Your photograph"} className={styles.photoImage} /> : <span className={styles.photoBlank} aria-hidden="true" />}
      {caption ? <span className={styles.photoCaption}>{caption}</span> : null}
    </div>
  );
}

/** Sable's notebook, open at the older conversation Ilex wants beside the map. */
export function NotebookPage({ who, at }: { who: string; at: string }) {
  return (
    <div className={styles.notebook}>
      <span className={styles.threadKnot} data-thread-anchor="notebook" aria-hidden="true" />
      <p className={styles.notebookLine}>
        {who} · {new Date(at).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}
      </p>
    </div>
  );
}

/**
 * Orren's week. The days the route runs carry it. A day the person closed turns its sign around: CLOSED on the back.
 * Nothing here explains itself.
 */
export function WeekStrip({ routeDay, closedDays }: { routeDay: number | null; closedDays: number[] }) {
  const reduce = useReducedMotion();
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className={styles.week} aria-label="The week" data-testid="first-ten-week">
      {order.map(day => {
        const closed = closedDays.includes(day);
        const name = WEEKDAY_NAMES[day].slice(0, 3);
        return (
          <motion.div
            key={day}
            className={styles.day}
            data-day={WEEKDAY_NAMES[day]}
            data-state={closed ? "closed" : routeDay === day ? "route" : "open"}
            animate={{ rotateY: closed ? 180 : 0 }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 60, damping: 11, delay: 0.25 }}
          >
            <span className={`${styles.dayFace} ${routeDay === day ? styles.routeDay : ""}`}>
              {name}
              {routeDay === day ? <i className={styles.dayRoute} aria-hidden="true" /> : null}
            </span>
            <span className={styles.dayBack} aria-hidden={!closed}>
              {name}
              <b>closed</b>
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}
