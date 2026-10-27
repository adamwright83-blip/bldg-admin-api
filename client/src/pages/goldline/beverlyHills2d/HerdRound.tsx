import { useEffect, useRef, useState } from "react";
import { DURATION, HW, newHerd, par, pennedCount, lostCount, shepherd, tickHerd, type Herd } from "./herd";
import { newFx, paintHerd } from "./herdPaint";
import { createHerdSounds } from "./herdSounds";
import { H, type Art } from "./paint";
import { VIEW } from "./adventure";
import styles from "./other-rodeo.module.css";

/**
 * The Round-Up screen. Bring the herd home before dark: steer by where you stand, bark (Space) to move them, sprint
 * (Shift) to get round the back, and run away from the herd when you want the boxer to charge it.
 */
const BEST = "joystick.round-up.best.v1";
type Best = { stars: number; time: number; penned: number };
const readBest = (): Best | null => {
  try {
    return JSON.parse(localStorage.getItem(BEST) ?? "null");
  } catch {
    return null;
  }
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function HerdRound({ art, extraCows, onExit, reduced, sound }: { art: Art; extraCows: number; onExit: () => void; reduced: boolean; sound: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const herd = useRef<Herd>(newHerd(undefined, extraCows));
  const fx = useRef(newFx());
  const keys = useRef(new Set<string>());
  const barkPressed = useRef(false);
  const sounds = useRef(createHerdSounds());
  const cam = useRef(0);
  const [view, setView] = useState({ penned: 0, total: herd.current.cows.length, lost: 0, time: 0, boxer: "follow", coyote: "away" });
  const [over, setOver] = useState<Herd["over"]>(null);
  const [banner, setBanner] = useState<{ text: string; id: number } | null>(null);
  const [intro, setIntro] = useState(true);
  const [paused, setPaused] = useState(false);
  const [best, setBest] = useState<Best | null>(readBest);
  const [newBest, setNewBest] = useState(false);
  const live = useRef(false);
  live.current = !intro && !paused && !over;

  useEffect(() => {
    sounds.current.setMuted(!sound);
  }, [sound]);
  useEffect(() => () => sounds.current.dispose(), []);
  useEffect(() => {
    if (!intro) return;
    const t = setTimeout(() => setIntro(false), 1900);
    return () => clearTimeout(t);
  }, [intro]);

  function say(text: string) {
    setBanner({ text, id: Math.random() });
  }
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 1500);
    return () => clearTimeout(t);
  }, [banner]);

  function restart() {
    herd.current = newHerd(undefined, extraCows);
    fx.current = newFx();
    cam.current = 0;
    setOver(null);
    setNewBest(false);
    setPaused(false);
    setIntro(true);
  }

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    let raf = 0, last = performance.now(), ui = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const h = herd.current;
      const k = keys.current;
      const input = {
        dx: (k.has("ArrowRight") || k.has("KeyD") ? 1 : 0) - (k.has("ArrowLeft") || k.has("KeyA") ? 1 : 0),
        dz: (k.has("ArrowDown") || k.has("KeyS") ? 1 : 0) - (k.has("ArrowUp") || k.has("KeyW") ? 1 : 0),
        sprint: k.has("ShiftLeft") || k.has("ShiftRight") || k.has("Run"),
        bark: barkPressed.current,
      };
      barkPressed.current = false;
      // visual-test builds only: a capture can hand the round to the bot shepherd
      const hook = import.meta.env.VITE_ADMIN_VISUAL_TEST === "1" ? (window as unknown as { __roundUpAuto?: boolean; __roundUpSpeed?: number }) : {};
      const steps = Math.max(1, Math.min(8, Math.round(hook.__roundUpSpeed ?? 1)));
      for (let i = 0; i < steps && live.current && !h.over; i++) tickHerd(h, dt, hook.__roundUpAuto ? shepherd(h) : i ? { ...input, bark: false } : input);
      // what happened becomes sound, gold numbers and shouts
      for (const e of h.events) {
        if (e.kind === "moo") sounds.current.moo(e.n ?? 1);
        else if (e.kind === "bark") sounds.current.bark();
        else if (e.kind === "charge") sounds.current.charge();
        else if (e.kind === "penned") {
          sounds.current.penned(e.n ?? 1);
          fx.current.floats.push({ x: e.x, z: e.z, t: 0, text: "+1", gold: true });
        } else if (e.kind === "combo") {
          sounds.current.combo(e.n ?? 2);
          say(e.n === 2 ? "Double!" : e.n === 3 ? "Triple!" : `${e.n} in a row!`);
        } else if (e.kind === "lost") {
          sounds.current.lost();
          fx.current.flash = 1;
          say("Into the wrong century…");
        } else if (e.kind === "coyote") {
          sounds.current.coyote();
          say("Coyote!");
        } else if (e.kind === "coyoteFlee") {
          sounds.current.flee();
          say("Shoo.");
        } else if (e.kind === "baffled") fx.current.floats.push({ x: e.x, z: e.z, t: 0, text: "?", gold: false });
        else if (e.kind === "nap") fx.current.floats.push({ x: e.x, z: e.z, t: 0, text: "z z z", gold: false });
      }
      h.events = [];
      const target = Math.max(0, Math.min(HW - VIEW, h.dog.x - VIEW * 0.42));
      cam.current += (target - cam.current) * (1 - Math.exp(-dt * 4));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (c.width !== Math.round(VIEW * dpr)) {
        c.width = Math.round(VIEW * dpr);
        c.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintHerd(ctx, art, h, fx.current, cam.current, live.current ? dt : 0, reduced);
      ui += dt;
      if (ui > 0.1) {
        ui = 0;
        setView({ penned: pennedCount(h), total: h.cows.length, lost: lostCount(h), time: h.time, boxer: h.boxer.state, coyote: h.coyote.state });
      }
      if (h.over && !over) {
        const o = h.over;
        setOver(o);
        sounds.current.win(o.stars);
        const prev = readBest();
        const better = !prev || o.stars > prev.stars || (o.stars === prev.stars && (o.penned > prev.penned || (o.penned === prev.penned && o.time < prev.time)));
        if (better) {
          const b = { stars: o.stars, time: o.time, penned: o.penned };
          try {
            localStorage.setItem(BEST, JSON.stringify(b));
          } catch {
            /* private window: the best lasts the session */
          }
          setBest(b);
          setNewBest(true);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [art, reduced, over]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches?.("input,textarea,select")) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(e.code)) e.preventDefault();
      if (e.code === "Escape") {
        setPaused(p => !p);
        keys.current.clear();
        return;
      }
      keys.current.add(e.code);
      if (e.code === "Space" && !e.repeat) barkPressed.current = true;
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const hold = (code: string) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      keys.current.add(code);
    },
    onPointerUp: () => keys.current.delete(code),
    onPointerCancel: () => keys.current.delete(code),
    onLostPointerCapture: () => keys.current.delete(code),
  });
  const left = Math.max(0, DURATION - view.time);
  const sun = Math.min(1, view.time / DURATION);

  return (
    <div className={styles.roundUp} data-testid="round-up" data-penned={view.penned} data-total={view.total} data-lost={view.lost} data-over={over ? "yes" : "no"} data-boxer={view.boxer} data-coyote={view.coyote}>
      <div className={styles.stage}>
        <canvas ref={canvas} aria-label="The Round-Up. Walk with the arrow keys or WASD, Shift to sprint, Space to bark. Run away from the herd to send the boxer charging into it." />
      </div>
      <div className={styles.ruHud}>
        <div className={styles.ruCount} aria-live="polite">
          <b>{view.penned}</b>
          <span>/ {view.total} home</span>
          {view.lost ? <small>{view.lost} lost to the tear</small> : null}
        </div>
        <div className={styles.ruClock} aria-label={`${clock(left)} until dark`}>
          <div className={styles.ruTrack}>
            <span className={styles.ruSun} style={{ left: `${sun * 100}%` }} />
          </div>
          <small>
            {clock(left)} until dark · ★★★ under {clock(par(view.total))}
          </small>
        </div>
        <div className={styles.ruBest}>{best ? <>Best {"★".repeat(best.stars)}{"☆".repeat(3 - best.stars)} · {best.penned} home{best.stars >= 2 ? ` · ${clock(best.time)}` : ""}</> : "First round"}</div>
      </div>
      {banner ? (
        <div key={banner.id} className={styles.ruBanner}>
          {banner.text}
        </div>
      ) : null}
      {intro && !over ? (
        <div className={styles.ruIntro}>
          <h2>Bring them home before dark.</h2>
          <p>They drift away from you. Bark to move them. Run away from the herd and he charges it.</p>
        </div>
      ) : null}
      {!over ? (
        <>
          <div className={styles.controls}>
            <span>← → ↑ ↓ Walk</span>
            <span>Shift Sprint</span>
            <span>Space Bark</span>
            <span>Run from the herd: he charges</span>
          </div>
          <div className={`${styles.touch} ${styles.ruTouch}`}>
            <div className={styles.ruPad}>
              <button aria-label="Walk deeper" style={{ gridArea: "up" }} {...hold("ArrowUp")}>↑</button>
              <button aria-label="Walk left" style={{ gridArea: "left" }} {...hold("ArrowLeft")}>←</button>
              <button aria-label="Walk nearer" style={{ gridArea: "down" }} {...hold("ArrowDown")}>↓</button>
              <button aria-label="Walk right" style={{ gridArea: "right" }} {...hold("ArrowRight")}>→</button>
            </div>
            <div className={styles.ruActs}>
              <button aria-label="Sprint" {...hold("Run")}>Run</button>
              <button aria-label="Bark" onPointerDown={() => (barkPressed.current = true)}>Bark</button>
            </div>
          </div>
        </>
      ) : null}
      {paused && !over ? (
        <div className={styles.modalShade}>
          <section className={styles.pause} role="dialog" aria-label="Round-up paused">
            <h2>The herd will wait.</h2>
            <button className={styles.primary} onClick={() => setPaused(false)}>Keep herding →</button>
            <button onClick={restart}>Start the round over</button>
            <button onClick={onExit}>Back to the story</button>
          </section>
        </div>
      ) : null}
      {over ? (
        <div className={styles.modalShade}>
          <section className={styles.ruResults} role="dialog" aria-label="Round-up results" data-testid="round-up-results">
            <div className={styles.ruStars} aria-label={`${over.stars} of 3 stars`}>
              {[0, 1, 2].map(i => (
                <span key={i} className={i < over.stars ? styles.ruStarOn : ""} style={{ animationDelay: `${0.2 + i * 0.18}s` }}>★</span>
              ))}
            </div>
            <h2>{over.penned === over.total ? `All ${over.total} home in ${clock(over.time)}.` : over.penned ? `${over.penned} of ${over.total} home before dark.` : "Dark, and not one home."}</h2>
            <p>
              {over.stars === 3 ? "Before the light even turned." : over.stars === 2 ? `Every one home. Under ${clock(par(over.total))} gets the third star.` : over.lost ? "The tear took some. They wander back next round." : "Get round behind them, and let the boxer do the heavy work."}
            </p>
            {newBest ? <p className={styles.ruNewBest}>New best.</p> : null}
            <button className={styles.primary} onClick={restart} data-testid="round-up-again">Again →</button>
            <button onClick={onExit}>Back to the story</button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
