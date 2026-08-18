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
 * Coordinates below are real Census Bureau rooftop coordinates supplied
 * by the operator — not geocoded through any live API. The NAVIGATE
 * action still uses the full street address as the Google Maps
 * destination (accurate regardless), and the arrival-radius proximity
 * check now uses these precise coordinates directly, which is why the
 * base radius (`arrivalRadiusMeters`, ~125m) is tighter than the earlier
 * approximate-coordinate draft's blanket 250m. See
 * `effectiveArrivalRadiusMeters` for how a reported GPS accuracy reading
 * is folded in on top of that base value.
 *
 * Opus LA is excluded: Laundry Butler already operates there, so it is
 * not a prospect and cannot count toward today's mission to acquire new
 * buildings. This is the final, authoritative operator-curated set —
 * route order chosen to reduce backtracking (Koreatown cluster, then
 * Echo Park, then West Hollywood/Beverly Grove, then Beverly Hills).
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
  /** Base arrival radius for THIS target, before folding in reported GPS
   * accuracy. Tighter in dense Koreatown blocks, looser in the more
   * spread-out Silver Lake/Echo Park stops — see file header. */
  arrivalRadiusMeters: number;
};

export const DAY1_BUSINESS_DATE = "2026-08-18";
export const RESCUE_TOTAL_DAYS = 9;
export const DAY1_DAY_INDEX = 1;
export const DAY1_TITLE = "DAY 1 — THE TEN DOORS";
export const DAY1_MISSION_LINE =
  "Visit 10 apartment buildings and pitch Laundry Butler as a no-cost resident amenity.";

/**
 * A reported GPS accuracy reading is folded on top of a target's base
 * `arrivalRadiusMeters`, capped here so a single noisy reading can never
 * silently restore something close to the old blanket 250m radius. GPS
 * is a helper, never a blocker — see `effectiveArrivalRadiusMeters` and
 * the manual "I'M HERE — CHECK IN" fallback in the UI, which works
 * identically whether automatic arrival ever fires or not.
 */
export const DAY1_ARRIVAL_ACCURACY_CAP_METERS = 100;

/** Foreground-only poll cadence while this mission is the active screen. */
export const DAY1_LOCATION_POLL_MS = 20_000;

/**
 * Effective arrival radius for a target: its own tightened base radius,
 * widened by however much the device says it's uncertain about its own
 * position — but never by more than `DAY1_ARRIVAL_ACCURACY_CAP_METERS`,
 * so a bad accuracy reading degrades gracefully instead of undoing the
 * per-target tightening entirely.
 */
export function effectiveArrivalRadiusMeters(
  target: Day1Target,
  accuracyMeters: number | null
): number {
  const accuracyContribution =
    accuracyMeters != null && Number.isFinite(accuracyMeters)
      ? Math.min(Math.max(0, accuracyMeters), DAY1_ARRIVAL_ACCURACY_CAP_METERS)
      : 0;
  return target.arrivalRadiusMeters + accuracyContribution;
}

function mapsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

/** Uniform now that every target has a real Census rooftop coordinate —
 * there is no more need to tier by neighborhood density. */
const BASE_ARRIVAL_RADIUS_METERS = 125;

export const DAY1_TARGETS: readonly Day1Target[] = [
  {
    id: "rise-koreatown",
    name: "Rise Koreatown",
    address: "750 S Oxford Ave, Los Angeles, CA 90005",
    neighborhood: "Koreatown",
    phone: "323-991-9423",
    lat: 34.058653,
    lng: -118.307756,
    managerLabel: "Greystar",
    isGreystar: true,
    evidenceNote: "greystar.com property page, Greystar CA broker license footer",
    prospectNote: "Flagship-style, luxury studios/1BR",
    navigationUrl: mapsUrl("750 S Oxford Ave, Los Angeles, CA 90005"),
    arrivalRadiusMeters: BASE_ARRIVAL_RADIUS_METERS,
  },
  {
    id: "avana-on-wilshire",
    name: "Avana on Wilshire",
    address: "635 S Hobart Blvd, Los Angeles, CA 90005",
    neighborhood: "Koreatown",
    phone: "925-237-9856",
    lat: 34.062787,
    lng: -118.305419,
    managerLabel: "Greystar",
    isGreystar: true,
    evidenceNote: "greystar.com canonical page",
    prospectNote: "Established Greystar community",
    navigationUrl: mapsUrl("635 S Hobart Blvd, Los Angeles, CA 90005"),
    arrivalRadiusMeters: BASE_ARRIVAL_RADIUS_METERS,
  },
  {
    id: "the-pearl-on-wilshire",
    name: "The Pearl on Wilshire",
    address: "687 S Hobart Blvd, Los Angeles, CA 90005",
    neighborhood: "Koreatown",
    phone: "833-563-8959",
    lat: 34.061653,
    lng: -118.305412,
    managerLabel: "Greystar",
    isGreystar: true,
    evidenceNote: "greystar.com page",
    prospectNote: "131 reviews — large resident base",
    navigationUrl: mapsUrl("687 S Hobart Blvd, Los Angeles, CA 90005"),
    arrivalRadiusMeters: BASE_ARRIVAL_RADIUS_METERS,
  },
  {
    id: "wilshire-vermont",
    name: "Wilshire Vermont",
    address: "3183 Wilshire Blvd, Los Angeles, CA 90010",
    neighborhood: "Koreatown",
    phone: "833-292-1783",
    lat: 34.061851,
    lng: -118.291329,
    managerLabel: "Greystar",
    isGreystar: true,
    evidenceNote: "greystar.com page",
    prospectNote: "Directly at Metro Red/Purple Line stop",
    navigationUrl: mapsUrl("3183 Wilshire Blvd, Los Angeles, CA 90010"),
    arrivalRadiusMeters: BASE_ARRIVAL_RADIUS_METERS,
  },
  {
    id: "the-chadwick",
    name: "The Chadwick",
    address: "209 S Westmoreland Ave, Los Angeles, CA 90004",
    neighborhood: "Koreatown",
    phone: "213-648-1790",
    lat: 34.070264,
    lng: -118.287968,
    managerLabel: "Greystar",
    isGreystar: true,
    evidenceNote: "greystar.com listing",
    prospectNote: "Resort-style pool/fitness/pet park",
    navigationUrl: mapsUrl("209 S Westmoreland Ave, Los Angeles, CA 90004"),
    arrivalRadiusMeters: BASE_ARRIVAL_RADIUS_METERS,
  },
  {
    id: "onsunset",
    name: "OnSunset",
    address: "2225 W Sunset Blvd, Los Angeles, CA 90026",
    neighborhood: "Echo Park",
    phone: "323-645-2496",
    lat: 34.078085,
    lng: -118.266133,
    managerLabel: "RPM Living",
    isGreystar: false,
    evidenceNote: "site: managed by RPM Living",
    prospectNote: "Pool, EV charging, controlled access",
    navigationUrl: mapsUrl("2225 W Sunset Blvd, Los Angeles, CA 90026"),
    arrivalRadiusMeters: BASE_ARRIVAL_RADIUS_METERS,
  },
  {
    id: "the-charlie-weho",
    name: "The Charlie WeHo",
    address: "7617 Santa Monica Blvd, West Hollywood, CA 90046",
    neighborhood: "West Hollywood",
    phone: null,
    lat: 34.090831,
    lng: -118.355641,
    managerLabel: "Greystar",
    isGreystar: true,
    evidenceNote: "greystar.com listing",
    prospectNote: "West Hollywood corridor",
    navigationUrl: mapsUrl("7617 Santa Monica Blvd, West Hollywood, CA 90046"),
    arrivalRadiusMeters: BASE_ARRIVAL_RADIUS_METERS,
  },
  {
    id: "the-alfred",
    name: "The Alfred",
    address: "725 N Croft Ave, Los Angeles, CA 90069",
    neighborhood: "West Hollywood",
    phone: null,
    lat: 34.084075,
    lng: -118.374286,
    managerLabel: "Greystar",
    isGreystar: true,
    evidenceNote: "greystar.com listing",
    prospectNote: "Beverly Grove / West Hollywood border",
    navigationUrl: mapsUrl("725 N Croft Ave, Los Angeles, CA 90069"),
    arrivalRadiusMeters: BASE_ARRIVAL_RADIUS_METERS,
  },
  {
    id: "blu-beverly-hills",
    name: "Blu Beverly Hills",
    address: "8601 Wilshire Blvd, Beverly Hills, CA 90211",
    neighborhood: "Beverly Hills",
    phone: null,
    lat: 34.065795,
    lng: -118.378367,
    managerLabel: "Willow Bridge",
    isGreystar: false,
    evidenceNote: "site: managed by Willow Bridge",
    prospectNote: "Wilshire corridor, Beverly Hills",
    navigationUrl: mapsUrl("8601 Wilshire Blvd, Beverly Hills, CA 90211"),
    arrivalRadiusMeters: BASE_ARRIVAL_RADIUS_METERS,
  },
  {
    id: "ninety9fifty5",
    name: "Ninety9Fifty5",
    address: "9955 Durant Dr, Beverly Hills, CA 90212",
    neighborhood: "Beverly Hills",
    phone: null,
    lat: 34.064045,
    lng: -118.412314,
    managerLabel: "Willow Bridge",
    isGreystar: false,
    evidenceNote: "site: managed by Willow Bridge",
    prospectNote: "Century City-adjacent, Beverly Hills",
    navigationUrl: mapsUrl("9955 Durant Dr, Beverly Hills, CA 90212"),
    arrivalRadiusMeters: BASE_ARRIVAL_RADIUS_METERS,
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
