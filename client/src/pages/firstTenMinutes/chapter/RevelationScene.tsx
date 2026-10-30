import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChapterOpportunity } from "@shared/firstTenMinutesChapter";
import type { PlacePin } from "@shared/firstTenMinutesCrew";
import { CREW_ART } from "../crew";
import { PlacesMap } from "../crew/objects";
import { SourceNote, sourceDate } from "../SourceNote";
import styles from "./chapter.module.css";

/**
 * The revelation, played rather than announced. The calendar turns back to when they asked; the crossing is folded
 * shut, and Rook tries it. The person turns the calendar to today and brings the old invitation onto today's map;
 * the crossing unfolds. Nobody says what it means. For whoever wants it, the full explanation is one tap away.
 */
type Phase = "back" | "then" | "forward" | "now" | "brought";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = (date: Date) => date.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

function monthsBetween(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function CalendarPage({ month, circled, children }: { month: Date; circled: number | null; children?: React.ReactNode }) {
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const days = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  const cells = [...Array(first.getUTCDay()).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)];
  return (
    <div className={styles.calendarPage}>
      <p className={styles.calendarMonth}>
        {MONTH(month)} <span>{month.getUTCFullYear()}</span>
      </p>
      <div className={styles.calendarGrid} aria-hidden="true">
        {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
          <b key={`${day}${index}`}>{day}</b>
        ))}
        {cells.map((day, index) => (
          <span key={index} data-circled={day !== null && day === circled ? "yes" : undefined}>
            {day ?? ""}
          </span>
        ))}
      </div>
      {children}
    </div>
  );
}

export function RevelationScene({
  opportunity,
  businessName,
  now,
  onPickUp,
}: {
  opportunity: ChapterOpportunity;
  businessName: string | null;
  now: Date;
  onPickUp: () => void;
}) {
  const reduce = useReducedMotion();
  const asked = useMemo(() => new Date(opportunity.request.at), [opportunity.request.at]);
  const today = useMemo(() => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), [now]);
  const span = Math.max(0, monthsBetween(asked, today));
  const [phase, setPhase] = useState<Phase>("back");
  const [shown, setShown] = useState<Date>(today);
  const [why, setWhy] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);

  // the calendar turns, a page at a time, back to when they asked, or forward to today
  useEffect(() => {
    if (phase !== "back" && phase !== "forward") return;
    const target = phase === "back" ? addMonths(today, -span) : today;
    if (shown.getTime() === target.getTime()) {
      setPhase(phase === "back" ? "then" : "now");
      return;
    }
    const timer = window.setTimeout(
      () => setShown(current => addMonths(current, phase === "back" ? -1 : 1)),
      reduce ? 40 : phase === "back" && shown.getTime() === today.getTime() ? 900 : 260
    );
    return () => window.clearTimeout(timer);
  }, [phase, shown, today, span, reduce]);

  const weekday = opportunity.route ? WEEKDAYS[opportunity.route.weekday] : null;
  // the sign says what wasn't there then, and only when something wasn't
  const sign = opportunity.reply?.missing ? `${(weekday ?? opportunity.reply.missing).toUpperCase()} — UNAVAILABLE` : null;
  const pins: PlacePin[] =
    opportunity.place && opportunity.place.lat !== null && opportunity.place.lng !== null
      ? [{ findingId: opportunity.place.findingId, name: opportunity.place.name, lat: opportunity.place.lat, lng: opportunity.place.lng, asked: null }]
      : [];
  const route = (opportunity.route?.stops ?? []).map(stop => ({ label: stop.label, location: "", lat: stop.lat, lng: stop.lng }));
  const onMap = phase === "brought";
  const atToday = phase === "now" || phase === "brought";
  const rookLine = phase === "then" ? "Well, that's inconvenient." : phase === "brought" ? "Oh. Well, look at that." : null;
  const who = opportunity.person.name ?? opportunity.person.address;

  function bring() {
    if (phase !== "now") return;
    setPhase("brought");
  }

  const invitation = (
    <div className={styles.note} data-testid="first-ten-invitation">
      <p className={styles.noteWords}>“{opportunity.request.quote}”</p>
      <p className={styles.noteWho}>
        {who} · {sourceDate(opportunity.request.at)}
      </p>
    </div>
  );

  return (
    <section className={styles.revelation} data-testid="first-ten-revelation" data-phase={phase}>
      <div className={styles.revelationDesk}>
        <div className={styles.calendar} data-testid="first-ten-calendar" data-month={MONTH(shown)}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={shown.toISOString()}
              initial={reduce ? false : { rotateX: phase === "forward" ? -70 : 70, opacity: 0 }}
              animate={{ rotateX: 0, opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { rotateX: phase === "forward" ? 70 : -70, opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.22 }}
              className={styles.calendarSheet}
            >
              <CalendarPage
                month={shown}
                circled={
                  phase === "then" ? asked.getUTCDate() : atToday ? now.getUTCDate() : null
                }
              >
                {phase === "then" ? (
                  <div className={styles.pinned}>
                    {invitation}
                    {opportunity.reply ? (
                      <div className={styles.reply} data-testid="first-ten-old-reply">
                        <p className={styles.noteWords}>“{opportunity.reply.quote}”</p>
                        <p className={styles.noteWho}>You · {sourceDate(opportunity.reply.at)}</p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {atToday && opportunity.service ? (
                  <div className={styles.pinned}>
                    <div className={styles.serviceNote} data-testid="first-ten-service-now">
                      <p className={styles.noteWords}>“{opportunity.service.quote}”</p>
                      <p className={styles.noteWho}>You · {sourceDate(opportunity.service.at)}</p>
                    </div>
                  </div>
                ) : null}
              </CalendarPage>
            </motion.div>
          </AnimatePresence>
          {phase === "then" ? (
            <button type="button" className={styles.turn} onClick={() => setPhase("forward")} data-testid="first-ten-turn-to-today">
              {MONTH(today)} →
            </button>
          ) : null}
        </div>

        <div className={styles.mapHolder} ref={mapRef} data-testid="first-ten-today-map" onClick={phase === "now" ? bring : undefined}>
          {pins.length ? (
            <PlacesMap
              title={businessName}
              pins={pins}
              unpinned={[]}
              clustered={false}
              route={route}
              highlight={opportunity.place?.findingId ?? null}
              showRoute={atToday}
              threadFrom={null}
              crossing={opportunity.place ? { pinId: opportunity.place.findingId, open: onMap, sign: phase === "then" || phase === "back" ? sign : null } : null}
            />
          ) : (
            <div className={styles.mapBlank}>{businessName ?? "Today"}</div>
          )}
          <AnimatePresence>
            {onMap ? (
              <motion.div
                className={styles.landed}
                initial={reduce ? false : { scale: 1.4, opacity: 0, y: -30 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 200, damping: 16 }}
              >
                {invitation}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {phase === "now" ? (
        <motion.div
          className={styles.inHand}
          drag={!reduce}
          dragSnapToOrigin
          whileDrag={{ scale: 1.04, rotate: -2 }}
          onDragEnd={(_, info) => {
            const box = mapRef.current?.getBoundingClientRect();
            if (box && info.point.x >= box.left && info.point.x <= box.right && info.point.y - window.scrollY >= box.top && info.point.y - window.scrollY <= box.bottom) bring();
          }}
          onClick={bring}
          role="button"
          tabIndex={0}
          aria-label={`Bring ${who}'s request onto today's map`}
          onKeyDown={event => {
            if (event.key === "Enter" || event.key === " ") bring();
          }}
          initial={reduce ? false : { y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
        >
          {invitation}
        </motion.div>
      ) : null}

      <div className={styles.revelationEdge}>
        <div className={styles.rook} data-crew="rook">
          <AnimatePresence mode="wait">
            {rookLine ? (
              <motion.p
                key={rookLine}
                className={styles.say}
                data-testid="first-ten-chapter-line"
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ delay: reduce ? 0 : phase === "then" ? 0.9 : 0.6 }}
              >
                <span className={styles.sayName}>Rook</span>
                {rookLine}
              </motion.p>
            ) : null}
          </AnimatePresence>
          {CREW_ART.rook ? <img src={CREW_ART.rook.src} alt={CREW_ART.rook.alt} className={styles.rookArt} draggable={false} /> : null}
        </div>
        {phase === "brought" ? (
          <motion.button
            type="button"
            className={styles.pickUp}
            onClick={onPickUp}
            data-testid="first-ten-pick-up"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduce ? 0 : 1.6 }}
          >
            Pick up the story
          </motion.button>
        ) : null}
        <button type="button" className={styles.why} onClick={() => setWhy(true)} data-testid="first-ten-why">
          Why?
        </button>
      </div>

      {why ? <WhySheet opportunity={opportunity} onClose={() => setWhy(false)} /> : null}
    </section>
  );
}

/** The full explanation, for whoever wants it, with every part's source. */
function WhySheet({ opportunity, onClose }: { opportunity: ChapterOpportunity; onClose: () => void }) {
  const first = opportunity.firstName ?? "They";
  const missing = opportunity.reply?.missing ?? opportunity.service?.name ?? null;
  const passes = opportunity.route && opportunity.place && opportunity.along ? `, and your route passes the ${opportunity.place.category ?? "place"}` : "";
  return (
    <div className={styles.whyScrim} role="dialog" aria-modal="true" aria-label="Why" onClick={onClose}>
      <article className={styles.whySheet} onClick={event => event.stopPropagation()} data-testid="first-ten-why-sheet">
        {opportunity.type === "became_possible" && missing ? (
          <>
            <h2>Someone already asked for what you now offer.</h2>
            <p>
              {first} asked before {missing} existed. It exists now{passes}.
            </p>
            <p>This may be a conversation worth reopening.</p>
          </>
        ) : (
          <h2>There's a conversation worth reopening.</h2>
        )}
        <SourceNote sources={[...opportunity.request.sources, ...(opportunity.reply?.sources ?? []), ...(opportunity.service?.sources ?? [])].slice(0, 4)} />
        <button type="button" className={styles.whyClose} onClick={onClose}>
          Close
        </button>
      </article>
    </div>
  );
}
