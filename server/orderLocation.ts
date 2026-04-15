import { BUILDINGS, canonicalTowerIdForHandoff, matchBuilding } from "@shared/buildings";

/**
 * Normalize stored address for consistent keyword matching (lowercase, trimmed).
 */
export function normalizeOrderAddress(address: string): string {
  return address.trim().toLowerCase();
}

export type OrderLocationInput = {
  address?: string | null;
  buildingSlug?: string | null;
};

/**
 * Resolve address + buildingSlug for a new order.
 * - Explicit tower id (3545/3650/2160/2170) wins.
 * - Legacy slugs opusla / centuryparkeast require a disambiguating address or throw.
 * - If only address: derive via matchBuilding (may be null if no tower keywords match).
 * @throws If both address and buildingSlug are empty after trim, or legacy slug cannot be resolved.
 */
export function resolveOrderLocationForInsert(
  input: OrderLocationInput
): { address: string; buildingSlug: string | null } {
  const rawAddr =
    input.address != null && typeof input.address === "string"
      ? input.address.trim()
      : "";
  const rawSlug =
    input.buildingSlug != null && typeof input.buildingSlug === "string"
      ? input.buildingSlug.trim()
      : "";

  if (!rawAddr && !rawSlug) {
    throw new Error(
      "Order requires address or buildingSlug (both were empty). Refusing to create a corrupted row."
    );
  }

  if (rawSlug) {
    const lower = rawSlug.toLowerCase();
    const config = BUILDINGS.find((b) => b.slug.toLowerCase() === lower);
    if (config) {
      const canonicalSlug = config.slug;
      const addressNorm = rawAddr
        ? normalizeOrderAddress(rawAddr)
        : normalizeOrderAddress(
            config.defaultAddress ?? `[building:${canonicalSlug}]`
          );
      return { address: addressNorm, buildingSlug: canonicalSlug };
    }

    if (lower === "opusla" || lower === "centuryparkeast") {
      const tid = canonicalTowerIdForHandoff(rawAddr || "", rawSlug);
      if (!tid) {
        throw new Error(
          `Cannot place order with legacy building "${rawSlug}" without a clear tower. Add street number 3545, 3650, 2160, or 2170 to the address, or choose Opus 3545 / Opus 3650 / CPE North / CPE South from the list.`
        );
      }
      const cfg = BUILDINGS.find((b) => b.slug === tid);
      const addressNorm = rawAddr
        ? normalizeOrderAddress(rawAddr)
        : normalizeOrderAddress(cfg?.defaultAddress ?? `[building:${tid}]`);
      return { address: addressNorm, buildingSlug: tid };
    }

    const canonicalSlug = lower;
    const addressNorm = rawAddr
      ? normalizeOrderAddress(rawAddr)
      : normalizeOrderAddress(`[building:${canonicalSlug}]`);
    return { address: addressNorm, buildingSlug: canonicalSlug };
  }

  const addressNorm = normalizeOrderAddress(rawAddr);
  const buildingSlug = matchBuilding(addressNorm)?.slug ?? null;
  return { address: addressNorm, buildingSlug };
}
