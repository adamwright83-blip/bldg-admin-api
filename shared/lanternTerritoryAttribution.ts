import {
  geometryContainsPoint,
  territoryCenter,
  type LanternTerritory,
  type TerritoryGeometry,
} from "./lanternTerritories";

/**
 * Street number + first street token. Unit, city, and ZIP never take part.
 * This is a premise key for two known towers. It is not a neighborhood-name match.
 */
export function streetIdentity(address: string | null | undefined): string | null {
  const match = (address ?? "")
    .toLowerCase()
    .trim()
    .match(/^(\d+[a-z]?)\s+(?:[nsew]\.?\s+)?([a-z]+)/);
  return match ? `${match[1]} ${match[2]}` : null;
}

/** 2160 and 2170 Century Park East. Not "the address mentions Century City." */
export function isCenturyParkEastTower(street: string | null | undefined): boolean {
  return street === "2160 century" || street === "2170 century";
}

export type PointAttribution =
  | { status: "assigned"; territoryId: string; territoryName: string }
  | { status: "ambiguous"; territoryIds: string[] }
  | { status: "unlocated" };

function rings(geometry: TerritoryGeometry): number[][][] {
  return geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
}

/**
 * Authoritative point-in-polygon ownership.
 * Address text that merely resembles a territory name is ignored.
 * The Century Park East towers are the one premise override, shared with the live lanterns.
 * Overlapping boundaries that are not a single child of a parent are ambiguous — never doubled.
 */
export function attributeLanternPoint(input: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  premiseStreet: string | null;
  territories: readonly LanternTerritory[];
}): PointAttribution {
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { status: "unlocated" };
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return { status: "unlocated" };
  if (isCenturyParkEastTower(input.premiseStreet)) {
    const century = input.territories.find(territory => territory.id === "century-city");
    if (century) return { status: "assigned", territoryId: century.id, territoryName: century.name };
  }
  const matches = input.territories.filter(territory =>
    geometryContainsPoint(territory.geometry, [longitude, latitude])
  );
  const children = matches.filter(
    territory => territory.parentTerritory && matches.some(parent => parent.id === territory.parentTerritory)
  );
  if (children.length === 1) {
    return { status: "assigned", territoryId: children[0]!.id, territoryName: children[0]!.name };
  }
  if (children.length > 1) {
    return { status: "ambiguous", territoryIds: children.map(territory => territory.id).sort() };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", territoryIds: matches.map(territory => territory.id).sort() };
  }
  if (matches.length === 1) {
    return { status: "assigned", territoryId: matches[0]!.id, territoryName: matches[0]!.name };
  }
  return { status: "unlocated" };
}

export type ServiceArea = {
  id: string;
  latitude: number;
  longitude: number;
  radiusMiles: number;
};

function distanceMiles(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const radians = (value: number) => (value * Math.PI) / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function territoryMeetsArea(territory: LanternTerritory, area: ServiceArea): boolean {
  if (geometryContainsPoint(territory.geometry, [area.longitude, area.latitude])) return true;
  const center = territoryCenter(territory);
  if (distanceMiles(area, center) <= area.radiusMiles) return true;
  for (const ring of rings(territory.geometry)) {
    for (const [longitude, latitude] of ring) {
      if (distanceMiles(area, { latitude: latitude!, longitude: longitude! }) <= area.radiusMiles) return true;
    }
  }
  return false;
}

/** Territories the tenant's configured service area actually reaches. Labels are ignored. */
export function territoriesInServiceAreas(
  areas: readonly ServiceArea[],
  territories: readonly LanternTerritory[]
): LanternTerritory[] {
  const valid = areas.filter(
    area =>
      Number.isFinite(area.latitude) &&
      Number.isFinite(area.longitude) &&
      Math.abs(area.latitude) <= 90 &&
      Math.abs(area.longitude) <= 180 &&
      area.radiusMiles > 0 &&
      area.radiusMiles <= 100
  );
  return territories.filter(territory => valid.some(area => territoryMeetsArea(territory, area)));
}
