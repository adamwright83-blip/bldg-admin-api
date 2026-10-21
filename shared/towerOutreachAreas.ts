/**
 * The towers the business serves, as personal-outreach areas. A tower is scoped by its own street addresses (not a
 * neighbourhood focus) and has its own quiet threshold on top of the canonical dormant line (30 days).
 */
export type TowerOutreachArea = {
  label: string;
  /** whole-word address terms, any of which places a customer in the building */
  addressAny: readonly string[];
  minQuietDays: number;
};

export const TOWER_OUTREACH_AREAS: Readonly<Record<string, TowerOutreachArea>> = {
  "century-park-east": {
    label: "Century Park East",
    addressAny: ["2160 century park", "2170 century park", "2160 century pk", "2170 century pk"],
    minQuietDays: 45,
  },
};

export const CENTURY_PARK_EAST_TERRITORY = "century-park-east";
