import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { TeaCosy } from "./props";
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

export function ClosingBeat({ outcome }: { outcome: ClosingOutcome }) {
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
