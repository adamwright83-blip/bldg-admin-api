import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { FIRST_CHAPTER_TITLE, TOMORROW, type FirstChapterView } from "@shared/firstTenMinutesFirstChapter";
import styles from "../portrait/portrait.module.css";

/** The new entry on the person's portrait: what they did, and where the message actually stands. */
export function FirstChapterEntry({ entry, status }: { entry: string; status: string | null }) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      className={styles.entry}
      data-testid="first-ten-first-chapter"
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 80, damping: 16, delay: reduce ? 0 : 0.5 }}
    >
      <h2 className={styles.entryTitle}>{FIRST_CHAPTER_TITLE}</h2>
      <p className={styles.entryText} data-testid="first-ten-first-chapter-entry">
        {entry}
      </p>
      {status ? (
        <p className={styles.entryStatus} data-testid="first-ten-first-chapter-status">
          {status}
        </p>
      ) : null}
    </motion.section>
  );
}

/**
 * Claire, with a suggested question. Her answer is exact and kept. Then a small invitation, and the courtyard if they
 * want it. No chore list.
 */
export function AskClaire({ view, onAsk, onCourtyard }: { view: FirstChapterView; onAsk: () => Promise<void>; onCourtyard: () => void }) {
  const reduce = useReducedMotion();
  const [asking, setAsking] = useState(false);
  const [trouble, setTrouble] = useState(false);

  async function ask() {
    setAsking(true);
    setTrouble(false);
    try {
      await onAsk();
    } catch {
      setTrouble(true);
    } finally {
      setAsking(false);
    }
  }

  return (
    <section className={styles.claire} data-testid="first-ten-claire">
      {view.answer ? (
        <>
          <p className={styles.asked} data-testid="first-ten-claire-question">
            “{view.question}”
          </p>
          <motion.div
            key={view.answer.at}
            className={styles.claireAnswer}
            data-testid="first-ten-claire-answer"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 90, damping: 16 }}
          >
            <span className={styles.claireName}>Claire</span>
            <p>{view.answer.text}</p>
          </motion.div>
          <motion.p
            className={styles.tomorrow}
            data-testid="first-ten-tomorrow"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: reduce ? 0 : 1.2, duration: 0.8 }}
          >
            {TOMORROW}
          </motion.p>
        </>
      ) : (
        <div className={styles.suggested}>
          <span className={styles.suggestedLabel}>Ask Claire</span>
          <button type="button" className={styles.claireAsk} disabled={asking} onClick={() => void ask()} data-testid="first-ten-ask-claire">
            “{view.question}”
          </button>
        </div>
      )}
      {trouble ? <p className={styles.quietNote}>Claire couldn't look just now. Try again in a moment.</p> : null}
      <div className={styles.claireLinks}>
        {view.answer ? (
          <button type="button" disabled={asking} onClick={() => void ask()} data-testid="first-ten-ask-again">
            Ask again
          </button>
        ) : null}
        <button type="button" onClick={onCourtyard} data-testid="first-ten-courtyard-link">
          The courtyard
        </button>
      </div>
    </section>
  );
}
