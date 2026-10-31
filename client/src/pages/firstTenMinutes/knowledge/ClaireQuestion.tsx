import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import type { KnowledgeQuestionView } from "@shared/businessKnowledge";
import styles from "./claireQuestion.module.css";

/**
 * Before Claire writes the page, she asks what the reading couldn't settle: one question, in her voice, answered in
 * the person's own words. "Not now" leaves it; nothing about the game changes. When an answer settles something,
 * she says back what she understood, briefly, and the next question (if any) follows.
 */
export function ClaireQuestion({
  question,
  understood,
  onAnswer,
}: {
  question: KnowledgeQuestionView;
  /** what Claire understood from the last answer */
  understood: string | null;
  onAnswer: (answer: string | null) => Promise<void>;
}) {
  const reduce = useReducedMotion();
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  const asking = question.followUp ?? question.question;
  useEffect(() => setWords(""), [asking]);

  async function send(answer: string | null) {
    setBusy(true);
    try {
      await onAnswer(answer);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card} data-testid="first-ten-claire-question" aria-live="polite">
      <AnimatePresence mode="wait">
        <motion.div
          key={asking}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -6 }}
          transition={{ duration: 0.35 }}
          className={styles.inner}
        >
          {understood ? (
            <p className={styles.understood} data-testid="first-ten-claire-understood">
              {understood}
            </p>
          ) : null}
          {question.followUp && question.answer ? (
            <p className={styles.theirs} data-testid="first-ten-claire-their-answer">
              {question.answer}
            </p>
          ) : null}
          <p className={styles.question} data-testid="first-ten-claire-question-text">
            <span className={styles.name}>Claire</span>
            {asking}
          </p>
          <form
            className={styles.form}
            onSubmit={event => {
              event.preventDefault();
              if (words.trim()) void send(words.trim());
            }}
          >
            <textarea
              className={styles.answer}
              value={words}
              onChange={event => setWords(event.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="In your own words"
              aria-label="Your answer"
              data-testid="first-ten-claire-answer"
            />
            <div className={styles.actions}>
              <button type="button" className={styles.later} disabled={busy} onClick={() => void send(null)} data-testid="first-ten-claire-not-now">
                Not now
              </button>
              <button type="submit" className={styles.reply} disabled={busy || !words.trim()} data-testid="first-ten-claire-reply">
                Reply
              </button>
            </div>
          </form>
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
