/**
 * THE OCCUPATION LAYER.
 *
 * A guarded territory is not weather. It is SEALED — buried under a localized,
 * mostly opaque pale mass that reads as cloud-stone / ivory ash / snowbank, so
 * a player glancing at the board has zero ambiguity about which neighbourhood
 * is blocked.
 *
 * WHY THIS IS DRAWN, NOT PAINTED FROM AN ASSET
 *
 * The previous treatment masked one wispy fog PNG into the polygon. A single
 * translucent texture can only ever read as haze: you could still see the
 * streets through it, and the same texture stretched across differently shaped
 * territories at different scales. Drawing the shroud means every guarded
 * territory gets a cover that is (a) genuinely opaque, (b) shaped by its own
 * polygon, and (c) lumpy in a way derived from that polygon's own outline.
 *
 * LOCALIZED, ALWAYS
 *
 * Every layer below is clipped to ONE territory's atlas polygon. There is no
 * shared weather front. Feathering past the edge is deliberately small — a
 * fringe, not a spill — because a shroud that drifts over the neighbouring
 * territory destroys the very thing it exists to communicate: this one is
 * blocked, that one is yours.
 */
import type { LanternTerritory } from "@shared/lanternTerritories";
import { atlasPolygon } from "@shared/lanternTerritories";

type Point = { x: number; y: number };

/**
 * Deterministic noise from a territory id.
 *
 * Billow placement must be stable across renders — a shroud that reshuffles its
 * lumps every paint reads as animated smoke, which is exactly the impression
 * this layer exists to kill. Same territory, same mass, every time.
 */
function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pointInRing(point: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

type Billow = { x: number; y: number; r: number };

/**
 * The sculptural relief.
 *
 * Two families, both derived from the territory's own outline:
 *
 *   edge billows    centred on the polygon's vertices, so the silhouette of the
 *                   cover is lumpy rather than a PowerPoint polygon fill
 *   interior lumps  a jittered grid kept inside the polygon, so the surface has
 *                   snowbank topology instead of a flat plate of paint
 */
function buildBillows(
  rings: readonly (readonly Point[])[],
  seed: string
): {
  edge: Billow[];
  coarse: Billow[];
  fine: Billow[];
  bounds: { x: number; y: number; w: number; h: number };
} {
  const random = seededRandom(seed);
  const all = rings.flat();
  const xs = all.map(p => p.x);
  const ys = all.map(p => p.y);
  const bounds = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
  const scale = Math.max(bounds.w, bounds.h);

  const edge: Billow[] = [];
  for (const ring of rings) {
    // Walk the ring at a fixed spacing so a long edge gets as many billows as a
    // short one gets few — vertex count is an authoring artefact, not a shape.
    const step = Math.max(scale * 0.13, 1.1);
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const span = Math.hypot(b.x - a.x, b.y - a.y);
      const count = Math.max(1, Math.round(span / step));
      for (let s = 0; s < count; s += 1) {
        const t = (s + random() * 0.5) / count;
        edge.push({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          r: scale * (0.075 + random() * 0.075),
        });
      }
    }
  }

  /*
    Two passes, not one. A single grid of same-sized lumps reads as bubble wrap
    — the eye finds the lattice immediately. Big masses laid down first and
    smaller detail broken over the top is what makes a snowbank look carved
    rather than tiled, so the coarse pass carries the form and the fine pass
    only breaks its silhouette.
  */
  const inside = (px: number, py: number) =>
    rings.some(ring => pointInRing({ x: px, y: py }, ring));
  const pass = (cellFactor: number, radius: [number, number]): Billow[] => {
    const cell = Math.max(scale * cellFactor, 0.9);
    const out: Billow[] = [];
    for (let row = 0; ; row += 1) {
      const y = bounds.y + row * cell * 0.82;
      if (y > bounds.y + bounds.h + cell) break;
      // Offset alternate rows so the grid never lines up into columns.
      const offset = (row % 2) * cell * 0.5;
      for (let x = bounds.x + offset; x <= bounds.x + bounds.w + cell; x += cell) {
        const px = x + (random() - 0.5) * cell * 0.9;
        const py = y + (random() - 0.5) * cell * 0.9;
        if (!inside(px, py)) continue;
        out.push({
          x: px,
          y: py,
          r: scale * (radius[0] + random() * (radius[1] - radius[0])),
        });
      }
    }
    return out;
  };
  const coarse = pass(0.28, [0.13, 0.2]);
  const fine = pass(0.15, [0.055, 0.1]);
  return { edge, coarse, fine, bounds };
}

/**
 * The glowing fissures.
 *
 * Seams between billows, not decoration scattered on top: each crack runs from
 * one interior lump towards its neighbour, so the light reads as leaking out of
 * the mass rather than as being drawn over it.
 */
function buildCracks(interior: readonly Billow[], seed: string): string[] {
  const random = seededRandom(`${seed}-cracks`);
  const paths: string[] = [];
  for (const a of interior) {
    // Nearest neighbour, so a seam runs along the valley BETWEEN two touching
    // masses. Pairing lumps arbitrarily drew long straight rods across the
    // surface instead, which read as sticks lying on top of the cover.
    let nearest: Billow | null = null;
    let best = Infinity;
    for (const b of interior) {
      if (b === a) continue;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d < best) {
        best = d;
        nearest = b;
      }
    }
    if (!nearest) continue;
    const midX = (a.x + nearest.x) / 2 + (random() - 0.5) * a.r * 0.55;
    const midY = (a.y + nearest.y) / 2 + (random() - 0.5) * a.r * 0.55;
    paths.push(`M ${a.x} ${a.y} Q ${midX} ${midY} ${nearest.x} ${nearest.y}`);
  }
  return paths;
}

export function TerritoryShroud({ territory }: { territory: LanternTerritory }) {
  const rings = atlasPolygon(territory).map(ring =>
    ring.map(p => ({ x: p.x, y: p.y }))
  );
  if (!rings.length) return null;
  const id = territory.id;
  const { edge, coarse, fine, bounds } = buildBillows(rings, id);
  const cracks = buildCracks(coarse, id);
  const scale = Math.max(bounds.w, bounds.h);
  const lump = (b: Billow, key: string, shrink: number) => (
    <circle
      key={key}
      className="gl-shroud-lump"
      cx={b.x}
      cy={b.y}
      r={b.r * shrink}
      fill={`url(#shroud-lump-${id})`}
    />
  );

  return (
    <g className="gl-territory-shroud" data-territory-id={id}>
      <defs>
        {/*
          The cover's own silhouette: the polygon PLUS its edge billows, blurred
          only enough to soften the rim. A large blur here is what turned the old
          treatment into fog — the mass must stay decisive, so the feather is a
          fraction of the territory, not a multiple of it.
        */}
        <filter
          id={`shroud-feather-${id}`}
          x="-25%"
          y="-25%"
          width="150%"
          height="150%"
        >
          <feGaussianBlur stdDeviation={Math.max(scale * 0.016, 0.25)} />
        </filter>
        <mask
          id={`shroud-mask-${id}`}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="100"
          height="100"
        >
          <g filter={`url(#shroud-feather-${id})`} fill="white">
            {rings.map((ring, i) => (
              <polygon key={i} points={ring.map(p => `${p.x},${p.y}`).join(" ")} />
            ))}
            {edge.map((b, i) => (
              <circle key={`e${i}`} cx={b.x} cy={b.y} r={b.r} />
            ))}
          </g>
        </mask>
        {/*
          Relief lighting. Each lump is lit from the top-left and falls into a
          cool recess at its lower-right — enough depth to feel carved, nowhere
          near enough to darken the neighbourhood into night.
        */}
        <radialGradient id={`shroud-lump-${id}`} cx="34%" cy="27%" r="82%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="46%" stopColor="#fffcf4" stopOpacity="1" />
          <stop offset="84%" stopColor="#f3eee6" stopOpacity="1" />
          <stop offset="100%" stopColor="#cdd3e8" stopOpacity="0.92" />
        </radialGradient>
        {/* Bloom on the seams. Without it a crack is a hard-edged orange line
            sitting on the cover; with it the gold reads as light coming out. */}
        <filter
          id={`shroud-bloom-${id}`}
          x="-40%"
          y="-40%"
          width="180%"
          height="180%"
        >
          <feGaussianBlur stdDeviation={Math.max(scale * 0.014, 0.16)} />
        </filter>
        <radialGradient id={`shroud-pocket-${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#93a0cc" stopOpacity="0.44" />
          <stop offset="100%" stopColor="#8e99c2" stopOpacity="0" />
        </radialGradient>
      </defs>

      <g mask={`url(#shroud-mask-${id})`}>
        {/* A. BASE MASS — opaque. The neighbourhood underneath is gone. */}
        <rect
          className="gl-shroud-base"
          x={bounds.x - scale}
          y={bounds.y - scale}
          width={bounds.w + scale * 2}
          height={bounds.h + scale * 2}
        />
        {/* C. SHADOW POCKETS — cool recesses under the coarse masses, drawn
             first so every billow above them reads as sitting proud. */}
        {coarse.map((b, i) => (
          <circle
            key={`p${i}`}
            cx={b.x + b.r * 0.22}
            cy={b.y + b.r * 0.3}
            r={b.r * 1.15}
            fill={`url(#shroud-pocket-${id})`}
          />
        ))}
        {/* B1. COARSE FORM — the masses that carry the topology. */}
        {coarse.map((b, i) => lump(b, `c${i}`, 0.9))}
        {/* D. GOLD CRACK LIGHT — threaded between the two billow passes:
             over the coarse masses so the seams sit in their valleys, under the
             fine detail so the light is broken up rather than painted across
             the top. Buried under both it vanished; laid over both it read as
             orange sticks lying on the surface. */}
        <g className="gl-shroud-cracks" strokeWidth={Math.max(scale * 0.005, 0.055)}>
          {cracks.map((d, i) => (
            <path
              key={`cg${i}`}
              className="gl-shroud-crack-glow"
              strokeWidth={Math.max(scale * 0.03, 0.32)}
              filter={`url(#shroud-bloom-${id})`}
              d={d}
            />
          ))}
          {cracks.map((d, i) => (
            <path key={`c${i}`} className="gl-shroud-crack" d={d} />
          ))}
        </g>
        {/* B2. FINE FORM — smaller billows breaking the coarse silhouette. */}
        {fine.map((b, i) => lump(b, `f${i}`, 0.86))}
        {edge.map((b, i) => lump(b, `el${i}`, 0.88))}
      </g>
    </g>
  );
}
