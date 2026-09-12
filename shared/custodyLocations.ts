import {
  COAST_CLEANER_NAME,
  COAST_CLEANER_SLUG,
  PARAGON_CLEANER_NAME,
  PARAGON_CLEANER_SLUG,
} from "./dryCleaners";

/** Physical custody columns in the driver kanban carousel. */
export const CUSTODY_LOCATION_ORDER = [
  "vehicle",
  COAST_CLEANER_SLUG,
  PARAGON_CLEANER_SLUG,
  "home_closet",
] as const;

export type CustodyLocationKey = (typeof CUSTODY_LOCATION_ORDER)[number];

export type CustodyLocationDef = {
  key: CustodyLocationKey;
  label: string;
  shortLabel: string;
  asset: string;
  slots: ReadonlyArray<{ left: string; top: string }>;
};

const CAR_ASSET =
  "/assets/goldline/vehicle-cargo/v2/car-topdown-neutral.png?v=20260909";
const LOCATION_ASSET_ROOT = "/assets/goldline/vehicle-cargo/v3/locations";

export const CUSTODY_LOCATIONS: Record<CustodyLocationKey, CustodyLocationDef> =
  {
    vehicle: {
      key: "vehicle",
      label: "Vehicle",
      shortLabel: "Car",
      asset: CAR_ASSET,
      slots: [
        { left: "30%", top: "56%" },
        { left: "66%", top: "56%" },
        { left: "30%", top: "72%" },
        { left: "66%", top: "72%" },
      ],
    },
    [COAST_CLEANER_SLUG]: {
      key: COAST_CLEANER_SLUG,
      label: COAST_CLEANER_NAME,
      shortLabel: "Coast",
      asset: `${LOCATION_ASSET_ROOT}/coast-cleaners.jpg`,
      slots: [
        { left: "34%", top: "62%" },
        { left: "62%", top: "62%" },
        { left: "48%", top: "74%" },
      ],
    },
    [PARAGON_CLEANER_SLUG]: {
      key: PARAGON_CLEANER_SLUG,
      label: PARAGON_CLEANER_NAME,
      shortLabel: "Paragon",
      asset: `${LOCATION_ASSET_ROOT}/paragon-cleaners.jpg`,
      slots: [
        { left: "36%", top: "60%" },
        { left: "64%", top: "60%" },
        { left: "50%", top: "72%" },
      ],
    },
    home_closet: {
      key: "home_closet",
      label: "Home closet",
      shortLabel: "Closet",
      asset: `${LOCATION_ASSET_ROOT}/home-closet.jpg`,
      slots: [
        { left: "22%", top: "36%" },
        { left: "32%", top: "36%" },
        { left: "42%", top: "36%" },
        { left: "52%", top: "36%" },
        { left: "62%", top: "36%" },
        { left: "72%", top: "36%" },
      ],
    },
  };

export function nextCustodyLocation(
  current: CustodyLocationKey
): CustodyLocationKey {
  const index = CUSTODY_LOCATION_ORDER.indexOf(current);
  return CUSTODY_LOCATION_ORDER[(index + 1) % CUSTODY_LOCATION_ORDER.length];
}

export function previousCustodyLocation(
  current: CustodyLocationKey
): CustodyLocationKey {
  const index = CUSTODY_LOCATION_ORDER.indexOf(current);
  return CUSTODY_LOCATION_ORDER[
    (index - 1 + CUSTODY_LOCATION_ORDER.length) %
      CUSTODY_LOCATION_ORDER.length
  ];
}

export function isCustodyLocationKey(
  value: string | null | undefined
): value is CustodyLocationKey {
  return (
    value != null &&
    (CUSTODY_LOCATION_ORDER as readonly string[]).includes(value)
  );
}

export function custodyLocationLabel(key: CustodyLocationKey): string {
  return CUSTODY_LOCATIONS[key].label;
}

export function custodyLocationFromEvidence(
  state: string,
  evidenceJson: unknown
): CustodyLocationKey {
  const evidence =
    evidenceJson && typeof evidenceJson === "object"
      ? (evidenceJson as { custodyLocation?: string })
      : null;
  if (isCustodyLocationKey(evidence?.custodyLocation))
    return evidence.custodyLocation;
  if (state === "AT_PROCESSOR") return COAST_CLEANER_SLUG;
  return "vehicle";
}

export function custodyLocationFromFieldRow(row: {
  vehicleState: string;
  location: string | null;
}): CustodyLocationKey {
  if (isCustodyLocationKey(row.location)) return row.location;
  if (row.vehicleState === "AT_PROCESSOR") return COAST_CLEANER_SLUG;
  return "vehicle";
}
