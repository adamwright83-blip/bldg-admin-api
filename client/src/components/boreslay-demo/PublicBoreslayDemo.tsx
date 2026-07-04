import { useCallback, useEffect, useRef, useState } from "react";
import {
  PublicBoreslayEngine,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  getPresentationMode,
  type PublicBattleState,
} from "./engine";
import "./public-boreslay-demo.css";

const fmt = (ms: number) =>
  `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

type PublicBoreslayDemoProps = {
  onActiveChange?: (active: boolean) => void;
  onVictoryCta?: () => void;
};

export function PublicBoreslayDemo({
  onActiveChange,
  onVictoryCta,
}: PublicBoreslayDemoProps) {
  const engineRef = useRef(new PublicBoreslayEngine());
  const keys = useRef(new Set<string>());
  const arenaRef = useRef<HTMLDivElement>(null);
  const deployRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<PublicBattleState>(
    () => engineRef.current.state
  );
  const [engaged, setEngaged] = useState(false);
  const [presentationState, setPresentationState] = useState<
    "marketing" | "transitioning" | "playing" | "victory"
  >("marketing");
  const [ctaAwake, setCtaAwake] = useState(false);
  const [joystick, setJoystick] = useState({ x: 0, y: 0 });
  const detectPresentation = () =>
    getPresentationMode(
      window.innerWidth,
      window.visualViewport?.height ?? window.innerHeight,
      window.matchMedia("(pointer: coarse)").matches &&
        Math.min(window.screen.width, window.screen.height) <= 700
    );
  const [presentation, setPresentation] = useState(detectPresentation);

  const sync = useCallback(
    () =>
      setState({
        ...engineRef.current.state,
        spark: { ...engineRef.current.state.spark },
        boss: { ...engineRef.current.state.boss },
        mission: { ...engineRef.current.state.mission },
        projectiles: [...engineRef.current.state.projectiles],
        hazards: [...engineRef.current.state.hazards],
      }),
    []
  );
  const updateMovement = useCallback(() => {
    const k = keys.current;
    engineRef.current.setMovement(
      Number(k.has("KeyD") || k.has("ArrowRight")) -
        Number(k.has("KeyA") || k.has("ArrowLeft")),
      Number(k.has("KeyS") || k.has("ArrowDown")) -
        Number(k.has("KeyW") || k.has("ArrowUp"))
    );
  }, []);

  useEffect(() => {
    let raf = 0,
      last = performance.now();
    const loop = (now: number) => {
      engineRef.current.update(now - last);
      last = now;
      sync();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sync]);

  useEffect(() => {
    const update = () => setPresentation(detectPresentation());
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    if (!engaged) return;
    const down = (e: KeyboardEvent) => {
      if (
        [
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Space",
          "KeyF",
          "Digit3",
          "Escape",
        ].includes(e.code)
      )
        e.preventDefault();
      if (e.code === "Escape") {
        if (engineRef.current.state.mission.status === "briefing") {
          engineRef.current.closeFollowUpBriefing();
          arenaRef.current?.focus();
          return;
        }
        engineRef.current.pause();
        setEngaged(false);
        arenaRef.current?.blur();
        return;
      }
      keys.current.add(e.code);
      updateMovement();
      if (e.code === "Space" && !e.repeat) engineRef.current.dash();
      if (e.code === "KeyF" && !e.repeat) engineRef.current.fire();
      if (e.code === "Digit3" && !e.repeat)
        engineRef.current.openFollowUpBriefing();
    };
    const up = (e: KeyboardEvent) => {
      keys.current.delete(e.code);
      updateMovement();
    };
    const clear = () => {
      keys.current.clear();
      updateMovement();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, [engaged, updateMovement]);

  useEffect(() => {
    if (state.mission.status === "briefing") deployRef.current?.focus();
  }, [state.mission.status]);

  useEffect(() => {
    if (state.status === "victory") setPresentationState("victory");
  }, [state.status]);

  const play = () => {
    setPresentationState("transitioning");
    onActiveChange?.(true);
    window.setTimeout(
      () => {
        engineRef.current.start();
        setEngaged(true);
        setPresentationState("playing");
        arenaRef.current?.focus();
      },
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900
    );
  };
  const restart = () => {
    engineRef.current.reset();
    engineRef.current.start();
    setEngaged(true);
    setPresentationState("playing");
    onActiveChange?.(true);
    arenaRef.current?.focus();
  };
  const aim = (clientX: number, clientY: number) => {
    const r = arenaRef.current?.getBoundingClientRect();
    if (r)
      engineRef.current.setAim(
        ((clientX - r.left) / r.width) * ARENA_WIDTH,
        ((clientY - r.top) / r.height) * ARENA_HEIGHT
      );
  };
  const pointerMove = (e: React.PointerEvent) => {
    if (engaged && e.pointerType === "mouse") aim(e.clientX, e.clientY);
  };
  const joystickMove = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const d = Math.max(1, Math.hypot(x, y));
    const next = { x: x / d, y: y / d };
    setJoystick(next);
    engineRef.current.setMovement(next.x, next.y);
  };
  const joystickEnd = () => {
    setJoystick({ x: 0, y: 0 });
    engineRef.current.setMovement(0, 0);
  };

  return (
    <section
      id="top"
      className={`pbd-shell pbd-${presentation} pbd-stage-${presentationState}${ctaAwake ? " is-awake" : ""}`}
      aria-label="BORESLAY first mission"
    >
      <div
        ref={arenaRef}
        className={`pbd-arena is-${state.status}`}
        tabIndex={engaged ? 0 : -1}
        onPointerMove={pointerMove}
        onPointerDown={e => {
          if (engaged && e.pointerType === "mouse") {
            aim(e.clientX, e.clientY);
            engineRef.current.fire();
          }
        }}
        aria-label="Boss fight arena. Use WASD or arrow keys to move, Space to dash, mouse click or F to fire."
      >
        <div className="pbd-depth pbd-depth--far" />
        <div className="pbd-depth pbd-depth--near" />
        <div className="pbd-mission-brief" aria-live="polite">
          <span>MISSION 01</span>
          <b>Defeat The Procrastinator</b>
          <small>Dodge the EXCUSE scrolls. Burn down the boss.</small>
        </div>
        <div className="pbd-hud pbd-hud--spark">
          <b>SPARK</b>
          <span>Field Commander</span>
          <div className="pbd-meter hp">
            <i style={{ width: `${state.spark.hp}%` }} />
          </div>
          <div className="pbd-meter energy">
            <i style={{ width: `${state.spark.energy}%` }} />
          </div>
        </div>
        <div className="pbd-bossbar">
          <b>THE PROCRASTINATOR</b>
          <span>BOSS LEVEL 30</span>
          <div className="pbd-meter hp">
            <i style={{ width: `${state.boss.hp}%` }} />
          </div>
        </div>
        <div className="pbd-contract">
          <span>DAILY CONTRACT</span>
          <b>{fmt(state.contractRemainingMs)}</b>
          <small>Defeat the Procrastinator</small>
        </div>
        <div
          className={`pbd-spark ${state.time < state.spark.dashUntil ? "is-dashing" : ""} ${state.time < state.spark.invulnerableUntil ? "is-invulnerable" : ""} ${state.time - state.lastSparkHitAt < 280 ? "is-hit" : ""}`}
          style={{
            left: `${(state.spark.x / ARENA_WIDTH) * 100}%`,
            top: `${(state.spark.y / ARENA_HEIGHT) * 100}%`,
            transform: `translate(-50%,-50%) scaleX(${state.spark.facing.x < 0 ? -1 : 1})`,
          }}
        >
          <span className="pbd-spark-shadow" />
          <img
            src="/assets/boreslay-hero/spark-reference.png"
            alt="Spark, the blue dragon wearing the WRIGHT STUFF watch-face chain"
          />
          {state.time < state.spark.dashUntil && (
            <i className="pbd-afterimage" />
          )}
        </div>
        <div
          className={`pbd-boss ${state.time < state.boss.staggerUntil ? "is-hit" : ""} ${state.boss.telegraph !== "none" ? "is-telegraphing" : ""}`}
          style={{
            left: `${(state.boss.x / ARENA_WIDTH) * 100}%`,
            top: `${(state.boss.y / ARENA_HEIGHT) * 100}%`,
          }}
        >
          <img
            src="/assets/boreslay-hero/procrastinator-reference.png"
            alt="The Procrastinator, an angry clock-faced boss in a gray plush blanket onesie"
          />
          {state.boss.telegraph !== "none" && (
            <span>
              {state.boss.telegraph === "excuse"
                ? "DO IT TOMORROW!"
                : "TIME SINK!"}
            </span>
          )}
        </div>
        {presentationState === "marketing" && (
          <img
            className="pbd-hero-scroll"
            src="/assets/boreslay-hero/scroll-reference.png"
            alt=""
            aria-hidden="true"
          />
        )}
        {state.projectiles.map(p =>
          p.kind === "fire" ? (
            <div
              key={p.id}
              className="pbd-fire-wrap"
              style={{
                left: `${(p.x / ARENA_WIDTH) * 100}%`,
                top: `${(p.y / ARENA_HEIGHT) * 100}%`,
                transform: `translate(-50%,-50%) rotate(${Math.atan2(p.vy, p.vx)}rad)`,
              }}
            >
              <div className="pbd-fire">
                <i />
                <i />
                <i />
              </div>
            </div>
          ) : (
            <div
              key={p.id}
              className="pbd-excuse-wrap"
              style={{
                left: `${(p.x / ARENA_WIDTH) * 100}%`,
                top: `${(p.y / ARENA_HEIGHT) * 100}%`,
              }}
            >
              <img
                className="pbd-excuse"
                src="/assets/boreslay-hero/scroll-reference.png"
                alt="Do it tomorrow excuse scroll"
              />
              <span className="pbd-violet-trail" />
            </div>
          )
        )}
        {state.time - state.lastBossHitAt < 420 && (
          <div
            className="pbd-impact"
            style={{
              left: `${(state.boss.x / ARENA_WIDTH) * 100}%`,
              top: `${(state.boss.y / ARENA_HEIGHT) * 100}%`,
            }}
          >
            <b>-8</b>
            <i />
            <i />
            <i />
          </div>
        )}
        {state.hazards.map(h => (
          <div
            key={h.id}
            className={`pbd-hazard ${state.time >= h.telegraphUntil ? "is-active" : ""}`}
            style={{
              left: `${(h.x / ARENA_WIDTH) * 100}%`,
              top: `${(h.y / ARENA_HEIGHT) * 100}%`,
              width: `${((h.radius * 2) / ARENA_WIDTH) * 100}%`,
              aspectRatio: "1",
            }}
          />
        ))}
        <div className="pbd-influence">
          <span>SPARK {Math.round(state.influence)}%</span>
          <b>KINGDOM INFLUENCE</b>
          <span>{Math.round(100 - state.influence)}% FOG</span>
          <i>
            <em style={{ width: `${state.influence}%` }} />
          </i>
        </div>
        <button
          type="button"
          className={`pbd-mission ${state.mission.status}`}
          aria-label={`Follow Up mission: ${state.mission.status}`}
          disabled={
            state.mission.status !== "ready" || state.status !== "playing"
          }
          onPointerDown={e => e.stopPropagation()}
          onClick={() => engineRef.current.openFollowUpBriefing()}
        >
          <span>3</span>
          <b>FOLLOW UP</b>
          <small>
            {state.mission.status === "charging"
              ? `${Math.round(Math.min(100, (state.time / state.mission.readyAt) * 100))}% CHARGED`
              : state.mission.status.replace("-", " ")}
          </small>
          <i
            style={{
              width: `${state.mission.status === "charging" ? Math.min(100, (state.time / state.mission.readyAt) * 100) : state.mission.progress * 100}%`,
            }}
          />
        </button>
        {state.mission.dispatch &&
          (state.mission.status === "result-incoming" ||
            state.mission.status === "final-result") && (
            <div className="pbd-dispatch" role="status">
              <span>SCOUT REPORT · DEMO</span>
              <b>{state.mission.dispatch}</b>
            </div>
          )}
        {(state.mission.status === "strike" ||
          state.mission.status === "resolved") && (
          <div className="pbd-momentum" role="status">
            <b>FOLLOW-THROUGH STRIKE</b>
            <span>You commanded the mission. The crew did the work.</span>
          </div>
        )}
        {state.mission.status === "briefing" && (
          <div
            className="pbd-briefing"
            role="dialog"
            aria-modal="true"
            aria-labelledby="scout-briefing-title"
          >
            <div className="pbd-scout-mark" aria-hidden="true">
              ⌖
            </div>
            <h2 id="scout-briefing-title">SCOUT FOUND AN OPENING</h2>
            <p>
              <strong>12 dormant estimates identified.</strong>
              <br />
              <span>SIMULATED PUBLIC DEMO</span>
            </p>
            <div>
              <button
                ref={deployRef}
                onClick={() => {
                  engineRef.current.deployFollowUp();
                  arenaRef.current?.focus();
                }}
              >
                DEPLOY CREW
              </button>
              <button
                onClick={() => {
                  engineRef.current.closeFollowUpBriefing();
                  arenaRef.current?.focus();
                }}
              >
                NOT NOW
              </button>
            </div>
            <small>
              You command the mission. The crew handles the follow-through.
            </small>
          </div>
        )}
        {presentationState === "marketing" && (
          <div className="pbd-marketing">
            <div className="pbd-marketing-copy">
              <span>A WORLD FIRST</span>
              <h1>
                THE VIDEO GAME
                <br />
                THAT HUNTS DOWN
                <br />
                NEW BUSINESS.
              </h1>
              <p>
                Your AI crew does the chasing.
                <br />
                When only a human can win it,
                <br />
                <strong>BORESLAY</strong> calls you in.
              </p>
              <button
                onClick={play}
                onMouseEnter={() => setCtaAwake(true)}
                onMouseLeave={() => setCtaAwake(false)}
                onFocus={() => setCtaAwake(true)}
                onBlur={() => setCtaAwake(false)}
              >
                <span aria-hidden="true">⚔</span> PLAY THE FIRST MISSION
              </button>
            </div>
          </div>
        )}
        {presentationState === "transitioning" && (
          <div className="pbd-powering" role="status">
            POWERING UP MISSION 01
          </div>
        )}
        {!engaged && state.status === "paused" && (
          <div className="pbd-gate">
            <h1>BATTLE PAUSED</h1>
            <p>Nothing moved. Resume when you’re ready.</p>
            <button
              onClick={() => {
                setEngaged(true);
                engineRef.current.start();
                arenaRef.current?.focus();
              }}
            >
              RESUME BATTLE
            </button>
          </div>
        )}
        {state.status === "victory" && (
          <div className="pbd-gate pbd-victory">
            <span>MISSION COMPLETE</span>
            <h1>THE PROCRASTINATOR DEFEATED</h1>
            <strong>+$1,240 BOOKED REVENUE</strong>
            <p>
              Scout found the opportunity.
              <br />
              Closer handled the pursuit.
              <br />
              You entered when the owner had to close.
            </p>
            <button onClick={onVictoryCta}>
              SEE HOW BORESLAY WORKS IN REAL LIFE
            </button>
            <button className="pbd-replay" onClick={restart}>
              REPLAY MISSION
            </button>
            <small>Demo narrative result — not live customer data.</small>
          </div>
        )}
        {state.status === "defeat" && (
          <div className="pbd-gate">
            <h1>SPARK HAS FALLEN</h1>
            <p>{state.message}</p>
            <button onClick={restart}>FIGHT AGAIN</button>
          </div>
        )}
        <div
          className="pbd-joystick"
          onPointerMove={joystickMove}
          onPointerDown={joystickMove}
          onPointerUp={joystickEnd}
          onPointerCancel={joystickEnd}
        >
          <i
            style={{
              transform: `translate(${joystick.x * 30}px,${joystick.y * 30}px)`,
            }}
          />
        </div>
        <div className="pbd-touch-actions">
          <button
            onPointerDown={e => {
              e.stopPropagation();
              engineRef.current.dash();
            }}
          >
            DASH
          </button>
          <button
            className="fire"
            onPointerDown={e => {
              e.stopPropagation();
              engineRef.current.setAim(state.boss.x, state.boss.y);
              engineRef.current.fire();
            }}
          >
            FIRE
          </button>
        </div>
        <div className="pbd-status" aria-live="polite">
          {state.message}
        </div>
      </div>
      <div className="pbd-controls">
        <span>
          <b>MOVE</b> WASD / ARROWS
        </span>
        <span>
          <b>DASH</b> SPACE
        </span>
        <span>
          <b>SPACE</b>
        </span>
        <span>
          <b>FIRE BREATH</b> CLICK / F
        </span>
        {state.mission.status !== "charging" && (
          <span>
            <b>FOLLOW UP</b> 3
          </span>
        )}
        <span>
          <b>PAUSE</b> ESC
        </span>
      </div>
    </section>
  );
}
