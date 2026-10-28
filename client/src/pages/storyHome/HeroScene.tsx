import { useEffect, useRef } from "react";
import { HOME_ART } from "./homeModel";

/**
 * The hero's living backdrop: the city at dusk drifting slowly, a path of glass tiles floating up to the house on the
 * hill with light travelling along it, the traveller standing on tonight's tile, clouds and sparks in front. The mouse
 * adds a little depth (near layers move more than far ones).
 *
 * Decoration only: hidden from assistive tech, no text, no story words. Reduced motion gets a still composition and
 * no pointer tracking. On narrow screens the path and traveller give way to the copy; the city and clouds stay.
 */

/** Tile centres on the city plate, in percent of the plate, nearest first. Scale shrinks with distance. */
export const HERO_PATH: readonly { x: number; y: number; s: number }[] = [
  { x: 47, y: 91, s: 1 },
  { x: 58, y: 77.5, s: 0.78 },
  { x: 66, y: 66, s: 0.6 },
  { x: 72, y: 55.5, s: 0.46 },
  { x: 76.5, y: 46.5, s: 0.36 },
  { x: 80, y: 39, s: 0.28 },
  { x: 83, y: 32.5, s: 0.22 },
  { x: 85.5, y: 27, s: 0.17 },
  { x: 87.5, y: 22.5, s: 0.13 },
];
/** The tile the traveller stands on. */
export const TRAVELLER_TILE = 1;

const SPARKS = [8, 17, 23, 31, 38, 46, 52, 59, 64, 71, 77, 83, 90, 96];

export function HeroScene() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hero = ref.current?.parentElement;
    if (!hero || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.matchMedia("(pointer: coarse)").matches) return;
    let frame = 0;
    let mx = 0;
    let my = 0;
    const apply = () => {
      frame = 0;
      hero.style.setProperty("--sh-mx", mx.toFixed(3));
      hero.style.setProperty("--sh-my", my.toFixed(3));
    };
    const move = (event: PointerEvent) => {
      const box = hero.getBoundingClientRect();
      mx = Math.max(-1, Math.min(1, ((event.clientX - box.left) / box.width - 0.5) * 2));
      my = Math.max(-1, Math.min(1, ((event.clientY - box.top) / box.height - 0.5) * 2));
      if (!frame) frame = window.requestAnimationFrame(apply);
    };
    const leave = () => {
      mx = 0;
      my = 0;
      if (!frame) frame = window.requestAnimationFrame(apply);
    };
    hero.addEventListener("pointermove", move);
    hero.addEventListener("pointerleave", leave);
    return () => {
      hero.removeEventListener("pointermove", move);
      hero.removeEventListener("pointerleave", leave);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="sh-scene" ref={ref} aria-hidden="true" data-testid="story-home-scene">
      <div className="sh-stage">
        <div className="sh-layer sh-layer-sky">
          <img className="sh-sky" src={HOME_ART.hero.sky} alt="" decoding="async" fetchPriority="high" />
        </div>
        <div className="sh-layer sh-layer-path">
          {HERO_PATH.map((tile, i) => (
            <div
              key={i}
              className="sh-tile"
              style={{ left: `${tile.x}%`, top: `${tile.y}%`, width: `${21 * tile.s}%`, ["--i" as string]: i, ["--s" as string]: tile.s }}
            >
              <div className="sh-tile-body">
                <img className="sh-tile-img" src={i === 0 ? HOME_ART.hero.tileStar : HOME_ART.hero.tileBlank} alt="" decoding="async" />
                {i === TRAVELLER_TILE ? <img className="sh-traveller" src={HOME_ART.hero.traveller} alt="" decoding="async" /> : null}
              </div>
            </div>
          ))}
        </div>
        <div className="sh-layer sh-layer-near">
          <span className="sh-cloud sh-cloud-a" />
          <span className="sh-cloud sh-cloud-b" />
          {SPARKS.map((left, i) => (
            <span key={i} className="sh-spark" style={{ left: `${left}%`, ["--k" as string]: i }} />
          ))}
        </div>
      </div>
      <div className="sh-scrim" />
    </div>
  );
}
