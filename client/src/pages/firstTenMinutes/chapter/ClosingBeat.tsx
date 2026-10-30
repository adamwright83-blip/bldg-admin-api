import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import type { ChapterKind, ChapterOpportunity, EstimateTrays } from "@shared/firstTenMinutesChapter";
import { TeaCosy } from "./props";
import { TodayMap, Workbench } from "./TodayMap";
import styles from "./send.module.css";

/**
 * The game's closing beat, answering what actually happened: a small remembered scene, tied to the first real
 * decision the person made here. Sent (in their words or in their Sent folder): Hazel notices the ink. Not yet, or
 * not now: the letter keeps. Either way, Pip retrieves the tea cosy and settles underneath it.
 */
export type ClosingOutcome = "sent" | "not_yet" | "not_now";

const LINES: Record<ClosingOutcome, Array<{ who: "hazel" | "narrator"; text: string }>> = {
  sent: [
    { who: "narrator", text: "Hazel notices the ink on your hand." },
    { who: "hazel", text: "You'll get used to that." },
    { who: "narrator", text: "Pip retrieves the tea cosy and settles underneath it." },
  ],
  not_yet: [
    { who: "narrator", text: "The letter waits on the table, folded." },
    { who: "hazel", text: "It'll keep. Ink does." },
    { who: "narrator", text: "Pip retrieves the tea cosy and settles underneath it." },
  ],
  not_now: [
    { who: "narrator", text: "Hazel tucks the card into the drawer of the writing table." },
    { who: "hazel", text: "Some letters are better kept." },
    { who: "narrator", text: "Pip retrieves the tea cosy and settles underneath it." },
  ],
};

/**
 * Part 3's chapters close on what the person's action left in the world (Astra): "A newly opened route remains on the
 * map. The original message stays pinned beside it." / "Dev's workbench keeps the two-tray arrangement he chose."
 */
function chapterLines(kind: "time" | "scope", outcome: ClosingOutcome): string[] {
  if (kind === "scope") return ["The workbench keeps the two-tray arrangement you chose."];
  return outcome === "not_now"
    ? ["A newly opened route remains on the map."]
    : ["A newly opened route remains on the map.", "The original message stays pinned beside it."];
}

export function ClosingBeat({
  outcome,
  kind = "letter",
  opportunity = null,
  businessName = null,
  closedDays = [],
  trays = null,
}: {
  outcome: ClosingOutcome;
  kind?: ChapterKind;
  opportunity?: ChapterOpportunity | null;
  businessName?: string | null;
  closedDays?: number[];
  trays?: EstimateTrays | null;
}) {
  if ((kind === "time" && opportunity) || (kind === "scope" && trays)) {
    return (
      <ChapterClosing outcome={outcome} lines={chapterLines(kind, outcome)}>
        {kind === "time" ? <TodayMap opportunity={opportunity!} businessName={businessName} closedDays={closedDays} /> : <Workbench trays={trays!} />}
      </ChapterClosing>
    );
  }
  return <CourtyardClosing outcome={outcome} />;
}

function ChapterClosing({ outcome, lines, children }: { outcome: ClosingOutcome; lines: string[]; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <section className={styles.closingPaper} data-testid="first-ten-closing" data-outcome={outcome}>
      {children}
      <div className={styles.closingPaperLines}>
        {lines.map((line, index) => (
          <motion.p
            key={line}
            className={styles.closingNarration}
            data-testid="first-ten-closing-line"
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduce ? 0 : 0.6 + index * 1.4 }}
          >
            {line}
          </motion.p>
        ))}
      </div>
    </section>
  );
}

function CourtyardClosing({ outcome }: { outcome: ClosingOutcome }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(1);
  const lines = LINES[outcome];
  useEffect(() => {
    if (shown >= lines.length) return;
    const timer = window.setTimeout(() => setShown(count => count + 1), reduce ? 1400 : 2200);
    return () => window.clearTimeout(timer);
  }, [shown, lines.length, reduce]);
  const settled = shown >= lines.length;
  return (
    <section className={styles.closing} data-testid="first-ten-closing" data-outcome={outcome}>
      <img src="/assets/first-ten/courtyard/courtyard.webp" alt="" className={styles.closingBack} draggable={false} />
      <img src="/assets/first-ten/courtyard/hazel.webp" alt="Hazel" className={styles.closingHazel} draggable={false} />
      <div className={styles.closingPip}>
        <img src="/assets/first-ten/courtyard/pip.webp" alt="Pip" draggable={false} />
        <AnimatePresence>
          {settled ? (
            <motion.span
              className={styles.closingCosy}
              initial={reduce ? false : { y: -60, opacity: 0, rotate: -20 }}
              animate={{ y: 0, opacity: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 160, damping: 14 }}
            >
              <TeaCosy />
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
      <div className={styles.closingLines}>
        {lines.slice(0, shown).map(line => (
          <motion.p
            key={line.text}
            className={line.who === "narrator" ? styles.closingNarration : styles.closingSay}
            data-testid="first-ten-closing-line"
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {line.who === "hazel" ? <span className={styles.sayName}>Hazel</span> : null}
            {line.text}
          </motion.p>
        ))}
      </div>
    </section>
  );
}
