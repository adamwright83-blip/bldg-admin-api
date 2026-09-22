/**
 * Mission visual package — contract only.
 * No art, no placement, no generated images. A missing package does not block
 * play. A missing image does not break the experience. The package id is not
 * a business key and does not participate in mission identity.
 */

export const MISSION_VISUAL_PACKAGE_ROLES = [
  "weekKeyArt",
  "dayLineMark",
  "missionBriefHero",
  "playableBackdrop",
  "playableForeground",
  "missionObject",
  "consequenceArt",
  "overworldLandmark",
] as const;

export type MissionVisualPackageRole = (typeof MISSION_VISUAL_PACKAGE_ROLES)[number];

export type MissionVisualPackage = {
  visualPackageId: string;
  roles: Partial<Record<MissionVisualPackageRole, string | null>>;
};

export function visualPackageAllowsMission(
  _pkg: MissionVisualPackage | null | undefined
): true {
  return true;
}

/** A missing or blank role resolves to no image. It does not throw. */
export function roleImage(
  pkg: MissionVisualPackage | null | undefined,
  role: MissionVisualPackageRole
): string | null {
  const value = pkg?.roles[role];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
