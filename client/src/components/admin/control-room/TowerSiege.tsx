import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Car,
  Droplets,
  Flag,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Shield,
  Sparkles,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  readSiegeChronicle,
  returningSiegePressure,
  DEFENSES,
  lapseWarning,
  newSiege,
  restoreSiege,
  siegePressure,
  siegeReducer,
  type Defense,
  type SiegeAction,
  type SiegeState,
} from "@shared/towerSiege";
import { SIEGE_ART, STAGE_PADS, stagePoint } from "./siegeStageGeometry";
import { useWorldTransition } from "./WorldTransitionProvider";
import "./towerSiege.css";

const icons = { launch: Car, surge: Droplets, beacon: Radio };
const pathPoint = stagePoint;
const pads = STAGE_PADS;

/** Read-only adapter: combat never writes a payment, promise, or property observation. */
export function TowerSiege({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}) {
  const [skipFeed, setSkipFeed] = useState(false);
  const { user, loading } = useAuth();
  const { returnPath } = useWorldTransition();
  const live = trpc.system.towerWars.today.useQuery(undefined, {
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const data = live.data;
  const orders = data?.evidenceSufficient
    ? data.ledger.filter(e => e.buildingId === "century_park_east").length
    : undefined;
  const reflection =
    orders === undefined
      ? "Business feed unavailable. Playing at standard difficulty."
      : `${orders} recorded paid order${orders === 1 ? "" : "s"} at Century Park East in the current weekly feed.`;
  // An unavailable tenant context still permits play, but does not share a save across tenants.
  const storageKey =
    user && data?.tenantId
      ? `goldline:siege:v1:${data.tenantId}:${user.openId}:century_park_east`
      : undefined;
  const context = useRef<{
    storageKey?: string;
    pressure: number;
    reflection: string;
  } | null>(null);
  if (!context.current && (skipFeed || (!loading && !live.isLoading)))
    context.current = {
      storageKey,
      pressure: siegePressure(orders),
      reflection,
    };
  if (!context.current)
    return (
      <div className="sg" role="status">
        <p>Preparing the Stronghold…</p>
        <button className="sg-primary" onClick={() => setSkipFeed(true)}>
          Play now without the business feed
        </button>
      </div>
    );
  return (
    <SiegeGame
      key={context.current.storageKey ?? "session"}
      storageKey={context.current.storageKey}
      pressure={context.current.pressure}
      reflection={context.current.reflection}
      onBack={() => onNavigate(returnPath ?? "/growth/lantern-city")}
    />
  );
}

export function SiegeGame({
  storageKey,
  pressure = 0.45,
  reflection,
  onBack,
}: {
  storageKey?: string;
  pressure?: number;
  reflection?: string;
  onBack?: () => void;
}) {
  const [chronicle, setChronicle] = useState(() => {
    try {
      return readSiegeChronicle(
        storageKey ? localStorage.getItem(`${storageKey}:chronicle`) : null
      );
    } catch {
      return [];
    }
  });
  const [state, setState] = useState<SiegeState>(() => {
    try {
      return (
        (storageKey && restoreSiege(localStorage.getItem(storageKey))) ||
        newSiege(returningSiegePressure(pressure, chronicle), reflection)
      );
    } catch {
      return newSiege(returningSiegePressure(pressure, chronicle), reflection);
    }
  });
  const battlefield = useRef<HTMLDivElement | null>(null);
  const tower = useRef<SVGImageElement | null>(null);
  const { arrive } = useWorldTransition();
  useLayoutEffect(() => {
    arrive("century_park_east", tower.current);
  }, [arrive]);
  const [selected, setSelected] = useState(0);
  const [sound, setSound] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const latest = useRef(state);
  latest.current = state;
  const dispatch = (action: SiegeAction) => {
    setState(s => siegeReducer(s, action));
    if (action.type === "start")
      battlefield.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  };
  const warning = lapseWarning(state);
  const firing = state.effects.some(effect => effect.life === 0.5);
  const finished = state.phase === "held" || state.phase === "breach";
  useEffect(() => {
    if (
      !finished ||
      chronicle.some(entry => entry.sessionId === state.sessionId)
    )
      return;
    const entries = [
      {
        sessionId: state.sessionId,
        endedAt: Date.now(),
        outcome: state.phase as "held" | "breach",
        lanterns: state.lanterns,
        wave: state.wave,
      },
      ...chronicle,
    ].slice(0, 20);
    setChronicle(entries);
    if (storageKey) {
      try {
        localStorage.setItem(
          `${storageKey}:chronicle`,
          JSON.stringify(entries)
        );
      } catch {
        setSaveError(true);
      }
    }
  }, [
    finished,
    state.sessionId,
    state.phase,
    state.lanterns,
    state.wave,
    chronicle,
    storageKey,
  ]);
  const slot = state.slots[selected];
  const editable = !finished && state.phase !== "paused";
  const save = () => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(latest.current));
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  };
  useEffect(() => {
    if (state.phase !== "active") return;
    const timer = window.setInterval(() => {
      if (document.hidden) dispatch({ type: "pause" });
      else dispatch({ type: "tick" });
    }, 100);
    return () => clearInterval(timer);
  }, [state.phase]);
  useEffect(() => {
    const persist = () => {
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(latest.current));
        } catch {
          /* Visible warning is handled by the periodic save. */
        }
      }
    };
    const pause = () => {
      if (document.hidden) {
        dispatch({ type: "pause" });
        persist();
      }
    };
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", pause);
    const interval = window.setInterval(save, 1000);
    return () => {
      persist();
      clearInterval(interval);
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", pause);
    };
  }, [storageKey]);
  useEffect(save, [
    state.phase,
    state.slots.map(s => s?.kind ?? "").join(","),
    storageKey,
  ]);
  useEffect(() => {
    if (!sound || !audio.current || !firing || warning) return;
    const context = audio.current;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(180, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      65,
      context.currentTime + 0.12
    );
    gain.gain.setValueAtTime(0.025, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
  }, [firing, warning, sound]);
  useEffect(() => {
    if (!sound || !audio.current) return;
    const context = audio.current;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.frequency.value = warning
      ? 740
      : state.phase === "held"
        ? 660
        : 280;
    gain.gain.setValueAtTime(0.035, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.25);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.25);
  }, [warning, state.phase, sound]);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    []
  );

  return (
    <section className="sg" aria-label="Century Park East Siege">
      <header className="sg-header">
        <div>
          <span className="sg-eyebrow">TOWER WARS / SIEGE</span>
          <h1>Hold the light.</h1>
          <p>
            Century Park East <span>·</span> Five waves. Your command.
          </p>
        </div>
        <div className="sg-header-actions">
          {onBack && (
            <button aria-label="Return to city" onClick={onBack}>
              <ArrowLeft size={18} />
            </button>
          )}
          <button
            aria-label={sound ? "Mute battle sound" : "Enable battle sound"}
            onClick={() => {
              if (!audio.current) audio.current = new AudioContext();
              void audio.current.resume();
              setSound(v => !v);
            }}
          >
            {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button
            disabled={state.phase !== "active"}
            onClick={() => dispatch({ type: "pause" })}
          >
            <Pause size={16} /> Pause
          </button>
        </div>
      </header>
      <div className="sg-layout">
        <div className="sg-field-wrap" ref={battlefield}>
          <div className="sg-hud">
            <span>
              <Shield size={16} /> {state.integrity}/6 <small>BARRICADE</small>
            </span>
            <span className="sg-lanterns">
              {"◆".repeat(state.lanterns)}
              {"◇".repeat(3 - state.lanterns)} <small>LANTERNS</small>
            </span>
            <span>
              {state.wave}
              <small>WAVE / 5</small>
            </span>
          </div>
          <div className={`sg-field ${warning ? "sg-danger" : ""}`}>
            <svg viewBox="0 0 1536 1024" className="sg-map" aria-hidden="true">
              <image
                ref={tower}
                href={`${SIEGE_ART}/courtyard.png`}
                width="1536"
                height="1024"
              />
              {state.slots.map((s, i) =>
                s?.kind === "beacon" ? (
                  <circle
                    key={i}
                    cx={pads[i].x}
                    cy={pads[i].y}
                    r="95"
                    fill="#fff4ac"
                    fillOpacity=".17"
                    stroke="#ba913e"
                    strokeDasharray="4 6"
                  />
                ) : null
              )}
              {state.effects.map((e, i) =>
                e.kind === "pulse" ? (
                  <circle
                    key={i}
                    cx="780"
                    cy="700"
                    r={650 * (1 - e.life / 0.7)}
                    fill="none"
                    stroke="#fff9bd"
                    strokeWidth="9"
                    opacity={e.life * 2}
                  />
                ) : (
                  <g key={i}>
                    <line
                      x1={pads[e.from].x}
                      y1={pads[e.from].y}
                      x2={pathPoint(e.to).x}
                      y2={pathPoint(e.to).y}
                      stroke={e.kind === "launch" ? "#ffed9b" : "#46c5dd"}
                      strokeWidth={e.kind === "launch" ? 7 : 15}
                      opacity={e.life * 2}
                    />
                    {e.kind === "launch" && (
                      <g
                        transform={`translate(${pads[e.from].x + (pathPoint(e.to).x - pads[e.from].x) * (1 - e.life / 0.5)},${pads[e.from].y + (pathPoint(e.to).y - pads[e.from].y) * (1 - e.life / 0.5)}) rotate(${(Math.atan2(pathPoint(e.to).y - pads[e.from].y, pathPoint(e.to).x - pads[e.from].x) * 180) / Math.PI})`}
                      >
                        <rect
                          x="-13"
                          y="-8"
                          width="26"
                          height="16"
                          rx="5"
                          fill="#fae5a2"
                          stroke="#31514b"
                          strokeWidth="2"
                        />
                        <rect
                          x="-5"
                          y="-6"
                          width="9"
                          height="12"
                          rx="2"
                          fill="#7eb9bb"
                        />
                        <path
                          d="M-8-9h4m7 0h4m-15 18h4m7 0h4"
                          stroke="#24443f"
                          strokeWidth="4"
                        />
                      </g>
                    )}
                    <circle
                      cx={pathPoint(e.to).x}
                      cy={pathPoint(e.to).y}
                      r={24 * (1 - e.life)}
                      fill="none"
                      stroke={e.kind === "launch" ? "#fff7c0" : "#2d9bae"}
                      strokeWidth="5"
                    />
                  </g>
                )
              )}
            </svg>
            {state.phase === "active" && (
              <button
                className="sg-field-pulse"
                disabled={state.pulseCooldown > 0}
                onClick={() => dispatch({ type: "pulse" })}
              >
                <Zap size={18} />
                {state.pulseCooldown > 0
                  ? `${Math.ceil(state.pulseCooldown)}s`
                  : "Repulse"}
              </button>
            )}
            <span className="sg-route-label">
              Approach Route <small>Unmapped · abstract path</small>
            </span>
            {pads.map((p, i) => {
              const defense = state.slots[i];
              const Icon = defense ? icons[defense.kind] : Flag;
              return (
                <button
                  key={i}
                  className={`sg-pad ${selected === i ? "is-selected" : ""} ${defense ? `is-${defense.kind}` : ""}`}
                  style={{ left: `${p.x / 15.36}%`, top: `${p.y / 10.24}%` }}
                  aria-label={`Pad ${i + 1}${defense ? `: ${DEFENSES[defense.kind].name}` : ": empty"}`}
                  aria-pressed={selected === i}
                  onClick={() => setSelected(i)}
                >
                  {defense ? (
                    <span
                      className={`sg-defense-art art-${defense.kind}`}
                      aria-hidden="true"
                    />
                  ) : (
                    <Icon size={23} />
                  )}
                  <small>{i + 1}</small>
                  {defense && defense.kind !== "beacon" && (
                    <i
                      style={{
                        width: `${100 * (1 - defense.cooldown / DEFENSES[defense.kind].cooldown)}%`,
                      }}
                    />
                  )}
                </button>
              );
            })}
            {state.enemies.map(e => {
              const p = pathPoint(e.position);
              return (
                <button
                  key={e.id}
                  aria-label={`Focus ${e.kind === "lapse" ? "The Lapse" : "Dust"}${e.carrying ? " carrying lantern" : ""}`}
                  className={`sg-enemy is-${e.kind} ${state.focus === e.id ? "is-focused" : ""} ${e.slow > 0 ? "is-slow" : ""}`}
                  style={{
                    left: `${p.x / 15.36 + (e.kind === "dust" ? ((e.id % 3) - 1) * 0.8 : 0)}%`,
                    top: `${p.y / 10.24}%`,
                  }}
                  onClick={() => dispatch({ type: "focus", id: e.id })}
                >
                  <span className="sg-enemy-art" aria-hidden="true" />
                  {e.carrying && (
                    <b
                      className="sg-stolen-lantern"
                      aria-label="Stolen lantern"
                    >
                      ◆
                    </b>
                  )}
                  <i style={{ width: `${(e.hp / e.maxHp) * 100}%` }} />
                </button>
              );
            })}
            {warning && (
              <div className="sg-warning" role="alert">
                <Zap size={18} /> THE LAPSE IS COMING{" "}
                <small>Fast thief · save your Repulse</small>
              </div>
            )}
            {state.phase === "paused" && (
              <div className="sg-overlay">
                <Pause size={28} />
                <h2>Your battle can wait.</h2>
                <p>Nothing advances while you’re away.</p>
                <button
                  className="sg-primary"
                  onClick={() => dispatch({ type: "start" })}
                >
                  <Play size={18} /> Resume Siege
                </button>
              </div>
            )}
            {finished && (
              <div className="sg-overlay">
                <Shield size={32} />
                <span className="sg-eyebrow">CENTURY PARK EAST</span>
                <h2>
                  {state.phase === "held"
                    ? "The light holds."
                    : "A breach. A rematch."}
                </h2>
                <p>{state.notice}</p>
                <p>
                  {state.kills} Ruinbound cleared · {state.lanterns} lanterns
                  remain
                </p>
                <button
                  className="sg-primary"
                  onClick={() =>
                    setState(
                      newSiege(
                        returningSiegePressure(pressure, chronicle),
                        reflection
                      )
                    )
                  }
                >
                  <RotateCcw size={17} /> Defend again
                </button>
                <small>{state.reflection}</small>
              </div>
            )}
          </div>
        </div>
        <aside className="sg-command">
          <div className="sg-lumen">
            <div>
              <Sparkles size={20} />
              <strong>{Math.floor(state.lumen)}</strong>
              <span>Lumen</span>
              <small>/ 120</small>
            </div>
            <meter min="0" max="120" value={state.lumen} />
            <p>Regenerates during combat. Spend it freely.</p>
          </div>
          <div className="sg-pad-title">
            <span className="sg-eyebrow">EMPLACEMENT {selected + 1}</span>
            <h2>{slot ? DEFENSES[slot.kind].name : "Choose your defense"}</h2>
          </div>
          <div className="sg-defense-list">
            {(Object.keys(DEFENSES) as Defense[]).map(kind => {
              const d = DEFENSES[kind];
              const Icon = icons[kind];
              return (
                <button
                  key={kind}
                  disabled={!editable || Boolean(slot) || state.lumen < d.cost}
                  onClick={() =>
                    dispatch({ type: "deploy", slot: selected, kind })
                  }
                >
                  <Icon size={23} />
                  <span>
                    <strong>{d.name}</strong>
                    <small>{d.description}</small>
                  </span>
                  <b>{d.cost}</b>
                </button>
              );
            })}
          </div>
          {slot && (
            <button
              className="sg-recall"
              disabled={!editable}
              onClick={() => dispatch({ type: "sell", slot: selected })}
            >
              Recall defense · recover{" "}
              {Math.floor(DEFENSES[slot.kind].cost * 0.75)} Lumen
            </button>
          )}
          <button
            className="sg-pulse"
            disabled={state.phase !== "active" || state.pulseCooldown > 0}
            onClick={() => dispatch({ type: "pulse" })}
          >
            <Zap size={22} />
            <span>
              <strong>Repulse</strong>
              <small>
                {state.pulseCooldown > 0
                  ? `Ready in ${Math.ceil(state.pulseCooldown)}s`
                  : "Free · knockback + 1 damage to all enemies"}
              </small>
            </span>
          </button>
          {state.phase === "planning" && (
            <button
              className="sg-primary"
              onClick={() => dispatch({ type: "start" })}
            >
              <Play size={18} />{" "}
              {state.wave === 1 ? "Begin Siege" : `Send wave ${state.wave}`}
            </button>
          )}
          <div className="sg-notice" role="status">
            {state.notice}
          </div>
          <details className="sg-how">
            <summary>Field guide</summary>
            <p>
              Tap a pad, then a defense. Launch damages; Surge buys time; Beacon
              accelerates its neighbors. Tap an enemy to focus Launch fire when
              in range.
            </p>
            <p>
              Dust breaks barricades. The Lapse steals a fictional lantern and
              runs back down the route. Defeat it before it escapes. Hold all
              five waves to win.
            </p>
            <p>
              This fictional field kit does not confirm a real valet or
              fountain. The dashed Approach Route makes no claim about actual
              entrances.
            </p>
          </details>
          {chronicle.length > 0 && (
            <details className="sg-how">
              <summary>
                Stronghold Chronicle · {chronicle.length} battles
              </summary>
              {chronicle.slice(0, 5).map(entry => (
                <p key={entry.sessionId}>
                  {new Date(entry.endedAt).toLocaleDateString()} ·{" "}
                  {entry.outcome === "held"
                    ? "Held"
                    : `Breach at wave ${entry.wave}`}{" "}
                  · {entry.lanterns} lanterns
                </p>
              ))}
            </details>
          )}
          {state.pressure < pressure && (
            <p className="sg-save">
              Welcome back. This first battle has gentler pressure.
            </p>
          )}
          <p className="sg-save">
            {saveError
              ? "Local save unavailable. Keep this tab open to continue."
              : storageKey
                ? "Battle saved on this browser · leaving pauses combat"
                : "Session play · local resume needs your connected account"}
          </p>
        </aside>
      </div>
    </section>
  );
}
