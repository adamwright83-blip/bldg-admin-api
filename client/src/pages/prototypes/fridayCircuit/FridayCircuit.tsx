import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform, type MotionValue } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { INITIAL, afterLeg, canRelease, release, retry, slide, turn, type Layer, type Leg, type Pad, type PuzzleState } from "./model";
import { AT, BOARD, HOTEL_BEND, JR, PORT, THEN_TRACKS, circuitRoute, junctionRail, legPoints, polyline, railPath, type Point } from "./geometry";
import { NOW_PAPER, PLACE_NAMES, SAMPLE_LABEL, THEN_PAPER } from "./sample";
import { Desk, type Choice } from "./Desk";
import styles from "./fridayCircuit.module.css";

/**
 * "The Friday That Didn't Exist", as a clockwork prototype (Adam's brief, 2026-10-30). A proposed game design, not
 * story canon, and not part of onboarding: an isolated page for finding out whether this little machine is enjoyable
 * to work, and whether THEN and NOW are both needed to make it work. Controls are only the junction, the layer
 * switch, wind and release, retry and reset. No timer, no highlighted next move, no announcement of what it means.
 *
 * The ending (Adam's approval, 2026-10-30): the courier comes home and the round trip lights up, postmarked; CHAPTER
 * COMPLETE, and the title corrects itself; the envelope left at the hotel opens there; then the studio's own dated
 * papers on the writing desk, with no explanation, and the choice. A tap moves it along at any point.
 */
export type Variant = "letters" | "neutral";
type Moment = "idle" | "winding" | "running" | "bump" | "bell" | "spin";
type Saved = { state: PuzzleState; solvedOnce: boolean };
/** home and lit, chapter complete, the hotel's envelope opens, the writing desk */
type Ending = "homecoming" | "chapter" | "hotel" | "desk";

const PUZZLE_KEY = (variant: Variant) => `joystick.prototype.fridayCircuit.${variant}.puzzle.v1`;
/** the sample business choice, kept apart from the puzzle */
const CHOICE_KEY = "joystick.prototype.fridayCircuit.sampleChoice.v1";
const ROOK_FAILURE = "A bold interpretation of ‘connected.’";
const ROOK_SUCCESS = "There and back. Suspiciously competent.";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* the page works without storage; it just won't remember */
  }
}

/** A little clockwork, made in the browser: the bell, a click as the junction turns, a ratchet as it's wound, a chime home. */
function useClockworkSounds() {
  const context = useRef<AudioContext | null>(null);
  return useCallback((kind: "bell" | "click" | "wind" | "chime") => {
    try {
      const Audio = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Audio) return;
      context.current ??= new Audio();
      const audio = context.current;
      const tone = (frequency: number, at: number, length: number, volume: number, type: OscillatorType = "triangle") => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(volume, at);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(at);
        oscillator.stop(at + length);
      };
      const now = audio.currentTime;
      if (kind === "bell") {
        tone(2093, now, 1.4, 0.07, "sine");
        tone(4186, now, 0.6, 0.02, "sine");
      } else if (kind === "click") {
        tone(1300, now, 0.05, 0.05);
      } else if (kind === "chime") {
        // three brass notes, rising: not the indignant bell
        [1568, 2093, 2637].forEach((frequency, i) => tone(frequency, now + i * 0.13, 1.6, 0.05, "sine"));
      } else {
        for (let i = 0; i < 5; i += 1) tone(900 + i * 60, now + i * 0.09, 0.04, 0.04);
      }
    } catch {
      /* no sound, no harm */
    }
  }, []);
}

const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

export default function FridayCircuit({ variant = "letters", rookSrc = "/assets/first-ten/crew/rook.webp", onVariant }: { variant?: Variant; rookSrc?: string; onVariant?: (variant: Variant) => void }) {
  const reduce = useReducedMotion();
  const letters = variant === "letters";
  const names = PLACE_NAMES[variant];
  const sound = useClockworkSounds();

  const [saved, setSaved] = useState<Saved>(() => {
    const loaded = load<Saved>(PUZZLE_KEY(variant), { state: INITIAL, solvedOnce: false });
    // a courier left stopped against the junction is back on its pad after a reload
    return { ...loaded, state: loaded.state.stuck ? retry(loaded.state) : loaded.state };
  });
  const state = saved.state;
  const [choice, setChoice] = useState<Choice | null>(() => load<{ choice: Choice } | null>(CHOICE_KEY, null)?.choice ?? null);
  const [moment, setMoment] = useState<Moment>("idle");
  const [envelope, setEnvelope] = useState<"carried" | "upright">("carried");
  const [rook, setRook] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const [hint, setHint] = useState(false);
  const [lastAction, setLastAction] = useState(() => Date.now());
  const [reading, setReading] = useState<"then" | "now" | null>(null);
  // a reload after the win reopens where it ends (the desk, or the plain version's card), without replaying it
  const [ending, setEnding] = useState<Ending | null>(() => (saved.state.complete ? (letters ? "desk" : "chapter") : null));
  /** the ending is playing now, rather than reopened */
  const [fresh, setFresh] = useState(false);
  const rookSaidFailure = useRef(false);
  const rookSaidSuccess = useRef(saved.state.complete);

  const x = useMotionValue(AT[state.at].x);
  const y = useMotionValue(AT[state.at].y);
  const facing = useMotionValue(1);
  const wheel = useMotionValue(0);
  const lift = useMotionValue(0);
  const lifted = useTransform(() => y.get() - lift.get());

  const busy = moment === "winding" || moment === "running";

  const commit = useCallback(
    (next: PuzzleState, solved = false) => {
      setSaved(current => {
        const value = { state: next, solvedOnce: current.solvedOnce || solved || next.complete };
        store(PUZZLE_KEY(variant), value);
        return value;
      });
    },
    [variant]
  );

  // control hints appear only when someone seems stuck: a long pause before trying anything, or a run of failures
  useEffect(() => {
    if (state.complete || hint) return;
    const timer = window.setInterval(() => {
      if (Date.now() - lastAction > 20_000) setHint(true);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lastAction, state.complete, hint]);
  const acted = () => setLastAction(Date.now());

  useEffect(() => {
    if (!rook || rook === ROOK_SUCCESS) return;
    const timer = window.setTimeout(() => setRook(null), 4200);
    return () => window.clearTimeout(timer);
  }, [rook]);

  // the ending plays itself along; a tap moves it on sooner
  const nextBeat = (beat: Ending): Ending | null => (beat === "homecoming" ? "chapter" : beat === "chapter" ? (letters ? "hotel" : null) : beat === "hotel" ? "desk" : null);
  useEffect(() => {
    if (!fresh || !ending) return;
    const next = nextBeat(ending);
    if (!next) return;
    const hold = { homecoming: reduce ? 900 : 1500, chapter: reduce ? 1100 : 1800, hotel: reduce ? 600 : 1300, desk: 0 }[ending];
    const timer = window.setTimeout(() => setEnding(next), hold);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ending, fresh, reduce]);
  const advance = () => setEnding(current => (current ? nextBeat(current) ?? current : current));

  function failed(kind: "bump" | "bell" | "spin") {
    setFailures(count => {
      const next = count + 1;
      if (next >= 3) setHint(true);
      return next;
    });
    if (!rookSaidFailure.current && kind !== "spin") {
      rookSaidFailure.current = true;
      setRook(ROOK_FAILURE);
    }
  }

  async function run(points: Point[], deliverAt: number | null, onDeliver: () => void) {
    const line = polyline(points);
    const duration = reduce ? Math.max(0.3, line.total / 1000) : Math.max(0.9, line.total / 270);
    const deliverFrom = deliverAt === null ? null : line.fractionOf(deliverAt);
    let handed = false;
    await animate(0, 1, {
      duration,
      ease: "easeInOut",
      onUpdate: fraction => {
        const point = line.at(fraction);
        x.set(point.x);
        y.set(point.y);
        if (Math.abs(point.dx) > 1) facing.set(point.dx > 0 ? 1 : -1);
        wheel.set(fraction * line.total * 2.4);
        if (deliverFrom !== null && !handed && fraction >= deliverFrom) {
          handed = true;
          onDeliver();
        }
      },
    });
  }

  async function windAndRelease() {
    if (busy || !canRelease(state)) return;
    acted();
    setMoment("winding");
    sound("wind");
    await sleep(reduce ? 150 : 700);
    const leg: Leg = release(state);
    const next = afterLeg(state, leg);
    if (leg.kind === "spun") {
      // wheels turn over a withdrawn track; it settles back onto the pad
      setMoment("spin");
      const home = AT[leg.from];
      await Promise.all([
        animate(wheel, wheel.get() + 900, { duration: reduce ? 0.3 : 1, ease: "easeOut" }),
        animate(x, [home.x, home.x + 7, home.x + 3, home.x + 6, home.x], { duration: reduce ? 0.3 : 1 }),
      ]);
      setMoment("idle");
      commit(next);
      failed("spin");
      return;
    }
    setMoment("running");
    const { points, deliverAt } = legPoints(leg, state.junction);
    let delivered = state.delivered;
    await run(points, deliverAt, () => {
      delivered = true;
      commit({ ...state, delivered: true });
    });
    if (leg.kind === "blocked") {
      const stop = points[points.length - 1];
      const nose = { x: Math.sign(PORT[leg.side].x - stop.x) * 6, y: Math.sign(PORT[leg.side].y - stop.y) * 6 };
      await animate(x, [stop.x, stop.x + nose.x, stop.x], { duration: 0.32 });
      await animate(y, [stop.y, stop.y + nose.y, stop.y], { duration: 0.01 });
      if (leg.carrying) {
        // the spring-loaded nose bumps, and the little envelope flips upright
        setEnvelope("upright");
        setMoment("bump");
        failed("bump");
      } else {
        // a tiny bell, once, indignantly
        sound("bell");
        setMoment("bell");
        failed("bell");
      }
      commit({ ...next, delivered });
      return;
    }
    setMoment("idle");
    commit({ ...next, delivered: delivered || next.delivered });
    if (next.complete) {
      setHint(false);
      sound("chime");
      setFresh(true);
      setEnding("homecoming");
      if (!rookSaidSuccess.current) {
        rookSaidSuccess.current = true;
        setRook(ROOK_SUCCESS);
      }
    }
  }

  async function retryLeg() {
    if (busy || !state.lastPad || state.complete) return;
    acted();
    const to = AT[state.lastPad];
    setMoment("running");
    // lifted off the rails and set back down on the pad it left from
    await animate(lift, 14, { duration: reduce ? 0.05 : 0.18 });
    await Promise.all([animate(x, to.x, { duration: reduce ? 0.1 : 0.45 }), animate(y, to.y, { duration: reduce ? 0.1 : 0.45 })]);
    await animate(lift, 0, { duration: reduce ? 0.05 : 0.2 });
    setEnvelope("carried");
    setMoment("idle");
    commit(retry(state));
  }

  function turnJunction() {
    if (busy || state.complete) return;
    acted();
    sound("click");
    commit(turn(state));
  }

  function slideTo(layer: Layer) {
    if (busy || state.layer === layer) return;
    acted();
    commit(slide(state, layer));
  }

  function reset() {
    if (busy) return;
    acted();
    x.set(AT.S.x);
    y.set(AT.S.y);
    facing.set(1);
    setEnvelope("carried");
    setMoment("idle");
    setRook(null);
    setEnding(null);
    setFresh(false);
    rookSaidSuccess.current = false;
    commit(INITIAL);
  }

  function choose(next: Choice) {
    setChoice(next);
    store(CHOICE_KEY, { choice: next, at: new Date().toISOString() });
  }

  /** A new round: the machine as found, and the sample's choice open again. */
  function playAgain() {
    reset();
    setChoice(null);
    try {
      window.localStorage.removeItem(CHOICE_KEY);
    } catch {
      /* nothing stored, nothing to forget */
    }
  }

  const solved = state.complete;
  const delivered = state.delivered;
  const stuck = Boolean(state.stuck);
  const canSlide = !busy && !stuck && !solved;
  // the round trip, lit once it's home; drawn as it happens, or already drawn when reopened
  const playing = fresh && ending === "homecoming";
  const envelopeOpen = letters && solved && ending !== "homecoming" && ending !== "chapter";

  return (
    <main className={styles.page} data-testid="friday-circuit" data-variant={variant} data-ending={ending ?? "none"}>
      <header className={styles.header}>
        {letters ? (
          <p className={styles.sample} data-testid="sample-label">
            {SAMPLE_LABEL}
          </p>
        ) : null}
        <h1 className={styles.instruction}>Deliver the invitation. Bring the courier home.</h1>
        {letters ? (
          <button
            type="button"
            className={styles.straight}
            onClick={() => {
              setFresh(!solved);
              setEnding("desk");
            }}
            data-testid="go-correspondence"
          >
            {solved ? "Open the correspondence" : "Go straight to the correspondence"}
          </button>
        ) : null}
      </header>

      <div className={styles.stage}>
        {letters ? <Paper side="then" onRead={() => setReading("then")} /> : null}

        <div className={styles.boardFrame}>
          <div className={styles.boardViewport}>
            {/* at the hotel, the table leans in to where the envelope was left */}
            <motion.div
              initial={false}
              animate={{ scale: ending === "hotel" && !reduce ? 1.9 : 1 }}
              transition={{ duration: 1.05, ease: [0.4, 0, 0.2, 1] }}
              // aimed so the hotel, its name and the envelope at its door all stay in view
              style={{ originX: 0.96, originY: 0.17 }}
            >
              <svg
                className={styles.board}
                viewBox={`0 0 ${BOARD.width} ${BOARD.height}`}
                data-testid="circuit-board"
                data-layer={state.layer}
                role="group"
                aria-label="The tabletop map"
              >
                <defs>
                  <clipPath id="fc-board">
                    <rect x="10" y="10" width={BOARD.width - 20} height={BOARD.height - 20} rx="22" />
                  </clipPath>
                  <radialGradient id="fc-glow">
                    <stop offset="0%" stopColor="#ffe3a0" stopOpacity="0.95" />
                    <stop offset="100%" stopColor="#ffd36b" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <rect x="10" y="10" width={BOARD.width - 20} height={BOARD.height - 20} rx="22" className={styles.mapBase} />

                <g clipPath="url(#fc-board)">
                  {/* THEN: the lower tracks, and no hotel tracks at all */}
                  <Plate layer="then" active={state.layer === "then"} reduce={Boolean(reduce)}>
                    {THEN_TRACKS.map((points, index) => (
                      <Rail key={index} points={points} />
                    ))}
                  </Plate>
                  {/* NOW: the hotel tracks; the lower tracks are withdrawn and only their outlines remain */}
                  <Plate layer="now" active={state.layer === "now"} reduce={Boolean(reduce)}>
                    {THEN_TRACKS.map((points, index) => (
                      <path key={index} d={railPath(points)} className={styles.outline} data-withdrawn="yes" />
                    ))}
                    <Rail points={HOTEL_BEND} />
                  </Plate>
                  {/* home: THEN and NOW together for once, and the round trip lit as one line */}
                  {solved ? (
                    <>
                      <motion.g className={styles.ghostBend} initial={playing ? { opacity: 0 } : false} animate={{ opacity: 0.55 }} transition={{ duration: 0.5 }}>
                        <Rail points={HOTEL_BEND} />
                      </motion.g>
                      <RouteGlow points={circuitRoute(state.lastPad ?? "Q")} draw={playing && !reduce} />
                    </>
                  ) : null}
                </g>

                <Hotel name={names.H} delivered={delivered} opened={envelopeOpen} opening={fresh && ending === "hotel"} reduce={Boolean(reduce)} />
                {(["S", "P", "Q"] as const).map(pad => (
                  <DockPad key={pad} pad={pad} label={pad === "S" ? names.S : null} />
                ))}
                <Turntable junction={state.junction} layer={state.layer} disabled={busy || solved} onTurn={turnJunction} reduce={Boolean(reduce)} />

                <motion.g style={{ x, y: lifted }} data-testid="courier" data-at={state.at} data-moment={moment} data-envelope={delivered ? "delivered" : envelope}>
                  <g transform="scale(1.45)">
                    <motion.g style={{ scaleX: facing }}>
                      <Courier wheel={wheel} winding={moment === "winding"} envelope={delivered ? null : envelope} reduce={Boolean(reduce)} />
                    </motion.g>
                  </g>
                </motion.g>
                <AnimatePresence>{moment === "bell" ? <Bell key="bell" /> : null}</AnimatePresence>
                {solved ? <Postmark stamp={playing && !reduce} /> : null}
              </svg>
            </motion.div>
          </div>

          <AnimatePresence>
            {rook && (ending === null || ending === "homecoming") ? (
              <motion.p
                key={rook}
                className={styles.rookSay}
                data-testid="rook-line"
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <span>Rook</span>
                {rook}
              </motion.p>
            ) : null}
          </AnimatePresence>
          <img src={rookSrc} alt="Rook" className={styles.rook} draggable={false} />

          <AnimatePresence>
            {ending === "chapter" ? (
              <ChapterCard key="chapter" letters={letters} play={fresh && !reduce} onPlayAgain={playAgain} />
            ) : null}
          </AnimatePresence>
          {/* while the ending plays on the board, a tap anywhere on it moves it along */}
          {fresh && (ending === "homecoming" || (ending === "chapter" && letters) || ending === "hotel") ? (
            <button type="button" className={styles.advance} onClick={advance} aria-label="Continue" data-testid="advance" />
          ) : null}
        </div>

        {letters ? <Paper side="now" onRead={() => setReading("now")} /> : null}
      </div>

      <div className={`${styles.controls} ${solved ? styles.controlsDone : ""}`} data-testid="controls">
        <div className={styles.lever} role="radiogroup" aria-label="Map layer" data-layer={state.layer}>
          {(["then", "now"] as const).map(layer => (
            <button
              key={layer}
              type="button"
              role="radio"
              aria-checked={state.layer === layer}
              disabled={!canSlide}
              onClick={() => slideTo(layer)}
              data-testid={`layer-${layer}`}
            >
              {layer === "then" ? "THEN" : "NOW"}
            </button>
          ))}
          <motion.span className={styles.knob} animate={{ x: state.layer === "then" ? "0%" : "100%" }} transition={{ type: "spring", stiffness: 260, damping: 22 }} aria-hidden="true" />
        </div>
        <button type="button" className={styles.wind} onClick={() => void windAndRelease()} disabled={busy || !canRelease(state)} data-testid="wind">
          <KeyIcon turning={moment === "winding"} />
          Wind &amp; release
        </button>
        <button type="button" className={styles.quiet} onClick={() => void retryLeg()} disabled={busy || !state.lastPad || solved} data-testid="retry">
          Retry the last leg
        </button>
        <button type="button" className={styles.quiet} onClick={reset} disabled={busy} data-testid="reset">
          Reset
        </button>
      </div>

      <AnimatePresence>
        {hint && !solved ? (
          <motion.p className={styles.hint} data-testid="control-hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            Tap the junction to turn it. Slide the map between THEN and NOW while the courier is docked. Wind it to send it off.
          </motion.p>
        ) : null}
      </AnimatePresence>

      {solved && ending === null ? (
        <section className={styles.completion} data-testid="completion">
          <p className={styles.plainWin}>Delivered, and home.</p>
          <button type="button" className={styles.quiet} onClick={playAgain} data-testid="play-again">
            Play again
          </button>
        </section>
      ) : !solved && saved.solvedOnce ? (
        <p className={styles.solvedOnce} data-testid="solved-once">
          You've brought it home before.
        </p>
      ) : null}

      {reading ? <PaperSheet side={reading} onClose={() => setReading(null)} /> : null}
      {ending === "desk" ? (
        <Desk
          choice={choice}
          onChoose={choose}
          fresh={fresh}
          reduce={Boolean(reduce)}
          solved={solved}
          onPlayAgain={playAgain}
          onBack={() => {
            setEnding(null);
            setFresh(false);
          }}
          onWithoutLetters={onVariant ? () => onVariant("neutral") : undefined}
        />
      ) : null}

      <footer className={styles.footer}>
        {onVariant ? (
          <button type="button" onClick={() => onVariant(letters ? "neutral" : "letters")} data-testid="switch-variant">
            {letters ? "Play it with neutral labels, without the letters" : "Play it with Nina's sample letters"}
          </button>
        ) : null}
        <span>Prototype · not part of JOYSTICK yet</span>
      </footer>
    </main>
  );
}

// ------------------------------------------------------------------ the model's parts

function Plate({ layer, active, reduce, children }: { layer: Layer; active: boolean; reduce: boolean; children: React.ReactNode }) {
  // THEN rests to the left, NOW to the right; the one in use slides in beneath the fixed pads
  const away = layer === "then" ? -BOARD.width : BOARD.width;
  return (
    <motion.g
      className={styles.plate}
      data-plate={layer}
      initial={false}
      animate={{ x: active ? 0 : away }}
      transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 70, damping: 15 }}
    >
      <rect x="10" y="10" width={BOARD.width - 20} height={BOARD.height - 20} rx="22" className={layer === "then" ? styles.plateThen : styles.plateNow} />
      <text x={layer === "then" ? 48 : BOARD.width - 48} y={BOARD.height - 40} textAnchor={layer === "then" ? "start" : "end"} className={styles.plateLabel}>
        {layer === "then" ? "THEN" : "NOW"}
      </text>
      {children}
    </motion.g>
  );
}

function Rail({ points }: { points: Point[] }) {
  const d = railPath(points);
  return (
    <g className={styles.rail}>
      <path d={d} className={styles.railTies} />
      <path d={d} className={styles.railSteel} />
      <path d={d} className={styles.railBed} />
    </g>
  );
}

function DockPad({ pad, label }: { pad: Pad; label: string | null }) {
  const { x, y } = AT[pad];
  return (
    <g className={styles.pad} data-pad={pad}>
      <circle cx={x} cy={y} r="30" className={styles.padRing} />
      <circle cx={x} cy={y} r="21" className={styles.padFace} />
      {label ? (
        <text x={x} y={y + 54} textAnchor="middle" className={styles.placeLabel}>
          {label}
        </text>
      ) : null}
    </g>
  );
}

function Hotel({ name, delivered, opened, opening, reduce }: { name: string; delivered: boolean; opened: boolean; opening: boolean; reduce: boolean }) {
  const { x, y } = AT.H;
  return (
    <g className={styles.hotel} aria-label={name}>
      <g transform={`translate(${x + 26} ${y - 104})`}>
        <path d="M0 40 L36 14 L72 40 Z" className={styles.hotelRoof} />
        <rect x="6" y="40" width="60" height="50" className={styles.hotelWall} />
        <rect x="16" y="50" width="12" height="12" className={styles.hotelWindow} />
        <rect x="44" y="50" width="12" height="12" className={styles.hotelWindow} />
        <rect x="29" y="66" width="14" height="24" className={styles.hotelDoor} />
      </g>
      <text x={x + 140} y={y - 116} textAnchor="end" className={styles.placeLabel}>
        {name}
      </text>
      <AnimatePresence>
        {delivered ? (
          <motion.g key="letter" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} data-testid="hotel-envelope" data-opened={opened ? "yes" : "no"}>
            {opened ? <OpenedEnvelope x={x + 46} y={y - 22} play={opening && !reduce} /> : <Envelope x={x + 46} y={y - 22} upright={false} />}
          </motion.g>
        ) : null}
      </AnimatePresence>
    </g>
  );
}

/** The envelope the courier left at the hotel, opening where it lies: the flap lifts and its card rises, in a little light. */
function OpenedEnvelope({ x, y, play }: { x: number; y: number; play: boolean }) {
  return (
    <g transform={`translate(${x + 10} ${y + 6.5}) scale(2.1) translate(-10 -6.5)`} className={styles.envelope} data-testid="hotel-opening">
      <motion.circle cx="10" cy="2" r="22" fill="url(#fc-glow)" initial={play ? { opacity: 0 } : false} animate={{ opacity: play ? [0, 0.95, 0.55] : 0.4 }} transition={{ duration: 1.1 }} />
      <rect width="20" height="13" rx="1.5" />
      {/* the card, rising out of it */}
      <motion.g initial={play ? { y: 0 } : false} animate={{ y: -9 }} transition={{ delay: play ? 0.35 : 0, duration: 0.55, ease: "easeOut" }}>
        <rect x="3" y="-1" width="14" height="10" rx="0.8" className={styles.envelopeCard} />
        <path d="M5.5 2.5 H14.5 M5.5 5 H12" className={styles.envelopeLines} />
      </motion.g>
      <path d="M0 13 L10 6 L20 13" />
      {/* the flap, lifted */}
      <motion.path d="M0 0 L10 -8 L20 0" className={styles.envelopeFlap} initial={play ? { scaleY: -1 } : false} animate={{ scaleY: 1 }} transition={{ duration: 0.4 }} style={{ originY: 1 }} />
    </g>
  );
}

/** The round trip, out on THEN, round the hotel on NOW and home on THEN, lit as one line. */
function RouteGlow({ points, draw }: { points: Point[]; draw: boolean }) {
  const d = railPath(points);
  return (
    <g data-testid="route-glow">
      <motion.path d={d} className={styles.routeHalo} initial={{ pathLength: draw ? 0 : 1 }} animate={{ pathLength: 1 }} transition={{ duration: draw ? 1.15 : 0, ease: "easeInOut" }} />
      <motion.path d={d} className={styles.routeLine} initial={{ pathLength: draw ? 0 : 1 }} animate={{ pathLength: 1 }} transition={{ duration: draw ? 1.15 : 0, ease: "easeInOut" }} />
    </g>
  );
}

/** Franked inside the loop it made. */
function Postmark({ stamp }: { stamp: boolean }) {
  const cx = 640;
  const cy = 330;
  return (
    <motion.g
      className={styles.postmark}
      data-testid="postmark"
      initial={stamp ? { opacity: 0, scale: 1.7 } : false}
      animate={{ opacity: 0.9, scale: 1 }}
      transition={stamp ? { delay: 0.8, type: "spring", stiffness: 420, damping: 18 } : { duration: 0 }}
    >
      <g transform={`rotate(-11 ${cx} ${cy})`}>
        <circle cx={cx} cy={cy} r="112" className={styles.postmarkRing} />
        <circle cx={cx} cy={cy} r="100" className={styles.postmarkRingThin} />
        <text x={cx} y={cy - 10} textAnchor="middle" className={styles.postmarkText}>
          DELIVERED
        </text>
        <path d={`M ${cx - 72} ${cy + 4} H ${cx + 72}`} className={styles.postmarkRule} />
        <text x={cx} y={cy + 40} textAnchor="middle" className={styles.postmarkText}>
          RETURNED
        </text>
      </g>
    </motion.g>
  );
}

/**
 * CHAPTER COMPLETE. With the letters, the title corrects itself in red ink: the player has made Friday possible.
 * The plain version ends here, with the same card and no story.
 */
function ChapterCard({ letters, play, onPlayAgain }: { letters: boolean; play: boolean; onPlayAgain: () => void }) {
  return (
    <motion.div className={styles.chapterCard} data-testid="chapter-card" initial={play ? { opacity: 0 } : false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
      <p className={styles.chapterKicker}>Chapter complete</p>
      {letters ? (
        <p className={styles.chapterTitle}>
          <span className={styles.srOnly}>The Friday That Does Exist</span>
          <span aria-hidden="true">
            The Friday That{" "}
            <span className={styles.correction} data-testid="title-correction">
              <span className={styles.struck}>
                Didn't
                <motion.span className={styles.strike} initial={play ? { scaleX: 0 } : false} animate={{ scaleX: 1 }} transition={{ delay: play ? 0.45 : 0, duration: 0.25 }} />
              </span>
              <motion.span className={styles.inserted} initial={play ? { opacity: 0, y: 8 } : false} animate={{ opacity: 1, y: 0 }} transition={{ delay: play ? 0.75 : 0, duration: 0.3 }}>
                Does
              </motion.span>
            </span>{" "}
            Exist
          </span>
        </p>
      ) : (
        <>
          <p className={styles.chapterTitle}>Delivered, and home.</p>
          <button type="button" className={styles.chapterAgain} onClick={onPlayAgain} data-testid="play-again">
            Play again
          </button>
        </>
      )}
    </motion.div>
  );
}

function Turntable({ junction, layer, disabled, onTurn, reduce }: { junction: PuzzleState["junction"]; layer: Layer; disabled: boolean; onTurn: () => void; reduce: boolean }) {
  const { x, y } = AT.J;
  const open = new Set(junction.split("-"));
  const stops = (["west", "north", "east"] as const).filter(side => !open.has(side));
  return (
    <g
      className={`${styles.turntable} ${layer === "now" ? styles.turntableWithdrawn : ""}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={`Junction: joins ${[...open].join(" and ")}`}
      data-testid="junction"
      data-junction={junction}
      onClick={() => !disabled && onTurn()}
      onKeyDown={event => {
        if (!disabled && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onTurn();
        }
      }}
    >
      <circle cx={x} cy={y} r={JR + 12} className={styles.turntableRim} />
      <circle cx={x} cy={y} r={JR + 2} className={styles.turntableFace} />
      <g transform={`translate(${x} ${y})`}>
        {/* turns about the turntable's centre: the invisible circle gives the group its centre */}
        <motion.g key={junction} initial={reduce ? false : { rotate: -90, opacity: 0.5 }} animate={{ rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 220, damping: 16 }}>
          <circle r={JR} fill="none" stroke="none" />
          <Rail points={junctionRail(junction).map(point => ({ x: point.x - x, y: point.y - y }))} />
        </motion.g>
      </g>
      {/* the side it doesn't join is shut with a little spring stop */}
      {stops.map(side => (
        <rect
          key={side}
          x={PORT[side].x - (side === "north" ? 9 : 3)}
          y={PORT[side].y - (side === "north" ? 3 : 9)}
          width={side === "north" ? 18 : 6}
          height={side === "north" ? 6 : 18}
          rx="2"
          className={styles.stop}
          data-stop={side}
        />
      ))}
      <circle cx={x} cy={y} r="5" className={styles.pivot} />
    </g>
  );
}

function Courier({ wheel, winding, envelope, reduce }: { wheel: MotionValue<number>; winding: boolean; envelope: "carried" | "upright" | null; reduce: boolean }) {
  return (
    <g className={styles.courier}>
      <ellipse cx="0" cy="18" rx="22" ry="5" className={styles.shadow} />
      {[-12, 12].map(at => (
        <g key={at} transform={`translate(${at} 10)`}>
          <motion.g style={{ rotate: wheel }}>
            <circle r="7" className={styles.wheel} />
            <path d="M-7 0 H7 M0 -7 V7" className={styles.spoke} />
          </motion.g>
        </g>
      ))}
      <rect x="-20" y="-12" width="40" height="22" rx="8" className={styles.body} />
      <circle cx="21" cy="-1" r="4" className={styles.nose} />
      <g transform="translate(-12 -12)">
        <motion.g animate={winding && !reduce ? { rotate: [0, 180, 360, 540] } : { rotate: 0 }} transition={{ duration: 0.7 }}>
          <path d="M0 0 V-7 M-4 -11 a3.5 3.5 0 1 0 0.1 0 M4 -11 a3.5 3.5 0 1 0 0.1 0" className={styles.key} />
        </motion.g>
      </g>
      {envelope ? (
        <g transform="translate(-2 -14)">
          {/* on a bump the little envelope flips upright on its hinge */}
          <motion.g animate={{ rotate: envelope === "upright" ? -72 : 0 }} style={{ originX: 0, originY: 1 }} transition={{ type: "spring", stiffness: 300, damping: 9 }}>
            <Envelope x={0} y={-13} upright={envelope === "upright"} />
          </motion.g>
        </g>
      ) : null}
    </g>
  );
}

function Envelope({ x, y, upright }: { x: number; y: number; upright: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`} className={styles.envelope} data-upright={upright ? "yes" : "no"}>
      <rect width="20" height="13" rx="1.5" />
      <path d="M0 0 L10 7 L20 0" />
    </g>
  );
}

function Bell() {
  const { x, y } = AT.J;
  return (
    <motion.g className={styles.bell} data-testid="bell" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <g className={styles.bellSwing}>
        <path d={`M${x + 58} ${y - 66} q0 -24 12 -24 q12 0 12 24 z`} />
        <circle cx={x + 70} cy={y - 62} r="3" />
      </g>
      <text x={x + 92} y={y - 82} className={styles.ding}>
        ding
      </text>
    </motion.g>
  );
}

function KeyIcon({ turning }: { turning: boolean }) {
  return (
    <motion.svg viewBox="0 0 24 24" className={styles.keyIcon} animate={turning ? { rotate: 360 } : { rotate: 0 }} transition={{ duration: 0.7 }} aria-hidden="true">
      <circle cx="7" cy="12" r="4" />
      <circle cx="17" cy="12" r="4" />
      <path d="M11 12 H13" />
    </motion.svg>
  );
}

// ------------------------------------------------------------------ the paper artifacts

function Paper({ side, onRead }: { side: "then" | "now"; onRead: () => void }) {
  const paper = side === "then" ? THEN_PAPER : NOW_PAPER;
  return (
    <button type="button" className={`${styles.paper} ${side === "then" ? styles.paperThen : styles.paperNow}`} onClick={onRead} data-testid={`paper-${side}`}>
      <span className={styles.paperHead}>
        {side === "then" ? "THEN" : "NOW"} · {paper.heading}
      </span>
      {paper.items.map(item => (
        <span key={item.when} className={styles.paperItem}>
          <span className={styles.paperWords}>“{item.words}”</span>
          <span className={styles.paperWho}>
            {item.who} · {item.when}
          </span>
        </span>
      ))}
    </button>
  );
}

function PaperSheet({ side, onClose }: { side: "then" | "now"; onClose: () => void }) {
  return (
    <div className={styles.scrim} role="dialog" aria-modal="true" aria-label={side === "then" ? "Then" : "Now"} onClick={onClose}>
      <div className={styles.sheet} onClick={event => event.stopPropagation()}>
        <Paper side={side} onRead={onClose} />
        <p className={styles.sheetNote}>{SAMPLE_LABEL}</p>
      </div>
    </div>
  );
}
