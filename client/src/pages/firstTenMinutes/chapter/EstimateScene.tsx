import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { DRAFT_APPROACH_NAMES, firstAreas, openDetail, openLines, type ChapterOpportunity, type EstimateTrays } from "@shared/firstTenMinutesChapter";
import { CREW_ART } from "../crew";
import { SourceNote, sourceDate } from "../SourceNote";
import styles from "./estimate.module.css";

/**
 * "The Estimate That Wouldn't Fit" (Astra, Part 3), in the Silver Lake courtyard. Bront's cart carries the estimate
 * folded into a paper house, one room for each area it quotes; it won't pass the arch. The person picks the rooms up
 * (each unfolds to its own lines and source), Sable brings what the client said later, and the rooms go onto two trays.
 * Every room must go on one; nothing is taken out to make it smaller. An unresolved line stays visibly unresolved.
 */
type Who = "hazel" | "sable" | "bront" | "narrator";
type Line = { who: Who; text: string };
type Phase = "arriving" | "hazel" | "explore" | "packing" | "through";
type Tray = "thisJob" | "later";

const NAMES: Record<Exclude<Who, "narrator">, string> = { hazel: "Hazel", sable: "Sable", bront: "Bront" };
const HAZEL_OPENING: Line[] = [
  { who: "hazel", text: "You may bring a letter through." },
  { who: "narrator", text: "She looks up." },
  { who: "hazel", text: "This appears to be a residence." },
];
const BRONT_TRAYS = "We've put tomorrow's dinner on today's plate.";
const BRONT_PRICE_TAG = "That's a question wearing a price tag.";
const HAZEL_THROUGH = "Acceptable. Barely.";

export function EstimateScene({
  opportunity,
  title,
  revealed,
  trays: saved,
  onRevealed,
  onArrange,
  onReady,
}: {
  opportunity: ChapterOpportunity;
  title: string;
  revealed: boolean;
  trays: EstimateTrays | null;
  onRevealed: () => Promise<void>;
  onArrange: (trays: EstimateTrays) => Promise<void>;
  onReady: (approach: "focused" | "question") => void;
}) {
  // reduced motion shortens what moves, never the time to read a line
  const reduce = useReducedMotion();
  const estimate = opportunity.estimate!;
  const scope = opportunity.scope!;
  const rooms = estimate.areas.map(area => area.name);
  const [phase, setPhase] = useState<Phase>(saved ? "through" : revealed ? "explore" : "arriving");
  const [line, setLine] = useState<Line | null>(null);
  const [beat, setBeat] = useState(0);
  const [sableIn, setSableIn] = useState(Boolean(saved || revealed));
  const [traysOut, setTraysOut] = useState(Boolean(saved || revealed));
  const [placed, setPlaced] = useState<Record<string, Tray>>(() =>
    saved ? Object.fromEntries([...saved.thisJob.map(name => [name, "thisJob" as const]), ...saved.later.map(name => [name, "later" as const])]) : {}
  );
  const [holding, setHolding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saidPriceTag = useRef(false);
  // where the arch's opening is: the cart, much smaller now, goes through it
  const [narrow] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.("(max-width: 720px)").matches));
  const through = narrow ? { x: "34cqw", scale: 0.5 } : { x: "57.5cqw", scale: 0.28 };
  const who = opportunity.firstName ?? opportunity.person.name ?? "the client";

  const thisJob = rooms.filter(name => placed[name] === "thisJob");
  const later = rooms.filter(name => placed[name] === "later");
  const unsorted = rooms.filter(name => !placed[name]);
  const openInJob = openLines(opportunity, thisJob)[0] ?? null;
  const firstWords = firstAreas(opportunity).length && firstAreas(opportunity).every(name => thisJob.includes(name)) && thisJob.length === firstAreas(opportunity).length
    ? scope.first.replace(/^(the|a|an)\s+/i, "")
    : thisJob.map(name => name.toLowerCase()).join(" and ");

  // Bront's cart rolls in and stops at the arch; Hazel examines it, a line at a time
  useEffect(() => {
    if (phase === "arriving") {
      const timer = window.setTimeout(() => setPhase("hazel"), reduce ? 300 : 1900);
      return () => window.clearTimeout(timer);
    }
    if (phase !== "hazel") return;
    setLine(HAZEL_OPENING[beat]);
    const timer = window.setTimeout(
      () => {
        if (beat + 1 < HAZEL_OPENING.length) return setBeat(beat + 1);
        setPhase("explore");
        void onRevealed();
      },
      reduce ? 1600 : beat === 1 ? 1300 : 2300
    );
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, beat, reduce]);

  // Sable brings the later message; then Bront puts out the two trays
  useEffect(() => {
    if (phase !== "explore" || sableIn) return;
    const timer = window.setTimeout(() => {
      setSableIn(true);
      setLine({ who: "sable", text: `“${scope.quote}” That came after the original request.` });
    }, reduce ? 1600 : 2600);
    return () => window.clearTimeout(timer);
  }, [phase, sableIn, scope.quote, reduce]);
  useEffect(() => {
    if (phase !== "explore" || !sableIn || traysOut) return;
    const timer = window.setTimeout(() => {
      setTraysOut(true);
      setLine({ who: "bront", text: BRONT_TRAYS });
    }, reduce ? 2600 : 4200);
    return () => window.clearTimeout(timer);
  }, [phase, sableIn, traysOut, reduce]);

  async function place(tray: Tray) {
    if (!holding || phase !== "explore") return;
    const next = { ...placed, [holding]: tray };
    setPlaced(next);
    setHolding(null);
    const area = estimate.areas.find(candidate => candidate.name === holding);
    if (tray === "thisJob" && area?.lines.some(entry => entry.open) && !saidPriceTag.current) {
      saidPriceTag.current = true;
      setLine({ who: "bront", text: BRONT_PRICE_TAG });
    }
    const nowJob = rooms.filter(name => next[name] === "thisJob");
    const nowLater = rooms.filter(name => next[name] === "later");
    if (nowJob.length + nowLater.length < rooms.length) return;
    if (!nowJob.length || !nowLater.length) {
      setLine(HAZEL_OPENING[2]);
      return;
    }
    setBusy(true);
    try {
      await onArrange({ thisJob: nowJob, later: nowLater });
      setPhase("packing");
      window.setTimeout(
        () => {
          setPhase("through");
          setLine({ who: "hazel", text: HAZEL_THROUGH });
        },
        reduce ? 400 : 2200
      );
    } finally {
      setBusy(false);
    }
  }

  const held = holding ? estimate.areas.find(area => area.name === holding) : null;
  const packed = phase === "packing" || phase === "through";
  const card = useMemo(
    () => (
      <div className={styles.laterNote} data-testid="first-ten-scope-note">
        <p className={styles.noteWords}>“{scope.quote}”</p>
        <p className={styles.noteWho}>
          {opportunity.person.name ?? opportunity.person.address} · {sourceDate(scope.at)}
        </p>
      </div>
    ),
    [scope.quote, scope.at, opportunity.person]
  );

  const room = (name: string) => (
    <Room
      key={name}
      name={name}
      open={estimate.areas.find(area => area.name === name)!.lines.some(entry => entry.open)}
      tray={placed[name] ?? null}
      held={holding === name}
      disabled={phase !== "explore" || busy}
      onToggle={() => setHolding(holding === name ? null : name)}
    />
  );

  return (
    <section className={styles.scene} data-testid="first-ten-estimate" data-phase={phase}>
      <img src="/assets/first-ten/courtyard/courtyard.webp" alt="" className={styles.back} draggable={false} />
      <div className={styles.shade} aria-hidden="true" />
      <p className={styles.title} data-testid="first-ten-chapter-title">
        {title}
      </p>

      <svg className={styles.arch} viewBox="0 0 120 200" aria-hidden="true">
        <path d="M0 200 V70 A60 60 0 0 1 120 70 V200 H96 V78 A36 36 0 0 0 24 78 V200 Z" fill="#b9a68a" stroke="#6f5d47" strokeWidth="3" />
        {[30, 55, 80].map(y => (
          <line key={y} x1="0" x2="24" y1={y + 40} y2={y + 40} stroke="#8a7659" strokeWidth="2" />
        ))}
      </svg>
      <img src="/assets/first-ten/courtyard/hazel.webp" alt="Hazel" className={styles.hazel} draggable={false} />

      <motion.div
        className={styles.cart}
        data-testid="first-ten-cart"
        initial={reduce ? false : { x: "-60cqw" }}
        animate={phase === "through" ? through : { x: "0cqw", scale: packed ? 0.9 : 1 }}
        transition={{ type: "spring", stiffness: phase === "through" ? 40 : 60, damping: 14, delay: phase === "through" ? 0.2 : 0 }}
      >
        <div className={styles.load}>
          {packed ? (
            <>
              <div className={styles.package} data-testid="first-ten-package">
                <span>{thisJob.join(" · ")}</span>
              </div>
              <div className={styles.envelope} data-testid="first-ten-envelope">
                <span>{later.join(" · ")}</span>
              </div>
            </>
          ) : (
            <>
              <div className={styles.house} data-testid="first-ten-paper-house">
                {unsorted.map(room)}
              </div>
              {traysOut ? (
                <div className={styles.trays}>
                  {(["thisJob", "later"] as const).map(tray => (
                    <div
                      key={tray}
                      className={`${styles.tray} ${holding ? styles.trayReady : ""}`}
                      data-testid={`first-ten-tray-${tray}`}
                      onClick={() => void place(tray)}
                    >
                      <button
                        type="button"
                        className={styles.trayLabel}
                        disabled={!holding || busy}
                        onClick={event => {
                          event.stopPropagation();
                          void place(tray);
                        }}
                      >
                        {tray === "thisJob" ? "This job" : "Possible later work"}
                      </button>
                      <span className={styles.trayRooms}>{rooms.filter(name => placed[name] === tray).map(room)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
        <svg className={styles.wagon} viewBox="0 0 200 50" aria-hidden="true">
          <rect x="6" y="4" width="188" height="20" rx="3" fill="#8a5a33" stroke="#5c3a1f" strokeWidth="2" />
          <circle cx="40" cy="36" r="12" fill="#4a3424" stroke="#2d1f14" strokeWidth="3" />
          <circle cx="160" cy="36" r="12" fill="#4a3424" stroke="#2d1f14" strokeWidth="3" />
        </svg>
      </motion.div>

      <AnimatePresence>
        {held && phase === "explore" ? (
          <motion.div
            className={styles.unfolded}
            data-testid="first-ten-room-open"
            initial={reduce ? false : { opacity: 0, scaleY: 0.4 }}
            animate={{ opacity: 1, scaleY: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <p className={styles.unfoldedName}>{held.name}</p>
            <ul className={styles.lines}>
              {held.lines.map(entry => (
                <li key={entry.text} data-open={entry.open ? "yes" : undefined}>
                  <span>{entry.text}</span>
                  <b>{entry.amount ?? (entry.open ? "?" : "")}</b>
                </li>
              ))}
            </ul>
            <SourceNote sources={estimate.sources.slice(0, 1)} />
            {traysOut ? <p className={styles.hint}>This job, or later?</p> : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {sableIn ? (
        <motion.div className={styles.sable} initial={reduce ? false : { x: 80, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
          {card}
          {CREW_ART.sable ? <img src={CREW_ART.sable.src} alt={CREW_ART.sable.alt} className={styles.edgeArt} draggable={false} /> : null}
        </motion.div>
      ) : null}
      <div className={styles.rook} data-holding={holding ? "yes" : "no"}>
        {CREW_ART.rook ? <img src={CREW_ART.rook.src} alt={CREW_ART.rook.alt} className={styles.edgeArt} draggable={false} /> : null}
      </div>

      <AnimatePresence mode="wait">
        {line ? (
          <motion.p
            key={`${line.who}:${line.text}`}
            className={line.who === "narrator" ? styles.narration : `${styles.say} ${styles[`say_${line.who}`]}`}
            data-testid="first-ten-estimate-line"
            data-who={line.who}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {line.who !== "narrator" ? <span className={styles.sayName}>{NAMES[line.who]}</span> : null}
            {line.text}
          </motion.p>
        ) : null}
      </AnimatePresence>

      {phase === "through" ? (
        <motion.div
          className={styles.next}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduce ? 0 : 1.4 }}
          data-testid="first-ten-estimate-next"
        >
          <button type="button" className={styles.nextMain} onClick={() => onReady("focused")}>
            Prepare the {firstWords} estimate
          </button>
          {openInJob ? (
            <button type="button" onClick={() => onReady("question")} title={DRAFT_APPROACH_NAMES.question}>
              Ask {who} about the {openDetail(openInJob.text)} first
            </button>
          ) : null}
        </motion.div>
      ) : null}
    </section>
  );
}

/** One room of the paper house: an area of the estimate. Picked up, it unfolds to its lines; it goes on one tray. */
function Room({
  name,
  open,
  tray,
  held,
  disabled,
  onToggle,
}: {
  name: string;
  open: boolean;
  tray: Tray | null;
  held: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.span
      layoutId={`room-${name}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-pressed={held}
      className={`${styles.room} ${held ? styles.roomHeld : ""}`}
      data-room={name}
      data-tray={tray ?? "none"}
      onClick={event => {
        event.stopPropagation();
        if (!disabled) onToggle();
      }}
      onKeyDown={event => {
        if (!disabled && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }
      }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
    >
      <span className={styles.roof} aria-hidden="true" />
      <span className={styles.roomName}>{name}</span>
      {open && tray === "thisJob" ? (
        <span className={styles.question} title="Unresolved in the estimate" aria-label="unresolved">
          ?
        </span>
      ) : null}
    </motion.span>
  );
}
