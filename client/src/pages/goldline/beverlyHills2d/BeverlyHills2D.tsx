import { useEffect, useRef, useState } from "react";
import { freshAdventure, restoreAdventure, CHAPTERS, hop, interact, prompt, throwToy, tick, VIEW, WIDTH, type Adventure } from "./adventure";
import { H, loadArt, paint, type Art } from "./paint";
import { createSound } from "./sound";
import { OutreachJournal } from "./OutreachJournal";
import { HerdRound } from "./HerdRound";
import styles from "./other-rodeo.module.css";
import { useDialogFocus } from "./useDialogFocus";
const SAVE = "joystick.other-rodeo.fiction.v2";
export default function BeverlyHills2D({ onExit }: { onExit: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const state = useRef<Adventure>(freshAdventure());
  const art = useRef<Art | null>(null);
  const keys = useRef(new Set<string>());
  const camera = useRef(0);
  const snapshot = useRef<HTMLCanvasElement | null>(null);
  const lastTear = useRef<number>(-1);
  const sound = useRef<ReturnType<typeof createSound> | null>(null);
  const [ready, setReady] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState("");
  const [started, setStarted] = useState(false),
    [paused, setPaused] = useState(false),
    [journal, setJournal] = useState(false),
    [music, setMusic] = useState(true),
    [saved, setSaved] = useState(false);
  const [view, setView] = useState<Adventure>(state.current);
  const [restored, setRestored] = useState(0);
  const [roundUp, setRoundUp] = useState(false);
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
  playing.current = started && !paused && !journal && !roundUp;
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
      const dx =
        (keys.current.has("ArrowRight") || keys.current.has("KeyD") ? 1 : 0) -
        (keys.current.has("ArrowLeft") || keys.current.has("KeyA") ? 1 : 0);
      const dy =
        (keys.current.has("ArrowDown") || keys.current.has("KeyS") ? 1 : 0) -
        (keys.current.has("ArrowUp") || keys.current.has("KeyW") ? 1 : 0);
      // the scene is about to be torn away: keep its last picture for the tear
      if (s.chapter !== lastChapter.current) {
        if (!snapshot.current) {
          snapshot.current = document.createElement("canvas");
          snapshot.current.width = VIEW;
          snapshot.current.height = H;
        }
        snapshot.current.getContext("2d")!.drawImage(c, 0, 0, VIEW, H);
        lastChapter.current = s.chapter;
        camera.current = 0;
        setChapterCard(true);
        persist();
        if (cardTimer.current) clearTimeout(cardTimer.current);
        cardTimer.current = setTimeout(() => setChapterCard(false), 2800);
      }
      if (playing.current) tick(s, dt, { dx, dy });
      const target = Math.max(0, Math.min(WIDTH - VIEW, s.player.x - 560));
      camera.current += (target - camera.current) * (1 - Math.exp(-dt * 5));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(VIEW * dpr),
        h = Math.round(H * dpr);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (art.current)
        paint(ctx, art.current, s, {
          cam: camera.current,
          moving: Boolean(dx || dy) && playing.current,
          reduced: preferences.current.reduced,
          restored: preferences.current.restored,
          snapshot: s.tear ? snapshot.current : null,
        });
      void lastTear;
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
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "KeyA", "KeyD", "KeyW", "KeyS", "KeyE", "KeyF", "Escape"].includes(e.code)
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
    cardTimer.current = setTimeout(() => setChapterCard(false), 2800);
  }
  const p = prompt(view);
  const chapter = CHAPTERS[view.chapter];
  const item = view.player.item;
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
      data-stairs={view.flags.stairs}
      data-gate={view.flags.gate}
      data-water={view.flags.water}
      data-tether={view.flags.tether}
      data-rescued={view.flags.rescued}
      data-item={item ?? "none"}
      data-boxer={view.boxer.state}
      data-player-x={Math.round(view.player.x)}
      data-boxer-x={Math.round(view.boxer.x)}
    >
      <div className={styles.stage}>
        <canvas
          ref={canvas}
          aria-label="The Other Rodeo. Walk with the arrow keys or WASD (up and down walk deeper into the picture), Space to hop, E to act, F to throw what you carry."
        />
      </div>
      <header className={styles.hud}>
        <button
          className={styles.city}
          aria-label="Return to Lantern City"
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
            <div className={styles.titleButtons}>
              <button
                className={styles.primary}
                onClick={() => {
                  begin();
                  setRoundUp(true);
                }}
                data-testid="start-round-up"
              >
                Round up the herd <span>→</span>
              </button>
              <button onClick={begin}>
                {saved ? "Continue the afternoon" : "Follow your nose"}
              </button>
            </div>
            <small>Headphones welcome · Progress saved on this device</small>
          </div>
          <div className={styles.titleFoot}>
            BEVERLY HILLS <span>34.0736° N · 118.4004° W</span>
          </div>
        </div>
      ) : null}
      {started && ready && !roundUp && (
        <>
          <div className={styles.chapter}>
            <div>{chapter.place}</div>
          </div>
          {chapterCard && (
            <div className={styles.chapterCard}>
              <span>{chapter.place}</span>
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
                {item && item !== "rope" && (
                  <button onClick={() => act("throw")}>
                    <kbd>F</kbd>
                    Throw the {item}
                  </button>
                )}
              </div>
              <div className={styles.controls}>
                <span>← → ↑ ↓ Walk</span>
                <span>Space Hop</span>
                <span>E Act</span>
                <span>F Throw</span>
              </div>
              <div className={styles.touch}>
                <button aria-label="Walk left" {...touch("ArrowLeft")}>
                  ←
                </button>
                <button aria-label="Walk deeper" {...touch("ArrowUp")}>
                  ↑
                </button>
                <button aria-label="Walk nearer" {...touch("ArrowDown")}>
                  ↓
                </button>
                <button aria-label="Walk right" {...touch("ArrowRight")}>
                  →
                </button>
                <button onClick={() => act("hop")}>Hop</button>
              </div>
            </>
          )}
          {view.chapter === "home" && !journal && !chapterCard && !view.tear && (
            <div className={styles.homeNote}>
              <button className={styles.primary} onClick={() => setRoundUp(true)}>
                Round up the herd →
              </button>
              <button onClick={() => setJournal(true)}>
                Open Claire’s field notes ↗
              </button>
              {restored > 0 && (
                <small>
                  {restored} ranch plots restored by new customers at buildings you visited
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
      {roundUp && ready && art.current ? (
        <HerdRound
          art={art.current}
          extraCows={restored}
          reduced={reduced}
          sound={music}
          onExit={() => {
            setRoundUp(false);
            root.current?.focus();
          }}
        />
      ) : null}
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
