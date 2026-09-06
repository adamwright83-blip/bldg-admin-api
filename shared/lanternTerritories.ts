import playable from "./data/mapping-la/playableTerritories.generated";
import { projectLatLngToLanternAtlas } from "./lanternCity";
import type { VeilGuardianId } from "./neighbourhoodVeil";

export type Position = [number, number];
export type PolygonGeometry = { type: "Polygon"; coordinates: Position[][] };
export type MultiPolygonGeometry = {
  type: "MultiPolygon";
  coordinates: Position[][][];
};
export type TerritoryGeometry = PolygonGeometry | MultiPolygonGeometry;
export type TerritoryControlState =
  | "queued"
  | "guarded"
  | "campaign_active"
  | "confrontation_ready"
  | "victory_pending"
  | "conquered";
export type TerritoryPresentation = {
  // Optional fantasy-map geometry. Geographic ownership always uses `geometry`.
  atlasPolygonOverride?: Position[][];
  cloudBounds: {
    xPct: number;
    yPct: number;
    widthPct: number;
    heightPct: number;
    rotation?: number;
  };
  guardianAnchor: { xPct: number; yPct: number; scale: number };
  lockAnchor: { xPct: number; yPct: number; scale: number; rotation?: number };
  majorLabel: boolean;
};
export type LanternTerritory = {
  id: string;
  name: string;
  aliases: string[];
  geometry: TerritoryGeometry;
  presentation: TerritoryPresentation;
  initialState: TerritoryControlState;
  initialGuardianId: VeilGuardianId | null;
  sourceType: "mapping_la_v5" | "operator_authored_subterritory";
  parentTerritory: string | null;
  boundaryBasis: string | null;
  referenceMetadata?: {
    label: string;
    url: string;
    canonical: false;
  };
};

const features = (playable as any).features as Array<{
  properties: { external_id: string; name: string };
  geometry: TerritoryGeometry;
}>;
const authored: Record<
  string,
  {
    state: TerritoryControlState;
    guardian: VeilGuardianId | null;
    major?: boolean;
  }
> = {
  "west-hollywood": {
    state: "guarded",
    guardian: "cloud_duchess",
    major: true,
  },
  "echo-park": { state: "guarded", guardian: "gust_jester", major: true },
  "east-hollywood": {
    state: "guarded",
    guardian: "sleepy_one_eye",
    major: true,
  },
  koreatown: { state: "conquered", guardian: null, major: true },
  "silver-lake": { state: "conquered", guardian: null, major: true },
  hollywood: { state: "conquered", guardian: null, major: true },
  "los-feliz": { state: "conquered", guardian: null, major: true },
  "beverly-hills": { state: "conquered", guardian: null, major: true },
  "century-city": { state: "conquered", guardian: null, major: true },
};
const presentationOverrides: Record<string, Partial<TerritoryPresentation>> = {
  "west-hollywood": {
    atlasPolygonOverride: [
      [
        [25, 31],
        [42, 30],
        [44, 43],
        [27, 45],
        [23, 38],
        [25, 31],
      ],
    ],
    cloudBounds: { xPct: 34, yPct: 38, widthPct: 21, heightPct: 15 },
    guardianAnchor: { xPct: 38, yPct: 36, scale: 0.86 },
    lockAnchor: { xPct: 42, yPct: 41, scale: 0.9 },
  },
  "east-hollywood": {
    atlasPolygonOverride: [
      [
        [46, 27],
        [59, 27],
        [62, 37],
        [58, 44],
        [45, 42],
        [46, 27],
      ],
    ],
    cloudBounds: { xPct: 53, yPct: 36, widthPct: 17, heightPct: 17 },
    guardianAnchor: { xPct: 53, yPct: 34, scale: 0.82 },
    lockAnchor: { xPct: 58, yPct: 40, scale: 0.9 },
  },
  "echo-park": {
    atlasPolygonOverride: [
      [
        [79, 28],
        [93, 29],
        [96, 40],
        [91, 47],
        [79, 44],
        [76, 36],
        [79, 28],
      ],
    ],
    cloudBounds: { xPct: 86, yPct: 37, widthPct: 20, heightPct: 19 },
    guardianAnchor: { xPct: 86, yPct: 35, scale: 0.84 },
    lockAnchor: { xPct: 91, yPct: 41, scale: 0.9 },
  },
};

function rings(g: TerritoryGeometry): Position[][] {
  return g.type === "Polygon" ? g.coordinates : g.coordinates.flat();
}
function centroid(g: TerritoryGeometry) {
  const pts = rings(g).flat();
  return {
    longitude: pts.reduce((s, p) => s + p[0], 0) / pts.length,
    latitude: pts.reduce((s, p) => s + p[1], 0) / pts.length,
  };
}
export function territoryCenter(territory: LanternTerritory) {
  return centroid(territory.geometry);
}
function presentation(
  g: TerritoryGeometry,
  majorLabel: boolean
): TerritoryPresentation {
  const projected = rings(g)
    .flat()
    .map(([longitude, latitude]) =>
      projectLatLngToLanternAtlas({ latitude, longitude })
    );
  const xs = projected.map(p => p.x),
    ys = projected.map(p => p.y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const x = (minX + maxX) / 2,
    y = (minY + maxY) / 2;
  return {
    cloudBounds: {
      xPct: x,
      yPct: y,
      widthPct: maxX - minX,
      heightPct: maxY - minY,
    },
    guardianAnchor: { xPct: x, yPct: y, scale: 1 },
    lockAnchor: { xPct: x + 2, yPct: y + 3, scale: 1 },
    majorLabel,
  };
}

export const LANTERN_TERRITORIES: LanternTerritory[] = features.map(feature => {
  const id = feature.properties.external_id;
  const init = authored[id];
  const basePresentation = presentation(feature.geometry, Boolean(init?.major));
  return {
    id,
    name: feature.properties.name,
    aliases: [],
    geometry: feature.geometry,
    presentation: { ...basePresentation, ...presentationOverrides[id] },
    initialState: init?.state ?? "queued",
    initialGuardianId: init?.guardian ?? null,
    sourceType: "mapping_la_v5",
    parentTerritory: null,
    boundaryBasis: null,
  };
});

// Mapping L.A. treats this area as part of Downtown. Goldline keeps an explicit,
// operator-authored Arts District subterritory using its commonly recognized
// 1st/7th Street and Alameda/river envelope.
const artsGeometry: PolygonGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [-118.239, 34.052],
      [-118.229, 34.052],
      [-118.225, 34.035],
      [-118.238, 34.035],
      [-118.239, 34.052],
    ],
  ],
};
LANTERN_TERRITORIES.push({
  id: "arts-district",
  name: "Arts District",
  aliases: ["Downtown Arts District"],
  geometry: artsGeometry,
  presentation: {
    ...presentation(artsGeometry, true),
    atlasPolygonOverride: [
      [
        [77, 58],
        [91, 56],
        [95, 66],
        [90, 76],
        [76, 73],
        [73, 65],
        [77, 58],
      ],
    ],
    cloudBounds: { xPct: 84, yPct: 66, widthPct: 22, heightPct: 20 },
    guardianAnchor: { xPct: 86, yPct: 68, scale: 0.86 },
    lockAnchor: { xPct: 91, yPct: 73, scale: 0.9 },
  },
  initialState: "guarded",
  initialGuardianId: "thunder_king",
  sourceType: "operator_authored_subterritory",
  parentTerritory: "downtown",
  boundaryBasis: "1st St / 7th St / Alameda St / Los Angeles River",
  referenceMetadata: {
    label: "Arts District Los Angeles BID map (sanity-check only)",
    url: "https://artsdistrictla.org/about/bid-map/",
    canonical: false,
  },
});

export function normalizeTerritoryName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
export function territoryByName(value: string) {
  const key = normalizeTerritoryName(value);
  return (
    LANTERN_TERRITORIES.find(
      t =>
        t.id === key || t.aliases.some(a => normalizeTerritoryName(a) === key)
    ) ?? null
  );
}
function inRing([x, y]: Position, ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
export function geometryContainsPoint(g: TerritoryGeometry, p: Position) {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polys.some(
    poly => inRing(p, poly[0]) && !poly.slice(1).some(h => inRing(p, h))
  );
}
export function classifyTerritory(latitude: number, longitude: number) {
  const matches = LANTERN_TERRITORIES.filter(t =>
    geometryContainsPoint(t.geometry, [longitude, latitude])
  );
  const children = matches.filter(
    t => t.parentTerritory && matches.some(p => p.id === t.parentTerritory)
  );
  if (children.length === 1) return children[0];
  if (matches.length > 1)
    throw new Error(
      `Overlapping territory geometry: ${matches.map(m => m.id).join(",")}`
    );
  return matches[0] ?? null;
}
export function atlasPolygon(t: LanternTerritory) {
  if (t.presentation.atlasPolygonOverride) {
    return t.presentation.atlasPolygonOverride.map(ring =>
      ring.map(([x, y]) => ({ x, y, outOfBounds: false }))
    );
  }
  return rings(t.geometry).map(r =>
    r.map(([longitude, latitude]) =>
      projectLatLngToLanternAtlas({ latitude, longitude })
    )
  );
}

export type TerritoryOccupancy = {
  territory: LanternTerritory;
  customerLocations: readonly { latitude: number; longitude: number }[];
  customerCount: number;
  conquered: boolean;
  guarded: boolean;
};

export function deriveTerritoryOccupancy(input: {
  customers: readonly { latitude: number; longitude: number }[];
  conqueredTerritoryIds?: ReadonlySet<string>;
  atlasReady: boolean;
  totalCustomers: number;
}): {
  suppressed: boolean;
  territories: TerritoryOccupancy[];
  unclassified: number;
} {
  const customerLocationsByTerritory = new Map<
    string,
    { latitude: number; longitude: number }[]
  >();
  let unclassified = 0;
  for (const customer of input.customers) {
    const territory = classifyTerritory(customer.latitude, customer.longitude);
    if (!territory) {
      unclassified += 1;
      continue;
    }
    const territoryCustomers =
      customerLocationsByTerritory.get(territory.id) ?? [];
    territoryCustomers.push(customer);
    customerLocationsByTerritory.set(territory.id, territoryCustomers);
  }
  const suppressed =
    !input.atlasReady ||
    (input.totalCustomers > 0 && input.customers.length === 0);
  return {
    suppressed,
    unclassified,
    territories: LANTERN_TERRITORIES.map(territory => {
      const customerLocations =
        customerLocationsByTerritory.get(territory.id) ?? [];
      const customerCount = customerLocations.length;
      const conquered =
        territory.initialState === "conquered" ||
        Boolean(input.conqueredTerritoryIds?.has(territory.id));
      return {
        territory,
        customerLocations,
        customerCount,
        conquered,
        guarded:
          !suppressed &&
          !conquered &&
          customerCount === 0 &&
          territory.initialState === "guarded",
      };
    }),
  };
}
