/**
 * Building configuration — four towers only, no ambiguous campus-level slugs.
 *
 * Canonical persisted values (`orders.buildingSlug`) and portal JWT `buildingSlug` claim:
 * `"3545" | "3650" | "2160" | "2170"` (string tower ids).
 *
 * Legacy values still seen in DB / old forms: `opusla`, `centuryparkeast`, `centuryparkeastnorth`,
 * `centuryparkeastsouth` — normalize via `canonicalTowerIdForHandoff`.
 */

export interface BuildingConfig {
  id: string;
  /** Canonical tower id — same value stored on orders and sent in handoff JWTs */
  slug: string;
  name: string;
  addressKeywords: string[];
  defaultAddress?: string;
  accessProtocol?: string;
}

/** Single source of truth: Opus (2) + Century Park East (2). Order = match priority (first win). */
export const BUILDINGS: BuildingConfig[] = [
  {
    id: "opus_3650_sixth",
    slug: "3650",
    name: "Opus — 3650 S 6th St",
    addressKeywords: ["3650 6th", "3650 s 6th", "3650 s. 6th", "3650 south 6th"],
    defaultAddress: "3650 S 6th St, Los Angeles, CA 90010",
  },
  {
    id: "opus_3545_wilshire",
    slug: "3545",
    name: "Opus — 3545 Wilshire",
    addressKeywords: ["3545 wilshire", "3545 w", "3545 wilshire blvd"],
    defaultAddress: "3545 Wilshire Blvd, Los Angeles, CA 90010",
    accessProtocol:
      "ButterflyMX entry. Staff manually programs elevator for unit floor.",
  },
  {
    id: "cpe_north_2160",
    slug: "2160",
    name: "Century Park East — North (2160)",
    addressKeywords: ["2160 century park", "2160 century park e", "2160 century"],
    defaultAddress: "2160 Century Park E, Los Angeles, CA 90067",
  },
  {
    id: "cpe_south_2170",
    slug: "2170",
    name: "Century Park East — South (2170)",
    addressKeywords: ["2170 century park", "2170 century park e", "2170 century"],
    defaultAddress: "2170 Century Park E, Los Angeles, CA 90067",
  },
];

const CANONICAL_TOWER_IDS = new Set(["3545", "3650", "2160", "2170"]);

function keywordMatches(addressLower: string, kw: string): boolean {
  const k = kw.toLowerCase().trim();
  if (!k) return false;
  // Pure numeric keyword: whole token only (avoid "13545" containing "3545").
  if (/^\d+$/.test(k)) {
    return new RegExp(`\\b${k}\\b`).test(addressLower);
  }
  // Keyword with digits + text: require digit runs as word boundaries (same substring bug).
  if (/\d/.test(k)) {
    const parts = k.split(/(\d+)/);
    let pattern = "";
    for (const part of parts) {
      if (part === "") continue;
      if (/^\d+$/.test(part)) {
        pattern += `\\b${part}\\b`;
      } else {
        pattern += part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
    }
    return new RegExp(pattern).test(addressLower);
  }
  return addressLower.includes(k);
}

/**
 * First matching tower from address. No generic "century park east" without 2160/2170;
 * no generic "opus" without 3545/3650 street numbers in keywords.
 */
export function matchBuilding(address: string | null | undefined): BuildingConfig | undefined {
  if (!address || typeof address !== "string") return undefined;
  const lower = address.trim().toLowerCase();
  return BUILDINGS.find((b) => b.addressKeywords.some((kw) => keywordMatches(lower, kw)));
}

/**
 * Map legacy admin / DB / resident-alias slugs → canonical tower id.
 */
function canonicalTowerIdFromLegacySlug(
  legacy: string,
  addressLower: string
): string | null {
  const L = legacy.toLowerCase();
  if (L === "opusla") {
    if (/\b3650\b/.test(addressLower)) return "3650";
    if (/\b3545\b/.test(addressLower)) return "3545";
    return null;
  }
  if (L === "centuryparkeast") {
    if (/\b2170\b/.test(addressLower)) return "2170";
    if (/\b2160\b/.test(addressLower)) return "2160";
    return null;
  }
  if (L === "centuryparkeastnorth") return "2160";
  if (L === "centuryparkeastsouth") return "2170";
  return null;
}

/**
 * Canonical tower id for `orders.buildingSlug` and portal JWT `buildingSlug` claim.
 * Returns `null` when the tower cannot be determined (ambiguous legacy + vague address).
 */
export function canonicalTowerIdForHandoff(
  address: string | null | undefined,
  explicitBuildingSlug: string | null | undefined
): string | null {
  const raw = explicitBuildingSlug?.trim() ?? "";
  const addr = (address ?? "").trim().toLowerCase();

  if (raw && CANONICAL_TOWER_IDS.has(raw)) return raw;

  if (raw === "centuryparkeastnorth") return "2160";
  if (raw === "centuryparkeastsouth") return "2170";

  if (raw === "opusla" || raw === "centuryparkeast") {
    const fromLegacy = canonicalTowerIdFromLegacySlug(raw, addr);
    if (fromLegacy) return fromLegacy;
  }

  const has3545 = /\b3545\b/.test(addr);
  const has3650 = /\b3650\b/.test(addr);
  const has2160 = /\b2160\b/.test(addr);
  const has2170 = /\b2170\b/.test(addr);

  const cpeContext =
    addr.includes("century park") ||
    addr.includes("century pke") ||
    addr.includes("century park e") ||
    raw === "centuryparkeast";

  if (cpeContext) {
    if (has2170) return "2170";
    if (has2160) return "2160";
  }

  const opusHint =
    /\bopus\b/.test(addr) || raw === "opusla" || has3545 || has3650;
  if (opusHint) {
    if (has3650) return "3650";
    if (has3545) return "3545";
  }

  const fromMatch = matchBuilding(address)?.slug;
  if (fromMatch && CANONICAL_TOWER_IDS.has(fromMatch)) return fromMatch;

  if (raw === "opusla" || raw === "centuryparkeast") return null;

  return null;
}

/** @deprecated Use canonicalTowerIdForHandoff — same behavior */
export const resolvePortalHandoffBuildingSlug = canonicalTowerIdForHandoff;
