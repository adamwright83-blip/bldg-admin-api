import { motion } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { FACT, INVITATION, NOW_PAPER, PLACE_NAMES, PROMISE, SAMPLE_DRAFT, THEN_PAPER } from "./sample";
import styles from "./desk.module.css";

/**
 * The writing desk, after the courier is home (or straight from the start): the studio's three dated records, laid
 * down in order. Nobody explains them. April's promise and September's fact are underlined in red ink and a thread
 * runs from one to the other; then the choice. These are the studio's own papers, not the envelope the courier left
 * at the hotel. Nothing here can send anything: "Prepare a reply" writes out a labelled sample, and that is all.
 */
export type Choice = "reply" | "later" | "not_for_me";

/** 0 the papers land, 1 April's promise is underlined, 2 September's fact, 3 the thread, 4 the choice */
type Stage = 0 | 1 | 2 | 3 | 4;
const HOLDS: readonly number[] = [1050, 650, 550, 750];

const [request, reply] = THEN_PAPER.items;
const [offer] = NOW_PAPER.items;

/** A paper's words split around the phrase the desk underlines, which is quoted from it. */
function around(words: string, phrase: string): [string, string, string] {
  const at = words.indexOf(phrase);
  return at < 0 ? [words, "", ""] : [words.slice(0, at), phrase, words.slice(at + phrase.length)];
}

export function Desk({
  choice,
  onChoose,
  fresh,
  reduce,
  solved,
  onPlayAgain,
  onBack,
  onWithoutLetters,
}: {
  choice: Choice | null;
  onChoose: (choice: Choice) => void;
  /** played now, rather than reopened after a reload */
  fresh: boolean;
  reduce: boolean;
  /** the courier is home: offer to play again */
  solved: boolean;
  onPlayAgain: () => void;
  onBack: () => void;
  onWithoutLetters?: () => void;
}) {
  const [stage, setStage] = useState<Stage>(fresh && !reduce ? 0 : 4);
  const [chosenHere, setChosenHere] = useState(false);
  const papers = useRef<HTMLDivElement>(null);
  const promise = useRef<HTMLSpanElement>(null);
  const fact = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (stage >= 4) return;
    const timer = window.setTimeout(() => setStage(current => Math.min(current + 1, 4) as Stage), HOLDS[stage]);
    return () => window.clearTimeout(timer);
  }, [stage]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const instant = !fresh || reduce;
  const [beforePromise, promised, afterPromise] = around(reply.words, PROMISE);
  const [beforeFact, offered, afterFact] = around(offer.words, FACT);

  return (
    <div
      className={styles.desk}
      role="dialog"
      aria-modal="true"
      aria-label="The studio's correspondence"
      data-testid="desk"
      data-stage={stage}
      // a tap anywhere settles the reveal at once
      onClick={() => stage < 4 && setStage(4)}
    >
      <div className={styles.inner}>
        <div className={styles.papers} ref={papers}>
          <DeskPaper index={0} instant={instant} when={request.when} who={request.who} testId="desk-paper-request">
            {request.words}
          </DeskPaper>
          <DeskPaper index={1} instant={instant} when={reply.when} who={reply.who} testId="desk-paper-promise">
            {beforePromise}
            <Inked inkRef={promise} drawn={stage >= 1} instant={instant} testId="ink-promise">
              {promised}
            </Inked>
            {afterPromise}
          </DeskPaper>
          <DeskPaper index={2} instant={instant} when={offer.when} who={offer.who} testId="desk-paper-fact">
            {beforeFact}
            <Inked inkRef={fact} drawn={stage >= 2} instant={instant} testId="ink-fact">
              {offered}
            </Inked>
            {afterFact}
          </DeskPaper>
          <Thread container={papers} from={promise} to={fact} drawn={stage >= 3} instant={instant} />
        </div>

        {stage >= 4 ? (
          choice ? (
            <Outcome choice={choice} play={chosenHere && !reduce} />
          ) : (
            <Decision
              instant={instant}
              onChoose={next => {
                setChosenHere(true);
                onChoose(next);
              }}
            />
          )
        ) : null}

        <p className={styles.sample} data-testid="desk-sample-label">
          Invented sample · this prototype can't send anything.
        </p>
        {stage >= 4 ? (
          <nav className={styles.nav} onClick={event => event.stopPropagation()}>
            {solved && choice ? (
              <button type="button" onClick={onPlayAgain} data-testid="play-again">
                Play again
              </button>
            ) : null}
            {solved && choice && onWithoutLetters ? (
              <button type="button" onClick={onWithoutLetters} data-testid="desk-switch-variant">
                Try it without the letters
              </button>
            ) : null}
            <button type="button" onClick={onBack} data-testid="back-to-board">
              {solved ? "Back to the board" : "Back to the map"}
            </button>
          </nav>
        ) : null}
      </div>
    </div>
  );
}

function DeskPaper({ index, instant, when, who, testId, children }: { index: number; instant: boolean; when: string; who: string; testId: string; children: React.ReactNode }) {
  return (
    <motion.article
      className={styles.paper}
      data-testid={testId}
      initial={instant ? false : { opacity: 0, y: 28, rotate: index === 1 ? 4 : -3 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ delay: instant ? 0 : 0.12 + index * 0.24, type: "spring", stiffness: 160, damping: 19 }}
    >
      <p className={styles.when}>{when}</p>
      <p className={styles.who}>{who}</p>
      <p className={styles.words}>“{children}”</p>
    </motion.article>
  );
}

/** Red ink, drawn under the words left to right. */
function Inked({ inkRef, drawn, instant, testId, children }: { inkRef: RefObject<HTMLSpanElement | null>; drawn: boolean; instant: boolean; testId: string; children: React.ReactNode }) {
  return (
    <motion.span
      ref={inkRef}
      className={styles.inked}
      data-testid={testId}
      data-drawn={drawn ? "yes" : "no"}
      initial={false}
      animate={{ backgroundSize: drawn ? "100% 0.13em" : "0% 0.13em" }}
      transition={{ duration: instant ? 0 : 0.5, ease: "easeOut" }}
    >
      {children}
    </motion.span>
  );
}

/** A red thread from the end of April's promise to the start of September's fact, pinned at both ends. */
function Thread({ container, from, to, drawn, instant }: { container: RefObject<HTMLDivElement | null>; from: RefObject<HTMLSpanElement | null>; to: RefObject<HTMLSpanElement | null>; drawn: boolean; instant: boolean }) {
  const [ends, setEnds] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  useLayoutEffect(() => {
    if (!drawn) return;
    const measure = () => {
      const box = container.current?.getBoundingClientRect();
      const a = Array.from(from.current?.getClientRects() ?? []).at(-1);
      const b = to.current?.getClientRects()[0];
      if (!box || !a || !b) return;
      setEnds({ a: { x: a.right - box.left, y: a.bottom - box.top }, b: { x: b.left - box.left, y: b.bottom - box.top } });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, [container, from, to, drawn]);
  if (!drawn || !ends) return null;
  const { a, b } = ends;
  const d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${(a.x + 44).toFixed(1)} ${(a.y + 34).toFixed(1)} ${(b.x - 44).toFixed(1)} ${(b.y - 34).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  return (
    <svg className={styles.thread} aria-hidden="true" data-testid="thread">
      <motion.path d={d} initial={{ pathLength: instant ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: instant ? 0 : 0.7, ease: "easeInOut" }} />
      <circle cx={a.x} cy={a.y} r="3.5" />
      <circle cx={b.x} cy={b.y} r="3.5" />
    </svg>
  );
}

function Decision({ instant, onChoose }: { instant: boolean; onChoose: (choice: Choice) => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus({ preventScroll: true });
  }, []);
  return (
    <motion.section
      className={styles.decision}
      data-testid="decision"
      initial={instant ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      onClick={event => event.stopPropagation()}
    >
      <p className={styles.decisionHead}>
        {INVITATION.from} · “{INVITATION.subject}”
      </p>
      <div className={styles.buttons}>
        <button ref={first} type="button" className={styles.primary} onClick={() => onChoose("reply")} data-testid="choice-reply">
          Prepare a reply
        </button>
        <button type="button" onClick={() => onChoose("later")} data-testid="choice-later">
          Keep for later
        </button>
        <button type="button" onClick={() => onChoose("not_for_me")} data-testid="choice-not_for_me">
          Not for me
        </button>
      </div>
    </motion.section>
  );
}

/** What the choice leaves on the desk. Nothing is sent; "Prepare a reply" writes out the labelled sample only. */
function Outcome({ choice, play }: { choice: Choice; play: boolean }) {
  if (choice === "reply") {
    const words = SAMPLE_DRAFT.split(" ");
    return (
      <div className={styles.outcome} data-testid="outcome" data-choice="reply">
        <motion.article className={styles.letter} data-testid="sample-reply" initial={play ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }}>
          <p className={styles.letterLabel}>Sample draft · invented</p>
          <p className={styles.letterhead}>{PLACE_NAMES.letters.S}</p>
          <p className={styles.letterTo}>To: {INVITATION.from}</p>
          <p className={styles.letterWords}>
            {words.map((word, index) => (
              <motion.span key={index} initial={play ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ delay: play ? 0.3 + index * 0.035 : 0, duration: 0.2 }}>
                {word}{" "}
              </motion.span>
            ))}
          </p>
          <motion.p
            className={styles.stamp}
            data-testid="sample-stamp"
            initial={play ? { opacity: 0, scale: 1.7 } : false}
            animate={{ opacity: 1, scale: 1 }}
            transition={play ? { delay: 0.5 + words.length * 0.035, type: "spring", stiffness: 420, damping: 17 } : { duration: 0 }}
          >
            Sample · not sent
          </motion.p>
        </motion.article>
        <motion.p className={styles.note} data-testid="joystick-note" initial={play ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ delay: play ? 0.9 + words.length * 0.035 : 0 }}>
          In JOYSTICK, this is your real reply to your real customer. It opens in your own Gmail, and you decide whether to send it.
        </motion.p>
      </div>
    );
  }
  const later = choice === "later";
  return (
    <div className={styles.outcome} data-testid="outcome" data-choice={choice}>
      <motion.div
        className={later ? styles.folded : styles.drawer}
        aria-hidden="true"
        initial={play ? (later ? { scaleY: 1.8, opacity: 0 } : { y: -26, opacity: 0 }) : false}
        animate={{ scaleY: 1, y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      />
      <motion.p className={styles.line} initial={play ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ delay: play ? 0.35 : 0 }}>
        {later ? "The letter waits on the table, folded." : "The card goes into the drawer."}
      </motion.p>
    </div>
  );
}
