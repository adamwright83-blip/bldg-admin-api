/**
 * DAY 1 — THE TEN DOORS.
 *
 * An emergency, narrowly-scoped rescue mission: Adam operator-declared a
 * 9-day rescue run starting 2026-08-18, and Day 1's mission is "visit 10
 * apartment buildings and pitch Laundry Butler as a no-cost resident
 * amenity." These 10 targets are hand-verified by Adam (name, address,
 * phone, real Greystar-or-not evidence) — never model-invented, never
 * sourced live. No Google Places call, no Anthropic call, no network
 * dependency anywhere in this flow. That is deliberate: this shipped the
 * day Adam had zero API credit headroom to risk on a live sourcing call
 * failing mid-route.
 *
 * Coordinates below are APPROXIMATE — derived from known LA street
 * geography, not geocoded through any API (none was available). The
 * NAVIGATE action always uses the full street address as the Google Maps
 * destination, so navigation itself is unaffected by that approximation;
 * only the arrival-radius proximity check depends on it, which is why
 * DAY1_ARRIVAL_RADIUS_METERS below is generous rather than doorway-tight.
 */

export type Day1TargetOutcome = "pitched" | "couldnt_reach";

export type Day1Target = {
  /** Stable slug — never regenerated, so a completed outcome always keys
   * back to the same target across reloads. */
  id: string;
  name: string;
  address: string;
  neighborhood: string;
  phone: string | null;
  /** Approximate — see file header. Used only for the arrival check. */
  lat: number;
  lng: number;
  /** Truthful attribution or null when no real evidence supports one. */
  managerLabel: string | null;
  isGreystar: boolean;
  /** What told Adam this was (or wasn't) Greystar-managed. */
  evidenceNote: string;
  prospectNote: string;
  navigationUrl: string;
};

export const DAY1_BUSINESS_DATE = "2026-08-18";
export const RESCUE_TOTAL_DAYS = 9;
export const DAY1_DAY_INDEX = 1;
export const DAY1_TITLE = "DAY 1 — THE TEN DOORS";
export const DAY1_MISSION_LINE =
  "Visit 10 apartment buildings and pitch Laundry Butler as a no-cost resident amenity.";

/**
 * Generous on purpose: these coordinates are best-effort, not
 * API-geocoded, and an apartment property is a large target, not a single
 * doorway. ~800 feet keeps false negatives ("I'm standing at the leasing
 * office and Goldline hasn't noticed") much rarer than false positives at
 * this class of target.
 */
export const DAY1_ARRIVAL_RADIUS_METERS = 250;

/** Foreground-only poll cadence while this mission is the active screen. */
export const DAY1_LOCATION_POLL_MS = 20_000;

function mapsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

export const DAY1_TARGETS: readonly Day1Target[] = [
  {
    id: "rise-koreatown",
    name: "Rise Koreatown",
    address: "750 S Oxford Ave, Los Angeles, CA 90005",
    neighborhood: "Koreatown",
    phone: "323-991-9423",
    lat: 34.0605,
    lng: -118.3078,
    managerLabel: "Greystar",
    isGreystar: true,
    evidenceNote: "greystar.com property page, Greystar CA broker license footer",
    prospectNote: "Flagship-style, luxury studios/1BR",
    navigationUrl: mapsUrl("750 S Oxford Ave, Los Angeles, CA 90005"),
  },
  {
    id: "avana-on-wilshire",
    name: "Avana on Wilshire",
    address: "635 S Hobart Blvd, Los Angeles, CA 90005",
    neighborhood: "Koreatown",
    phone: "925-237-9856",
    lat: 34.0606,
    lng: -118.3057,
    managerLabel: "Greystar",
    isGreystar: true,
    evidenceNote: "greystar.com canonical page",
    prospectNote: "Established Greystar community",
    navigationUrl: mapsUrl("635 S Hobart Blvd, Los Angeles, CA 90005"),
  },
  {
    id: "the-pearl-on-wilshire",
    name: "The Pearl on Wilshire",
    address: "687 S Hobart Blvd, Los Angeles, CA 90005",
    neighborhood: "Koreatown",
    phone: "833-563-8959",
    lat: 34.0596,
    lng: -118.3057,
    managerLabel: "Greystar",
    isGreystar: true,
    evidenceNote: "greystar.com page",
    prospectNote: "131 reviews — large resident base",
    navigationUrl: mapsUrl("687 S Hobart Blvd, Los Angeles, CA 90005"),
  },
  {
    id: "the-chadwick",
    name: "The Chadwick",
    address: "209 S Westmoreland Ave, Los Angeles, CA 90004",
    neighborhood: "Koreatown",
    phone: "213-648-1790",
    lat: 34.0658,
    lng: -118.2971,
    managerLabel: "Greystar",
    isGreystar: true,
    evidenceNote: "greystar.com listing",
    prospectNote: "Resort-style pool/fitness/pet park",
    navigationUrl: mapsUrl("209 S Westmoreland Ave, Los Angeles, CA 90004"),
  },
  {
    id: "wilshire-vermont",
    name: "Wilshire Vermont",
    address: "3183 Wilshire Blvd, Los Angeles, CA 90010",
    neighborhood: "Koreatown",
    phone: "833-292-1783",
    lat: 34.0617,
    lng: -118.2915,
    managerLabel: "Greystar",
    isGreystar: true,
    evidenceNote: "greystar.com page",
    prospectNote: "Directly at Metro Red/Purple Line stop",
    navigationUrl: mapsUrl("3183 Wilshire Blvd, Los Angeles, CA 90010"),
  },
  {
    id: "opus-la",
    name: "Opus LA",
    address: "3545 Wilshire Blvd, Los Angeles, CA 90010",
    neighborhood: "Koreatown",
    phone: "844-634-0963",
    lat: 34.0617,
    lng: -118.2999,
    managerLabel: "Greystar",
    isGreystar: true,
    evidenceNote: "greystar.com/opus-la page",
    prospectNote: "Wilshire corridor tower",
    navigationUrl: mapsUrl("3545 Wilshire Blvd, Los Angeles, CA 90010"),
  },
  {
    id: "violet-on-virgil",
    name: "Violet on Virgil",
    address: "160 S Virgil Ave, Los Angeles, CA 90004",
    neighborhood: "Silver Lake",
    phone: "213-325-1570",
    lat: 34.0759,
    lng: -118.2896,
    managerLabel: "Vive LA",
    isGreystar: false,
    evidenceNote: "listing: managed by Vive LA",
    prospectNote: "302 units, high volume",
    navigationUrl: mapsUrl("160 S Virgil Ave, Los Angeles, CA 90004"),
  },
  {
    id: "canyon",
    name: "Canyon",
    address: "1250 W Court St, Los Angeles, CA 90026",
    neighborhood: "Echo Park",
    phone: "323-905-6749",
    lat: 34.0703,
    lng: -118.2596,
    managerLabel: "Oro Properties LA",
    isGreystar: false,
    evidenceNote: "branded under Oro Properties LA",
    prospectNote: "Full amenity building",
    navigationUrl: mapsUrl("1250 W Court St, Los Angeles, CA 90026"),
  },
  {
    id: "encore-echo-park",
    name: "Encore Echo Park",
    address: "226 N Lake St, Los Angeles, CA 90026",
    neighborhood: "Echo Park",
    phone: "818-570-2292",
    lat: 34.0778,
    lng: -118.2589,
    managerLabel: "Encore Development/Management",
    isGreystar: false,
    evidenceNote: "encoredevco.com: Encore Development/Management",
    prospectNote: "Luxury new build, skyline views",
    navigationUrl: mapsUrl("226 N Lake St, Los Angeles, CA 90026"),
  },
  {
    id: "onsunset",
    name: "OnSunset",
    address: "2225 W Sunset Blvd, Los Angeles, CA 90026",
    neighborhood: "Echo Park",
    phone: "323-645-2496",
    lat: 34.0779,
    lng: -118.2565,
    managerLabel: "RPM Living",
    isGreystar: false,
    evidenceNote: "site: managed by RPM Living",
    prospectNote: "Pool, EV charging, controlled access",
    navigationUrl: mapsUrl("2225 W Sunset Blvd, Los Angeles, CA 90026"),
  },
] as const;

export type Day1TenDoorsPayload = {
  kind: "day1_ten_doors";
  targets: Day1Target[];
  /** Keyed by target id. Presence in this map is the ONE definition of
   * "physically visited" — arrival alone never writes here. */
  outcomes: Record<string, Day1TargetOutcome>;
};

export function encodeDay1Payload(payload: Day1TenDoorsPayload): string {
  return JSON.stringify(payload);
}

/** Returns null for anything that isn't a Day 1 payload, including a
 * normal task's free-text detail and any malformed JSON. */
export function decodeDay1Payload(detail: string): Day1TenDoorsPayload | null {
  if (!detail || detail.charAt(0) !== "{") return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as { kind?: unknown }).kind === "day1_ten_doors"
    ) {
      return parsed as Day1TenDoorsPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export function day1VisitedCount(payload: Day1TenDoorsPayload): number {
  return Object.keys(payload.outcomes).length;
}

export function day1CurrentTarget(
  payload: Day1TenDoorsPayload
): Day1Target | null {
  return payload.targets.find(target => !(target.id in payload.outcomes)) ?? null;
}

export function day1IsComplete(payload: Day1TenDoorsPayload): boolean {
  return day1VisitedCount(payload) >= payload.targets.length;
}

/** "TARGET 3 OF 10" — 1-based. Null once every target has an outcome. */
export function day1ProgressLabel(payload: Day1TenDoorsPayload): string | null {
  const visited = day1VisitedCount(payload);
  if (visited >= payload.targets.length) return null;
  return `TARGET ${visited + 1} OF ${payload.targets.length}`;
}

export function day1OutcomeCounts(payload: Day1TenDoorsPayload): {
  pitched: number;
  couldntReach: number;
} {
  let pitched = 0;
  let couldntReach = 0;
  for (const outcome of Object.values(payload.outcomes)) {
    if (outcome === "pitched") pitched += 1;
    else couldntReach += 1;
  }
  return { pitched, couldntReach };
}

/** Great-circle distance in meters — used only for the arrival check. */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
