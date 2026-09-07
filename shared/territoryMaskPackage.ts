/**
 * Single authoritative browser path for real territory mask assets.
 *
 * Masks are generated into `artifacts/lantern-city-territory-art-inputs/<id>/mask.png`
 * and deployed to this public path by `scripts/export-lantern-city-territory-art-inputs.ts`.
 * Do not maintain a second diverging mask set elsewhere.
 */
export const TERRITORY_MASK_PUBLIC_ROOT =
  "/assets/admin/control-room/world/territories-v2/masks";

export function territoryMaskSrc(territoryId: string): string {
  return `${TERRITORY_MASK_PUBLIC_ROOT}/${territoryId}.png`;
}
