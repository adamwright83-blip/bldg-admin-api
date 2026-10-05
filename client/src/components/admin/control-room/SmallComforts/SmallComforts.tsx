import { useEffect, useRef, useState } from "react";
import "./smallComfortsPlate.css";

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

  const makeRipple = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setRipple({
      id: Date.now(),
      x: ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100,
      y: ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100,
    });
  };

  return (
    <div
      ref={root}
      className="scp-root"
      data-small-comforts="plate"
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

      <div className="scp-hint">
        <b>SMALL COMFORTS</b>
        <span>Move to look around · tap for a little light</span>
      </div>
    </div>
  );
}
