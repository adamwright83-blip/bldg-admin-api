/**
 * GOLDLINE ASSET REGISTRY — the single source of truth for every game-facing image.
 *
 * Why this exists: on 2026-09-11 an hour was spent sourcing OPUS LA tower art that
 * was already generated and sitting untracked in the repo. 574 images live under
 * `client/public/assets` and nothing could answer "what art do we already have?".
 *
 * Two layers, deliberately kept apart:
 *
 *   generated/assetManifest.json   what is ON DISK. Written by `npm run assets:scan`.
 *                                  Never hand-edited. Always sees new files.
 *   ASSET_GROUPS (this file)       what each thing IS FOR. Hand-authored.
 *                                  Does not see new files until a human says so.
 *
 * `registry.test.ts` fails when the two disagree. That is the whole enforcement
 * mechanism: dropping a PNG into `client/public/assets` and shipping it without
 * classifying it breaks the suite.
 *
 * The pivot/art-space convention below generalizes
 * `client/src/components/admin/control-room/buildingArt.ts`, which already solved
 * this correctly for two buildings.
 */
import manifest from "./generated/assetManifest.json";

/* ------------------------------------------------------------------ contract */

/**
 * Where a layered composition's coordinates live. Layers sharing an art space are
 * positioned `center bottom / contain`, so they stay locked together at any scale
 * and geometry can be authored once in art-space pixels.
 */
export type ArtSpace = { readonly width: number; readonly height: number };

/** The building/tower art space. Any new tower plate must be authored to this. */
export const TOWER_ART_SPACE: ArtSpace = { width: 800, height: 1200 };

/** The chapter stage art space — `ChapterScene` composes at a fixed 960x640. */
export const CHAPTER_ART_SPACE: ArtSpace = { width: 960, height: 640 };

/**
 * Pivot convention. `center_bottom` means the sprite's origin sits at the midpoint
 * of its bottom edge, so a character stands on the point it is positioned at and a
 * tower grows upward from its footprint. This is the default for anything that
 * occupies ground. `center` is for things that float or rotate about themselves.
 */
export type Pivot = "center_bottom" | "center" | "top_left" | "custom";

/**
 * Style tag. New art must declare which visual language it belongs to, and the
 * reference guide in `docs/GOLDLINE-TASKS.md` governs `goldline_current`.
 * Anything tagged `legacy_*` is pre-Goldline and is Slice D's inventory.
 */
export type StyleTag =
  | "goldline_current"
  | "goldline_lantern_city"
  | "goldline_chapter"
  | "legacy_boreslay"
  | "legacy_dayforge"
  | "legacy_saleslay"
  | "legacy_level4"
  | "product_chrome"
  | "not_rendered";

/**
 * - `live`      currently rendered by a surface.
 * - `unused`    on disk, referenced by nothing. Wire it up or delete it — but it is
 *               KNOWN, which is the point. Several of these are finished art.
 * - `retired`   must never be rendered again. Rendering one is a bug.
 * - `source`    working files and pre-composite originals. Not shipped.
 * - `reference` art-direction reference. Never rendered in the product.
 */
export type AssetStatus = "live" | "unused" | "retired" | "source" | "reference";

/** Which product surface consumes the art. */
export type Surface =
  | "control_room"
  | "tower_wars"
  | "lantern_city"
  | "chapter"
  | "expedition"
  | "colosseum"
  | "boreslay"
  | "dayforge"
  | "saleslay"
  | "level4"
  | "landing"
  | "chrome"
  | "none";

/**
 * WHICH PIPELINE OWNS THIS ART. Scope boundary, recorded as data because a memo
 * gets forgotten and this one is expensive to forget.
 *
 * - `authored_2d`      painted, drawn or generated as a 2D image. Ships as-is.
 *                      Re-rendering any of it in 3D destroys approved work.
 * - `blender_rendered` baked from a 3D model through scripts/assets/blender.
 *                      ONLY for characters that animate and need many consistent
 *                      frames of the same subject. Roughly ten characters, never
 *                      the other 640 images.
 * - `not_art`          masks, references, working files. Not rendered in product.
 */
export type Pipeline = "authored_2d" | "blender_rendered" | "not_art";

/**
 * The only groups permitted to be `blender_rendered`. Anything else declaring it
 * fails the test. Buildings do not animate and already have a working pivot
 * contract; UI chrome, painted backgrounds, territory art and every marketing
 * asset stay exactly as they are.
 */
export const BLENDER_ELIGIBLE_GROUPS: readonly string[] = [
  "companions",
  "characters.trailblazer",
  "characters.trailblazer.directional",
];

export type AssetGroup = {
  /** Stable id. Referenced by docs and by the inventory report. */
  readonly id: string;
  /** Directory prefix under `client/public`, no trailing slash. Longest match wins. */
  readonly dir: string;
  /** Optional filename filter, so one directory can hold two differently-purposed sets. */
  readonly match?: RegExp;
  /** Do not fall through into subdirectories that have their own group. */
  readonly surface: Surface;
  readonly status: AssetStatus;
  readonly style: StyleTag;
  readonly pivot: Pivot;
  /** Defaults to `authored_2d` when omitted. Only ever set deliberately. */
  readonly pipeline?: Pipeline;
  readonly artSpace?: ArtSpace;
  /**
   * Whether consumers build these paths at runtime (template literals, a shipped
   * `manifest.json`). Literal-reference checking is skipped for these, because a
   * static scan cannot see them — the group declaration is the record instead.
   */
  readonly dynamic?: boolean;
  /** Code or data that loads this group. Empty for anything not rendered. */
  readonly loadedBy: readonly string[];
  readonly note: string;
};

/* -------------------------------------------------------------------- groups */

export const ASSET_GROUPS: readonly AssetGroup[] = [
  /* ---- Control Room chrome -------------------------------------------- */
  {
    id: "control_room.brand",
    dir: "/assets/admin/control-room/brand",
    surface: "chrome",
    status: "live",
    style: "product_chrome",
    pivot: "center",
    loadedBy: ["client/src/components/admin/control-room/ControlRoomNav.tsx"],
    note: "Wordmark in the Control Room nav.",
  },
  {
    id: "control_room.nav",
    dir: "/assets/admin/control-room/nav",
    surface: "control_room",
    status: "live",
    style: "product_chrome",
    pivot: "center",
    loadedBy: ["client/src/components/admin/control-room/ControlRoomSections.tsx"],
    note:
      "Section icons. Four of the six SVGs here (customers, home, money, operations) " +
      "are unreferenced — an icon set that was replaced without deleting the old one.",
  },
  {
    id: "control_room.production",
    dir: "/assets/admin/control-room/production",
    surface: "control_room",
    status: "live",
    style: "product_chrome",
    pivot: "center",
    dynamic: true,
    loadedBy: ["client/src/pages/AdminLive.tsx"],
    note:
      "Order-stage icons (received/processing/ready/dispatch), selected per lane " +
      "status and built into a path at render time. An earlier pass called these " +
      "unused because a static scan could not see the template literal.",
  },
  {
    id: "control_room.signals",
    dir: "/assets/admin/control-room/signals",
    surface: "control_room",
    status: "live",
    style: "product_chrome",
    pivot: "center",
    loadedBy: ["client/src/components/admin/control-room/psychSignals.ts"],
    note: "Psych-signal badges.",
  },
  {
    id: "control_room.status",
    dir: "/assets/admin/control-room/status",
    surface: "control_room",
    status: "live",
    style: "product_chrome",
    pivot: "center",
    loadedBy: ["client/src/components/admin/control-room/ControlRoomSections.tsx"],
    note: "Status pips.",
  },
  {
    id: "ops_board",
    dir: "/assets/admin/ops-board",
    surface: "control_room",
    status: "live",
    style: "product_chrome",
    pivot: "center",
    loadedBy: ["client/src/components/admin/ops-board/OpsBoardCards.tsx"],
    note: "Ops board card art.",
  },

  /* ---- Tower Wars ------------------------------------------------------ */
  {
    id: "tower_wars.buildings",
    dir: "/assets/admin/control-room/tower-wars",
    surface: "tower_wars",
    status: "live",
    style: "goldline_current",
    pivot: "center_bottom",
    artSpace: TOWER_ART_SPACE,
    loadedBy: ["client/src/components/admin/control-room/buildingArt.ts"],
    note:
      "Canonical layered building art: pristine plate + scars + fresh damage + weapon " +
      "+ projectile, all in the 800x1200 art space. buildingArt.ts owns the geometry " +
      "and the RETIRED_BUILDING_ART list; this group is the registry side of it.",
  },
  {
    id: "opus_la.inspection",
    dir: "/assets/admin/control-room/opus-la-inspection",
    surface: "tower_wars",
    status: "live",
    style: "goldline_current",
    pivot: "center_bottom",
    artSpace: TOWER_ART_SPACE,
    loadedBy: ["client/src/components/admin/control-room/OpusLaInspection.tsx"],
    note:
      "OPUS LA close inspection view. north-tower.png and south-tower.png are " +
      "byte-identical duplicates of the world/ copies, and weapon.png duplicates the " +
      "tower-wars driver overlay. See DUPLICATE_SETS.",
  },

  /* ---- World / territory atlases --------------------------------------- */
  {
    id: "world.atlases",
    dir: "/assets/admin/control-room/world",
    match: /\.(png|jpg|webp)$/,
    surface: "lantern_city",
    status: "unused",
    style: "goldline_lantern_city",
    pivot: "top_left",
    loadedBy: [],
    note:
      "Superseded Lantern City atlas masters (v2-v4), the truth reference photo, and " +
      "the two OPUS tower renders that were re-sourced by hand because nobody knew " +
      "they were here. The live scene is on v6.",
  },
  {
    id: "world.territories_v2.png",
    dir: "/assets/admin/control-room/world/territories-v2",
    match: /\.png$/,
    surface: "lantern_city",
    status: "live",
    style: "goldline_lantern_city",
    pivot: "top_left",
    dynamic: true,
    loadedBy: ["client/public/assets/admin/control-room/world/territories-v2/manifest.json"],
    note:
      "61 territory plates loaded through the shipped manifest.json by " +
      "LanternTerritoryStateLayer.tsx. 116 MB.",
  },
  {
    id: "world.territories_v2.webp",
    dir: "/assets/admin/control-room/world/territories-v2",
    match: /\.webp$/,
    surface: "lantern_city",
    status: "unused",
    style: "goldline_lantern_city",
    pivot: "top_left",
    loadedBy: [],
    note:
      "A complete WebP conversion of the 61 live PNG plates — 28.9 MB against 116.4 MB " +
      "for the same pictures. The manifest still points at the PNGs, so the browser " +
      "downloads the large set. Switching the manifest is a 4x payload win.",
  },
  {
    id: "world.territories_v2.masks",
    dir: "/assets/admin/control-room/world/territories-v2/masks",
    surface: "lantern_city",
    status: "live",
    style: "not_rendered",
    pivot: "top_left",
    dynamic: true,
    pipeline: "not_art",
    loadedBy: ["client/public/assets/admin/control-room/world/territories-v2/manifest.json"],
    note: "Per-territory hit/clip masks, referenced from the same manifest.",
  },

  /* ---- Lantern City ----------------------------------------------------- */
  {
    id: "lantern_city.v2",
    dir: "/assets/goldline/lantern-city/v2",
    surface: "lantern_city",
    status: "live",
    style: "goldline_lantern_city",
    pivot: "center_bottom",
    loadedBy: ["client/src/components/admin/control-room/lanternCityCombat.ts"],
    note: "Combat-overworld plates still read by lanternCityCombat.",
  },
  {
    id: "lantern_city.v3",
    dir: "/assets/goldline/lantern-city/v3",
    surface: "lantern_city",
    status: "live",
    style: "goldline_lantern_city",
    pivot: "center_bottom",
    loadedBy: ["client/src/components/goldline/lanternCityAssets.ts"],
    note: "Third-generation city art, still referenced by AdminHostApp.",
  },
  {
    id: "lantern_city.v4",
    dir: "/assets/goldline/lantern-city/v4",
    surface: "lantern_city",
    status: "live",
    style: "goldline_lantern_city",
    pivot: "center_bottom",
    loadedBy: ["client/src/pages/AdminHostApp.tsx"],
    note: "Fourth-generation city art.",
  },
  {
    id: "lantern_city.v5",
    dir: "/assets/goldline/lantern-city/v5",
    surface: "lantern_city",
    status: "live",
    style: "goldline_lantern_city",
    pivot: "center_bottom",
    dynamic: true,
    loadedBy: ["client/src/components/goldline/lanternCityV5Assets.ts"],
    note:
      "Master plate, foreground depth layer, eight territory state gels, lanterns, " +
      "decay props, frontier and arsenal art. Paths are built from a ROOT constant.",
  },
  {
    id: "lantern_city.v6",
    dir: "/assets/goldline/lantern-city/v6",
    surface: "lantern_city",
    status: "live",
    style: "goldline_lantern_city",
    pivot: "center_bottom",
    dynamic: true,
    loadedBy: ["client/src/components/admin/control-room/LanternCitySceneV6/sceneAssets.ts"],
    note:
      "Current live scene. Fourteen territories x four environment states, composed " +
      "per territory by sceneAssets.ts. This is the generation to add to.",
  },

  /* ---- Chapter: THE LAST VALET ------------------------------------------ */
  {
    id: "chapter.last_valet.backgrounds",
    dir: "/assets/goldline/chapters/the-last-valet/backgrounds",
    surface: "chapter",
    status: "live",
    style: "goldline_chapter",
    pivot: "top_left",
    artSpace: CHAPTER_ART_SPACE,
    dynamic: true,
    loadedBy: ["client/src/game/chapters/firstChapter/ChapterScene.ts"],
    note:
      "Three room paintings, loaded as `backgrounds/${name}.png` from a room map. " +
      "Painted empty: all interaction geometry is separate sprites over the top.",
  },
  {
    id: "chapter.last_valet.characters",
    dir: "/assets/goldline/chapters/the-last-valet/characters",
    surface: "chapter",
    status: "live",
    style: "goldline_chapter",
    pivot: "center_bottom",
    artSpace: CHAPTER_ART_SPACE,
    loadedBy: ["client/src/game/chapters/firstChapter/ChapterScene.ts"],
    note:
      "Character atlases (inez, perrin, bellwether) plus heroine-actions. ChapterScene " +
      "slices these as a 3x2 frame grid — the beginnings of the Slice B animator.",
  },
  {
    id: "chapter.last_valet.mechanisms",
    dir: "/assets/goldline/chapters/the-last-valet/mechanisms",
    surface: "chapter",
    status: "live",
    style: "goldline_chapter",
    pivot: "center_bottom",
    artSpace: CHAPTER_ART_SPACE,
    loadedBy: ["client/src/game/chapters/firstChapter/ChapterScene.ts"],
    note: "Scenery, machinery and props atlases.",
  },
  {
    id: "chapter.last_valet.fx",
    dir: "/assets/goldline/chapters/the-last-valet/fx",
    surface: "chapter",
    status: "live",
    style: "goldline_chapter",
    pivot: "center",
    loadedBy: ["client/src/game/chapters/firstChapter/ChapterScene.ts"],
    note: "Impact atlas. Slice C's particle work draws from here.",
  },
  {
    id: "chapter.last_valet.references",
    dir: "/assets/goldline/chapters/the-last-valet/references",
    surface: "none",
    status: "reference",
    style: "not_rendered",
    pivot: "top_left",
    pipeline: "not_art",
    loadedBy: [],
    note: "Approved art direction and two asset sheets. Never rendered in product.",
  },

  /* ---- Characters -------------------------------------------------------- */
  {
    id: "characters.trailblazer",
    dir: "/assets/goldline/characters/trailblazer",
    match: /^[^/]+$/,
    surface: "expedition",
    status: "live",
    style: "goldline_current",
    pivot: "center_bottom",
    loadedBy: ["client/src/game/runtime/GoldlineGame.ts"],
    note: "Heroine composites used by the expedition world.",
  },
  {
    id: "characters.trailblazer.directional",
    dir: "/assets/goldline/characters/trailblazer/directional",
    surface: "expedition",
    status: "live",
    style: "goldline_current",
    pivot: "center_bottom",
    dynamic: true,
    loadedBy: [
      "client/src/game/runtime/GoldlineGame.ts",
      "client/src/game/chapters/firstChapter/ChapterScene.ts",
    ],
    note:
      "Four idle stances and FOUR FIVE-FRAME WALK CYCLES (walk-{dir}-01..05.webp). " +
      "ChapterScene loads only `idle-${dir}.webp` — the 20 walk frames are finished " +
      "art that nothing plays. Slice B's first movement cycle already exists here.",
  },
  {
    id: "characters.trailblazer.originals",
    dir: "/assets/goldline/characters/trailblazer/_originals",
    surface: "none",
    status: "source",
    style: "not_rendered",
    pivot: "top_left",
    pipeline: "not_art",
    loadedBy: [],
    note: "Pre-composite working files. Not shipped.",
  },

  /* ---- Other Goldline surfaces -------------------------------------------- */
  {
    id: "colosseum",
    dir: "/assets/goldline/colosseum",
    surface: "colosseum",
    status: "live",
    style: "goldline_current",
    pivot: "center_bottom",
    loadedBy: ["client/src/pages/goldline/ColosseumBossGate.tsx"],
    note: "Boss gate art.",
  },
  {
    id: "corridor_01",
    dir: "/assets/goldline/corridor_01",
    match: /^[^/]+$/,
    surface: "expedition",
    status: "live",
    style: "goldline_current",
    pivot: "top_left",
    dynamic: true,
    loadedBy: ["client/public/assets/goldline/corridor_01/manifest.json"],
    note: "Corridor 01 layers, loaded through a shipped manifest.",
  },
  {
    id: "corridor_01.occlusion",
    dir: "/assets/goldline/corridor_01/occlusion-accents",
    surface: "expedition",
    status: "live",
    style: "goldline_current",
    pivot: "top_left",
    loadedBy: ["client/src/game/runtime/GoldlineGame.ts"],
    note: "Foreground occluders the avatar walks behind.",
  },
  {
    id: "corridor_01.originals",
    dir: "/assets/goldline/corridor_01/_originals",
    surface: "none",
    status: "source",
    style: "not_rendered",
    pivot: "top_left",
    pipeline: "not_art",
    loadedBy: [],
    note: "Pre-composite working files. Not shipped.",
  },
  {
    id: "corridor_02",
    dir: "/assets/goldline/corridor_02",
    surface: "expedition",
    status: "live",
    style: "goldline_current",
    pivot: "top_left",
    dynamic: true,
    loadedBy: ["client/public/assets/goldline/corridor_02/manifest.json"],
    note: "Corridor 02 layers, loaded through a shipped manifest.",
  },
  {
    id: "guardians",
    dir: "/assets/goldline/guardians",
    surface: "expedition",
    status: "live",
    style: "goldline_current",
    pivot: "center_bottom",
    loadedBy: ["client/src/components/goldline/GuardianActor.tsx"],
    note: "Guardian actor art. One v1 file is unreferenced.",
  },
  {
    id: "orders",
    dir: "/assets/goldline/orders",
    surface: "expedition",
    status: "live",
    style: "goldline_current",
    pivot: "center",
    loadedBy: ["client/src/game/runtime/GoldlineGame.ts"],
    note:
      "Order-state art. delivery-completed.webp and pickup-completed.webp are " +
      "unreferenced — the completed states render without art.",
  },
  {
    id: "population",
    dir: "/assets/goldline/population",
    surface: "expedition",
    status: "live",
    style: "goldline_current",
    pivot: "center_bottom",
    dynamic: true,
    loadedBy: ["client/src/game/world/PopulationSystem.ts"],
    note: "Population sprite sheet.",
  },
  {
    id: "procedural_world_v1",
    dir: "/assets/goldline/procedural-world-v1",
    surface: "expedition",
    status: "live",
    style: "goldline_current",
    pivot: "top_left",
    dynamic: true,
    loadedBy: ["client/public/assets/goldline/procedural-world-v1/manifest.json"],
    note: "Procedural world tiles, manifest-driven, with a shipped audit.json.",
  },
  {
    id: "pwa",
    dir: "/assets/goldline/pwa",
    surface: "chrome",
    status: "live",
    style: "product_chrome",
    pivot: "center",
    loadedBy: ["client/src/game/pwa/installPwaHead.ts"],
    note: "Home-screen icons.",
  },
  {
    id: "siege",
    dir: "/assets/goldline/siege",
    surface: "tower_wars",
    status: "live",
    style: "goldline_current",
    pivot: "center_bottom",
    loadedBy: ["client/src/components/admin/control-room/towerSiege.css"],
    note: "Siege navigation art.",
  },
  {
    id: "vehicle_cargo.v1",
    dir: "/assets/goldline/vehicle-cargo/v1",
    surface: "expedition",
    status: "live",
    style: "goldline_current",
    pivot: "center",
    loadedBy: ["client/src/components/goldline/VehicleCargo.tsx"],
    note:
      "Cargo interior art. Four JPGs here are unreferenced, including a " +
      "'premium-preview' that was never wired.",
  },
  {
    id: "vehicle_cargo.v2",
    dir: "/assets/goldline/vehicle-cargo/v2",
    surface: "expedition",
    status: "live",
    style: "goldline_current",
    pivot: "center",
    loadedBy: ["client/src/components/goldline/VehicleCargo.tsx"],
    note: "Current cargo art.",
  },
  {
    id: "wayward",
    dir: "/assets/goldline/wayward",
    surface: "expedition",
    status: "live",
    style: "goldline_current",
    pivot: "center_bottom",
    loadedBy: ["client/src/pages/goldline/stages/futureStages.ts"],
    note: "Wayward stage art.",
  },

  /* ---- Pre-Goldline surfaces. Slice D's inventory. ------------------------ */
  {
    id: "legacy.boreslay_hero",
    dir: "/assets/boreslay-hero",
    surface: "boreslay",
    status: "live",
    style: "legacy_boreslay",
    pivot: "center",
    loadedBy: ["client/src/components/boreslay-demo/PublicBoreslayDemo.tsx"],
    note: "Public Boreslay demo hero art.",
  },
  {
    id: "legacy.boreslay_sections",
    dir: "/assets/boreslay-sections",
    surface: "boreslay",
    status: "live",
    style: "legacy_boreslay",
    pivot: "center",
    loadedBy: ["client/src/components/boreslay/BsCanonicalSections.tsx"],
    note: "Canonical section art. 13 of 24 are unreferenced leftovers from earlier cuts.",
  },
  {
    id: "legacy.dayforge_arcade",
    dir: "/assets/dayforge-arcade",
    surface: "dayforge",
    status: "live",
    style: "legacy_dayforge",
    pivot: "center",
    loadedBy: ["client/src/pages/dayforge-landing.css"],
    note: "Dayforge arcade landing art.",
  },
  {
    id: "legacy.dayforge_final",
    dir: "/assets/dayforge-final",
    surface: "dayforge",
    status: "live",
    style: "legacy_dayforge",
    pivot: "center",
    loadedBy: ["client/src/pages/DayforgeDemoControlPage.tsx"],
    note: "Demo control page art. Three of four are unreferenced.",
  },
  {
    id: "legacy.held_landing",
    dir: "/assets/held-landing",
    surface: "landing",
    status: "live",
    style: "product_chrome",
    pivot: "center",
    loadedBy: ["client/src/pages/HeldLanding.tsx"],
    note: "HELD landing screenshot.",
  },
  {
    id: "legacy.level4",
    dir: "/assets/level4",
    surface: "level4",
    status: "live",
    style: "legacy_level4",
    pivot: "center_bottom",
    loadedBy: ["client/src/components/Level4BoardScene.tsx"],
    note: "Level 4 board scene. 8 of 19 unreferenced.",
  },
  {
    id: "legacy.saleslay",
    dir: "/assets/saleslay",
    surface: "saleslay",
    status: "live",
    style: "legacy_saleslay",
    pivot: "center_bottom",
    loadedBy: ["client/src/components/admin/saleslay-game/game/renderer.ts"],
    note: "Saleslay battle actors.",
  },
  {
    id: "legacy.saleslay_hud",
    dir: "/assets/saleslay/hud",
    surface: "saleslay",
    status: "live",
    style: "legacy_saleslay",
    pivot: "center",
    loadedBy: ["client/src/components/admin/saleslay-game/SaleslayBattleCanvas.tsx"],
    note: "Saleslay HUD frames.",
  },

  /* ---- The bundled root: client/src/assets, imported through "@/". --------
   * Vite hashes these at build time, so they never appear as a runtime
   * "/assets/..." URL. A registry that only watched client/public declared all
   * 78 of them missing, which is how a "single source of truth" quietly becomes
   * wrong. 112 MB lives here. */
  {
    id: "bundled.boreslay_rally",
    dir: "@/assets/boreslay-rally",
    surface: "boreslay",
    status: "live",
    style: "legacy_boreslay",
    pivot: "center",
    loadedBy: ["client/src/components/boreslay-rally/rallyRenderer.ts"],
    note: "Rally arena, sheets and proof shots. Bundled, not served.",
  },
  {
    id: "bundled.codex_l_final",
    dir: "@/assets/codex-l-final",
    surface: "dayforge",
    status: "live",
    style: "legacy_dayforge",
    pivot: "center",
    loadedBy: ["client/src/pages/DayforgeLanding.tsx"],
    note: "Owner-journey stills on the Dayforge landing page.",
  },
  {
    id: "bundled.dayforge_flagship",
    dir: "@/assets/dayforge-flagship",
    surface: "dayforge",
    status: "live",
    style: "legacy_dayforge",
    pivot: "center",
    loadedBy: ["client/src/pages/LandingFinal.tsx"],
    note: "Flagship landing art. Also used by the archived flagship page.",
  },
  {
    id: "bundled.driver",
    dir: "@/assets/driver",
    surface: "expedition",
    status: "live",
    style: "goldline_current",
    pivot: "center_bottom",
    loadedBy: ["client/src/components/driver/LaundryRun.tsx"],
    note: "Driver prep mini-games: laundry run sprites and signal override chrome.",
  },
  {
    id: "bundled.goldline",
    dir: "@/assets/goldline",
    match: /^[^/]+$/,
    surface: "expedition",
    status: "live",
    style: "goldline_current",
    pivot: "center_bottom",
    loadedBy: ["client/src/game/GoldlineGameHome.tsx"],
    note: "Top-level bundled Goldline art.",
  },
  {
    id: "bundled.goldline_generated",
    dir: "@/assets/goldline/generated",
    surface: "expedition",
    status: "live",
    style: "goldline_current",
    pivot: "center_bottom",
    loadedBy: ["client/src/game/GoldlineGameHome.tsx"],
    note: "World plate and the Trailblazer operator composite.",
  },
  {
    id: "bundled.goldline_heartbeat",
    dir: "@/assets/goldline/heartbeat",
    surface: "expedition",
    status: "live",
    style: "goldline_current",
    pivot: "center_bottom",
    loadedBy: ["client/src/game/expedition/ExpeditionLayer.ts"],
    note: "Ruinbound actors, grapple ring, cargo hazard and pickup objective.",
  },
  {
    id: "bundled.l4",
    dir: "@/assets/l4",
    surface: "level4",
    status: "live",
    style: "legacy_level4",
    pivot: "center_bottom",
    loadedBy: ["client/src/components/Level4Offensive.tsx"],
    note: "Level 4 offensive board, actors and HUD plates.",
  },
  {
    id: "bundled.landing_final",
    dir: "@/assets/landing-final",
    surface: "landing",
    status: "live",
    style: "product_chrome",
    pivot: "center",
    loadedBy: ["client/src/pages/LandingFinal.tsx"],
    note: "Final landing page art.",
  },
  {
    id: "bundled.pnl",
    dir: "@/assets/pnl",
    surface: "control_room",
    status: "live",
    style: "product_chrome",
    pivot: "center",
    loadedBy: ["client/src/pages/DayforgeDemoControlPage.tsx"],
    note: "P&L surface art and its icon set.",
  },
];

/* ---------------------------------------------------------------- retirement */

/**
 * Assets that must never be rendered again, with the reason. Rendering one is a bug,
 * and `registry.test.ts` fails if a source file references any of them.
 *
 * The building entries mirror `RETIRED_BUILDING_ART` in buildingArt.ts, which stays
 * the authority for the building layer model.
 */
export const RETIRED_ASSETS: Readonly<Record<string, string>> = {
  "opus-la-siege-driver-v5.png": "Stale tower+club composite; OPUS changes weapons between screens.",
  "opus-la-siege-driver-v4.png": "Older stale composite of the same kind.",
  "century-bazooka-optimized.png": "Not a bazooka — an entirely different CPE tower.",
  "century-park-east-tower-v2.png": "Combat damage and weapon baked into the plate.",
  "opus-la-tower-v2.png": "Combat damage and weapon baked into the plate.",
  "opus-la-tower-plate-v3.png": "Superseded by plate-v4.",
};

/**
 * Byte-identical files kept in two places. Each pair is one picture stored twice.
 * Recorded rather than deleted, because deleting the wrong copy breaks a surface —
 * but an agent looking for tower art should find it here instead of regenerating it.
 */
export const DUPLICATE_SETS: readonly (readonly string[])[] = [
  [
    "/assets/admin/control-room/tower-wars/opus-la-driver-overlay-v6.png",
    "/assets/admin/control-room/opus-la-inspection/weapon.png",
  ],
  [
    "/assets/admin/control-room/world/opus-la-south-tower-v1.png",
    "/assets/admin/control-room/opus-la-inspection/south-tower.png",
  ],
  [
    "/assets/admin/control-room/world/opus-la-north-tower-v1.png",
    "/assets/admin/control-room/opus-la-inspection/north-tower.png",
  ],
];

/**
 * References in source that point at art which does not exist.
 *
 * All five live in the Saleslay renderer, which asks for dragon attack, hit and
 * victory states plus two projectiles. The Saleslay directory only ever shipped
 * dragon_idle, so those combat states have never rendered. This is pre-Goldline
 * code and fixing it is not this brief's job, but it is recorded so the test can
 * enforce that NO NEW broken reference is added.
 */
export const KNOWN_MISSING_REFERENCES: readonly string[] = [
  // CommandLanternKingdom falls back to `/assets/kingdom/${k}.png` when the
  // kingdom-art hook returns nothing for a key. That directory exists in neither
  // asset root, so the fallback renders a broken image rather than a placeholder.
  "/assets/kingdom/",
  "/assets/saleslay/dragon_attack.png",
  "/assets/saleslay/dragon_hit.png",
  "/assets/saleslay/dragon_victory.png",
  "/assets/saleslay/excuse_projectile.png",
  "/assets/saleslay/fireball.png",
];

/* -------------------------------------------------------------------- lookup */

export type AssetRoot = "public" | "bundled";

export type ManifestAsset = {
  /** "/assets/..." for public, "@/assets/..." for bundler imports. */
  readonly url: string;
  readonly root: AssetRoot;
  readonly bytes: number;
  readonly sha256: string;
  readonly format: string;
  readonly width: number | null;
  readonly height: number | null;
};

export type AssetEntry = ManifestAsset & {
  readonly group: AssetGroup;
  readonly pipeline: Pipeline;
  readonly status: AssetStatus;
  readonly surface: Surface;
  readonly style: StyleTag;
  readonly pivot: Pivot;
};

const MANIFEST = manifest as { readonly assets: readonly ManifestAsset[] };

/** Longest `dir` wins, so a subdirectory group overrides its parent. */
const GROUPS_BY_SPECIFICITY = [...ASSET_GROUPS].sort((a, b) => b.dir.length - a.dir.length);

export function groupFor(url: string): AssetGroup | null {
  for (const group of GROUPS_BY_SPECIFICITY) {
    if (url !== group.dir && !url.startsWith(group.dir + "/")) continue;
    if (group.match && !group.match.test(url.slice(group.dir.length + 1))) continue;
    return group;
  }
  return null;
}

let cache: readonly AssetEntry[] | null = null;

/** Every image on disk, classified. The answer to "what art do we already have?". */
export function allAssets(): readonly AssetEntry[] {
  if (cache) return cache;
  cache = MANIFEST.assets.flatMap((asset) => {
    const group = groupFor(asset.url);
    if (!group) return [];
    return [{
      ...asset,
      group,
      pipeline: group.pipeline ?? "authored_2d",
      status: group.status,
      surface: group.surface,
      style: group.style,
      pivot: group.pivot,
    }];
  });
  return cache;
}

export function assetsForSurface(surface: Surface): readonly AssetEntry[] {
  return allAssets().filter((a) => a.surface === surface);
}

export function assetsWithStatus(status: AssetStatus): readonly AssetEntry[] {
  return allAssets().filter((a) => a.status === status);
}

export function assetByUrl(url: string): AssetEntry | null {
  return allAssets().find((a) => a.url === url) ?? null;
}

/** True when a URL is a registered image that a surface is allowed to render. */
export function isRenderable(url: string): boolean {
  const entry = assetByUrl(url);
  if (!entry) return false;
  return entry.status === "live" || entry.status === "unused";
}
