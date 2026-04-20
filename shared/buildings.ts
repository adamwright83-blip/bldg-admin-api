/**
 * Building configuration — replaces hardcoded building-specific logic.
 *
 * Each building has an ID, display name, address keywords for matching,
 * and an optional access protocol note shown to drivers.
 *
 * To add a new building: append an entry to BUILDINGS below.
 */

import type { TenantId } from "./tenantConfig";

/**
 * Outreach artifact type for this building's Lane 1 (building_penetration).
 * "sms" — LLM-generated SMS-style outreach (default).
 * "card" — deterministic print-friendly handoff card / order-insert. No LLM call,
 *          no unsolicited text suggestion. Used for buildings where operator-initiated
 *          SMS outreach would create a relationship risk with management.
 */
export type BuildingDeliverable = "sms" | "card";

export interface BuildingConfig {
  /** Stable building identifier */
  id: string;
  /** Resident app / admin routing slug (e.g. opusla) */
  slug: string;
  /** Display name */
  name: string;
  /** Keywords to match against order address (lowercase) */
  addressKeywords: string[];
  /** Default full address for auto-fill in New Order */
  defaultAddress?: string;
  /** Access protocol note shown on driver stop cards */
  accessProtocol?: string;
  /** Total rentable units in the building (denominator for penetration). Placeholder values marked needsVerification are flagged provisional by Level 4 endpoints. */
  total_units: number;
  /** True when total_units is a placeholder pending verification — Level 4 reports provisional=true for the building. */
  needsVerification?: boolean;
  /**
   * All bldg_users.buildingSlug variants that should roll up to this building.
   * Must include the canonical `slug` itself. Level 4 building penetration sums
   * signups and paid users across this family.
   */
  slugAliases: string[];
  /**
   * Lane 1 outreach artifact for this building. Defaults to "sms" when omitted.
   * Set to "card" for buildings where unsolicited SMS to residents would risk the
   * management relationship — the admin gets a printed handoff card instead.
   */
  deliverable?: BuildingDeliverable;
  /**
   * Brands the admin may select for Lane 1 outreach at this building. Order is
   * significant: the first entry is the default. Omitting this implies ["default"]
   * (Laundry Butler only).
   */
  allowedBrands?: TenantId[];
}

export const BUILDINGS: BuildingConfig[] = [
  {
    id: "opus_la",
    slug: "opusla",
    name: "Opus Los Angeles",
    addressKeywords: [
      "3545 wilshire",
      "3650 6th",
      "3545",
      "3650",
      "opus",
    ],
    defaultAddress: "3545 Wilshire Blvd, Los Angeles, CA 90010",
    accessProtocol:
      "ButterflyMX entry. Staff manually programs elevator for unit floor.",
    total_units: 428,
    slugAliases: ["opusla", "opus-south", "opus-north", "opus-la", "3545"],
  },
  {
    id: "century_park_east",
    slug: "centuryparkeast",
    name: "Century Park East",
    addressKeywords: [
      "2170 century park",
      "2160 century park",
      "century park e",
      "century park east",
      "century pke",
    ],
    defaultAddress: "2170 Century Park E, Los Angeles, CA 90067",
    total_units: 576,
    slugAliases: ["centuryparkeast", "century-park-east", "cpe-south", "cpe-north", "2170", "2160"],
    // CPE Lane 1 is a printed resident-safe referral card / order-insert — NOT SMS.
    // Unsolicited texts to residents here risk the management relationship.
    deliverable: "card",
    // Butler is the default brand. Laundry Farm is a manual override only.
    allowedBrands: ["default", "laundry_farm"],
  },
];

/**
 * Find a matching building config for a given address string.
 * Returns undefined if no building matches.
 */
export function matchBuilding(address: string | null | undefined): BuildingConfig | undefined {
  if (!address || typeof address !== "string") return undefined;
  const lower = address.toLowerCase();
  return BUILDINGS.find((b) =>
    b.addressKeywords.some((kw) => lower.includes(kw))
  );
}
