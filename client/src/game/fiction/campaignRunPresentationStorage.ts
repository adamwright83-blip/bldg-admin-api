/**
 * Presentation-only persistence for a Campaign Run overlay.
 *
 * Same localStorage pattern as fictionAssignmentStorage: this remembers
 * whether the operator entered the field and which Clockhead beat they
 * dismissed. It never writes qualified counts, completion, or any other
 * campaign-run truth.
 */
export type CampaignRunPresentationRecord = {
  campaignRunId: string;
  fieldEntered: boolean;
  acknowledgedBeatId: string | null;
};

const STORAGE_PREFIX = "goldline:campaign-run-presentation:v1";

export function campaignRunPresentationStorageKey(campaignRunId: string): string {
  return `${STORAGE_PREFIX}:${campaignRunId}`;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function emptyRecord(campaignRunId: string): CampaignRunPresentationRecord {
  return {
    campaignRunId,
    fieldEntered: false,
    acknowledgedBeatId: null,
  };
}

function sanitize(
  campaignRunId: string,
  value: unknown
): CampaignRunPresentationRecord {
  const record = emptyRecord(campaignRunId);
  if (!value || typeof value !== "object") return record;
  const raw = value as Partial<CampaignRunPresentationRecord>;
  return {
    campaignRunId,
    fieldEntered: raw.fieldEntered === true,
    acknowledgedBeatId:
      typeof raw.acknowledgedBeatId === "string" && raw.acknowledgedBeatId.length
        ? raw.acknowledgedBeatId
        : null,
  };
}

export function loadCampaignRunPresentation(
  campaignRunId: string
): CampaignRunPresentationRecord {
  const store = storage();
  if (!store) return emptyRecord(campaignRunId);
  try {
    const raw = store.getItem(campaignRunPresentationStorageKey(campaignRunId));
    if (!raw) return emptyRecord(campaignRunId);
    return sanitize(campaignRunId, JSON.parse(raw) as unknown);
  } catch {
    return emptyRecord(campaignRunId);
  }
}

function write(
  campaignRunId: string,
  record: CampaignRunPresentationRecord
): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(
      campaignRunPresentationStorageKey(campaignRunId),
      JSON.stringify(sanitize(campaignRunId, record))
    );
  } catch {
    // Best-effort presentation continuity only.
  }
}

export function markCampaignRunFieldEntered(campaignRunId: string): void {
  const current = loadCampaignRunPresentation(campaignRunId);
  write(campaignRunId, { ...current, fieldEntered: true });
}

export function acknowledgeCampaignRunBeat(
  campaignRunId: string,
  beatId: string
): void {
  const current = loadCampaignRunPresentation(campaignRunId);
  write(campaignRunId, { ...current, acknowledgedBeatId: beatId });
}
