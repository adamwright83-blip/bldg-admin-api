import { writeFileSync } from "node:fs";
import {
  LANTERN_TERRITORIES,
  territoryCenter,
} from "../shared/lanternTerritories";
import { projectLatLngToLanternAtlas } from "../shared/lanternCity";
import { territoryMaskSrc } from "../shared/territoryMaskPackage";
import {
  presentationFor,
  TERRITORY_PRESENTATION,
} from "../client/src/components/admin/control-room/LanternCitySceneV6/territoryPresentation";
import { hudLayout } from "../client/src/components/admin/control-room/LanternCitySceneV6/composeLanternCityScene";
const states = ["healthy", "cooling", "infested", "locked"] as const;
const descriptions = {
  healthy:
    "Warm window lighting, maintained low-rise LA buildings, clean paths, healthy planted courtyards. Leave the central game-object silhouette clear; no baked customer lanterns.",
  cooling:
    "The SAME registered architecture and paths with weakened illumination, dry greenery, modest physical deterioration and warm amber/red environmental light. No labels or lanterns.",
  infested:
    "The SAME registered neighborhood footprint transformed into neglected terrain: boarded storefronts, cracked pavement, trash, grime and abandoned yards. Must read as neglect with no rats, roaches, UI or labels. Existing rat and roach assets are supporting runtime props; leave ground slots for them.",
  locked:
    "The SAME registered neighborhood transformed into hostile, unclaimed land: blackened/damaged buildings, broken entrances, thorny ground and darkened paths. Must read physically locked without a lock icon or label. Reserve central slot for the runtime lock.",
};
const manifest = {
  version: 6,
  status: "BLOCKED ON ART",
  accepted: false,
  reference:
    "Screen Shot 2026-09-07 at 22.01.55 PM.png (composition only; never copy counts)",
  runtimeRegistry:
    "client/src/components/admin/control-room/LanternCitySceneV6/sceneAssets.ts",
  base: {
    destination: "/assets/goldline/lantern-city/v6/world-neutral.png",
    width: 3840,
    height: 2160,
    alpha: false,
    colorSpace: "sRGB",
    status: "missing-approved-art",
    description:
      "Bright premium painterly Los Angeles, broad readable district masses, connected roads, mountain/skyline backdrop, quieter central object slots. No text, customers, lanterns, locks, destruction or pests baked in. Match approved perspective and light direction. Rejected neutral-atlas-draft.png is not an approved substitute.",
  },
  objectAssets: [
    ...["active", "dimming", "dark"].map(state => ({
      destination: `/assets/goldline/lantern-city/v6/objects/lantern-${state}.png`,
      width: 768,
      height: 1024,
      alpha: true,
      registry: `SCENE_ART.lanterns.${state}`,
      description:
        "Ground-standing monumental gold customer lantern matching the approved reference, with a grounded architectural foot, correct flame/energy state and transparent perimeter. Same camera, silhouette, and pivot across states. No text, numbers, backing square or baked neighborhood. Bottom-center pivot. Existing V5 hanging lantern remains a preview fallback.",
      status: "required-for-reference-art-direction",
    })),
    ...["opus_la", "century_park_east"].map(id => ({
      destination: `/assets/goldline/lantern-city/v6/objects/${id}.png`,
      width: 1024,
      height: 1024,
      alpha: true,
      registry: `SCENE_ART.strongholds.${id}`,
      description:
        "Authored stronghold silhouette coordinated with the approved gold lantern world and neutral atlas. Preserve the canonical building identity, reserve lower-right 28% width by 50% height for separate live customer light. No count or flame baked into the tower. Whole-city art only; existing Tower Wars combat assets and damage truth are unchanged.",
      status: "required-for-reference-art-direction",
    })),
    {
      destination: "/assets/goldline/lantern-city/v6/objects/frontier-lock.png",
      width: 512,
      height: 512,
      alpha: true,
      registry: "SCENE_ART.lock",
      description:
        "Simple readable gold frontier lock matching approved reference and hostile terrain perspective; no background or text.",
      status: "required-for-reference-art-direction",
    },
  ],
  hudSafeAreas: Object.fromEntries(
    [
      [1920, 1080],
      [1440, 900],
      [1280, 900],
    ].map(([w, h]) => [`${w}x${h}`, hudLayout(w, h)])
  ),
  registration: {
    stage: { width: 3840, height: 2160 },
    geography:
      "worldAnchor remains the existing Mercator projection of canonical WGS84; display percentages are art-directed and must not be used for membership or GPS.",
    maskUsage:
      "Existing canonical masks are provenance/reference only. V6 plates use the authored display footprint, not the unshifted GIS crop.",
    platePixelSize: { width: 1536, height: 994 },
    plateAlpha:
      "RGBA PNG with straight alpha. Opaque terrain/building core covers the old landscape; feather the perimeter over 48–96 pixels into genuine transparency. No rectangular matte, drop shadow, baked color wash, or duplicate pests.",
    pivot: { x: 0.5, y: 9 / 23 },
    continuity:
      "All four states for a territory share pixel dimensions, camera, skyline/building registration, road entry/exit positions, horizon, light direction and pivot. Plate translation follows the compositor group. Inspect transitions at 100% and label-hidden state at all target viewports.",
    forbidden:
      "Do not turn a state plate into a large rat/building sticker. Transform the perceived ground and neighborhood. No labels, counts, customer lanterns, major locks, UI or business facts baked into artwork.",
  },
  territories: LANTERN_TERRITORIES.map(t => {
    const worldAnchor = projectLatLngToLanternAtlas(territoryCenter(t));
    const p = presentationFor(t.id, worldAnchor);
    return {
      territoryId: t.id,
      name: t.name,
      priority: TERRITORY_PRESENTATION[t.id]
        ? "initial authored neighborhood"
        : "expansion / selected neighborhood",
      canonicalMask: territoryMaskSrc(t.id),
      worldAnchor,
      displayPrimaryAnchorPct: p.primaryAnchor,
      displayStateBoundsPct: p.stateArtBounds,
      displacementLimitPx: p.displacementLimit,
      objectSafeArea: { x: 0.25, y: 0, width: 0.5, height: 0.7 },
      propGroundSlots: [
        { x: 0.3, y: 0.7, width: 0.25, height: 0.2 },
        { x: 0.65, y: 0.8, width: 0.2, height: 0.1 },
      ],
      assets: states.map(state => ({
        state,
        destination: `/assets/goldline/lantern-city/v6/territories/${t.id}/${state}.png`,
        width: 1536,
        height: 994,
        alpha: true,
        status: "missing",
        description: descriptions[state],
      })),
    };
  }),
  acceptance: [
    "Base and all required visible territory states supplied and manually reviewed.",
    "Hide status labels: healthy, cooling, neglected and hostile places remain distinguishable.",
    "No pasted-object appearance; soft transitions are authored into alpha.",
    "Real browser 1920×1080,1440×900,1280×900 side-by-side with approved reference.",
    "Only after art and browser review may acceptance change; file existence alone never grants visual acceptance.",
  ],
};
writeFileSync(
  "docs/design/goldline/lantern-city-v6/asset-manifest.json",
  JSON.stringify(manifest, null, 2) + "\n"
);
console.log(
  `Exported exact specifications for ${manifest.territories.length} territories / ${manifest.territories.length * 4} state variants.`
);
