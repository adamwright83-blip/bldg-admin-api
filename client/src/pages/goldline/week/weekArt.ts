import plateCliff from "@/assets/goldline/week/plate-cliff.webp";
import plateDefault from "@/assets/goldline/week/plate-default.webp";
import plateJungle from "@/assets/goldline/week/plate-jungle.webp";
import plateRiver from "@/assets/goldline/week/plate-river.webp";
import plateRuins from "@/assets/goldline/week/plate-ruins.webp";
import plateVillage from "@/assets/goldline/week/plate-village.webp";

/**
 * Swappable plate filenames. The brochure asks for a variant; it does not
 * bake a scene into the fold geometry. Unknown variants fall back to default.
 */
export const WEEK_ART_FILES = {
  default: plateDefault,
  ruins: plateRuins,
  jungle: plateJungle,
  river: plateRiver,
  cliff: plateCliff,
  village: plateVillage,
} as const;

export type WeekArtVariant = keyof typeof WEEK_ART_FILES;

export function weekArtSrc(artVariant?: string): string {
  if (!artVariant) return WEEK_ART_FILES.default;
  if (artVariant in WEEK_ART_FILES) {
    return WEEK_ART_FILES[artVariant as WeekArtVariant];
  }
  return WEEK_ART_FILES.default;
}
