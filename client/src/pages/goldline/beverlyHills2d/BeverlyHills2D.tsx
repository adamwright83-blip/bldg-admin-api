import { useEffect, useRef, useState } from "react";
import {
  freshAdventure,
  restoreAdventure,
  CHAPTERS,
  hint,
  hop,
  interact,
  prompt,
  throwToy,
  tick,
  type Adventure,
} from "./adventure";
import { loadArt, paint, type Art } from "./paint";
import { createSound } from "./sound";
import { OutreachJournal } from "./OutreachJournal";
import styles from "./other-rodeo.module.css";
import { useDialogFocus } from "./useDialogFocus";
const SAVE = "joystick.other-rodeo.fiction.v1";
export default function BeverlyHills2D({ onExit }: { onExit: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const state = useRef<Adventure>(freshAdventure());
  const art = useRef<Art | null>(null);
  const keys = useRef(new Set<string>());
  const camera = useRef(0);
  const sound = useRef<ReturnType<typeof createSound> | null>(null);
  const [ready, setReady] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState("");
  const [started, setStarted] = useState(false),
    [paused, setPaused] = useState(false),
    [journal, setJournal] = useState(false),
    [music, setMusic] = useState(true),
    [showHint, setShowHint] = useState(false),
    [saved, setSaved] = useState(false);
  const [view, setView] = useState<Adventure>(state.current);
  const [restored, setRestored] = useState(0);
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const pauseDialog = useRef<HTMLElement>(null);
  useDialogFocus(pauseDialog, paused && !journal);
  const [chapterCard, setChapterCard] = useState(false);
  const lastChapter = useRef(state.current.chapter);
  const cardTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const playing = useRef(false);
  playing.current = started && !paused && !journal;
  const preferences = useRef({ reduced, restored });
  preferences.current = { reduced, restored };
  function persist() {
    try {
      localStorage.setItem(SAVE, JSON.stringify(state.current));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }
  function act(kind: "interact" | "throw" | "hop") {
    if (!playing.current) return;
    let did = false;
    if (kind === "interact") did = interact(state.current);
    else if (kind === "throw") did = throwToy(state.current);
    else hop(state.current);
    if (did) {
      sound.current?.cue();
      persist();
    }
    setView({ ...state.current });
  }
  const actions = useRef(act);
  actions.current = act;
  useEffect(() => {
    try {
      state.current = restoreAdventure(localStorage.getItem(SAVE));
      setSaved(Boolean(localStorage.getItem(SAVE)));
      setView({ ...state.current });
    } catch {
      /* private mode remains playable */
    }
    lastChapter.current = state.current.chapter;
    let alive = true;
    void loadArt(n => {
      if (alive) setProgress(n);
    }).then(
      a => {
        if (alive) {
          art.current = a;
          setReady(true);
        }
      },
      e => {
        if (alive) setError(String(e));
      }
    );
    return () => {
      alive = false;
      sound.current?.dispose();
      if (cardTimer.current) clearTimeout(cardTimer.current);
    };
  }, []);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) {
      setError("This browser could not open the painted canvas.");
      return;
    }
    let frame = 0,
      last = performance.now(),
      ui = 0,
      save = 0;
    function render(now: number) {
      if (!ctx || !c) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const s = state.current;
      const direction =
        (keys.current.has("ArrowRight") || keys.current.has("KeyD") ? 1 : 0) -
        (keys.current.has("ArrowLeft") || keys.current.has("KeyA") ? 1 : 0);
      if (playing.current) tick(s, dt, direction);
      const target = Math.max(
        0,
        Math.min(CHAPTERS[s.chapter].width - 1280, s.x - 480)
      );
      camera.current += (target - camera.current) * (1 - Math.exp(-dt * 6));
      if (s.chapter !== lastChapter.current) {
        lastChapter.current = s.chapter;
        camera.current = 0;
        setChapterCard(true);
        setShowHint(false);
        persist();
        if (cardTimer.current) clearTimeout(cardTimer.current);
        cardTimer.current = setTimeout(() => setChapterCard(false), 3200);
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(1280 * dpr),
        h = Math.round(800 * dpr);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (art.current)
        paint(
          ctx,
          art.current,
          s,
          camera.current,
          Boolean(direction) && playing.current,
          preferences.current.reduced,
          preferences.current.restored
        );
      ui += dt;
      save += dt;
      if (ui > 0.1) {
        setView({ ...s });
        ui = 0;
      }
      if (save > 4 && playing.current) {
        persist();
        save = 0;
      }
      frame = requestAnimationFrame(render);
    }
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches("input,textarea,select")) return;
      if (
        [
          "ArrowLeft",
          "ArrowRight",
          "Space",
          "KeyA",
          "KeyD",
          "KeyE",
          "KeyF",
          "Escape",
        ].includes(e.code)
      )
        e.preventDefault();
      if (e.code === "Escape") {
        setJournal(false);
        setPaused(p => !p);
        keys.current.clear();
        return;
      }
      if (
        (e.target as HTMLElement)?.matches("button") &&
        ["Space", "Enter"].includes(e.code)
      )
        return;
      if (!playing.current) return;
      keys.current.add(e.code);
      if (!e.repeat) {
        if (e.code === "KeyE") actions.current("interact");
        if (e.code === "KeyF") actions.current("throw");
        if (e.code === "Space") actions.current("hop");
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const blur = () => {
      keys.current.clear();
      setPaused(true);
    };
    const hidden = () => {
      if (document.hidden) blur();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  useEffect(() => {
    sound.current?.mute(!music || paused || journal);
  }, [music, paused, journal]);
  function begin() {
    if (!sound.current) sound.current = createSound();
    if (music) sound.current.start();
    setStarted(true);
    setPaused(false);
    root.current?.focus();
    setChapterCard(true);
    cardTimer.current = setTimeout(() => setChapterCard(false), 3200);
  }
  const p = prompt(view);
  const chapter = CHAPTERS[view.chapter];
  const touch = (code: string) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      keys.current.add(code);
    },
    onPointerUp: () => keys.current.delete(code),
    onPointerCancel: () => keys.current.delete(code),
    onLostPointerCapture: () => keys.current.delete(code),
  });
  return (
    <div
      ref={root}
      tabIndex={-1}
      className={styles.root}
      data-testid="beverly-hills-2d"
      data-chapter={view.chapter}
      data-gate={view.gate}
      data-water={view.water}
      data-tether={view.tether}
      data-item={view.item ?? "none"}
      data-player-x={Math.round(view.x)}
    >
      <div className={styles.stage}>
        <canvas
          ref={canvas}
          aria-label="The Other Rodeo. Move with A and D or arrow keys, Space to hop, E to investigate, F to throw."
        />
      </div>
      <header className={styles.hud}>
        <button
          className={styles.city}
          onClick={() => {
            persist();
            onExit();
          }}
        >
          ← <span>Lantern City</span>
        </button>
        <div className={styles.wordmark}>
          JOYSTICK <span>/</span> THE OTHER RODEO
        </div>
        <button onClick={() => setPaused(true)} aria-label="Pause adventure">
          Ⅱ
        </button>
      </header>
      {!ready || error ? (
        <div className={styles.titleShade}>
          <div className={styles.titleContent}>
            <div className={styles.eyebrow}>Lantern City · Beverly Hills</div>
            <h1>
              The Other
              <br />
              <i>Rodeo.</i>
            </h1>
            {error ? (
              <>
                <p role="alert">{error}</p>
                <button onClick={() => window.location.reload()}>
                  Try loading again
                </button>
              </>
            ) : (
              <>
                <p>Finding a little room between then and now…</p>
                <progress value={progress} max="1" />
              </>
            )}
          </div>
        </div>
      ) : !started ? (
        <div className={styles.titleShade}>
          <div className={styles.titleContent}>
            <div className={styles.eyebrow}>
              A Lantern City animal adventure
            </div>
            <h1>
              The Other
              <br />
              <i>Rodeo.</i>
            </h1>
            <p>
              Two dogs. One lost calf.
              <br />A city with room for another past.
            </p>
            <button className={styles.primary} onClick={begin}>
              {saved ? "Continue the afternoon" : "Follow your nose"}{" "}
              <span>→</span>
            </button>
            <small>Headphones welcome · Progress saved on this device</small>
          </div>
          <div className={styles.titleFoot}>
            BEVERLY HILLS <span>34.0736° N · 118.4004° W</span>
          </div>
        </div>
      ) : null}
      {started && ready && (
        <>
          <div className={styles.chapter}>
            <span>
              {String(Object.keys(CHAPTERS).indexOf(view.chapter) + 1).padStart(
                2,
                "0"
              )}{" "}
              / 04
            </span>
            <div>
              {chapter.place}
              <small>{chapter.title}</small>
            </div>
          </div>
          {chapterCard && (
            <div className={styles.chapterCard}>
              <span>{chapter.place}</span>
              <h2>{chapter.title}</h2>
            </div>
          )}
          {!paused && !journal && view.chapter !== "home" && (
            <>
              <div className={styles.actionDock}>
                {p && (
                  <button
                    className={styles.interact}
                    onClick={() => act("interact")}
                  >
                    <kbd>E</kbd>
                    {p.label}
                  </button>
                )}
                {view.item && (
                  <button
                    onClick={() => act("throw")}
                    disabled={view.item === "rope"}
                  >
                    <kbd>{view.item === "rope" ? "∞" : "F"}</kbd>
                    {view.item === "rope"
                      ? "Rope in your teeth"
                      : `Throw ${view.item}`}
                  </button>
                )}
              </div>
              <div className={styles.controls}>
                <span>← → Move</span>
                <span>Space Hop</span>
                <span>E Investigate</span>
                <span>F Throw</span>
                <button onClick={() => setShowHint(h => !h)}>
                  A little nudge?
                </button>
              </div>
              <div className={styles.touch}>
                <button aria-label="Move left" {...touch("ArrowLeft")}>
                  ←
                </button>
                <button aria-label="Move right" {...touch("ArrowRight")}>
                  →
                </button>
                <button onClick={() => act("hop")}>Hop</button>
              </div>
            </>
          )}
          {showHint && (
            <div className={styles.hint} role="status">
              {hint(view)}
              <button
                onClick={() => setShowHint(false)}
                aria-label="Close hint"
              >
                ×
              </button>
            </div>
          )}
          {view.chapter === "home" && !journal && !chapterCard && (
            <div className={styles.homeNote}>
              <div className={styles.eyebrow}>
                Some things are better together.
              </div>
              <h2>
                There was room
                <br />
                all along.
              </h2>
              <p>The afternoon can wait.</p>
              <button
                className={styles.primary}
                onClick={() => setJournal(true)}
              >
                Open Claire’s field notes ↗
              </button>
              {restored > 0 && (
                <small>
                  {restored} ranch plots restored by verified visits
                </small>
              )}
            </div>
          )}
          {paused && !journal && (
            <div className={styles.modalShade}>
              <section
                ref={pauseDialog}
                role="dialog"
                aria-modal="true"
                aria-label="Adventure paused"
                className={styles.pause}
              >
                <div className={styles.eyebrow}>Take your time</div>
                <h2>The afternoon waits.</h2>
                <button
                  className={styles.primary}
                  onClick={() => {
                    setPaused(false);
                    root.current?.focus();
                  }}
                >
                  Keep exploring →
                </button>
                <button
                  onClick={() => {
                    setMusic(m => !m);
                    if (!music) sound.current?.start();
                  }}
                  aria-pressed={music}
                >
                  Sound {music ? "on" : "off"}
                </button>
                <button
                  onClick={() => setReduced(r => !r)}
                  aria-pressed={reduced}
                >
                  Reduced motion {reduced ? "on" : "off"}
                </button>
                <button
                  onClick={() => {
                    state.current = freshAdventure();
                    camera.current = 0;
                    persist();
                    setPaused(false);
                    root.current?.focus();
                  }}
                >
                  Start a new afternoon
                </button>
                <small>
                  Restart replaces only this device’s fictional adventure.
                  Outreach reports stay in the journal.
                </small>
                <button
                  onClick={() => {
                    persist();
                    onExit();
                  }}
                >
                  Return to Lantern City
                </button>
              </section>
            </div>
          )}
        </>
      )}
      {journal && (
        <OutreachJournal
          onClose={() => {
            setJournal(false);
            root.current?.focus();
          }}
          onRestored={setRestored}
        />
      )}
    </div>
  );
}
