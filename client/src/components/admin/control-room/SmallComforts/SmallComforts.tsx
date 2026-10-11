import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import "./smallComfortsPlate.css";
import { presentGate } from "./logic/gate";
import { useGateQuery } from "./useGateQuery";

type Ripple = { id: number; x: number; y: number };

/**
 * Small Comforts plate build.
 *
 * This is the cinematic painted-scene version, not the retired realtime
 * primitive-room prototype. The finished art is the room; JOYSTICK layers
 * motion, weather, light and interaction on top of it.
 */
export default function SmallComforts({ onExit }: { onExit: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [ripple, setRipple] = useState<Ripple | null>(null);
  // The server decides what is open. Nothing here can open a chapter.
  const gate = presentGate(useGateQuery());
  const [chapter, setChapter] = useState<number | null>(null);
  const [latchWiggle, setLatchWiggle] = useState(0);

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

  const makeRipple = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    // Behind the gate a tap does nothing but the latch.
    if (root.current?.dataset.gate !== "open") return;
    const rect = event.currentTarget.getBoundingClientRect();
    setRipple({
      id: Date.now(),
      x: ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100,
      y: ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100,
    });
  };

  const wiggleLatch = () => {
    setLatchWiggle(n => n + 1);
    latchClick();
  };

  // The scene stays behind the gate, dimmed. The gate only decides whether
  // the player can reach it.
  const playing = gate.kind === "open" && chapter !== null;

  return (
    <div
      ref={root}
      className="scp-root"
      data-small-comforts="plate"
      data-gate={playing ? "open" : gate.kind}
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

      <button type="button" className="scp-exit" onClick={onExit}>
        <span aria-hidden="true">←</span>
        Lantern City
      </button>

      {playing ? (
        <div className="scp-hint">
          <b>SMALL COMFORTS</b>
          <span>Move to look around · tap for a little light</span>
        </div>
      ) : (
        <div className="scp-gate" role="status" aria-live="polite">
          {gate.kind === "open" ? (
            <>
              <h2 className="scp-gate-title">Pick a chapter</h2>
              <ul className="scp-tags">
                {gate.tags.map(tag => (
                  <li key={tag.chapter}>
                    {tag.state === "open" ? (
                      <button
                        type="button"
                        className="scp-tag scp-tag-open"
                        onClick={() => setChapter(tag.chapter)}
                      >
                        {tag.label}
                      </button>
                    ) : (
                      <span
                        className={`scp-tag scp-tag-${tag.state}`}
                        aria-label={tag.state === "shut" ? "Not yet" : tag.label ?? undefined}
                      >
                        {tag.label ?? ""}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <button
                type="button"
                key={latchWiggle}
                className={`scp-latch${latchWiggle ? " scp-latch-wiggle" : ""}`}
                onClick={wiggleLatch}
                aria-label="The suitcase latch"
                disabled={gate.kind === "loading"}
              />
              <p className="scp-gate-line">{gate.message}</p>
              {gate.kind === "locked" && gate.progress ? (
                <p className="scp-gate-progress">{gate.progress}</p>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** One soft click on the latch. Procedural, optional: any audio failure is silence. */
function latchClick() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.07);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
    osc.onended = () => void ctx.close().catch(() => undefined);
  } catch {
    // Sound is a courtesy.
  }
}
