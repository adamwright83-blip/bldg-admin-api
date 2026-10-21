/**
 * The one way into Silver Lake. Every entry (Home clicks, the golden messenger on the overview, territory rooms,
 * deep links) lands on the walkable 3D courtyard. The painted 2D encounter is archived and no longer reachable.
 */
export function silverLake3DHref(territoryId = "silver-lake", extra: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams({ cozy: "1", territory: territoryId });
  const here = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  // carry the safe synthetic preview through, so a preview never turns into real data
  if (here?.get("preview") === "synthetic") params.set("preview", "synthetic");
  for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v);
  return `/growth/lantern-city?${params.toString()}`;
}

export function openSilverLake3D(territoryId = "silver-lake", extra: Record<string, string | undefined> = {}): void {
  if (typeof window === "undefined") return;
  window.location.assign(silverLake3DHref(territoryId, extra));
}
