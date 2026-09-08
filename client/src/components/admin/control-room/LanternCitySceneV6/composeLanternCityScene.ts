import { CANONICAL_BUILDING_GEOGRAPHY } from "@shared/canonicalGeography";
import {
  classifyTerritory,
  deriveTerritoryOccupancy,
  territoryCenter,
} from "@shared/lanternTerritories";
import { projectLatLngToLanternAtlas } from "@shared/lanternCity";
import {
  deriveTerritoryVisualState,
  territoryVisualStateLabel,
  stableHash,
  type TerritoryVisualState,
} from "@shared/lanternTerritoryVisualState";
import {
  clusterGeographicCustomers,
  clusterAtCanonicalAddress,
  clusterCoveredByAtlasPoint,
  centroidOfClusters,
  mergeClusters,
} from "../customerGeography";
import type { GeographicCustomer } from "../customerGeography";
import { LANTERN_CITY_V5_ASSETS as ASSETS } from "@/components/goldline/lanternCityV5Assets";
import { frontierKindForTerritory, lostGroundKindForTerritory } from "@shared/lanternFrontierPresentation";
import {
  presentationFor,
  TERRITORY_PRESENTATION,
} from "./territoryPresentation";
import { statePlateAsset } from "./sceneAssets";
import { worldPercentToScreen, worldPercentSizeToScreen } from "./worldStage";
import {
  DEFAULT_CONTROLS,
  type CityScene,
  type Point,
  type Rect,
  type SceneControls,
  type SceneObject,
  type SceneProspect,
  type TerritoryTruth,
} from "./sceneTypes";

export function overlaps(a: Rect, b: Rect, gap = 8) {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}
/**
 * A scene object's status text must describe that object, not the whole
 * territory. `objectCustomerCount` is the count the object itself carries
 * (its own cluster total) — never the territory-wide truth.customers.length
 * when the object is only one of several lanterns sharing a territory.
 */
export function territoryStateText(params: {
  totalCustomers: number;
  guarded: boolean;
  state: TerritoryVisualState;
  objectCustomerCount: number;
}): string {
  const { totalCustomers, guarded, state, objectCustomerCount } = params;
  return !totalCustomers
    ? `${guarded ? "Guarded · " : ""}0 customers`
    : `${territoryVisualStateLabel(state)} · ${objectCustomerCount} customer${objectCustomerCount === 1 ? "" : "s"}`;
}
export function hudLayout(width: number, height: number) {
  const compact = width < 1400;
  const leftWidth = compact ? 258 : width < 1700 ? 286 : 330;
  const rightWidth = compact ? 264 : width < 1700 ? 292 : 330;
  return {
    identity: { x: 16, y: 10, width: compact ? 250 : 330, height: 72 },
    topBar: {
      x: compact ? 278 : 360,
      y: 10,
      width: width - (compact ? 294 : 376),
      height: 72,
    },
    leftOperation: { x: 14, y: 92, width: leftWidth, height: height - 198 },
    rightDossier: {
      x: width - rightWidth - 14,
      y: 92,
      width: rightWidth,
      height: height - 198,
    },
    deck: { x: 14, y: height - 96, width: width - 28, height: 84 },
  };
}
export type ComposeInput = {
  customers: readonly GeographicCustomer[];
  atlasReady: boolean;
  viewport: { width: number; height: number };
  conqueredTerritoryIds?: ReadonlySet<string>;
  lostGroundTerritoryIds?: ReadonlySet<string>;
  selectedTerritory?: string | null;
  controls?: SceneControls;
  prospects?: readonly SceneProspect[];
  secondLightTerritoryId?: string | null;
  featuredOperationTerritoryId?: string | null;
};
export function composeLanternCityScene(input: ComposeInput): CityScene {
  const { width, height } = input.viewport;
  const controls = input.controls ?? DEFAULT_CONTROLS;
  const hud = hudLayout(width, height);
  const exclusions = Object.values(hud);
  const scene: CityScene = {
    viewport: input.viewport,
    hud,
    exclusions,
    objects: [],
    plates: [],
    props: [],
    suppressed: [],
    truth: [],
    controls,
    artStatus: "APPROVED",
  };
  const located = input.customers.filter(c => c.location);
  const occupancy = deriveTerritoryOccupancy({
    customers: located.map(c => c.location!),
    totalCustomers: input.customers.length,
    atlasReady: input.atlasReady,
    conqueredTerritoryIds: input.conqueredTerritoryIds,
  });
  if (occupancy.suppressed) return scene;
  const byTerritory = new Map<string, GeographicCustomer[]>();
  for (const c of located) {
    const id = classifyTerritory(
      c.location!.latitude,
      c.location!.longitude
    )?.id;
    if (id) byTerritory.set(id, [...(byTerritory.get(id) ?? []), c]);
  }
  scene.truth = occupancy.territories.map(row => {
    const customers = byTerritory.get(row.territory.id) ?? [];
    const mix = { active: 0, dimming: 0, dark: 0 };
    customers.forEach(c => mix[c.cadence.state]++);
    const state = deriveTerritoryVisualState({
      ...mix,
      territoryId: row.territory.id,
      conquered: row.conquered,
      guarded: row.guarded,
      pressureReturned:
        input.lostGroundTerritoryIds?.has(row.territory.id) ?? false,
    });
    // Empty-land art is a presentation choice; guarded/conquered evidence stays on occupancy.
    const emptySkin =
      TERRITORY_PRESENTATION[row.territory.id]?.emptyEnvironment;
    const environment: TerritoryTruth["environment"] = !customers.length
      ? emptySkin === "infested" || state === "lost_ground"
        ? "infested"
        : "locked"
      : ["infested", "overgrown", "closed_construction"].includes(state)
        ? "infested"
        : state === "healthy"
          ? "healthy"
          : "cooling";
    return { occupancy: row, customers, state, environment };
  });
  const clusters = clusterGeographicCustomers([...input.customers]);
  const assigned = new Set<string>();
  const candidates: Array<
    Omit<SceneObject, "displayAnchor" | "bounds" | "artBounds" | "labelBounds">
  > = [];
  // Placement anchoring stays territory-geography-based even where
  // worldAnchor (truth) now points at a specific customer address.
  const territoryPresentationCache = new Map<
    string,
    ReturnType<typeof presentationFor>
  >();
  for (const buildingId of ["opus_la", "century_park_east"] as const) {
    const geo = CANONICAL_BUILDING_GEOGRAPHY[buildingId];
    const worldAnchor = projectLatLngToLanternAtlas(geo);
    const carried = clusters.filter(
      c =>
        !assigned.has(c.key) &&
        !c.outsideAtlas &&
        (clusterAtCanonicalAddress(c, geo.address) ||
          clusterCoveredByAtlasPoint(c, worldAnchor))
    );
    carried.forEach(c => assigned.add(c.key));
    const cluster = carried.length ? mergeClusters(carried) : undefined;
    const territoryId =
      classifyTerritory(geo.latitude, geo.longitude)?.id ??
      (buildingId === "opus_la" ? "koreatown" : "century-city");
    const truth = scene.truth.find(
      t => t.occupancy.territory.id === territoryId
    )!;
    if (controls.buildings)
      candidates.push({
        id: buildingId,
        buildingId,
        kind: "stronghold",
        name: geo.name,
        territoryId,
        worldAnchor,
        sourceAnchors: [
          { ...worldAnchor, latitude: geo.latitude, longitude: geo.longitude },
        ],
        cluster,
        sourceClusters: carried,
        state: truth.state,
        environment: truth.environment,
        priority: 0,
        status: `${cluster?.total ?? 0} customers · Enter Tower Wars`,
        occupancy: truth.occupancy,
      });
    else carried.forEach(c => assigned.delete(c.key));
  }
  for (const truth of scene.truth) {
    const { territory } = truth.occupancy;
    const geo = territoryCenter(territory);
    const territoryWorldAnchor = projectLatLngToLanternAtlas(geo);
    const presentation = presentationFor(territory.id, territoryWorldAnchor);
    territoryPresentationCache.set(territory.id, presentation);
    const remaining = truth.customers.filter(
      c => !clusters.some(g => assigned.has(g.key) && g.customers.includes(c))
    );
    const groups = clusterGeographicCustomers(remaining);
    const cluster = groups.length ? mergeClusters(groups) : undefined;
    const alreadyHasTower = candidates.some(
      c => c.territoryId === territory.id && c.kind === "stronghold"
    );
    if (alreadyHasTower && !cluster) continue;
    if (
      !TERRITORY_PRESENTATION[territory.id] &&
      !truth.customers.length &&
      input.selectedTerritory !== territory.id
    )
      continue;
    if (
      territoryWorldAnchor.outOfBounds &&
      !TERRITORY_PRESENTATION[territory.id]
    )
      continue;
    const kind =
      cluster && controls.lanterns
        ? "lantern"
        : truth.environment === "locked"
          ? "lock"
          : "environment";
    // worldAnchor is geographic truth: a single real address for one
    // physical cluster, a weighted centroid of real addresses for an
    // aggregate, and the territory centroid only for objects that don't
    // represent any specific customer (locks/environment skins).
    const worldAnchor =
      kind === "lantern" && groups.length === 1
        ? { x: groups[0]!.x, y: groups[0]!.y }
        : kind === "lantern" && groups.length > 1
          ? centroidOfClusters(groups)
          : territoryWorldAnchor;
    const objectCustomerCount = cluster?.total ?? truth.customers.length;
    const stateText = territoryStateText({
      totalCustomers: truth.customers.length,
      guarded: truth.occupancy.guarded,
      state: truth.state,
      objectCustomerCount,
    });
    // "What could be…" world storytelling: a guarded (unreached) frontier
    // gets its authored dormant object; a territory whose prior clear lost
    // pressure gets the LOST variant instead. Never both, never fabricated
    // from anything but real occupancy/state truth already computed above.
    const isLostGround = truth.state === "lost_ground";
    const frontierKind =
      !cluster && isLostGround
        ? lostGroundKindForTerritory(territory.id)
        : !cluster && truth.occupancy.guarded
          ? frontierKindForTerritory(territory.id)
          : undefined;
    candidates.push({
      id: `territory:${territory.id}`,
      territoryId: territory.id,
      name: territory.name,
      kind,
      worldAnchor,
      sourceAnchors: groups.map(g => ({
        x: g.x,
        y: g.y,
        latitude: g.latitude,
        longitude: g.longitude,
      })),
      cluster,
      sourceClusters: groups,
      environment: truth.environment,
      state: truth.state,
      occupancy: truth.occupancy,
      priority: frontierKind
        ? -2
        : input.selectedTerritory === territory.id
          ? 1
          : presentation.priority,
      status: stateText,
      frontierKind,
      frontierLostGround: isLostGround,
    });
  }
  // Territory environment art is foundational world art, not an
  // interactive object — it renders whenever a territory has an authored
  // position, independent of whether that territory's customer lantern or
  // stronghold later wins a collision-free slot in the placement pass
  // below. It always sits at its pure authored stateArtBounds (never
  // nudged to "follow" a displaced object), which is correct now that
  // registered art is generated directly from that exact board crop.
  if (controls.territories)
    for (const truth of scene.truth) {
      const territoryId = truth.occupancy.territory.id;
      const presentation = territoryPresentationCache.get(territoryId);
      if (!presentation) continue;
      const plateTopLeft = worldPercentToScreen(
        { x: presentation.stateArtBounds.x, y: presentation.stateArtBounds.y },
        input.viewport
      );
      const plateSize = worldPercentSizeToScreen(
        {
          width: presentation.stateArtBounds.width,
          height: presentation.stateArtBounds.height,
        },
        input.viewport
      );
      const plateBounds = {
        x: plateTopLeft.x,
        y: plateTopLeft.y,
        width: plateSize.width,
        height: plateSize.height,
      };
      if (exclusions.some(zone => overlaps(plateBounds, zone, 0))) continue;
      scene.plates.push({
        territoryId,
        state: truth.environment,
        bounds: plateBounds,
        src: statePlateAsset(territoryId, truth.environment),
        registration: "authored-display",
      });
      // Infestation is a territory-level environmental truth, independent
      // of whether that same territory also has real customers, a lantern,
      // or a stronghold — those are separate layers. A district reading
      // "infested" always shows both a rat and a cockroach presence, never
      // suppressed by customer/object placement pressure. Deterministic
      // per-territory offset (not random) so neighbors don't look cloned,
      // and both props always render regardless of viewport width.
      if (truth.environment === "infested") {
        const seed = stableHash(territoryId);
        const jitterX = ((seed % 7) - 3) * 4; // -12..12
        const jitterY = (((seed >> 3) % 5) - 2) * 4; // -8..8
        scene.props.push({
          id: `territory:${territoryId}:rat`,
          territoryId,
          src: ASSETS.decayProps.ratHero,
          bounds: {
            x: plateBounds.x + plateBounds.width * 0.12 + jitterX,
            y: plateBounds.y + plateBounds.height * 0.42 + jitterY,
            width: Math.max(
              64,
              plateBounds.width *
                (input.featuredOperationTerritoryId === territoryId
                  ? 0.34
                  : 0.22)
            ),
            height: Math.max(
              64,
              plateBounds.width *
                (input.featuredOperationTerritoryId === territoryId
                  ? 0.34
                  : 0.22)
            ),
          },
        });
        scene.props.push({
          id: `territory:${territoryId}:roach`,
          territoryId,
          src: ASSETS.decayProps.cockroachSwarm,
          bounds: {
            x: plateBounds.x + plateBounds.width * 0.58 - jitterX,
            y: plateBounds.y + plateBounds.height * 0.68 - jitterY,
            width: Math.max(48, plateBounds.width * 0.16),
            height: Math.max(36, plateBounds.width * 0.12),
          },
        });
      }
    }
  if (controls.opportunities)
    for (const prospect of input.prospects ?? []) {
      const territoryId = classifyTerritory(
        prospect.latitude,
        prospect.longitude
      )?.id;
      if (!territoryId) continue;
      const territoryTruth = scene.truth.find(
        t => t.occupancy.territory.id === territoryId
      )!;
      candidates.push({
        id: `prospect:${prospect.id}`,
        prospectId: prospect.id,
        territoryId,
        name: prospect.name,
        kind: "prospect",
        worldAnchor: prospect.worldAnchor,
        sourceAnchors: [
          {
            ...prospect.worldAnchor,
            latitude: prospect.latitude,
            longitude: prospect.longitude,
          },
        ],
        priority: 6,
        state: territoryTruth.state,
        environment: territoryTruth.environment,
        status: "Opportunity",
      });
    }
  if (input.secondLightTerritoryId) {
    const territoryId = input.secondLightTerritoryId;
    const truth = scene.truth.find(
      row => row.occupancy.territory.id === territoryId
    );
    const presentation = territoryPresentationCache.get(territoryId);
    if (truth && presentation)
      candidates.push({
        id: `second-light:${territoryId}`,
        territoryId,
        name: "The Second Light",
        kind: "second_light",
        worldAnchor:
          presentation.lanternSlots?.at(-1) ?? presentation.primaryAnchor,
        sourceAnchors: [],
        priority: -1,
        state: truth.state,
        environment: truth.environment,
        status: "Waiting for a real new customer",
      });
  }
  candidates.sort(
    (a, b) =>
      a.priority - b.priority ||
      (b.cluster?.total ?? 0) - (a.cluster?.total ?? 0) ||
      a.id.localeCompare(b.id)
  );
  const occupied: Rect[] = [...exclusions];
  let heroSlots = 3;
  for (const candidate of candidates) {
    const p =
      territoryPresentationCache.get(candidate.territoryId) ??
      presentationFor(candidate.territoryId, candidate.worldAnchor);
    const count = candidate.cluster?.total ?? 0;
    const hero =
      heroSlots > 0 && (candidate.kind === "stronghold" || count >= 6);
    const artHeight =
      candidate.kind === "stronghold"
        ? // Sized so the weapon overlay (the OPUS golf driver, the CPE
          // bazooka) — composed together with the tower plate in the same
          // authored 800x1200 art space — reads as a hero feature rather
          // than a barely-visible detail. CanonicalBuildingArt scales
          // both plate and weapon as one locked unit, so enlarging this
          // box enlarges the weapon proportionally with it.
          width >= 1680
          ? 280
          : 230
        : candidate.kind === "second_light"
          ? 96
          : candidate.frontierKind
            ? 108
            : hero
              ? 154
              : count >= 2
                ? 104
                : 80;
    const boxWidth = candidate.kind === "stronghold" ? 176 : 124;
    const boxHeight = artHeight + 42;
    // Strongholds always use the territory's primary anchor. A customer
    // lantern that cannot fit there (usually because it shares the
    // territory with a stronghold already occupying that anchor) falls
    // through to the territory's authored lanternSlots in order, before
    // being suppressed. Each anchor is a world-stage percent, converted
    // through the same cover transform the atlas <img> renders with, so
    // the box lands on the artwork it is meant to sit on instead of
    // drifting with viewport aspect ratio.
    const anchorCandidates: Point[] =
      candidate.kind === "stronghold"
        ? [p.primaryAnchor]
        : candidate.kind === "second_light"
          ? [...(p.lanternSlots ?? []), p.primaryAnchor]
          : [p.primaryAnchor, ...(p.lanternSlots ?? [])];
    const offsets = [{ x: 0, y: 0 }];
    for (const radius of [36, 72, 108, 144, 180, 216, 252, 288, 324, 360, 396])
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ])
        offsets.push({ x: dx * radius, y: dy * radius });
    let desired = { x: 0, y: 0 };
    let found: Rect | undefined;
    for (const anchor of anchorCandidates) {
      const anchorScreen = worldPercentToScreen(anchor, input.viewport);
      const anchorDesired = {
        x: anchorScreen.x - boxWidth / 2,
        y: anchorScreen.y - artHeight / 2,
      };
      const anchorFound = offsets
        .map(offset => ({
          x: anchorDesired.x + offset.x,
          y: anchorDesired.y + offset.y,
          width: boxWidth,
          height: boxHeight,
        }))
        .find(
          rect =>
            Math.hypot(rect.x - anchorDesired.x, rect.y - anchorDesired.y) <=
              p.displacementLimit &&
            rect.x >= 8 &&
            rect.y >= 8 &&
            rect.x + rect.width <= width - 8 &&
            rect.y + rect.height <= height - 8 &&
            !occupied.some(other => overlaps(rect, other))
        );
      if (anchorFound) {
        found = anchorFound;
        desired = anchorDesired;
        break;
      }
    }
    if (!found) {
      scene.suppressed.push({
        id: candidate.id,
        reason: "No collision-free slot within authored displacement limit",
      });
      continue;
    }
    occupied.push(found);
    if (hero) heroSlots--;
    const object: SceneObject = {
      ...candidate,
      bounds: found,
      displayAnchor: {
        x: found.x + found.width / 2,
        y: found.y + artHeight / 2,
      },
      artBounds: { ...found, height: artHeight },
      labelBounds: {
        x: found.x,
        y: found.y + artHeight,
        width: found.width,
        height: 42,
      },
    };
    scene.objects.push(object);
  }
  return scene;
}
