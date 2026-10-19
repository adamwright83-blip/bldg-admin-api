/**
 * Pure: the source conditions that mean sales data is actually missing.
 * A source that loaded but has orders without payment receipts is not an outage.
 */
export function salesSourceOutage(
  revenue:
    | { status: "unavailable"; coverage: { cleanCloudStatus: string | null; snapshotRead: boolean; loadedSources: readonly string[]; failedSources: readonly string[] } }
    | { status: "ok"; coverage: { cleanCloudStatus: string | null; snapshotRead: boolean; loadedSources: readonly string[]; failedSources: readonly string[] } }
): string[] {
  const c = revenue.coverage;
  if (revenue.status === "unavailable") return ["sales sources could not be read"];
  return [
    ...(c.cleanCloudStatus && !["fresh", "not_held"].includes(c.cleanCloudStatus)
      ? [`CleanCloud ${c.cleanCloudStatus}`]
      : []),
    ...c.failedSources
      .filter(s => !c.loadedSources.includes(s))
      .map(s => `${s} could not be loaded`),
    ...(!c.snapshotRead ? ["source coverage contract unreadable"] : []),
  ];
}
