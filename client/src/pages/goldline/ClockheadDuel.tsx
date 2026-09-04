import { useEffect, useRef, useState } from "react";
import { createClockDuel, stepClockDuel, CLOCK_PHASE_NAMES } from "./clockheadDuelEngine";
import { sweepAngleDegrees } from "./colosseumCombat";
import { DynamicJoystick } from "./DynamicJoystick";
import { getAudioManager } from "@/game/audio/AudioManager";
import { combatHurtFeedback, combatRevealFeedback } from "@/game/audio/haptics";
import "./clockhead-duel.css";

/** Receives no person record and cannot publish a business outcome. */
export default function ClockheadDuel({ onDefeated }: { onDefeated: () => void }) {
  const [world, setWorld] = useState(createClockDuel);
  const ref = useRef(world);
  const input = useRef({ x: 0, y: 0, dodge: false, strike: false });
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(() => getAudioManager().isMuted);
  const completed = useRef(false);
  useEffect(() => {
    if (!started) return;
    let raf = 0; let last = performance.now();
    const tick = (now: number) => {
      const elapsed = now - last; last = now;
      if (!document.hidden) {
        const before = ref.current;
        const next = stepClockDuel(before, elapsed, input.current);
        input.current.dodge = false; input.current.strike = false;
        if (next.cue !== before.cue) {
          const audio = getAudioManager();
          if (next.hp < before.hp) { audio.play("player_hurt"); combatHurtFeedback(); }
          else if (next.bossHp < before.bossHp) { audio.play(next.stage === "won" ? "hostile_down" : "strike_hit"); combatRevealFeedback(); }
          else audio.play(next.stage === "tell" ? "clockhead_charge" : next.stage === "attack" ? next.pattern === "sweep" ? "clockhead_sweep" : "clockhead_fire" : "target_reveal");
        }
        ref.current = next; setWorld(next);
      }
      raf = requestAnimationFrame(tick);
    };
    const keys = new Set<string>();
    const move = () => { input.current.x = Number(keys.has("d") || keys.has("ArrowRight")) - Number(keys.has("a") || keys.has("ArrowLeft")); input.current.y = Number(keys.has("s") || keys.has("ArrowDown")) - Number(keys.has("w") || keys.has("ArrowUp")); };
    const down = (event: KeyboardEvent) => {
      if (!["w","a","s","d","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," ","Shift"].includes(event.key)) return;
      event.preventDefault(); keys.add(event.key); move();
      if (!event.repeat && event.key === " ") input.current.strike = true;
      if (!event.repeat && event.key === "Shift") input.current.dodge = true;
    };
    const up = (event: KeyboardEvent) => { keys.delete(event.key); move(); };
    const blur = () => { keys.clear(); input.current = { x: 0, y: 0, strike: false, dodge: false }; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, [started]);
  const finished = world.stage === "won" || world.stage === "lost";
  return <main className={`clock-duel is-${world.stage}${world.hurtMs > 750 ? " is-hurt" : ""}`} data-testid="clockhead-duel" data-phase={world.phase} data-stage={world.stage} data-hp={world.hp} data-boss-hp={world.bossHp}>
    <header><small>FIELD TRACE VERIFIED · FICTIONAL ENCOUNTER</small><h1>CLOCKHEAD</h1><strong>{world.phase} · {CLOCK_PHASE_NAMES[world.phase]}</strong><p role="status">{world.line}</p><p>Clockhead {world.bossHp}/9 · Guard {world.hp}/3</p></header>
    <div className="clock-duel-arena" aria-label="Move, dodge the tells, strike while Clockhead winds himself">
      <img className="clock-duel-boss" src="/assets/boreslay-hero/procrastinator-reference.png" alt="Clockhead, a fictional clock-headed antagonist" />
      {world.stage === "tell" ? <div className="clock-tell">{world.pattern === "sweep" ? "CLOCK SWEEP — DODGE THE HAND" : world.pattern === "deadline" ? "DEADLINE — LEAVE THE MARK" : world.pattern === "fan" ? "THREE SHOTS — MOVE THROUGH THE GAP" : "AIMED SHOT — KEEP MOVING"}</div> : null}
      {world.stage === "exposed" ? <div className="clock-tell">WINDING — CLOSE IN AND STRIKE</div> : null}
      <svg className="clock-duel-effects" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {world.pattern === "sweep" && world.stage === "attack" ? <line x1="50" y1="31" x2={50 + Math.cos(sweepAngleDegrees(world.clock / 1200) * Math.PI / 180) * 67} y2={31 + Math.sin(sweepAngleDegrees(world.clock / 1200) * Math.PI / 180) * 67} stroke="#ffe989" strokeWidth="1.2" /> : null}
        {world.pattern === "deadline" && world.stage === "attack" ? <circle cx={world.target.x} cy={world.target.y} r="14" fill={world.clock >= 1100 ? "#ffac49b0" : "#bd3d6630"} stroke="#ffe3a5" strokeWidth=".7" strokeDasharray="2 1" /> : null}
        {world.projectiles.map(p => <circle key={p.id} cx={p.x} cy={p.y} r="1.3" fill="#fff1b0" stroke="#ff8a2d" strokeWidth=".6" />)}
        {world.stage === "exposed" ? <circle cx="50" cy="31" r="38" fill="none" stroke="#8bffff66" strokeWidth=".4" strokeDasharray="1 2" /> : null}
      </svg>
      <img className={`clock-duel-player${world.dodgeMs ? " is-dodging" : ""}`} src="/assets/goldline/characters/trailblazer/directional/idle-back.webp" alt="Trailblazer" style={{ left: `${world.player.x}%`, top: `${world.player.y}%` }} />
      {!started ? <button className="clock-duel-start" onClick={() => { getAudioManager().play("clockhead_charge"); setStarted(true); }}>Face Clockhead</button> : null}
      {finished ? <div className="clock-duel-result"><h2>{world.stage === "won" ? "THE FINAL HOUR IS YOURS" : "TIME’S UP"}</h2><p>{world.stage === "won" ? "The Wayward route is unlocked. This victory records no visit, sale, or revenue." : "Read the tell, move, then close in during winding."}</p>
        {world.stage === "won" ? <button onClick={() => { if (!completed.current) { completed.current = true; onDefeated(); } }}>Take the Wayward route</button> : <button onClick={() => { const fresh = createClockDuel(); ref.current = fresh; setWorld(fresh); }}>Retry Clockhead</button>}
      </div> : null}
    </div>
    <footer><DynamicJoystick disabled={!started || finished} onInput={(x, y) => { input.current.x = x; input.current.y = y; }} /><div><button disabled={!started || finished || world.dodgeCooldown > 0} onPointerDown={() => { input.current.dodge = true; }}>DODGE</button><button disabled={!started || finished} onPointerDown={() => { input.current.strike = true; }}>STRIKE</button><button onClick={() => { getAudioManager().setMuted(!muted); setMuted(!muted); }}>{muted ? "Unmute" : "Mute"}</button><small>WASD / arrows · Shift dodge · Space strike</small></div></footer>
  </main>;
}
