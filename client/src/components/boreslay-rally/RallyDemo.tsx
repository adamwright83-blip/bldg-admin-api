import { useCallback, useEffect, useRef, useState } from "react";
import { RallyAudio } from "./rallyAudio";
import { RallyEngine, type RallyState } from "./rallyEngine";
import { RALLY_CONFIG } from "./rallyConfig";
import { RallyParticlePool } from "./rallyParticles";
import { RallyRenderer } from "./rallyRenderer";
import "./rally.css";

type HudState = {
  status: RallyState["status"];
  message: string;
  sparkLives: number;
  clockheadLives: number;
  influence: number;
  energy: number;
  rallyCount: number;
  speedTier: 0 | 1 | 2 | 3;
  missionStatus: RallyState["mission"]["status"];
  missionDeadline: number | null;
  timeMs: number;
  reducedMotion: boolean;
};

const snapshotHud = (state: RallyState): HudState => ({
  status: state.status,
  message: state.message,
  sparkLives: state.sparkLives,
  clockheadLives: state.clockheadLives,
  influence: state.influence,
  energy: state.spark.energy,
  rallyCount: state.excuse.rallyCount,
  speedTier: state.excuse.speedTier,
  missionStatus: state.mission.status,
  missionDeadline: state.mission.acceptDeadline,
  timeMs: state.timeMs,
  reducedMotion: state.reducedMotion,
});

const LIFE_SLOTS = [0, 1, 2] as const;

export function RallyDemo() {
  const reducedMotionQuery =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const engineRef = useRef<RallyEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new RallyEngine({ reducedMotion: reducedMotionQuery });
  }
  const rendererRef = useRef<RallyRenderer | null>(null);
  const particlesRef = useRef(new RallyParticlePool());
  const audioRef = useRef(new RallyAudio());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<HTMLDivElement>(null);
  const rescueButtonRef = useRef<HTMLButtonElement>(null);
  const keysRef = useRef(new Set<string>());
  const [hud, setHud] = useState(() => snapshotHud(engineRef.current!.state));
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const [joystick, setJoystick] = useState({ x: 0, y: 0 });

  const syncHud = useCallback(() => {
    setHud(snapshotHud(engineRef.current!.state));
  }, []);

  useEffect(() => {
    const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      engineRef.current!.setReducedMotion(reducedQuery.matches);
      particlesRef.current.setReducedMotion(reducedQuery.matches);
      syncHud();
    };
    update();
    reducedQuery.addEventListener("change", update);
    return () => reducedQuery.removeEventListener("change", update);
  }, [syncHud]);

  useEffect(() => {
    rendererRef.current = new RallyRenderer();
    let animationFrame = 0;
    let lastFrame = performance.now();
    let lastHudSync = lastFrame;
    const loop = (now: number) => {
      const frameMs = Math.min(100, now - lastFrame);
      lastFrame = now;
      const engine = engineRef.current!;
      engine.advanceFrame(frameMs);
      const events = engine.consumeEvents();
      for (const event of events) {
        audioRef.current.handleEvent(event);
        particlesRef.current.handleEvent(event);
      }
      particlesRef.current.update(engine.hitStopMs > 0 ? 0 : frameMs);
      if (canvasRef.current) {
        rendererRef.current?.render(
          canvasRef.current,
          engine.state,
          engine.interpolationAlpha,
          particlesRef.current
        );
      }
      if (events.length > 0 || now - lastHudSync >= 100) {
        syncHud();
        lastHudSync = now;
      }
      animationFrame = requestAnimationFrame(loop);
    };
    animationFrame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrame);
  }, [syncHud]);

  const updateMovement = useCallback(() => {
    const keys = keysRef.current;
    engineRef.current!.setMovement(
      Number(keys.has("KeyD") || keys.has("ArrowRight")) -
        Number(keys.has("KeyA") || keys.has("ArrowLeft")),
      Number(keys.has("KeyS") || keys.has("ArrowDown")) -
        Number(keys.has("KeyW") || keys.has("ArrowUp"))
    );
  }, []);

  useEffect(() => {
    if (!engaged) return;
    const gameplayCodes = new Set([
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "KeyF",
      "Space",
      "Escape",
    ]);
    const onKeyDown = (event: KeyboardEvent) => {
      if (gameplayCodes.has(event.code)) event.preventDefault();
      if (event.code === "Escape" && !event.repeat) {
        engineRef.current!.pause();
        setEngaged(false);
        syncHud();
        return;
      }
      keysRef.current.add(event.code);
      updateMovement();
      if (event.code === "KeyF") engineRef.current!.setBreath(true);
      if (event.code === "Space" && !event.repeat) engineRef.current!.dash();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keysRef.current.delete(event.code);
      updateMovement();
      if (event.code === "KeyF") engineRef.current!.setBreath(false);
    };
    const clearInput = () => {
      keysRef.current.clear();
      engineRef.current!.setMovement(0, 0);
      engineRef.current!.setBreath(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearInput);
    document.addEventListener("visibilitychange", clearInput);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearInput);
      document.removeEventListener("visibilitychange", clearInput);
    };
  }, [engaged, syncHud, updateMovement]);

  useEffect(() => {
    if (hud.missionStatus === "ready") rescueButtonRef.current?.focus();
  }, [hud.missionStatus]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "BORESLAY: EXCUSE RALLY — Phase 1";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const begin = () => {
    engineRef.current!.start();
    setEngaged(true);
    syncHud();
    arenaRef.current?.focus();
  };

  const restart = () => {
    engineRef.current!.reset();
    particlesRef.current.clear();
    engineRef.current!.start();
    setEngaged(true);
    syncHud();
    arenaRef.current?.focus();
  };

  const aimAtPointer = (clientX: number, clientY: number) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    engineRef.current!.setAim(
      ((clientX - bounds.left) / bounds.width) * RALLY_CONFIG.arena.width,
      ((clientY - bounds.top) / bounds.height) * RALLY_CONFIG.arena.height
    );
  };

  const joystickMove = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const rawX = (event.clientX - bounds.left - bounds.width / 2) / (bounds.width / 2);
    const rawY = (event.clientY - bounds.top - bounds.height / 2) / (bounds.height / 2);
    const magnitude = Math.max(1, Math.hypot(rawX, rawY));
    const next = { x: rawX / magnitude, y: rawY / magnitude };
    setJoystick(next);
    engineRef.current!.setMovement(next.x, next.y);
  };

  const endJoystick = () => {
    setJoystick({ x: 0, y: 0 });
    engineRef.current!.setMovement(0, 0);
  };

  const toggleSound = async () => {
    const next = !soundEnabled;
    await audioRef.current.setEnabled(next);
    setSoundEnabled(next);
  };

  const resume = () => {
    engineRef.current!.start();
    setEngaged(true);
    syncHud();
    arenaRef.current?.focus();
  };

  const acceptRemaining =
    hud.missionDeadline === null
      ? 0
      : Math.max(0, (hud.missionDeadline - hud.timeMs) / 1000);

  return (
    <main className={`rally-page${hud.reducedMotion ? " is-reduced" : ""}`}>
      <section className="rally-shell" aria-label="BORESLAY Excuse Rally vertical slice">
        <div
          ref={arenaRef}
          className={`rally-stage is-${hud.status} tier-${hud.speedTier}`}
          tabIndex={engaged ? 0 : -1}
          onPointerMove={event => {
            if (engaged && event.pointerType === "mouse") aimAtPointer(event.clientX, event.clientY);
          }}
          onPointerDown={event => {
            if (!engaged || event.pointerType !== "mouse") return;
            aimAtPointer(event.clientX, event.clientY);
            engineRef.current!.setBreath(true);
          }}
          onPointerUp={() => engineRef.current!.setBreath(false)}
          onPointerLeave={() => engineRef.current!.setBreath(false)}
          aria-label="Excuse Rally arena. Use WASD or arrow keys to move, hold F or the mouse to breathe fire, Space to dash, and Escape to pause."
        >
          <canvas ref={canvasRef} className="rally-canvas" aria-hidden="true" />

          <div className="rally-hud" aria-label="Rally status">
            <div className="rally-fighter rally-fighter--spark">
              <strong>SPARK</strong>
              <div className="rally-lives" aria-label={`${hud.sparkLives} gate lives remaining`}>
                {LIFE_SLOTS.map(slot => (
                  <i key={slot} className={slot < hud.sparkLives ? "is-live" : ""} aria-hidden="true">🔥</i>
                ))}
              </div>
              <div className="rally-energy" aria-label={`${Math.round(hud.energy)} percent fire energy`}>
                <span style={{ width: `${hud.energy}%` }} />
              </div>
            </div>
            <div className="rally-center-hud">
              <b>RALLY ×{hud.rallyCount}</b>
              <small>KINGDOM INFLUENCE</small>
              <div className="rally-influence" aria-label={`${Math.round(hud.influence)} percent Kingdom Influence`}>
                <i style={{ width: `${hud.influence}%` }} />
              </div>
            </div>
            <div className="rally-fighter rally-fighter--clock">
              <strong>CLOCKHEAD</strong>
              <div className="rally-lives" aria-label={`${hud.clockheadLives} gate lives remaining`}>
                {LIFE_SLOTS.map(slot => (
                  <i key={slot} className={slot < hud.clockheadLives ? "is-live" : ""} aria-hidden="true">⌛</i>
                ))}
              </div>
            </div>
          </div>

          <button className="rally-sound" type="button" onPointerDown={event => event.stopPropagation()} onClick={toggleSound}>
            {soundEnabled ? "SOUND ON" : "SOUND OFF"}
          </button>
          {engaged && (
            <button
              className="rally-pause"
              type="button"
              aria-label="Pause rally"
              onPointerDown={event => event.stopPropagation()}
              onClick={() => {
                engineRef.current!.pause();
                setEngaged(false);
                syncHud();
              }}
            >
              Ⅱ
            </button>
          )}

          {hud.missionStatus === "ready" && (
            <div className="rally-rescue" role="dialog" aria-modal="false" aria-labelledby="rally-rescue-title">
              <span className="rally-simulated">SIMULATED</span>
              <h2 id="rally-rescue-title">CLOSER FOUND A WAY OUT</h2>
              <p>Accept within 20s to break the freeze and return the Excuse with triple force.</p>
              <div>
                <button
                  ref={rescueButtonRef}
                  type="button"
                  onClick={() => {
                    engineRef.current!.acceptRescue();
                    syncHud();
                    arenaRef.current?.focus();
                  }}
                >
                  ACCEPT MISSION
                </button>
                <strong>{acceptRemaining.toFixed(1)}s</strong>
              </div>
            </div>
          )}

          {hud.status === "idle" && (
            <div className="rally-gate rally-intro">
              <span>PHASE 1 · VERTICAL SLICE</span>
              <h1>EXCUSE RALLY</h1>
              <p>Keep the Excuse out of your Gate. Fire it into his.</p>
              <button type="button" onClick={begin}>ENTER THE RALLY</button>
              <small>WASD / ARROWS · HOLD F / CLICK · SPACE TO DASH</small>
            </div>
          )}

          {hud.status === "paused" && (
            <div className="rally-gate">
              <span>THE CLOCK STOPPED</span>
              <h1>RALLY PAUSED</h1>
              <button type="button" onClick={resume}>RESUME</button>
            </div>
          )}

          {(hud.status === "victory" || hud.status === "defeat") && (
            <div className={`rally-gate rally-result is-${hud.status}`}>
              <span>{hud.status === "victory" ? "REALITY WINS" : "THE EXCUSE GOT THROUGH"}</span>
              <h1>{hud.status === "victory" ? "CLOCKHEAD SHATTERED" : "RALLY AGAIN"}</h1>
              <p>{hud.message}</p>
              <button type="button" onClick={restart}>PLAY AGAIN</button>
            </div>
          )}

          <div
            className="rally-joystick"
            aria-hidden="true"
            onPointerDown={joystickMove}
            onPointerMove={joystickMove}
            onPointerUp={endJoystick}
            onPointerCancel={endJoystick}
          >
            <i style={{ transform: `translate(${joystick.x * 34}px, ${joystick.y * 34}px)` }} />
          </div>
          <div className="rally-touch-actions">
            <button
              type="button"
              onPointerDown={event => {
                event.stopPropagation();
                engineRef.current!.setAim(RALLY_CONFIG.clockhead.spawnX, RALLY_CONFIG.clockhead.spawnY);
                engineRef.current!.setBreath(true);
              }}
              onPointerUp={() => engineRef.current!.setBreath(false)}
              onPointerCancel={() => engineRef.current!.setBreath(false)}
            >
              BREATH
            </button>
            <button
              type="button"
              onPointerDown={event => {
                event.stopPropagation();
                engineRef.current!.dash();
              }}
            >
              DASH
            </button>
          </div>

          <div className="rally-status" aria-live="polite">{hud.message}</div>
        </div>
        <div className="rally-controls" aria-hidden="true">
          <span><b>MOVE</b> WASD / ARROWS</span>
          <span><b>BREATH</b> HOLD F / CLICK</span>
          <span><b>DASH</b> SPACE</span>
          <span><b>PAUSE</b> ESC</span>
        </div>
      </section>
    </main>
  );
}

export default RallyDemo;
