export type PropertyGroup = "opus_la" | "century_park_east" | "unknown";
export type TowerKey =
  | "opus_south_3545"
  | "opus_north_3650"
  | "cpe_south_2170"
  | "cpe_north_2160"
  | "unknown";

export type PropertyTowerMatch = {
  propertyGroup: PropertyGroup;
  propertyDisplayName: "OPUS LA" | "Century Park East" | "Unknown";
  towerKey: TowerKey;
  towerDisplayName: "South Tower" | "North Tower" | "Unknown Tower";
  buildingAddressCanonical: string | null;
};

export const UNKNOWN_PROPERTY_TOWER: PropertyTowerMatch = {
  propertyGroup: "unknown",
  propertyDisplayName: "Unknown",
  towerKey: "unknown",
  towerDisplayName: "Unknown Tower",
  buildingAddressCanonical: null,
};

export const TOWER_DEFINITIONS: Record<TowerKey, PropertyTowerMatch> = {
  opus_south_3545: {
    propertyGroup: "opus_la",
    propertyDisplayName: "OPUS LA",
    towerKey: "opus_south_3545",
    towerDisplayName: "South Tower",
    buildingAddressCanonical: "3545 Wilshire Blvd",
  },
  opus_north_3650: {
    propertyGroup: "opus_la",
    propertyDisplayName: "OPUS LA",
    towerKey: "opus_north_3650",
    towerDisplayName: "North Tower",
    buildingAddressCanonical: "3650 W 6th Street",
  },
  cpe_south_2170: {
    propertyGroup: "century_park_east",
    propertyDisplayName: "Century Park East",
    towerKey: "cpe_south_2170",
    towerDisplayName: "South Tower",
    buildingAddressCanonical: "2170 Century Pk E",
  },
  cpe_north_2160: {
    propertyGroup: "century_park_east",
    propertyDisplayName: "Century Park East",
    towerKey: "cpe_north_2160",
    towerDisplayName: "North Tower",
    buildingAddressCanonical: "2160 Century Pk E",
  },
  unknown: UNKNOWN_PROPERTY_TOWER,
};

function normalizeAddressToken(address: string | null | undefined): string {
  return String(address ?? "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\bwest\b/g, "w")
    .replace(/\bboulevard\b/g, "blvd")
    .replace(/\bpark east\b/g, "pk e")
    .replace(/\bstreet\b/g, "st")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePropertyTower(
  address: string | null | undefined,
  fallback?: Partial<Pick<PropertyTowerMatch, "propertyGroup" | "towerKey">>
): PropertyTowerMatch {
  const normalized = normalizeAddressToken(address);

  if (normalized.includes("3545 wilshire")) return TOWER_DEFINITIONS.opus_south_3545;
  if (
    normalized.includes("3650 w 6th") ||
    normalized.includes("3650 6th")
  ) {
    return TOWER_DEFINITIONS.opus_north_3650;
  }
  if (normalized.includes("2170 century pk e")) return TOWER_DEFINITIONS.cpe_south_2170;
  if (normalized.includes("2160 century pk e")) return TOWER_DEFINITIONS.cpe_north_2160;

  if (
    fallback?.towerKey &&
    fallback.towerKey !== "unknown" &&
    fallback.towerKey in TOWER_DEFINITIONS
  ) {
    return TOWER_DEFINITIONS[fallback.towerKey as TowerKey];
  }
  if (fallback?.propertyGroup === "opus_la") {
    return {
      ...UNKNOWN_PROPERTY_TOWER,
      propertyGroup: "opus_la",
      propertyDisplayName: "OPUS LA",
    };
  }
  if (fallback?.propertyGroup === "century_park_east") {
    return {
      ...UNKNOWN_PROPERTY_TOWER,
      propertyGroup: "century_park_east",
      propertyDisplayName: "Century Park East",
    };
  }
  return UNKNOWN_PROPERTY_TOWER;
}
