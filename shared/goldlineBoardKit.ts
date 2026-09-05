/**
 * THE LANTERN CITY BOARD KIT — a variant registry, not a tile.
 *
 * Lantern City is a war table assembled from discrete authored pieces: island
 * silhouettes, stronghold plinths, bridges, overlays. This module is the
 * registry those pieces are declared in and the rules by which a territory is
 * assigned one.
 *
 * WHY A REGISTRY AND NOT A CONSTANT
 *
 * The first board pass hardcoded a single generic island. That works exactly
 * once — for Los Angeles, at the current zoom, with today's territory count —
 * and then every future city is the same seven copies of one picture. The whole
 * point of the asset kit is that onboarding can generate Phoenix, Atlanta or
 * Dallas from real customer geography, and that only works if the LAYOUT LOGIC
 * NEVER KNOWS HOW MANY TILES EXIST.
 *
 * So every piece below declares its own geometry — bridge sockets, plinth
 * anchor, safe scale range, whether it survives mirroring — and the renderer
 * reads that geometry rather than assuming it. Adding an eighth island is a new
 * entry here and nothing else.
 *
 * SHAPE FIRST, THEN DRESSING
 *
 * Rotation, mirroring, scale and tint are SECONDARY variation. They are applied
 * after a silhouette is chosen and they never substitute for one: a board whose
 * variety is entirely tint is a board of identical tiles in different colours,
 * which reads as cheap the moment two of them are adjacent. `assignIslands`
 * therefore spends its first effort on giving neighbours different SHAPES, and
 * only then dresses them.
 *
 * GEOGRAPHY IS STILL AUTHORITATIVE
 *
 * Nothing here decides where anything sits. Islands are placed by the caller at
 * the territory's own centroid, which `buildVeilGeometry` derives from the real
 * latitude/longitude of that territory's real members. The fantasy terrain is a
 * geographically ALIGNED game layer laid over real Los Angeles — it may cover
 * real streets, and it never moves a real coordinate.
 */

/** Where the kit's production art lives. */
export const BOARD_KIT_ASSETS = "/assets/goldline/procedural-world-v1";

export type BoardEdge = "north" | "east" | "south" | "west";

/** A point in a piece's own normalized art space (0..1 of its canvas). */
export type NormalizedPoint = { x: number; y: number };

/**
 * How complete a piece's art is.
 *
 * `scaffold` means the entry is real and wired but is temporarily borrowing the
 * generic tile until its authored silhouette is generated. It is a first-class
 * state rather than a TODO comment so the renderer can visibly mark a
 * placeholder in development, and so `authoredIslandCount()` can report honestly
 * how far the board actually is.
 */
export type ArtStatus = "authored" | "scaffold";

export type IslandVariantId =
  | "metro"
  | "mills"
  | "beverly"
  | "industrial"
  | "beach"
  | "canal"
  | "downtown";

export type IslandVariant = {
  id: IslandVariantId;
  /** Human name, from the approved style sheet. Never rendered from the art. */
  displayName: string;
  art: string;
  status: ArtStatus;
  /** The art's own pixel canvas, so the renderer can size without measuring. */
  canvas: { width: number; height: number };
  /**
   * Where a bridge may land on this silhouette, in the piece's own normalized
   * space. Per-variant because the silhouettes genuinely differ — a long narrow
   * spit does not offer the same landfall as a compact block, and a bridge that
   * assumed it would end in open water.
   */
  sockets: Record<BoardEdge, NormalizedPoint>;
  /**
   * Where a stronghold tower stands if this island carries one. Distinct from
   * the centroid: the visual centre of an isometric island is not where a
   * building looks planted.
   */
  plinthAnchor: NormalizedPoint;
  /**
   * Whether a horizontal flip is safe. False for silhouettes with directional
   * content the mirror would break — a lit signed frontage, a pier that reads
   * as reaching out to sea, a one-way interchange.
   */
  mirrorSafe: boolean;
  /** Scale band this silhouette stays legible in, as a multiplier. */
  scaleRange: [number, number];
  /** Rotations, in degrees, that keep the isometric projection convincing. */
  rotations: readonly number[];
  /** Optional dressing this silhouette accepts. */
  overlaySlots: {
    coastlineGlow: boolean;
    foliage: boolean;
    districtDressing: boolean;
  };
};

/**
 * The default sockets, from the kit's own `projection.json`. Variants override
 * only where their silhouette genuinely differs.
 */
const DEFAULT_SOCKETS: Record<BoardEdge, NormalizedPoint> = {
  north: { x: 0.5, y: 0.08 },
  east: { x: 0.91, y: 0.5 },
  south: { x: 0.5, y: 0.92 },
  west: { x: 0.09, y: 0.5 },
};

/** The one production silhouette that exists today. */
const GENERIC_ISLAND = `${BOARD_KIT_ASSETS}/02-territory-island-generic.png`;

function island(
  id: IslandVariantId,
  displayName: string,
  overrides: Partial<Omit<IslandVariant, "id" | "displayName">> = {}
): IslandVariant {
  return {
    id,
    displayName,
    art: GENERIC_ISLAND,
    status: "scaffold",
    canvas: { width: 1024, height: 768 },
    sockets: DEFAULT_SOCKETS,
    plinthAnchor: { x: 0.5, y: 0.42 },
    mirrorSafe: true,
    scaleRange: [0.85, 1.15],
    rotations: [0],
    overlaySlots: { coastlineGlow: true, foliage: true, districtDressing: true },
    ...overrides,
  };
}

/**
 * The seven silhouettes from the approved style sheet.
 *
 * Every entry is currently a `scaffold` borrowing the generic tile — the style
 * sheet that named them is a thumbnail contact sheet, not production art. The
 * geometry each one declares is nonetheless its OWN and already correct, so
 * dropping the authored PNG in and flipping `status` is the entire change.
 */
export const ISLAND_VARIANTS: readonly IslandVariant[] = [
  island("metro", "Metro Island", {
    // Freeway interchange runs corner to corner; a mirror reverses the ramps.
    mirrorSafe: false,
    scaleRange: [1.0, 1.2],
  }),
  island("mills", "Mills Island", {
    // Hillside. Reads as terrain rather than blocks, so it takes foliage well
    // and district dressing badly.
    overlaySlots: { coastlineGlow: true, foliage: true, districtDressing: false },
    rotations: [0, 90, 180, 270],
  }),
  island("beverly", "Beverly Island", {
    scaleRange: [0.9, 1.1],
    rotations: [0, 180],
  }),
  island("industrial", "Industrial Island", {
    // Working port: the quay is the south face and cargo reads directionally.
    mirrorSafe: false,
    sockets: { ...DEFAULT_SOCKETS, south: { x: 0.55, y: 0.95 } },
    overlaySlots: { coastlineGlow: true, foliage: false, districtDressing: true },
  }),
  island("beach", "Beach Island", {
    // The pier reaches out to sea and must keep doing so.
    mirrorSafe: false,
    sockets: { ...DEFAULT_SOCKETS, west: { x: 0.04, y: 0.55 } },
    scaleRange: [0.9, 1.05],
  }),
  island("canal", "Canal Island", {
    // Already fragmented by its own water; bridges land on its outer lobes.
    sockets: {
      north: { x: 0.42, y: 0.1 },
      east: { x: 0.93, y: 0.46 },
      south: { x: 0.58, y: 0.9 },
      west: { x: 0.07, y: 0.54 },
    },
    rotations: [0, 180],
  }),
  island("downtown", "Downtown Island", {
    // The tallest skyline in the set. Runs large, and never small enough for
    // its towers to turn into noise.
    scaleRange: [1.1, 1.35],
    mirrorSafe: false,
    plinthAnchor: { x: 0.5, y: 0.3 },
  }),
];

export type PlinthVariantId =
  | "gold"
  | "violet"
  | "neutral"
  | "contested"
  | "luxury"
  | "industrial";

export type PlinthVariant = {
  id: PlinthVariantId;
  displayName: string;
  art: string;
  status: ArtStatus;
  canvas: { width: number; height: number };
  /** Where the building this plinth carries actually stands. */
  towerAnchor: NormalizedPoint;
};

function plinth(
  id: PlinthVariantId,
  displayName: string,
  towerAnchor: NormalizedPoint = { x: 0.5, y: 0.38 }
): PlinthVariant {
  return {
    id,
    displayName,
    // No plinth art exists yet. Scaffolds resolve to nothing rather than to a
    // wrong picture: the renderer draws a tower with no plinth, which looks
    // unfinished — correctly — instead of looking wrong.
    art: "",
    status: "scaffold",
    canvas: { width: 1280, height: 960 },
    towerAnchor,
  };
}

export const PLINTH_VARIANTS: readonly PlinthVariant[] = [
  plinth("gold", "Gold Plinth"),
  plinth("violet", "Violet Plinth"),
  plinth("neutral", "Neutral Plinth"),
  plinth("contested", "Contested Plinth"),
  plinth("luxury", "Luxury Plinth"),
  plinth("industrial", "Industrial Plinth", { x: 0.5, y: 0.44 }),
];

/** The four bridge rotations the kit ships, keyed by the axis they span. */
export const BRIDGE_MODULES = {
  ne_sw: `${BOARD_KIT_ASSETS}/03-bridge-ne-sw.png`,
  sw_ne: `${BOARD_KIT_ASSETS}/04-bridge-sw-ne.png`,
  nw_se: `${BOARD_KIT_ASSETS}/05-bridge-nw-se.png`,
  se_nw: `${BOARD_KIT_ASSETS}/06-bridge-se-nw.png`,
} as const;

export type BridgeAxis = keyof typeof BRIDGE_MODULES;

export const BOARD_OVERLAYS = {
  background: `${BOARD_KIT_ASSETS}/01-background-water-sky.png`,
  coastlineGlow: `${BOARD_KIT_ASSETS}/07-coastline-glow-overlay.png`,
  fog: `${BOARD_KIT_ASSETS}/08-cloud-fog-overlay.png`,
  waterReflection: `${BOARD_KIT_ASSETS}/09-water-reflection-overlay.png`,
  sunGlow: `${BOARD_KIT_ASSETS}/10-sun-glow-overlay.png`,
} as const;

/**
 * Which bridge art spans two board points.
 *
 * Chosen from the direction of travel so the authored perspective runs the
 * right way; the kit's four files are two artworks plus their exact 180°
 * counterparts, which is why this reduces to a quadrant test.
 */
export function bridgeAxisBetween(
  from: { x: number; y: number },
  to: { x: number; y: number }
): BridgeAxis {
  /*
    Read straight off projection.json rather than reasoned about, because the
    compass names and screen space disagree and it is easy to get backwards:

      03 ne_sw : start (0.90, 0.28) -> end (0.10, 0.72)   dx < 0, dy > 0
      04 sw_ne : start (0.10, 0.72) -> end (0.90, 0.28)   dx > 0, dy < 0
      05 nw_se : start (0.10, 0.28) -> end (0.90, 0.72)   dx > 0, dy > 0
      06 se_nw : start (0.90, 0.72) -> end (0.10, 0.28)   dx < 0, dy < 0

    Screen y grows downward, so "north" in the asset names is the SMALLER y.
  */
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx >= 0) return dy >= 0 ? "nw_se" : "sw_ne";
  return dy >= 0 ? "ne_sw" : "se_nw";
}

/**
 * A stable non-negative hash. Same string, same number, forever.
 *
 * The board must not reshuffle on reload: a territory that was Beach Island
 * this morning is Beach Island tonight, because the operator navigates by
 * shape. Deterministic assignment from the territory's own stable key is what
 * guarantees that without persisting a single row.
 */
export function boardHash(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

export type BoardPlacementInput = {
  /** The territory's own stable key. Drives every deterministic choice. */
  stableKey: string;
  /** Board position, in atlas percentage space, from real member coordinates. */
  position: { x: number; y: number };
};

export type BoardPlacement = {
  stableKey: string;
  position: { x: number; y: number };
  variant: IslandVariant;
  /** Secondary dressing. Never a substitute for a different silhouette. */
  rotation: number;
  mirrored: boolean;
  scale: number;
};

/**
 * How close two islands must be before sharing a silhouette is objectionable,
 * in atlas percentage units. Generous on purpose: clone-spotting happens across
 * a glance, not across the whole board.
 */
const NEIGHBOUR_RADIUS = 26;

/**
 * Assign a silhouette to every territory.
 *
 * Two rules, in priority order:
 *
 *   1. DETERMINISM. The same stable key always starts from the same candidate.
 *   2. NO ADJACENT CLONES. If a territory's first choice is already worn by a
 *      neighbour, it walks the registry until it finds one that is not.
 *
 * Rule 2 is why this is a whole function rather than a modulo. A hash alone
 * distributes evenly across the WHOLE board and is perfectly happy to put two
 * Metro Islands side by side, which is exactly the failure that makes a board
 * look cheap. Only when every variant is already taken by a neighbour does it
 * fall back to the hashed choice — at which point the board has more crowded
 * territories than the kit has shapes, and the honest fix is more art, not a
 * cleverer tiebreak.
 *
 * Processing order is sorted by stable key, never by array order, so callers
 * cannot change the board by reordering their query results.
 */
export function assignIslands(
  territories: readonly BoardPlacementInput[],
  variants: readonly IslandVariant[] = ISLAND_VARIANTS
): BoardPlacement[] {
  if (!variants.length) return [];
  const ordered = [...territories].sort((left, right) =>
    left.stableKey.localeCompare(right.stableKey)
  );
  const placed: BoardPlacement[] = [];

  for (const territory of ordered) {
    const hash = boardHash(territory.stableKey);
    const first = hash % variants.length;

    const clashes = (candidate: IslandVariant) =>
      placed.some(
        other =>
          other.variant.id === candidate.id &&
          Math.hypot(
            other.position.x - territory.position.x,
            other.position.y - territory.position.y
          ) < NEIGHBOUR_RADIUS
      );

    let variant = variants[first];
    for (let step = 0; step < variants.length; step += 1) {
      const candidate = variants[(first + step) % variants.length];
      if (!clashes(candidate)) {
        variant = candidate;
        break;
      }
    }

    // Dressing, drawn from independent bits of the same hash so two islands
    // that legitimately share a silhouette still differ in presentation.
    const rotation =
      variant.rotations[(hash >> 3) % variant.rotations.length] ?? 0;
    const mirrored = variant.mirrorSafe && ((hash >> 7) & 1) === 1;
    const [minScale, maxScale] = variant.scaleRange;
    const scale =
      minScale + (((hash >> 11) % 100) / 99) * (maxScale - minScale);

    placed.push({
      stableKey: territory.stableKey,
      position: territory.position,
      variant,
      rotation,
      mirrored,
      scale: Number(scale.toFixed(4)),
    });
  }
  return placed;
}

/** How much of the board's visual language is real authored art yet. */
export function authoredIslandCount(
  variants: readonly IslandVariant[] = ISLAND_VARIANTS
): { authored: number; scaffold: number; total: number } {
  const authored = variants.filter(v => v.status === "authored").length;
  return {
    authored,
    scaffold: variants.length - authored,
    total: variants.length,
  };
}
