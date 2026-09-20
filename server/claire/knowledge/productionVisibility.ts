/**
 * Production visibility boundary for business records that may have been created by
 * acceptance tests, synthetic verification, demos, or developer tooling.
 *
 * This does not delete data. It prevents records carrying explicit non-production
 * provenance markers from being promoted into Claire's real operator context.
 */
const NON_PRODUCTION_MARKER =
  /(?:^|[^a-z0-9])(?:slice0|synthetic(?:[-_ ]verification)?|verification[-_ ]follow[-_ ]?up|e2e|codex|fixture|qa[-_ ]?only|test[-_ ]?fixture|demo[-_ ]?fixture)(?:$|[^a-z0-9])/i;

export type BusinessRecordProvenance = {
  createdBy?: string | null;
  requestId?: string | null;
  missionCode?: string | null;
  accountName?: string | null;
  note?: string | null;
};

export function hasNonProductionProvenance(record: BusinessRecordProvenance): boolean {
  return [
    record.createdBy,
    record.requestId,
    record.missionCode,
    record.accountName,
    record.note,
  ].some(value => Boolean(value && NON_PRODUCTION_MARKER.test(value)));
}

export function isProductionVisibleBusinessRecord(record: BusinessRecordProvenance): boolean {
  return !hasNonProductionProvenance(record);
}
