/**
 * WHICH NEIGHBOURHOODS ARE STILL UNDER CLOUD.
 *
 * The rule the world actually runs on, in one sentence:
 *
 *   A NEIGHBOURHOOD WHERE YOU HAVE CUSTOMERS IS CLEAR. A NEIGHBOURHOOD WHERE
 *   YOU HAVE NONE IS UNDER CLOUD, AND A GUARDIAN IS STANDING ON IT.
 *
 * WHY THIS REPLACED A HOLE-PUNCHING VEIL
 *
 * The first version clouded the entire map and punched a soft hole around each
 * mapped customer. It was wrong in a way that only showed up against real data:
 * a customer is a point, so nine customers in Koreatown cleared nine small
 * discs and left Koreatown itself under cloud. The operator's mental model is
 * not "my customers have a radius" — it is "I work Koreatown, so Koreatown is
 * mine". Reveal is per NEIGHBOURHOOD, and one real customer takes the whole
 * neighbourhood.
 *
 * THE OTHER FAILURE THIS GUARDS
 *
 * The hole-punch version also could not tell "you have not conquered this yet"
 * apart from "the geocoder has not run". When customers exist but none are
 * mapped, every hole disappears and the world goes solid white — a data-pipeline
 * outage rendered as total defeat. `deriveNeighbourhoodVeil` returns
 * `suppressed` for exactly that case, and the renderer draws no cloud at all.
 * An unclouded city with missing lanterns is an obviously incomplete screen; a
 * fully clouded one looks like a finished screen telling you that you have
 * nothing, which is a lie.
 *
 * GEOGRAPHY IS STILL AUTHORITATIVE
 *
 * Neighbourhoods are the nine real Los Angeles landmarks already in
 * `GOLDLINE_LA_LANDMARKS`, at their real coordinates. Nothing here invents a
 * district, moves one, or draws a boundary: a neighbourhood is a named point
 * with a radius of influence, and the cloud is a soft field around that point.
 */
import { GOLDLINE_LA_LANDMARKS, projectLatLngToLanternAtlas } from "./lanternCity";

export type NeighbourhoodVeilState = "clear" | "clouded";

/** The six guardians, in the order `shared/goldlineGuardians.ts` defines them. */
export const VEIL_GUARDIAN_IDS = [
  "thunder_king",
  "cloud_duchess",
  "sleepy_one_eye",
  "tiny_emperor",
  "gust_jester",
  "drizzle_detective",
] as const;

export type VeilGuardianId = (typeof VEIL_GUARDIAN_IDS)[number];

/**
 * How near a customer must be to count as being "in" a neighbourhood, in atlas
 * percentage units.
 *
 * The nine landmarks are 5-12 units apart at this projection, so this is
 * deliberately a little under half the typical spacing: close enough that a
 * customer reliably claims the neighbourhood they actually live in, far enough
 * that they do not also claim the one next door.
 */
export const NEIGHBOURHOOD_CLAIM_RADIUS = 6.5;

/**
 * How far a clouded neighbourhood's weather spreads. Larger than the claim
 * radius so adjacent clouded neighbourhoods merge into continuous overcast
 * rather than reading as separate circular puffs.
 */
export const NEIGHBOURHOOD_CLOUD_RADIUS = 13;

export type NeighbourhoodVeil = {
  name: string;
  /** Atlas percentage position, projected from the landmark's real coordinate. */
  x: number;
  y: number;
  latitude: number;
  longitude: number;
  state: NeighbourhoodVeilState;
  /** Real mapped customers claiming this neighbourhood. Zero means clouded. */
  customerCount: number;
  /** Present only while clouded. Deterministic from the neighbourhood name. */
  guardianId: VeilGuardianId | null;
  cloudRadius: number;
};

export type VeilDerivation = {
  neighbourhoods: NeighbourhoodVeil[];
  /**
   * True when the cloud must not be drawn at all, because the absence of
   * mapped customers is more likely a pipeline failure than an unconquered
   * city. See `deriveNeighbourhoodVeil`.
   */
  suppressed: boolean;
  suppressedReason: string | null;
};

/** Keep the board legible and the campaign comprehensible at a glance. */
export const MAX_ACTIVE_CLOUD_GUARDIANS = 5;

/**
 * Choose the current campaign frontier. Empty neighbourhoods nearest to real
 * customer activity appear first; a brand-new city falls back to west-to-east
 * atlas order. The full zero-customer set remains in the derivation, but only
 * this bounded frontier is rendered on the board.
 */
export function selectActiveCloudGuardians(
  neighbourhoods: readonly NeighbourhoodVeil[],
  mappedCustomers: readonly { x: number; y: number }[],
  limit = MAX_ACTIVE_CLOUD_GUARDIANS
): NeighbourhoodVeil[] {
  return neighbourhoods
    .filter(neighbourhood => neighbourhood.state === "clouded")
    .map(neighbourhood => ({
      neighbourhood,
      frontierDistance: mappedCustomers.length
        ? Math.min(
            ...mappedCustomers.map(customer =>
              Math.hypot(customer.x - neighbourhood.x, customer.y - neighbourhood.y)
            )
          )
        : neighbourhood.x,
    }))
    .sort(
      (a, b) =>
        a.frontierDistance - b.frontierDistance ||
        a.neighbourhood.name.localeCompare(b.neighbourhood.name)
    )
    .slice(0, Math.max(0, limit))
    .map((candidate, index) => ({
      ...candidate.neighbourhood,
      // One active territory, one distinct boss. The assignment is stable for
      // the current frontier and never repeats a silhouette on the same board.
      guardianId: VEIL_GUARDIAN_IDS[index % VEIL_GUARDIAN_IDS.length],
    }));
}

/** Stable hash, so a neighbourhood keeps its guardian across reloads. */
function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function guardianForNeighbourhood(name: string): VeilGuardianId {
  return VEIL_GUARDIAN_IDS[hash(name) % VEIL_GUARDIAN_IDS.length];
}

export function deriveNeighbourhoodVeil(input: {
  /** Mapped customer locations, in atlas percentage space. */
  mappedCustomers: readonly { x: number; y: number }[];
  /**
   * How many customers the atlas knows about in total, mapped or not. Used
   * only to tell an unconquered city apart from a broken geocoder.
   */
  totalCustomers: number;
  /** False while the atlas query is loading or has errored. */
  atlasReady: boolean;
}): VeilDerivation {
  const neighbourhoods = GOLDLINE_LA_LANDMARKS.map(landmark => {
    const point = projectLatLngToLanternAtlas(landmark);
    const customerCount = input.mappedCustomers.filter(
      customer =>
        Math.hypot(customer.x - point.x, customer.y - point.y) <=
        NEIGHBOURHOOD_CLAIM_RADIUS
    ).length;
    const state: NeighbourhoodVeilState = customerCount > 0 ? "clear" : "clouded";
    return {
      name: landmark.name,
      x: point.x,
      y: point.y,
      latitude: landmark.latitude,
      longitude: landmark.longitude,
      state,
      customerCount,
      guardianId: state === "clouded" ? guardianForNeighbourhood(landmark.name) : null,
      cloudRadius: NEIGHBOURHOOD_CLOUD_RADIUS,
    };
  });

  /*
    THE SUPPRESSION RULE.

    Cloud is a claim: "you have not taken this yet". It is only safe to make
    that claim when the map is actually capable of showing customers. Two cases
    where it is not, and where drawing cloud would be lying:

      - the atlas has not answered yet, or errored
      - the atlas knows about customers but none of them carry coordinates,
        which means geocoding has not run rather than that the city is empty

    A tenant with genuinely zero customers is NOT suppressed: an empty city
    really is entirely unconquered, and showing it fully clouded is true.
  */
  if (!input.atlasReady) {
    return {
      neighbourhoods,
      suppressed: true,
      suppressedReason: "Geographic truth has not loaded yet",
    };
  }
  if (input.totalCustomers > 0 && input.mappedCustomers.length === 0) {
    return {
      neighbourhoods,
      suppressed: true,
      suppressedReason:
        "Customers exist but none are geocoded, so the veil would report a pipeline gap as an unconquered city",
    };
  }

  return { neighbourhoods, suppressed: false, suppressedReason: null };
}
