import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { LETTER_STEPS, type LetterStep } from "@shared/firstTenMinutesChapter";
import { REUNION_QUEST_TEMPLATES, applyStepItem } from "@/pages/goldline/silverLake3d/reunionQuests";
import { CREW_ART } from "../crew";
import { FoldedCard, Inkwell, KnitGlove, Pumpkin, Quill, TeaCosy, WritingTable } from "./props";
import styles from "./chapter.module.css";

/**
 * "A Proper Letter", in the Silver Lake courtyard: Hazel's errand from the courtyard game (reunionQuests.ts,
 * "squirrel_hoa_letter"), its steps and their lines as written there, opened and closed with Astra's lines. The
 * player carries the unfinished conversation as a folded card. Fast recovery, no punishing failure.
 */
const HAZEL = REUNION_QUEST_TEMPLATES.find(template => template.id === "squirrel_hoa_letter")!;

type Speaker = "hazel" | "rook" | "sable" | "narrator";
type Line = { who: Speaker; text: string };

const OPENING: Line[] = [
  { who: "hazel", text: "A letter? Excellent. I have several opinions about letters." },
  { who: "hazel", text: "Mine requires a proper response. In ink. With a quill." },
  { who: "rook", text: "You have a pen." },
  { who: "hazel", text: "I said proper." },
];
const SABLE_HINT = "Thick. Knitted. Currently protecting a teapot.";
const THE_REPLY =
  "Dear Hazel, I am sorry about the fountain, and about the noise, and about the fountain again. Your acorns remain the finest in Silver Lake.";
const CLOSING: Line[] = [
  { who: "narrator", text: "Hazel reads. Straightens the paper. Stamps it." },
  { who: "hazel", text: "Complaint withdrawn." },
  { who: "hazel", text: "I'm keeping the stamp." },
  { who: "hazel", text: "Now. Yours." },
];

const NAMES: Record<Exclude<Speaker, "narrator">, string> = { hazel: "Hazel", rook: "Rook", sable: "Sable" };

export function LetterScene({
  steps,
  letterWritten,
  carrying,
  onStep,
  onWritten,
  onYours,
}: {
  steps: LetterStep[];
  letterWritten: boolean;
  /** the first name on the folded card the player carries */
  carrying: string;
  onStep: (step: LetterStep) => Promise<void>;
  onWritten: () => Promise<void>;
  /** prepares the real draft; the table opens once it resolves */
  onYours: () => Promise<unknown>;
}) {
  // reduced motion shortens what moves, never the time to read a line
  const reduce = useReducedMotion();
  const at = steps.length;
  const [beat, setBeat] = useState(() => (letterWritten ? -1 : 0));
  const [line, setLine] = useState<Line | null>(letterWritten ? null : OPENING[0]);
  const [phase, setPhase] = useState<"opening" | "explore" | "writing" | "closing" | "done">(letterWritten ? "closing" : at > 0 ? "explore" : "opening");
  const [shaking, setShaking] = useState(false);
  const [inkFlying, setInkFlying] = useState(false);
  const [inkSpot, setInkSpot] = useState(at >= 4);
  const [stamped, setStamped] = useState(letterWritten);
  const [busy, setBusy] = useState(false);
  const lastProgress = useRef(Date.now());
  const yoursCalled = useRef(false);
  const [handOffFailed, setHandOffFailed] = useState(false);

  // the opening: Hazel, Rook, Hazel, one line at a time
  useEffect(() => {
    if (phase !== "opening") return;
    const timer = window.setTimeout(() => {
      const next = beat + 1;
      if (next >= OPENING.length) {
        setPhase("explore");
        setLine(null);
        return;
      }
      setBeat(next);
      setLine(OPENING[next]);
    }, reduce ? 1600 : 2300);
    return () => window.clearTimeout(timer);
  }, [phase, beat, reduce]);

  // the closing, after the letter is written; a reload after it lands on "Now. Yours."
  useEffect(() => {
    if (phase !== "closing") return;
    if (beat < 0) {
      setBeat(CLOSING.length - 1);
      setLine(CLOSING[CLOSING.length - 1]);
      setStamped(true);
      return;
    }
    if (beat >= CLOSING.length - 1) {
      const timer = window.setTimeout(() => {
        if (yoursCalled.current) return;
        yoursCalled.current = true;
        setPhase("done");
        handOff();
      }, reduce ? 1600 : 2000);
      return () => window.clearTimeout(timer);
    }
    const following = beat + 1;
    const timer = window.setTimeout(() => {
      if (CLOSING[following].text === "Complaint withdrawn.") setStamped(true);
      setBeat(following);
      setLine(CLOSING[following]);
    }, reduce ? 1500 : following === 1 ? 1700 : 2000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, beat, reduce]);

  // Sable, if the player needs a hint
  useEffect(() => {
    if (phase !== "explore" || at > 0) return;
    const timer = window.setInterval(() => {
      if (Date.now() - lastProgress.current > 18_000) {
        setLine({ who: "sable", text: SABLE_HINT });
        lastProgress.current = Date.now();
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [phase, at]);

  // "Now. Yours.": the table opens once the draft is prepared; if that fails, the person can try again without a reload
  function handOff() {
    setHandOffFailed(false);
    onYours().catch(() => setHandOffFailed(true));
  }

  async function use(step: LetterStep) {
    if (phase !== "explore" || busy) return;
    const outcome = applyStepItem(HAZEL, at, step);
    setLine(outcome.line ? { who: "narrator", text: outcome.line } : null);
    if (!outcome.ok) {
      if (step === "shake") {
        setShaking(true);
        window.setTimeout(() => setShaking(false), 700);
        window.setTimeout(() => setLine({ who: "sable", text: SABLE_HINT }), reduce ? 300 : 2600);
      }
      return;
    }
    lastProgress.current = Date.now();
    setBusy(true);
    try {
      if (step === "shake") {
        setShaking(true);
        window.setTimeout(() => setShaking(false), 900);
      }
      if (step === "dip") {
        setInkFlying(true);
        window.setTimeout(() => {
          setInkFlying(false);
          setInkSpot(true);
        }, reduce ? 50 : 650);
      }
      await onStep(step);
    } finally {
      setBusy(false);
    }
  }

  async function giveHazel() {
    if (phase === "opening") return;
    if (phase !== "explore") return;
    if (at < LETTER_STEPS.length) {
      setLine({ who: "hazel", text: "Mine requires a proper response. In ink. With a quill." });
      return;
    }
    setLine({ who: "hazel", text: HAZEL.lines.carrying });
    setPhase("writing");
  }

  // the reply writes itself in the player's best quill handwriting, then Hazel has it
  useEffect(() => {
    if (phase !== "writing") return;
    const timer = window.setTimeout(async () => {
      await onWritten();
      setBeat(0);
      setLine(CLOSING[0]);
      setPhase("closing");
    }, reduce ? 600 : 4200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, reduce]);

  const held = useMemo(() => {
    if (at >= 4) return <Quill inked />;
    if (at === 3) return <Quill />;
    if (at >= 1) return <KnitGlove />;
    return null;
  }, [at]);

  return (
    <section className={styles.courtyard} data-testid="first-ten-letter" data-phase={phase} data-step={at}>
      <img src="/assets/first-ten/courtyard/courtyard.webp" alt="" className={styles.courtyardBack} draggable={false} />
      <div className={styles.courtyardShade} aria-hidden="true" />

      <button
        type="button"
        className={`${styles.station} ${styles.atTeapot}`}
        aria-label={at === 0 ? "Put on the tea cosy" : "The teapot"}
        data-station="glove"
        onClick={() => void use("glove")}
      >
        <TeaCosy worn={at >= 1} />
      </button>

      <motion.button
        type="button"
        className={`${styles.station} ${styles.atPip}`}
        aria-label="Shake the porcupine"
        data-station="shake"
        onClick={() => void use("shake")}
        animate={shaking && !reduce ? { x: [0, -5, 5, -4, 4, -2, 0] } : { x: 0 }}
        transition={{ duration: 0.6 }}
      >
        <Pumpkin />
        <img src="/assets/first-ten/courtyard/pip.webp" alt="Pip the porcupine, asleep" className={styles.pip} draggable={false} />
      </motion.button>

      <AnimatePresence>
        {at === 2 ? (
          <motion.button
            type="button"
            className={`${styles.station} ${styles.atQuill}`}
            aria-label="Pick up the quill"
            data-station="quill"
            onClick={() => void use("quill")}
            initial={reduce ? false : { y: -70, rotate: -40, opacity: 0 }}
            animate={{ y: 0, rotate: 12, opacity: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: reduce ? 0 : 1.4, ease: "easeOut" }}
          >
            <Quill />
          </motion.button>
        ) : null}
      </AnimatePresence>

      <button type="button" className={`${styles.station} ${styles.atInk}`} aria-label="Dip the quill in the ink well" data-station="dip" onClick={() => void use("dip")}>
        <Inkwell />
      </button>
      <AnimatePresence>
        {inkFlying ? (
          <motion.span
            className={styles.inkDrop}
            initial={{ opacity: 1 }}
            animate={{ x: ["0cqw", "10cqw", "20cqw"], y: ["0cqw", "-9cqw", "-10cqw"], opacity: [1, 1, 0.9] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            aria-hidden="true"
          />
        ) : null}
      </AnimatePresence>

      <button type="button" className={`${styles.station} ${styles.atTable}`} aria-label="Give Hazel the quill" data-station="hazel" onClick={() => void giveHazel()}>
        <img src="/assets/first-ten/courtyard/hazel.webp" alt="Hazel" className={styles.hazel} draggable={false} />
        <WritingTable inkSpot={inkSpot} stamped={stamped} />
        {phase === "writing" ? (
          <motion.p
            className={styles.letterWriting}
            initial={{ clipPath: "inset(0 100% 0 0)" }}
            animate={{ clipPath: "inset(0 0% 0 0)" }}
            transition={{ duration: reduce ? 0.2 : 3.6, ease: "linear" }}
            data-testid="first-ten-hazel-reply"
          >
            {THE_REPLY}
          </motion.p>
        ) : null}
      </button>

      <div className={styles.edgeLeft}>{CREW_ART.rook ? <img src={CREW_ART.rook.src} alt={CREW_ART.rook.alt} className={styles.edgeArt} draggable={false} /> : null}</div>
      <div className={styles.edgeRight}>{CREW_ART.sable ? <img src={CREW_ART.sable.src} alt={CREW_ART.sable.alt} className={styles.edgeArt} draggable={false} /> : null}</div>

      <div className={styles.pocket} data-testid="first-ten-pocket">
        <span className={styles.pocketCard}>
          <FoldedCard name={carrying} />
        </span>
        <AnimatePresence mode="popLayout">
          {held ? (
            <motion.span key={at} className={styles.pocketHeld} initial={reduce ? false : { scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} data-held={at}>
              {held}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait">
        {line ? (
          <motion.p
            key={`${line.who}:${line.text}`}
            className={line.who === "narrator" ? styles.narration : `${styles.courtyardSay} ${styles[`say_${line.who}`]}`}
            data-testid="first-ten-letter-line"
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
      {handOffFailed ? (
        <button type="button" className={`${styles.pickUp} ${styles.tableRetry}`} data-testid="first-ten-table-retry" onClick={handOff}>
          Try again
        </button>
      ) : null}
    </section>
  );
}
