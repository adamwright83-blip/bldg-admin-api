/**
 * Persists WHICH fiction template an unresolved real action is currently
 * playing as — never any business truth.
 *
 * Same shape and same guarantees as `checkpointStorage.ts`, reused
 * deliberately rather than inventing a second local-storage pattern: this
 * IS the "existing metadata/event seam" the mission-fiction prompt asked to
 * be preferred over a new migration. Fiction assignment is presentation
 * metadata exactly like corridor position is — which movie is playing, not
 * what happened in reality.
 *
 * Two guarantees, both structural:
 *
 *   1. NO AUTHORITATIVE BUSINESS STATE IS EVER WRITTEN. `sanitizeAssignment`
 *      rebuilds the stored object field by field from a known-safe
 *      whitelist, so a caller that accidentally passes a business outcome
 *      field simply has it dropped.
 *
 *   2. ASSIGNMENTS ARE IDENTITY-SCOPED, same rule as checkpoints — a shared
 *      device cannot hand one driver's in-progress movie to another.
 *
 * Once written for a `stableMissionKey`, an assignment is authoritative for
 * THAT unresolved mission and is never overwritten by re-derivation — this
 * is what keeps the same real action playing the same fiction across
 * reload/resume/registry evolution, per the mission-fiction determinism
 * contract in shared/fictionTemplate.ts.
 */
export type FictionAssignmentRecord = {
  stableMissionKey: string;
  templateId: string;
  rulesVersion: number;
  instantiatedAt: string;
};

export type FictionAssignmentIdentity = string | null;

const STORAGE_PREFIX = "goldline:fiction-assignments:v1";
/** Bounded so a very long play history can never grow this unboundedly. */
const MAX_RECORDS = 64;

export function fictionAssignmentStorageKey(
  identity: FictionAssignmentIdentity
): string {
  return `${STORAGE_PREFIX}:${identity && identity.length ? identity : "anon"}`;
}

function sanitizeRecord(record: FictionAssignmentRecord): FictionAssignmentRecord {
  return {
    stableMissionKey: record.stableMissionKey,
    templateId: record.templateId,
    rulesVersion: record.rulesVersion,
    instantiatedAt: record.instantiatedAt,
  };
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readAll(identity: FictionAssignmentIdentity): FictionAssignmentRecord[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(fictionAssignmentStorageKey(identity));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is FictionAssignmentRecord =>
          !!item &&
          typeof item === "object" &&
          typeof (item as FictionAssignmentRecord).stableMissionKey === "string" &&
          typeof (item as FictionAssignmentRecord).templateId === "string" &&
          typeof (item as FictionAssignmentRecord).rulesVersion === "number" &&
          typeof (item as FictionAssignmentRecord).instantiatedAt === "string"
      )
      .map(sanitizeRecord);
  } catch {
    return [];
  }
}

function writeAll(
  identity: FictionAssignmentIdentity,
  records: FictionAssignmentRecord[]
): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(
      fictionAssignmentStorageKey(identity),
      JSON.stringify(records.slice(-MAX_RECORDS))
    );
  } catch {
    // Best-effort only — losing an assignment just means the mission gets
    // freshly (still deterministically) re-derived next time.
  }
}

/** How many assignments are currently persisted — used only to report a real prune count. */
export function fictionAssignmentCount(
  identity: FictionAssignmentIdentity = null
): number {
  return readAll(identity).length;
}

/** Returns the persisted assignment for this mission, if one was ever recorded. */
export function loadFictionAssignment(
  stableMissionKey: string,
  identity: FictionAssignmentIdentity = null
): FictionAssignmentRecord | null {
  return (
    readAll(identity).find(record => record.stableMissionKey === stableMissionKey) ??
    null
  );
}

/**
 * Records an assignment for a mission that has none yet. A no-op if one
 * already exists for this exact `stableMissionKey` — the first assignment
 * wins, which is what makes an already-instantiated mission's fiction
 * immune to later re-derivation or registry evolution.
 */
export function saveFictionAssignmentIfAbsent(
  record: FictionAssignmentRecord,
  identity: FictionAssignmentIdentity = null
): FictionAssignmentRecord {
  const existing = loadFictionAssignment(record.stableMissionKey, identity);
  if (existing) return existing;
  const all = readAll(identity);
  all.push(sanitizeRecord(record));
  writeAll(identity, all);
  return record;
}

/** Called once the underlying real action resolves or is confirmed gone — reality wins. */
export function clearFictionAssignment(
  stableMissionKey: string,
  identity: FictionAssignmentIdentity = null
): void {
  const remaining = readAll(identity).filter(
    record => record.stableMissionKey !== stableMissionKey
  );
  writeAll(identity, remaining);
}

/**
 * Drops every persisted assignment whose key is not in `stillUnresolvedKeys`.
 * Used on long-horizon resume: reality is re-read first, and any fiction
 * whose real action resolved or vanished while offline is removed — the
 * Fiction Director never resurrects a finished story.
 */
export function pruneResolvedFictionAssignments(
  stillUnresolvedKeys: readonly string[],
  identity: FictionAssignmentIdentity = null
): FictionAssignmentRecord[] {
  const keep = new Set(stillUnresolvedKeys);
  const remaining = readAll(identity).filter(record => keep.has(record.stableMissionKey));
  writeAll(identity, remaining);
  return remaining;
}
