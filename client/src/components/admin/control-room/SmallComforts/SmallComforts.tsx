import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Game } from "./game/game";
import { Sound } from "./game/audio";
import { SMALL_COMFORTS_MARKUP } from "./markup";
import { ChapterStageCanvas } from "./ChapterStageCanvas";
import {
  CHAPTER_CARDS,
  SCRAP_COURSES,
  completeChapter4Finale,
  createInitialStoryState,
  dismissChapterCard,
  getChapterCard,
  selectChapter,
  selectMouse,
  stepChapter1,
  stepChapter2,
  stepChapter3,
  stepChapter4,
  type ChapterId,
  type MouseActorId,
  type SmallComfortsStoryState,
} from "./logic/chapters";
import "./smallComforts.css";
import "./smallComfortsPlate.css";

type Ripple = { id: number; x: number; y: number };

const STORAGE_KEY = "sc.chapters_v4";

function loadSavedCompletedChapters(): ChapterId[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { completed?: number[] };
    if (!Array.isArray(parsed.completed)) return [];
    return parsed.completed.filter((n): n is ChapterId => n === 1 || n === 2 || n === 3 || n === 4);
  } catch {
    return [];
  }
}

function saveCompletedChapters(completed: readonly ChapterId[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ completed }));
  } catch {
    /* ignore private mode */
  }
}

const MOUSE_BADGES: readonly {
  id: MouseActorId;
  name: string;
  role: string;
  accent: string;
}[] = [
  { id: "pip", name: "Pip", role: "Crutch · Tight Spaces", accent: "#86bf7e" },
  { id: "biscuit", name: "Biscuit", role: "Chef Hat · Heavy Weight", accent: "#e8b94c" },
  { id: "conductor", name: "Conductor", role: "Umbrella · Cord Grip", accent: "#7fa6d6" },
] as const;

/**
 * Small Comforts — Chapters 1–4 Unified Experience
 *
 * Combines the warm painted tin-can interior plate (`/assets/joystick-home/tin-can-house.webp`),
 * authored Chapter I–IV cards, cartoon human cutout performance, tactile mouse slapstick,
 * procedural WebAudio (including the free singing glass-shard a cappella chorus in Chapter 4),
 * and the optional 3D suitcase workshop Drawer.
 */
export default function SmallComforts({ onExit }: { onExit: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const soundRef = useRef<Sound | null>(null);
  const threeHostRef = useRef<HTMLDivElement>(null);
  const threeGameRef = useRef<Game | null>(null);

  const [ripple, setRipple] = useState<Ripple | null>(null);
  const [story, setStory] = useState<SmallComfortsStoryState>(() => {
    const init = createInitialStoryState(1);
    init.completedChapters = loadSavedCompletedChapters();
    return init;
  });
  const [slingDraft, setSlingDraft] = useState(0.82);
  const [studio3DOpen, setStudio3DOpen] = useState(false);
  const [muted, setMuted] = useState(false);

  // Drain procedural sound queue on every state transition
  useEffect(() => {
    if (!story.soundQueue.length) return;
    if (!soundRef.current) soundRef.current = new Sound();
    soundRef.current.setMuted(muted);
    for (const cue of story.soundQueue) {
      soundRef.current.playCue(cue);
    }
    setStory(prev => (prev.soundQueue.length ? { ...prev, soundQueue: [] } : prev));
  }, [story.soundQueue, muted]);

  // Persist completed chapters
  useEffect(() => {
    saveCompletedChapters(story.completedChapters);
  }, [story.completedChapters]);

  // Dispose WebAudio and optional 3D suitcase on unmount
  useEffect(() => {
    return () => {
      threeGameRef.current?.dispose();
      threeGameRef.current = null;
      soundRef.current?.dispose();
      soundRef.current = null;
    };
  }, []);

  // Mount/unmount the 3D Suitcase Workshop when toggled
  useEffect(() => {
    const host = threeHostRef.current;
    if (!studio3DOpen || !host) {
      threeGameRef.current?.dispose();
      threeGameRef.current = null;
      return;
    }
    host.innerHTML = SMALL_COMFORTS_MARKUP;
    const canvasHost = host.querySelector<HTMLElement>("#app") ?? host;
    const game = new Game(canvasHost, host, {
      autoStart: true,
      onExit: () => setStudio3DOpen(false),
    });
    threeGameRef.current = game;
    return () => {
      game.dispose();
      threeGameRef.current = null;
    };
  }, [studio3DOpen]);

  // Parallax look on the painted tin-can interior plate
  useEffect(() => {
    const el = root.current;
    if (!el) return;

    const setLook = (x: number, y: number) => {
      el.style.setProperty("--sc-look-x", `${x.toFixed(2)}px`);
      el.style.setProperty("--sc-look-y", `${y.toFixed(2)}px`);
      el.style.setProperty("--sc-tilt-x", `${(-y / 28).toFixed(2)}deg`);
      el.style.setProperty("--sc-tilt-y", `${(x / 28).toFixed(2)}deg`);
    };

    const pointerMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const nx = ((event.clientX - rect.left) / Math.max(rect.width, 1) - 0.5) * 2;
      const ny = ((event.clientY - rect.top) / Math.max(rect.height, 1) - 0.5) * 2;
      setLook(nx * 14, ny * 10);
    };
    const pointerLeave = () => setLook(0, 0);
    const orientation = (event: DeviceOrientationEvent) => {
      if (event.gamma == null || event.beta == null) return;
      setLook(
        Math.max(-14, Math.min(14, event.gamma * 0.45)),
        Math.max(-10, Math.min(10, (event.beta - 45) * 0.22)),
      );
    };

    el.addEventListener("pointermove", pointerMove, { passive: true });
    el.addEventListener("pointerleave", pointerLeave, { passive: true });
    window.addEventListener("deviceorientation", orientation, { passive: true });

    return () => {
      el.removeEventListener("pointermove", pointerMove);
      el.removeEventListener("pointerleave", pointerLeave);
      window.removeEventListener("deviceorientation", orientation);
    };
  }, []);

  // Live rhythm tickers for Chapter 2 (sleep stir), Chapter 3 (in-breath), and Chapter 4 (Heimlich sync)
  useEffect(() => {
    if (story.showingChapterCard || studio3DOpen) return;
    const timer = window.setInterval(() => {
      setStory(prev => {
        if (prev.showingChapterCard) return prev;
        if (prev.activeChapter === 2 && prev.ch2.step === "beard_shave") {
          return stepChapter2(prev, { type: "advance_sleep_timer", dtSec: 0.15 });
        }
        if (prev.activeChapter === 3 && prev.ch3.step === "wait_for_inhale") {
          return stepChapter3(prev, { type: "advance_breath", dtSec: 0.15 });
        }
        if (prev.activeChapter === 4 && prev.ch4.beat === "6_one_armed_heimlich_sync") {
          return stepChapter4(prev, { type: "tick_compression", dtSec: 0.08 });
        }
        return prev;
      });
    }, 150);
    return () => window.clearInterval(timer);
  }, [story.activeChapter, story.showingChapterCard, studio3DOpen]);

  const makeRipple = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setRipple({
      id: Date.now(),
      x: ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100,
      y: ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100,
    });
  };

  const card = getChapterCard(story.activeChapter);

  const handleBeardPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0 && e.type !== "pointerdown") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / Math.max(rect.width, 1);
    const y = (e.clientY - rect.top) / Math.max(rect.height, 1);
    setStory(prev => stepChapter2(prev, { type: "shave_stroke", x, y }));
  };

  // Direct spatial tap/drag on the live 2.5D stage canvas
  const handleStageTap = (nx: number, ny: number) => {
    setStory(prev => {
      if (prev.showingChapterCard) return prev;
      if (prev.activeChapter === 1) {
        if (prev.ch1.step === "free_biscuit") {
          return stepChapter1(prev, { type: "pull_zipper_tooth" });
        }
        if (prev.ch1.step === "place_bottle_cap") {
          return stepChapter1(prev, { type: "place_bottle_cap" });
        }
        if (prev.ch1.step === "aim_shoelace_sling") {
          return stepChapter1(prev, { type: "fire_shoelace_sling", tension: slingDraft });
        }
        if (prev.ch1.step === "stack_eggshell_stairs") {
          return stepChapter1(prev, { type: "stack_eggshell" });
        }
        if (prev.ch1.step === "whoopee_launchpad") {
          if (!prev.ch1.whoopeePlaced) {
            return stepChapter1(prev, { type: "place_whoopee_cushion" });
          }
          return stepChapter1(prev, { type: "biscuit_cannonball" });
        }
        if (prev.ch1.step === "toaster_finale") {
          return stepChapter1(prev, { type: "pull_toaster_lever" });
        }
        if (prev.ch1.step === "complete") {
          return selectChapter(prev, 2);
        }
      }
      if (prev.activeChapter === 2) {
        if (prev.ch2.step === "this_is_a_sign_wake") {
          return stepChapter2(prev, { type: "speak_this_is_a_sign" });
        }
        if (prev.ch2.step === "phone_pinball") {
          const target = nx < 0.36 ? "accept" : nx < 0.66 ? "voicemail" : "speaker";
          return stepChapter2(prev, { type: "hit_pinball_bumper", target });
        }
        if (prev.ch2.step === "complete") {
          return selectChapter(prev, 3);
        }
      }
      if (prev.activeChapter === 3) {
        if (prev.ch3.step === "load_spoon") {
          return stepChapter3(prev, { type: "load_scrap_spoon" });
        }
        if (prev.ch3.step === "wait_for_inhale") {
          return stepChapter3(prev, { type: "launch_spoon" });
        }
        if (prev.ch3.step === "choking_onset") {
          return stepChapter3(prev, { type: "transition_to_chapter_4" });
        }
      }
      if (prev.activeChapter === 4) {
        if (
          prev.ch4.beat !== "6_one_armed_heimlich_sync" &&
          prev.ch4.beat !== "7_triumphant_expulsion" &&
          prev.ch4.beat !== "complete"
        ) {
          return stepChapter4(prev, { type: "advance_intro_beat" });
        }
        if (prev.ch4.beat === "6_one_armed_heimlich_sync") {
          return stepChapter4(prev, { type: "mouse_jump" });
        }
        if (prev.ch4.beat === "7_triumphant_expulsion") {
          return completeChapter4Finale(prev);
        }
        if (prev.ch4.beat === "complete") {
          return selectChapter(prev, 1);
        }
      }
      void ny;
      return prev;
    });
  };

  const handleStageDrag = (nx: number, ny: number, isDown: boolean) => {
    if (!isDown) return;
    if (story.activeChapter === 2 && story.ch2.step === "beard_shave") {
      const bx = Math.max(0, Math.min(1, (nx - 0.25) / 0.5));
      const by = Math.max(0, Math.min(1, (ny - 0.42) / 0.28));
      setStory(prev => stepChapter2(prev, { type: "shave_stroke", x: bx, y: by }));
    }
  };

  return (
    <div
      ref={root}
      className="scp-root"
      data-small-comforts="plate"
      data-active-chapter={story.activeChapter}
      onPointerDown={makeRipple}
    >
      <div className="scp-world" aria-label="Small Comforts">
        <div className="scp-backdrop" />
        <img
          className="scp-house"
          src="/assets/joystick-home/tin-can-house.webp"
          alt="Small Comforts, a warm tiny home built inside a weathered found-object tin"
          draggable={false}
        />

        <div className="scp-glow scp-glow-left" />
        <div className="scp-glow scp-glow-right" />
        <div className="scp-window-shimmer" />

        <div className="scp-rain scp-rain-far" aria-hidden="true" />
        <div className="scp-rain scp-rain-near" aria-hidden="true" />

        <div className="scp-steam" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>

        <div className="scp-puddle" aria-hidden="true" />
        {ripple ? (
          <span
            key={ripple.id}
            className="scp-ripple"
            style={{ left: `${ripple.x}%`, top: `${ripple.y}%` }}
            onAnimationEnd={() => setRipple(null)}
            aria-hidden="true"
          />
        ) : null}
      </div>

      {/* Live 2.5D Illustrated Cutout & Mouse Slapstick Stage Canvas */}
      {!studio3DOpen && !story.showingChapterCard ? (
        <ChapterStageCanvas
          story={story}
          slingDraft={slingDraft}
          onCanvasTap={handleStageTap}
          onCanvasDrag={handleStageDrag}
        />
      ) : null}

      {/* Primary Lantern City exit button (kept as the only <button> so plate.getByRole("button") in smoke tests resolves unambiguously) */}
      <button type="button" className="scp-exit" onClick={onExit}>
        <span aria-hidden="true">←</span>
        Lantern City
      </button>

      {/* Top Chapter Selector & Controls Bar */}
      <nav className="scp-chapter-rail" aria-label="Small Comforts Chapters" data-sc-interactive="true">
        {CHAPTER_CARDS.map(ch => {
          const isCurrent = story.activeChapter === ch.id;
          const isDone = story.completedChapters.includes(ch.id);
          return (
            <div
              key={ch.id}
              tabIndex={0}
              data-testid={`sc-chapter-tab-${ch.id}`}
              className={`scp-chapter-pill${isCurrent ? " is-active" : ""}${isDone ? " is-done" : ""}`}
              onClick={() => setStory(prev => selectChapter(prev, ch.id))}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") setStory(prev => selectChapter(prev, ch.id));
              }}
            >
              <span className="scp-pill-num">Ch. {ch.roman}</span>
              <span className="scp-pill-title">{ch.title}</span>
              {isDone ? <span className="scp-pill-star" aria-label="Completed">★</span> : null}
            </div>
          );
        })}
        <div
          tabIndex={0}
          className="scp-mode-btn"
          data-testid="sc-toggle-mute"
          onClick={() => setMuted(m => !m)}
          aria-label={muted ? "Unmute sound" : "Mute sound"}
        >
          {muted ? "🔇" : "🔊"}
        </div>
        <div
          tabIndex={0}
          className="scp-mode-btn"
          data-testid="sc-toggle-3d-suitcase"
          onClick={() => setStudio3DOpen(v => !v)}
        >
          {studio3DOpen ? "← Tin Interior" : "🧳 3D Suitcase"}
        </div>
      </nav>

      {/* Optional 3D Suitcase Workshop Overlay */}
      {studio3DOpen ? (
        <div
          ref={threeHostRef}
          className="sc-root"
          data-testid="sc-3d-workshop"
          data-sc-interactive="true"
        />
      ) : null}

      {/* Authored Chapter Card Modal */}
      {!studio3DOpen && story.showingChapterCard ? (
        <section
          className="scp-chapter-card-modal"
          aria-label={`${card.label}: ${card.title}`}
          data-testid={`sc-chapter-card-${card.id}`}
          data-sc-interactive="true"
        >
          <div className="scp-card-paper">
            <div className="scp-card-eyebrow">SMALL COMFORTS · {card.label.toUpperCase()}</div>
            <h1 className="scp-card-title">{card.title}</h1>
            <ul className="scp-card-premises">
              {card.premises.map((line, idx) => (
                <li key={idx}>{line}</li>
              ))}
            </ul>
            <p className="scp-card-sub">{card.subtitle}</p>
            <div className="scp-card-actions">
              <div
                tabIndex={0}
                className="scp-btn-primary"
                data-testid={`sc-begin-chapter-${card.id}`}
                onClick={() => setStory(prev => dismissChapterCard(prev))}
                onKeyDown={e => {
                  if (e.key === "Enter" || e.key === " ") setStory(prev => dismissChapterCard(prev));
                }}
              >
                Open {card.label} →
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Live Interactive Stage for Chapters 1–4 */}
      {!studio3DOpen && !story.showingChapterCard ? (
        <main
          className="scp-stage-overlay"
          data-testid={`sc-stage-chapter-${story.activeChapter}`}
          data-sc-interactive="true"
        >
          {/* Mouse Trio Switcher */}
          <div className="scp-mice-bar" role="group" aria-label="Choose active mouse">
            {MOUSE_BADGES.map(m => (
              <div
                key={m.id}
                tabIndex={0}
                data-testid={`sc-mouse-${m.id}`}
                className={`scp-mouse-chip${story.activeMouse === m.id ? " is-selected" : ""}`}
                style={{ "--mouse-accent": m.accent } as React.CSSProperties}
                onClick={() => setStory(prev => selectMouse(prev, m.id))}
              >
                <b>{m.name}</b>
                <small>{m.role}</small>
              </div>
            ))}
          </div>

          {/* Slapstick Pratfall Banner (Wrong Branches = 3s+ physical comedy, never a fail screen) */}
          {story.pratfall ? (
            <div className="scp-pratfall-card" role="status" data-testid="sc-pratfall-banner">
              <div className="scp-pratfall-tag">COMIC PRATFALL · NO FAIL STATE</div>
              <strong>{story.pratfall.headline}</strong>
              <p>{story.pratfall.caption}</p>
            </div>
          ) : null}

          {/* ==============================================================
              CHAPTER 1: BREAKFAST IN BED
             ============================================================== */}
          {story.activeChapter === 1 ? (
            <section className="scp-scene-panel" aria-label="Chapter One: Breakfast in Bed">
              <div className="scp-diorama-row">
                <div className="scp-prop-badge">
                  <span className="scp-prop-icon">🥚</span>
                  <div>
                    <b>His Lunch (Top of Tin)</b>
                    <small>
                      {story.ch1.eggCrackedInCap
                        ? "Cracked into the bottle-cap pan!"
                        : "Sitting high on the tin lid out of reach."}
                    </small>
                  </div>
                </div>
                <div className="scp-prop-badge">
                  <span className="scp-prop-icon">🛏️</span>
                  <div>
                    <b>Pip’s Shelf Bed</b>
                    <small>
                      {story.ch1.pipInShelfBed
                        ? "Pip is tucked in with warm egg breakfast!"
                        : "Way up on the high shelf—crutch can’t reach."}
                    </small>
                  </div>
                </div>
              </div>

              {/* Step-by-step physical gag controls */}
              <div className="scp-action-deck">
                {story.ch1.step === "free_biscuit" ? (
                  <>
                    <div
                      tabIndex={0}
                      className="scp-btn-action"
                      data-testid="sc-ch1-zipper-tooth"
                      onClick={() => setStory(prev => stepChapter1(prev, { type: "pull_zipper_tooth" }))}
                    >
                      🤐 Tug Stuck Zipper Tooth ({story.ch1.zipperTeethFreed}/5) · Free Biscuit!
                    </div>
                    <div
                      tabIndex={0}
                      className="scp-btn-gag"
                      data-testid="sc-ch1-wrong-pip-cap"
                      onClick={() => setStory(prev => stepChapter1(prev, { type: "wrong_pip_lifts_cap" }))}
                    >
                      🐢 Have Pip Lift Heavy Bottle Cap Solo
                    </div>
                  </>
                ) : null}

                {story.ch1.step === "place_bottle_cap" ? (
                  <>
                    <div
                      tabIndex={0}
                      className="scp-btn-action"
                      data-testid="sc-ch1-place-cap"
                      onClick={() => setStory(prev => stepChapter1(prev, { type: "place_bottle_cap" }))}
                    >
                      🍾 Slide Brass Bottle Cap Under Zipper Track
                    </div>
                    <div
                      tabIndex={0}
                      className="scp-btn-gag"
                      data-testid="sc-ch1-wrong-biscuit-sling"
                      onClick={() =>
                        setStory(prev => stepChapter1(prev, { type: "wrong_biscuit_climbs_shoelace" }))
                      }
                    >
                      🧶 Send Heavy Biscuit Up the Shoelace
                    </div>
                  </>
                ) : null}

                {story.ch1.step === "aim_shoelace_sling" ? (
                  <div className="scp-sling-box">
                    <label className="scp-slider-label" htmlFor="sc-sling-slider">
                      <span>Conductor’s Shoelace Sling Arc: <b>{Math.round(slingDraft * 100)}%</b></span>
                      <small>(Gold sweet spot: 70%–92%)</small>
                    </label>
                    <input
                      id="sc-sling-slider"
                      data-testid="sc-ch1-sling-slider"
                      type="range"
                      min={0.2}
                      max={1.0}
                      step={0.02}
                      value={slingDraft}
                      onChange={e => setSlingDraft(Number(e.target.value))}
                    />
                    <div className="scp-row-buttons">
                      <div
                        tabIndex={0}
                        className="scp-btn-action"
                        data-testid="sc-ch1-fire-sling"
                        onClick={() =>
                          setStory(prev =>
                            stepChapter1(prev, { type: "fire_shoelace_sling", tension: slingDraft }),
                          )
                        }
                      >
                        🥾 Launch Conductor’s Backflip Kick!
                      </div>
                      <div
                        tabIndex={0}
                        className="scp-btn-gag"
                        data-testid="sc-ch1-underpull-gag"
                        onClick={() =>
                          setStory(prev =>
                            stepChapter1(prev, { type: "fire_shoelace_sling", tension: 0.35 }),
                          )
                        }
                      >
                        🤪 Under-Pull (Belly-Flop Tin)
                      </div>
                    </div>
                  </div>
                ) : null}

                {story.ch1.step === "stack_eggshell_stairs" ? (
                  <div
                    tabIndex={0}
                    className="scp-btn-action"
                    data-testid="sc-ch1-stack-shell"
                    onClick={() => setStory(prev => stepChapter1(prev, { type: "stack_eggshell" }))}
                  >
                    🥚 Stack Eggshell Staircase for Pip ({story.ch1.shellStairsStacked}/3)
                  </div>
                ) : null}

                {story.ch1.step === "whoopee_launchpad" ? (
                  <div className="scp-row-buttons">
                    {!story.ch1.whoopeePlaced ? (
                      <div
                        tabIndex={0}
                        className="scp-btn-action"
                        data-testid="sc-ch1-place-whoopee"
                        onClick={() =>
                          setStory(prev => stepChapter1(prev, { type: "place_whoopee_cushion" }))
                        }
                      >
                        🎈 Drag Red Whoopee Cushion Under Shelf
                      </div>
                    ) : null}
                    <div
                      tabIndex={0}
                      className="scp-btn-action"
                      data-testid="sc-ch1-biscuit-cannonball"
                      onClick={() =>
                        setStory(prev => stepChapter1(prev, { type: "biscuit_cannonball" }))
                      }
                    >
                      💨 Biscuit Cannonball → Launch Pip into Bed!
                    </div>
                  </div>
                ) : null}

                {story.ch1.step === "toaster_finale" ? (
                  <div
                    tabIndex={0}
                    className="scp-btn-action"
                    data-testid="sc-ch1-pull-toaster"
                    onClick={() => setStory(prev => stepChapter1(prev, { type: "pull_toaster_lever" }))}
                  >
                    🍞 Pull Chrome Toaster Lever (Smoke Alarm & Neighbour Reveal!)
                  </div>
                ) : null}

                {story.ch1.step === "complete" ? (
                  <div className="scp-complete-box" data-testid="sc-ch1-complete">
                    <b>Chapter One Complete!</b>
                    <span>
                      Pip is eating his omelette in his shelf bed, and the man just met his cast-armed
                      Neighbour in the hallway.
                    </span>
                    <div
                      tabIndex={0}
                      className="scp-btn-primary"
                      data-testid="sc-ch1-next-chapter"
                      onClick={() => setStory(prev => selectChapter(prev, 2))}
                    >
                      Continue to Chapter Two: “This Is a Sign” →
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {/* ==============================================================
              CHAPTER 2: THIS IS A SIGN
             ============================================================== */}
          {story.activeChapter === 2 ? (
            <section className="scp-scene-panel" aria-label="Chapter Two: This Is a Sign">
              <div className="scp-cutout-man-card">
                <div className="scp-cutout-header">
                  <span className="scp-cutout-badge">CARTOON CUTOUT PERFORMANCE</span>
                  <span
                    className={`scp-stir-pill scp-stir-${story.ch2.sleepPhase}`}
                    data-testid="sc-ch2-sleep-phase"
                  >
                    {story.ch2.sleepPhase === "deep_sleep"
                      ? "😴 Deep Sleep — SAFE TO TRIM"
                      : story.ch2.sleepPhase === "twitch_warning"
                        ? "👃 Pip Warning: Nostril Twitching!"
                        : "😳 STIRRING! Hands Off Clippers!"}
                  </span>
                </div>

                {/* Interactive Procedural Beard Canvas */}
                <div
                  className="scp-beard-board"
                  data-testid="sc-ch2-beard-board"
                  onPointerDown={handleBeardPointer}
                  onPointerMove={handleBeardPointer}
                  role="application"
                  aria-label="Sleeping man's beard trimmer canvas"
                >
                  <div className="scp-cutout-face-top">
                    <span className="scp-nose-lookout">🐭 Pip on Nose Lookout</span>
                    {story.ch2.wokeLineSpoken ? (
                      <blockquote className="scp-sign-quote" data-testid="sc-ch2-sign-quote">
                        “…this is a sign.”
                      </blockquote>
                    ) : null}
                  </div>
                  <div className="scp-beard-grid">
                    {story.ch2.beardMask.map((hasHair, idx) => (
                      <span
                        key={idx}
                        className={`scp-beard-tuft${hasHair ? " is-woolly" : " is-shaved"}`}
                      />
                    ))}
                  </div>
                </div>

                <div className="scp-action-deck">
                  {story.ch2.step === "beard_shave" ? (
                    <div className="scp-row-buttons">
                      <div
                        tabIndex={0}
                        className="scp-btn-action"
                        data-testid="sc-ch2-carve-pass"
                        onClick={() =>
                          setStory(prev => {
                            let s = prev;
                            const pts = [
                              [0.15, 0.25],
                              [0.35, 0.3],
                              [0.55, 0.35],
                              [0.75, 0.4],
                              [0.25, 0.65],
                              [0.5, 0.68],
                              [0.75, 0.7],
                            ] as const;
                            for (const [x, y] of pts) {
                              s = stepChapter2(s, { type: "shave_stroke", x, y });
                            }
                            return s;
                          })
                        }
                      >
                        🪒 Drive Clippers Across Beard ({Math.round(story.ch2.shavedRatio * 100)}% shaved)
                      </div>
                      <div
                        tabIndex={0}
                        className="scp-btn-gag"
                        data-testid="sc-ch2-wrong-dust-bunny"
                        onClick={() =>
                          setStory(prev => stepChapter2(prev, { type: "wrong_biscuit_dust_bunny" }))
                        }
                      >
                        🤠 Biscuit Unsteered Clipper Rodeo
                      </div>
                    </div>
                  ) : null}

                  {story.ch2.step === "this_is_a_sign_wake" ? (
                    <div
                      tabIndex={0}
                      className="scp-btn-action"
                      data-testid="sc-ch2-wake-mirror"
                      onClick={() =>
                        setStory(prev => stepChapter2(prev, { type: "speak_this_is_a_sign" }))
                      }
                    >
                      🪞 Tilt Shaving Mirror → He Wakes (“…this is a sign.”)
                    </div>
                  ) : null}

                  {story.ch2.step === "phone_pinball" ? (
                    <div className="scp-row-buttons" data-testid="sc-ch2-pinball">
                      {(["accept", "voicemail", "speaker"] as const).map(target => (
                        <div
                          key={target}
                          tabIndex={0}
                          className={`scp-btn-action${story.ch2.pinballHits.includes(target) ? " is-hit" : ""}`}
                          data-testid={`sc-ch2-bumper-${target}`}
                          onClick={() =>
                            setStory(prev =>
                              stepChapter2(prev, { type: "hit_pinball_bumper", target }),
                            )
                          }
                        >
                          📱 Bounce Phone Bumper: {target.toUpperCase()}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {story.ch2.step === "complete" ? (
                    <div className="scp-complete-box" data-testid="sc-ch2-complete">
                      <b>Chapter Two Complete!</b>
                      <span>
                        “Daddy… you have a MOUSE?!” Now the mice feel guilty they still owe him dinner.
                      </span>
                      <div
                        tabIndex={0}
                        className="scp-btn-primary"
                        data-testid="sc-ch2-next-chapter"
                        onClick={() => setStory(prev => selectChapter(prev, 3))}
                      >
                        Continue to Chapter Three: “Leftovers” →
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {/* ==============================================================
              CHAPTER 3: LEFTOVERS
             ============================================================== */}
          {story.activeChapter === 3 ? (
            <section className="scp-scene-panel" aria-label="Chapter Three: Leftovers">
              <div className="scp-breath-stage">
                <div className="scp-breath-meter" data-testid="sc-ch3-breath-phase">
                  <div className="scp-breath-header">
                    <b>SLEEPING MAN’S BREATH RHYTHM</b>
                    <span className={`scp-breath-badge is-${story.ch3.breathPhase}`}>
                      {story.ch3.breathPhase === "inhale_open" || story.ch3.breathPhase === "peak_hold"
                        ? "🌬️ IN-BREATH OPEN — FIRE SPOON NOW!"
                        : "💤 EXHALE SNORE — DO NOT FIRE!"}
                    </span>
                  </div>
                  <div className="scp-mouth-bar">
                    <div
                      className="scp-mouth-fill"
                      style={{ width: `${Math.round(story.ch3.mouthOpenness * 100)}%` }}
                    />
                  </div>
                  <div className="scp-courses-row">
                    {SCRAP_COURSES.map((course, idx) => {
                      const fed = story.ch3.coursesFed.includes(course.id);
                      const current = idx === story.ch3.courseIndex && !fed;
                      return (
                        <div
                          key={course.id}
                          className={`scp-course-card${fed ? " is-fed" : ""}${current ? " is-current" : ""}`}
                        >
                          <b>
                            {idx + 1}. {course.label}
                          </b>
                          <small>{course.description}</small>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="scp-action-deck">
                  {story.ch3.step === "load_spoon" ? (
                    <div
                      tabIndex={0}
                      className="scp-btn-action"
                      data-testid="sc-ch3-load-spoon"
                      onClick={() => setStory(prev => stepChapter3(prev, { type: "load_scrap_spoon" }))}
                    >
                      🥄 Load Teaspoon Catapult ({SCRAP_COURSES[story.ch3.courseIndex]?.label})
                    </div>
                  ) : null}

                  {story.ch3.step === "wait_for_inhale" ? (
                    <div className="scp-row-buttons">
                      <div
                        tabIndex={0}
                        className="scp-btn-action"
                        data-testid="sc-ch3-fire-inhale"
                        onClick={() =>
                          setStory(prev => {
                            const synced = stepChapter3(prev, {
                              type: "advance_breath",
                              dtSec: 0,
                              forcePhase: "inhale_open",
                            });
                            return stepChapter3(synced, { type: "launch_spoon" });
                          })
                        }
                      >
                        🎯 Release Spoon on the IN-BREATH! ({story.ch3.coursesFed.length + 1}/3)
                      </div>
                      <div
                        tabIndex={0}
                        className="scp-btn-gag"
                        data-testid="sc-ch3-fire-exhale-gag"
                        onClick={() =>
                          setStory(prev => {
                            const snore = stepChapter3(prev, {
                              type: "advance_breath",
                              dtSec: 0,
                              forcePhase: "exhale_snore",
                            });
                            return stepChapter3(snore, { type: "launch_spoon" });
                          })
                        }
                      >
                        💨 Fire on EXHALE Snore (Mustache Blowback Gag!)
                      </div>
                    </div>
                  ) : null}

                  {story.ch3.step === "choking_onset" ? (
                    <div className="scp-complete-box" data-testid="sc-ch3-choking-transition">
                      <b>GULP! The Guilt Egg Lodged Sideways!</b>
                      <span>
                        He bolts upright clutching his throat! The bedroom window is right behind him!
                      </span>
                      <div
                        tabIndex={0}
                        className="scp-btn-primary"
                        data-testid="sc-ch3-to-ch4"
                        onClick={() =>
                          setStory(prev => stepChapter3(prev, { type: "transition_to_chapter_4" }))
                        }
                      >
                        Crash Into Chapter Four: “The Heimlich” →
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {/* ==============================================================
              CHAPTER 4: THE HEIMLICH (+ FREE SINGING GLASS SHARDS)
             ============================================================== */}
          {story.activeChapter === 4 ? (
            <section className="scp-scene-panel" aria-label="Chapter Four: The Heimlich">
              <div className="scp-heimlich-stage">
                {/* Cartoon Cutout Performance Stage: Man, Broken Window, Cast-Armed Neighbour */}
                <div className="scp-heimlich-theater" data-testid="sc-ch4-theater">
                  <div className="scp-theater-actor" data-testid="sc-ch4-man-status">
                    <span className="scp-actor-emoji">
                      {story.ch4.foodExpelled ? "😮‍💨" : story.ch4.manOutsideOnAss ? "🙃" : "🤢"}
                    </span>
                    <div>
                      <b>The Man (Cutout)</b>
                      <small>
                        {story.ch4.foodExpelled
                          ? "Breathing easy! Egg popped into Conductor’s cap!"
                          : story.ch4.manOutsideOnAss
                            ? "Fell backward outside through the window onto his ass!"
                            : "Clutching his throat, backing toward the bedroom window!"}
                      </small>
                    </div>
                  </div>

                  <div className="scp-theater-actor" data-testid="sc-ch4-neighbor-status">
                    <span className="scp-actor-emoji">🦴</span>
                    <div>
                      <b>The Neighbour (Broken Arm in Plaster Cast)</b>
                      <small>
                        {story.ch4.neighborPresent
                          ? "Left arm in a sling cast—only one arm free! Needs the mice’s jump impact!"
                          : "Hears the window crash from next door…"}
                      </small>
                    </div>
                  </div>
                </div>

                {/* FREE BROKEN GLASS SHARDS A CAPPELLA CHORUS */}
                {story.ch4.windowShattered ? (
                  <div
                    className="scp-shard-choir"
                    data-testid="sc-ch4-shard-choir"
                    aria-label="Free broken glass shards singing a cappella celebration notes"
                  >
                    <div className="scp-shard-choir-header">
                      <b>✨ THE FREE GLASS-SHARD A CAPPELLA QUINTET ✨</b>
                      <span data-testid="sc-ch4-shard-syllable">
                        {story.ch4.lastShardChorusSyllable ?? "WE’RE FREE FROM THE WINDOW! ♫"}
                      </span>
                    </div>
                    <div className="scp-shard-row">
                      {story.ch4.shards.map(shard => (
                        <div
                          key={shard.id}
                          data-testid={`sc-ch4-shard-${shard.id}`}
                          className={`scp-shard-singer${shard.bounceAmt > 0.05 ? " is-singing" : ""}`}
                          style={
                            {
                              "--shard-rot": `${shard.rotationDeg}deg`,
                              "--shard-bounce": `${Math.round(shard.bounceAmt * 18)}px`,
                            } as React.CSSProperties
                          }
                        >
                          <span className="scp-shard-face">🔺😄🎶</span>
                          <b>{shard.name}</b>
                          <small>{shard.lyric}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* One-Armed Heimlich Rhythm Meter & Mouse Jump Sync */}
                {story.ch4.beat === "6_one_armed_heimlich_sync" ? (
                  <div className="scp-sync-meter-box" data-testid="sc-ch4-sync-box">
                    <div className="scp-sync-header">
                      <b>ONE-ARMED HEIMLICH COMPRESSION RHYTHM</b>
                      <span>
                        Synced Mice: <b>{story.ch4.syncedMice.length}/3</b> (
                        {story.ch4.syncedMice.join(", ") || "none yet"}) · Jumps:{" "}
                        <b data-testid="sc-ch4-jump-count">{story.ch4.totalMouseJumps}</b>
                      </span>
                    </div>
                    <div className="scp-sync-track">
                      <div className="scp-sync-sweetspot" />
                      <div
                        className="scp-sync-cursor"
                        style={{ left: `${Math.round(story.ch4.compressionCycle * 100)}%` }}
                      />
                    </div>
                    <div className="scp-row-buttons">
                      <div
                        tabIndex={0}
                        className="scp-btn-action"
                        data-testid="sc-ch4-jump-sync"
                        onClick={() =>
                          setStory(prev => {
                            const aligned = stepChapter4(prev, {
                              type: "tick_compression",
                              dtSec: 0,
                              forceCompression: 0.52,
                            });
                            return stepChapter4(aligned, { type: "mouse_jump" });
                          })
                        }
                      >
                        🐭🎶 JUMP IN SYNC WITH HER ONE GOOD ARM! ({story.ch4.syncedMice.length + 1}/3)
                      </div>
                      <div
                        tabIndex={0}
                        className="scp-btn-gag"
                        data-testid="sc-ch4-jump-offbeat"
                        onClick={() =>
                          setStory(prev => {
                            const early = stepChapter4(prev, {
                              type: "tick_compression",
                              dtSec: 0,
                              forceCompression: 0.1,
                            });
                            return stepChapter4(early, { type: "mouse_jump" });
                          })
                        }
                      >
                        🎵 Jump Early (Hear Free Glass Shards Sing anyway!)
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Intro beat progression & Finale controls */}
                <div className="scp-action-deck">
                  {story.ch4.beat !== "6_one_armed_heimlich_sync" &&
                  story.ch4.beat !== "7_triumphant_expulsion" &&
                  story.ch4.beat !== "complete" ? (
                    <div
                      tabIndex={0}
                      className="scp-btn-action"
                      data-testid="sc-ch4-advance-beat"
                      onClick={() =>
                        setStory(prev => stepChapter4(prev, { type: "advance_intro_beat" }))
                      }
                    >
                      {story.ch4.beat === "1_fed_and_choking"
                        ? "1️⃣ He Stands & Backs Up Clutching His Throat →"
                        : story.ch4.beat === "2_stands_and_backs_up"
                          ? "2️⃣ CRASH! Break the Bedroom Window (Free the Glass Shards!) →"
                          : story.ch4.beat === "3_breaks_bedroom_window"
                            ? "3️⃣ Fall Backward Outside onto His Ass →"
                            : story.ch4.beat === "4_falls_outside_on_ass"
                              ? "4️⃣ Neighbour Rushes In (Broken Arm in Cast!) →"
                              : "5️⃣ Begin One-Armed Heimlich + Singing Shards Sync →"}
                    </div>
                  ) : null}

                  {story.ch4.beat === "7_triumphant_expulsion" ? (
                    <div
                      tabIndex={0}
                      className="scp-btn-primary"
                      data-testid="sc-ch4-finale-hats"
                      onClick={() => setStory(prev => completeChapter4Finale(prev))}
                    >
                      🎩 Tip Three Hovering Mouse Hats on the Broken Windowsill →
                    </div>
                  ) : null}

                  {story.ch4.beat === "complete" ? (
                    <div className="scp-complete-box" data-testid="sc-ch4-complete">
                      <b>All Four Chapters of Small Comforts Complete! ★</b>
                      <span>
                        The man is breathing, the cast-armed Neighbour is laughing, the three mouse hats
                        saluted from the sill, and the free window shards are still humming barbershop
                        chords in the grass.
                      </span>
                      <div
                        tabIndex={0}
                        className="scp-btn-primary"
                        data-testid="sc-replay-ch1"
                        onClick={() => setStory(prev => selectChapter(prev, 1))}
                      >
                        Replay from Chapter One →
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}
        </main>
      ) : null}

      {/* Bottom Narrative & Hint Bar */}
      <div className="scp-hint" data-testid="sc-story-bar">
        <b>
          SMALL COMFORTS · CHAPTER {card.roman}: {card.title.toUpperCase()}
        </b>
        <span>{story.storyLine}</span>
      </div>
    </div>
  );
}
