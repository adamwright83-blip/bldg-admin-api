/**
 * Building configuration — replaces hardcoded building-specific logic.
 *
 * Each building has an ID, display name, address keywords for matching,
 * and an optional access protocol note shown to drivers.
 *
 * To add a new building: append an entry to BUILDINGS below.
 */

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
}

export const BUILDINGS: BuildingConfig[] = [
  {
    id: "opus_la",
    slug: "opusla",
    name: "Opus Los Angeles",
    addressKeywords: ["opus", "12655 bluff creek"],
    defaultAddress: "12655 Bluff Creek Dr, Los Angeles, CA 90094",
    accessProtocol:
      "ButterflyMX entry. Staff manually programs elevator for unit floor.",
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
