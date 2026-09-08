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
  return {
    identity: { x: 16, y: 12, width: compact ? 300 : 370, height: 80 },
    quest: { x: 16, y: 102, width: compact ? 246 : 280, height: 136 },
    controls: {
      x: width - (compact ? 204 : 224),
      y: 16,
      width: compact ? 188 : 208,
      height: 340,
    },
    deck: { x: 16, y: height - 104, width: width - 32, height: 88 },
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
    artStatus: "BLOCKED ON ART",
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
      priority:
        input.selectedTerritory === territory.id ? 1 : presentation.priority,
      status: stateText,
    });
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
        ? width >= 1680
          ? 206
          : 168
        : hero
          ? 154
          : count >= 2
            ? 115
            : 88;
    const boxWidth = candidate.kind === "stronghold" ? 190 : 166;
    const boxHeight = artHeight + 50;
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
        : [p.primaryAnchor, ...(p.lanternSlots ?? [])];
    const offsets = [{ x: 0, y: 0 }];
    for (const radius of [36, 72, 108, 144])
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
        height: 50,
      },
    };
    scene.objects.push(object);
    if (
      controls.territories &&
      !scene.plates.some(plate => plate.territoryId === object.territoryId)
    ) {
      // Registered art moves with its authored territory group, not an
      // unrelated centroid, and is converted through the same world-stage
      // transform as the anchor above so it stays pinned to the atlas.
      const plateTopLeft = worldPercentToScreen(
        { x: p.stateArtBounds.x, y: p.stateArtBounds.y },
        input.viewport
      );
      const plateSize = worldPercentSizeToScreen(
        { width: p.stateArtBounds.width, height: p.stateArtBounds.height },
        input.viewport
      );
      const plateBounds = {
        x: plateTopLeft.x + found.x - desired.x,
        y: plateTopLeft.y + found.y - desired.y,
        width: plateSize.width,
        height: plateSize.height,
      };
      if (!exclusions.some(zone => overlaps(plateBounds, zone, 0)))
        scene.plates.push({
          territoryId: object.territoryId,
          state: object.environment,
          bounds: plateBounds,
          src: statePlateAsset(object.territoryId, object.environment),
          registration: "authored-display",
        });
    }
    if (
      candidate.kind === "environment" &&
      candidate.environment === "infested" &&
      !candidate.cluster
    ) {
      scene.props.push({
        id: `${candidate.id}:rat`,
        territoryId: candidate.territoryId,
        src: ASSETS.decayProps.ratHero,
        bounds: {
          x: found.x + 30,
          y: found.y,
          width: 90,
          height: artHeight - 15,
        },
      });
      if (width >= 1400)
        scene.props.push({
          id: `${candidate.id}:roach`,
          territoryId: candidate.territoryId,
          src: ASSETS.decayProps.cockroachSwarm,
          bounds: {
            x: found.x + 102,
            y: found.y + artHeight - 38,
            width: 52,
            height: 36,
          },
        });
    }
  }
  return scene;
}
