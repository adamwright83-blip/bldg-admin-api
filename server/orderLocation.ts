import { BUILDINGS, matchBuilding } from "@shared/buildings";

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
 * - Explicit non-empty buildingSlug wins over address-derived slug.
 * - If only buildingSlug: fill address from BUILDINGS.defaultAddress or a tagged placeholder.
 * - If only address: derive slug via matchBuilding (may be null).
 * @throws If both address and buildingSlug are empty after trim.
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
    const config = BUILDINGS.find(
      (b) => b.slug.toLowerCase() === rawSlug.toLowerCase()
    );
    const canonicalSlug = config?.slug ?? rawSlug.toLowerCase();
    const addressNorm = rawAddr
      ? normalizeOrderAddress(rawAddr)
      : normalizeOrderAddress(
          config?.defaultAddress ?? `[building:${canonicalSlug}]`
        );
    return { address: addressNorm, buildingSlug: canonicalSlug };
  }

  const addressNorm = normalizeOrderAddress(rawAddr);
  const buildingSlug = matchBuilding(addressNorm)?.slug ?? null;
  return { address: addressNorm, buildingSlug };
}
