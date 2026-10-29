import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { CompanionId } from "@shared/firstTenMinutesFindings";
import { CREW_ART } from "../crew";
import styles from "./crew.module.css";

const NAMES: Record<CompanionId, string> = {
  sable: "Sable",
  mara: "Mara",
  rook: "Rook",
  bront: "Bront",
  luma: "Luma",
  orren: "Orren",
  ilex: "Ilex",
};

/** Bront, Orren and Ilex have no art yet: a small hand-drawn token for what each carries, until they do. */
function Token({ who }: { who: CompanionId }) {
  return (
    <svg viewBox="0 0 64 64" className={styles.token} role="img" aria-label={NAMES[who]}>
      <circle cx="32" cy="32" r="29" className={styles.tokenDisc} />
      {who === "bront" ? (
        // a tureen: exchange through food
        <g className={styles.tokenInk}>
          <path d="M14 34 h36 c0 9 -8 15 -18 15 s-18 -6 -18 -15 z" />
          <path d="M22 34 c0 -6 4 -9 10 -9 s10 3 10 9" />
          <path d="M30 22 h4" />
        </g>
      ) : who === "orren" ? (
        // a compass rose: changing reality, not static maps
        <g className={styles.tokenInk}>
          <circle cx="32" cy="32" r="14" />
          <path d="M32 14 L36 32 L32 50 L28 32 Z" />
          <path d="M14 32 L32 29 L50 32 L32 35 Z" />
        </g>
      ) : (
        // a spool of red thread: patterns other people miss
        <g className={styles.tokenInk}>
          <path d="M22 18 h20 M22 46 h20" />
          <path d="M25 18 v28 M39 18 v28" />
          <path d="M25 24 L39 28 M25 30 L39 34 M25 36 L39 40" className={styles.tokenThread} />
          <path d="M39 40 C 48 42, 50 50, 56 52" className={styles.tokenThread} />
        </g>
      )}
    </svg>
  );
}

/**
 * A line said from the edge. It sits over whoever says it, slid sideways when that would take it off the screen,
 * with its tail still pointing at the speaker.
 */
function Say({ children, reduce }: { children: ReactNode; reduce: boolean | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const fit = () => {
      const element = ref.current;
      if (!element) return;
      const parent = element.parentElement?.getBoundingClientRect();
      if (!parent) return;
      const width = element.offsetWidth;
      const centre = parent.left + parent.width / 2;
      const margin = 12;
      const left = centre - width / 2;
      const right = centre + width / 2;
      const room = document.documentElement.clientWidth;
      const wanted = right > room - margin ? room - margin - right : left < margin ? margin - left : 0;
      // the tail stays under the bubble, however far it slides
      const most = Math.max(0, width / 2 - 18);
      setShift(Math.max(-most, Math.min(most, wanted)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [children]);
  return (
    <motion.p
      ref={ref}
      className={styles.say}
      style={{ ["--shift" as string]: `${Math.round(shift)}px` }}
      data-testid="first-ten-crew-line"
      initial={reduce ? false : { opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.28 }}
    >
      {children}
    </motion.p>
  );
}

export function CrewEdge({
  present,
  speaker,
  line,
}: {
  /** who has stepped in so far, in the order they did */
  present: CompanionId[];
  speaker: CompanionId | null;
  line: string | null;
}) {
  const reduce = useReducedMotion();
  return (
    <div className={styles.edge} data-testid="first-ten-crew">
      {present.map(who => {
        const art = CREW_ART[who];
        const speaking = speaker === who;
        return (
          <motion.div
            key={who}
            className={styles.member}
            data-crew={who}
            data-speaking={speaking ? "yes" : "no"}
            initial={reduce ? false : { opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: speaking ? -6 : 0, scale: speaking ? 1.06 : 1 }}
            transition={{ type: "spring", stiffness: 160, damping: 16 }}
          >
            <AnimatePresence mode="wait">
              {speaking && line ? (
                <Say key={line} reduce={reduce}>
                  <span className={styles.sayName}>{NAMES[who]}</span>
                  {line}
                </Say>
              ) : null}
            </AnimatePresence>
            {art ? <img src={art.src} alt={art.alt} className={styles.memberArt} draggable={false} /> : <Token who={who} />}
          </motion.div>
        );
      })}
    </div>
  );
}
