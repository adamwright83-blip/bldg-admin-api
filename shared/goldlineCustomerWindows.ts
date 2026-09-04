export const CUSTOMER_WINDOW_READABILITY_THRESHOLD = 12;

export type CustomerWindowResident = {
  identityKey: string;
  cadence: { state: "active" | "dimming" | "dark" };
};

export type CustomerWindowProjection =
  | { mode: "individual"; active: number; dormant: number; windows: ReadonlyArray<{ identityKey: string; state: "warm" | "cool" }> }
  | { mode: "aggregate"; active: number; dormant: number; total: number; warmRatio: number; bands: ReadonlyArray<"warm" | "cool"> };

/** Aggregate only presentation; the authoritative resident roster is untouched. */
export function projectCustomerWindows(
  residents: readonly CustomerWindowResident[],
  threshold = CUSTOMER_WINDOW_READABILITY_THRESHOLD
): CustomerWindowProjection {
  const active = residents.filter(resident => resident.cadence.state !== "dark").length;
  const dormant = residents.length - active;
  if (residents.length <= threshold) return {
    mode: "individual", active, dormant,
    windows: residents.map(resident => ({ identityKey: resident.identityKey, state: resident.cadence.state === "dark" ? "cool" : "warm" })),
  };
  const bandCount = Math.min(6, Math.max(3, Math.ceil(residents.length / threshold)));
  const warmBands = Math.round((active / Math.max(1, residents.length)) * bandCount);
  return { mode: "aggregate", active, dormant, total: residents.length, warmRatio: active / residents.length,
    bands: Array.from({ length: bandCount }, (_, index) => index < warmBands ? "warm" : "cool") };
}
