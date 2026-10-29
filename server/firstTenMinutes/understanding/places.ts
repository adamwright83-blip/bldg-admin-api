import type { FindingPayload } from "../../../shared/firstTenMinutesFindings";
import type { DraftFinding } from "./draft";
import type { Geocoder } from "./sources";

/**
 * Mara's map and Orren's route get coordinates from a geocoder, from addresses the person's own sources wrote down.
 * Nothing is placed without an address; a place whose address doesn't resolve keeps its name and no pin.
 */
const MAX_LOOKUPS = 16;

export async function placeFindings(findings: DraftFinding[], geocoder: Geocoder): Promise<void> {
  let lookups = 0;
  const cache = new Map<string, Awaited<ReturnType<Geocoder["geocode"]>>>();
  const resolve = async (address: string) => {
    const key = address.trim();
    if (cache.has(key)) return cache.get(key) ?? null;
    if (lookups >= MAX_LOOKUPS) return null;
    lookups += 1;
    const found = await geocoder.geocode(key).catch(() => null);
    cache.set(key, found);
    return found;
  };
  for (const finding of findings) {
    const payload = finding.payload;
    if (payload.kind === "place" && payload.address) {
      const found = await resolve(payload.address);
      if (found) {
        payload.lat = found.lat;
        payload.lng = found.lng;
      }
    }
    if (payload.kind === "route") {
      for (const stop of payload.stops) {
        if (!stop.location) continue;
        const found = await resolve(stop.location);
        if (found) {
          stop.lat = found.lat;
          stop.lng = found.lng;
        }
      }
    }
  }
}

/** Metres between two points (haversine). */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

const SUFFIXES: Record<string, string> = {
  avenue: "ave",
  av: "ave",
  boulevard: "blvd",
  street: "st",
  road: "rd",
  drive: "dr",
  lane: "ln",
  place: "pl",
  court: "ct",
  terrace: "ter",
  highway: "hwy",
  parkway: "pkwy",
};

/** "hyperion ave" from "2304 Hyperion Ave, Los Angeles, CA 90027". Null when the line has no street number. */
export function streetOf(address: string): string | null {
  const firstLine = address.split(",")[0]?.trim().toLowerCase() ?? "";
  const match = firstLine.match(/^\d+[a-z]?\s+(.+)$/);
  if (!match) return null;
  const parts = match[1].replace(/[.#]/g, "").split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1];
  if (last && SUFFIXES[last]) parts[parts.length - 1] = SUFFIXES[last];
  return parts.join(" ");
}

/**
 * How a route meets a place: a stop on the same street, or a stop within `nearMetres`. Never a claim about travel time
 * or whether another stop would fit.
 */
export function routeMeetsPlace(
  route: Extract<FindingPayload, { kind: "route" }>,
  place: Extract<FindingPayload, { kind: "place" }>,
  nearMetres = 600
): "street" | "nearby" | null {
  const placeStreet = place.address ? streetOf(place.address) : null;
  if (placeStreet && route.stops.some(stop => streetOf(stop.location) === placeStreet)) return "street";
  if (place.lat != null && place.lng != null) {
    const near = route.stops.some(
      stop => stop.lat != null && stop.lng != null && metresBetween({ lat: stop.lat, lng: stop.lng }, { lat: place.lat!, lng: place.lng! }) <= nearMetres
    );
    if (near) return "nearby";
  }
  return null;
}

/** Places of one kind that sit close together: Mara's "They're all in the same neighbourhood." */
export function clusteredPlaces(
  places: Array<Extract<FindingPayload, { kind: "place" }>>,
  radiusMetres = 2_500
): boolean {
  const pinned = places.filter(place => place.lat != null && place.lng != null);
  if (pinned.length < 2 || pinned.length !== places.length) return false;
  const centre = {
    lat: pinned.reduce((sum, place) => sum + place.lat!, 0) / pinned.length,
    lng: pinned.reduce((sum, place) => sum + place.lng!, 0) / pinned.length,
  };
  return pinned.every(place => metresBetween(centre, { lat: place.lat!, lng: place.lng! }) <= radiusMetres);
}
