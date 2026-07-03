import { useCallback, useEffect, useRef, useState } from "react";
import { PublicBoreslayEngine, ARENA_HEIGHT, ARENA_WIDTH, type PublicBattleState } from "./engine";
import "./public-boreslay-demo.css";

const fmt = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

export function PublicBoreslayDemo() {
  const engineRef = useRef(new PublicBoreslayEngine());
  const keys = useRef(new Set<string>());
  const arenaRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PublicBattleState>(() => engineRef.current.state);
  const [engaged, setEngaged] = useState(false);
  const [joystick, setJoystick] = useState({ x: 0, y: 0 });

  const sync = useCallback(() => setState({ ...engineRef.current.state, spark: { ...engineRef.current.state.spark }, boss: { ...engineRef.current.state.boss }, projectiles: [...engineRef.current.state.projectiles], hazards: [...engineRef.current.state.hazards] }), []);
  const updateMovement = useCallback(() => {
    const k = keys.current;
    engineRef.current.setMovement(Number(k.has("KeyD") || k.has("ArrowRight")) - Number(k.has("KeyA") || k.has("ArrowLeft")), Number(k.has("KeyS") || k.has("ArrowDown")) - Number(k.has("KeyW") || k.has("ArrowUp")));
  }, []);

  useEffect(() => {
    let raf = 0, last = performance.now();
    const loop = (now: number) => { engineRef.current.update(now - last); last = now; sync(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sync]);

  useEffect(() => {
    if (!engaged) return;
    const down = (e: KeyboardEvent) => {
      if (["KeyW","KeyA","KeyS","KeyD","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space","KeyF","Escape"].includes(e.code)) e.preventDefault();
      if (e.code === "Escape") { engineRef.current.pause(); setEngaged(false); arenaRef.current?.blur(); return; }
      keys.current.add(e.code); updateMovement();
      if (e.code === "Space" && !e.repeat) engineRef.current.dash();
      if (e.code === "KeyF" && !e.repeat) engineRef.current.fire();
    };
    const up = (e: KeyboardEvent) => { keys.current.delete(e.code); updateMovement(); };
    const clear = () => { keys.current.clear(); updateMovement(); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", clear); document.removeEventListener("visibilitychange", clear); };
  }, [engaged, updateMovement]);

  const play = () => { engineRef.current.start(); setEngaged(true); arenaRef.current?.focus(); };
  const restart = () => { engineRef.current.reset(); engineRef.current.start(); setEngaged(true); arenaRef.current?.focus(); };
  const aim = (clientX: number, clientY: number) => { const r = arenaRef.current?.getBoundingClientRect(); if (r) engineRef.current.setAim((clientX-r.left)/r.width*ARENA_WIDTH, (clientY-r.top)/r.height*ARENA_HEIGHT); };
  const pointerMove = (e: React.PointerEvent) => { if (engaged && e.pointerType === "mouse") aim(e.clientX, e.clientY); };
  const joystickMove = (e: React.PointerEvent<HTMLDivElement>) => { e.currentTarget.setPointerCapture(e.pointerId); const r=e.currentTarget.getBoundingClientRect(); const x=(e.clientX-(r.left+r.width/2))/(r.width/2); const y=(e.clientY-(r.top+r.height/2))/(r.height/2); const d=Math.max(1,Math.hypot(x,y)); const next={x:x/d,y:y/d}; setJoystick(next); engineRef.current.setMovement(next.x,next.y); };
  const joystickEnd = () => { setJoystick({x:0,y:0}); engineRef.current.setMovement(0,0); };

  return <section className="pbd-shell" aria-label="Playable BORESLAY demo">
    <div className="pbd-title"><span>PLAY THE GAME.</span> COMMAND THE CREW. <strong>GROW YOUR BUSINESS.</strong></div>
    <div ref={arenaRef} className={`pbd-arena is-${state.status}`} tabIndex={0} onPointerMove={pointerMove} onPointerDown={e => { if (engaged && e.pointerType === "mouse") { aim(e.clientX,e.clientY); engineRef.current.fire(); } }} aria-label="Boss fight arena. Use WASD or arrow keys to move, Space to dash, mouse click or F to fire.">
      <div className="pbd-depth pbd-depth--far"/><div className="pbd-depth pbd-depth--near"/>
      <div className="pbd-hud pbd-hud--spark"><b>SPARK</b><span>Field Commander</span><div className="pbd-meter hp"><i style={{width:`${state.spark.hp}%`}}/></div><div className="pbd-meter energy"><i style={{width:`${state.spark.energy}%`}}/></div></div>
      <div className="pbd-bossbar"><b>THE PROCRASTINATOR</b><span>BOSS LEVEL 30</span><div className="pbd-meter hp"><i style={{width:`${state.boss.hp}%`}}/></div></div>
      <div className="pbd-contract"><span>DAILY CONTRACT</span><b>{fmt(state.contractRemainingMs)}</b><small>Defeat the Procrastinator</small></div>
      <div className={`pbd-spark ${state.time < state.spark.dashUntil ? "is-dashing":""} ${state.time < state.spark.invulnerableUntil ? "is-invulnerable":""}`} style={{left:`${state.spark.x/ARENA_WIDTH*100}%`,top:`${state.spark.y/ARENA_HEIGHT*100}%`, transform:`translate(-50%,-50%) scaleX(${state.spark.facing.x < 0 ? -1:1})`}}><img src="/assets/saleslay/dragon_idle.png" alt="Spark, the blue dragon"/></div>
      <div className={`pbd-boss ${state.time < state.boss.staggerUntil ? "is-hit":""} ${state.boss.telegraph !== "none" ? "is-telegraphing":""}`} style={{left:`${state.boss.x/ARENA_WIDTH*100}%`,top:`${state.boss.y/ARENA_HEIGHT*100}%`}}><img src={state.status==="victory"?"/assets/saleslay/villain_defeat.png":state.boss.telegraph==="excuse"?"/assets/saleslay/villain_attack.png":"/assets/saleslay/villain_idle.png"} alt="The Procrastinator, a hooded clock-face villain"/>{state.boss.telegraph !== "none" && <span>{state.boss.telegraph === "excuse" ? "EXCUSE THROW!" : "TIME SINK!"}</span>}</div>
      {state.projectiles.map(p => p.kind === "fire" ? <div key={p.id} className="pbd-fire" style={{left:`${p.x/ARENA_WIDTH*100}%`,top:`${p.y/ARENA_HEIGHT*100}%`, transform:`translate(-50%,-50%) rotate(${Math.atan2(p.vy,p.vx)}rad)`}}/> : <div key={p.id} className="pbd-excuse" style={{left:`${p.x/ARENA_WIDTH*100}%`,top:`${p.y/ARENA_HEIGHT*100}%`}}>EXCUSE</div>)}
      {state.hazards.map(h => <div key={h.id} className={`pbd-hazard ${state.time>=h.telegraphUntil?"is-active":""}`} style={{left:`${h.x/ARENA_WIDTH*100}%`,top:`${h.y/ARENA_HEIGHT*100}%`,width:`${h.radius*2/ARENA_WIDTH*100}%`,aspectRatio:"1"}}/>)}
      <div className="pbd-influence"><span>SPARK {Math.round(state.influence)}%</span><b>KINGDOM INFLUENCE</b><span>{Math.round(100-state.influence)}% FOG</span><i><em style={{width:`${state.influence}%`}}/></i></div>
      {!engaged && (state.status === "idle" || state.status === "paused") && <div className="pbd-gate"><h1>{state.status === "paused" ? "BATTLE PAUSED" : "PLAY THE GAME."}</h1><p>{state.status === "paused" ? "Nothing moved. Resume when you’re ready." : "You are Spark. Move, dodge the EXCUSE scrolls, and burn down The Procrastinator."}</p><button onClick={play}>{state.status === "paused" ? "RESUME BATTLE" : "PLAY DEMO"}</button><small>WASD / ARROWS · SPACE DASH · MOUSE / F FIRE · ESC PAUSE</small></div>}
      {(state.status === "victory" || state.status === "defeat") && <div className="pbd-gate"><h1>{state.status === "victory" ? "CONTRACT CONQUERED" : "SPARK HAS FALLEN"}</h1><p>{state.message}</p><button onClick={restart}>FIGHT AGAIN</button></div>}
      <div className="pbd-joystick" onPointerMove={joystickMove} onPointerDown={joystickMove} onPointerUp={joystickEnd} onPointerCancel={joystickEnd}><i style={{transform:`translate(${joystick.x*30}px,${joystick.y*30}px)`}}/></div>
      <div className="pbd-touch-actions"><button onPointerDown={e=>{e.stopPropagation();engineRef.current.dash();}}>DASH</button><button className="fire" onPointerDown={e=>{e.stopPropagation();engineRef.current.setAim(state.boss.x,state.boss.y);engineRef.current.fire();}}>FIRE</button></div>
      <div className="pbd-status" aria-live="polite">{state.message}</div>
    </div>
    <div className="pbd-controls"><span><b>MOVE</b> WASD / ARROWS</span><span><b>DASH</b> SPACE</span><span><b>FIRE BREATH</b> CLICK / F</span><span><b>PAUSE</b> ESC</span></div>
  </section>;
}
