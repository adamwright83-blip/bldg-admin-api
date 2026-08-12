import type { CorridorBranch } from "../state/GameState";

/**
 * Persists WHERE the player was standing — never what their business is
 * doing.
 *
 * Two guarantees, both enforced in code rather than by convention:
 *
 *   1. NO AUTHORITATIVE BUSINESS STATE IS EVER WRITTEN. `sanitizeCheckpoint`
 *      rebuilds the stored object field by field from a known-safe whitelist,
 *      so a caller that accidentally passes `missionState`, revenue, or a
 *      capture flag simply has it dropped. Business truth is reconciled from
 *      the server on resume, always.
 *
 *   2. CHECKPOINTS ARE IDENTITY-SCOPED. The storage key includes the
 *      authenticated identity, so signing out and signing in as somebody else
 *      on a shared phone cannot inherit the previous player's position. An
 *      unauthenticated session gets its own `anon` bucket rather than sharing
 *      one with every account that ever used the device.
 *
 * Only ever written from a safe avatar state (see GoldlineGame's
 * reportCheckpointIfSafe), so a restore can never resume mid-jump/vault/climb.
 */
export type Checkpoint = {
  corridorId: string;
  progress: number;
  lateral: number;
  branch: CorridorBranch;
  savedAt: string;
};

/**
 * Stable per-player key. `null` means "not signed in" and maps to its own
 * bucket — deliberately not shared with any real account.
 */
export type CheckpointIdentity = string | null;

/**
 * v2 introduced identity scoping. v1 values are intentionally never migrated:
 * a v1 checkpoint has no identity attached, so adopting it would be a guess
 * about who it belonged to. Dropping it costs the player a corridor entry
 * position and nothing else.
 */
const STORAGE_PREFIX = "goldline:checkpoint:v2";

export function checkpointStorageKey(identity: CheckpointIdentity): string {
  return `${STORAGE_PREFIX}:${identity && identity.length ? identity : "anon"}`;
}

/**
 * Rebuilds a checkpoint from only the safe positional fields.
 *
 * This is the structural guarantee that authoritative business outcomes
 * cannot be persisted locally: anything not named here does not survive.
 */
function sanitizeCheckpoint(checkpoint: Checkpoint): Checkpoint {
  return {
    corridorId: checkpoint.corridorId,
    progress: checkpoint.progress,
    lateral: checkpoint.lateral,
    branch: checkpoint.branch,
    savedAt: checkpoint.savedAt,
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

export function saveCheckpoint(
  checkpoint: Checkpoint,
  identity: CheckpointIdentity = null
): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(
      checkpointStorageKey(identity),
      JSON.stringify(sanitizeCheckpoint(checkpoint))
    );
  } catch {
    // Best-effort only — losing a checkpoint just means starting the
    // corridor from its default entry point, never a broken state.
  }
}

function readCheckpoint(identity: CheckpointIdentity): Checkpoint | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(checkpointStorageKey(identity));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Checkpoint>;
    if (
      typeof parsed.corridorId !== "string" ||
      typeof parsed.progress !== "number" ||
      typeof parsed.lateral !== "number" ||
      typeof parsed.branch !== "string"
    ) {
      return null;
    }
    // Re-sanitize on read as well: a value hand-edited in devtools cannot
    // smuggle extra fields into the running game.
    return sanitizeCheckpoint(parsed as Checkpoint);
  } catch {
    return null;
  }
}

/**
 * Returns the saved checkpoint only if it belongs to `corridorId`.
 *
 * Kept for callers that are already committed to a specific corridor and
 * just want its entry position.
 */
export function loadCheckpoint(
  corridorId: string,
  identity: CheckpointIdentity = null
): Checkpoint | null {
  const checkpoint = readCheckpoint(identity);
  if (!checkpoint || checkpoint.corridorId !== corridorId) return null;
  return checkpoint;
}

/**
 * Returns the saved checkpoint whichever corridor it belongs to.
 *
 * This is what makes continuity CROSS-corridor: on resume the caller reads
 * the checkpoint first, discovers which corridor the player was in, validates
 * and loads that corridor's manifest, restores the safe position, and only
 * then reconciles authoritative mission state from the server.
 */
export function loadAnyCheckpoint(
  identity: CheckpointIdentity = null
): Checkpoint | null {
  return readCheckpoint(identity);
}

export function clearCheckpoint(identity: CheckpointIdentity = null): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(checkpointStorageKey(identity));
  } catch {
    // Best-effort only.
  }
}

/**
 * Removes every identity's checkpoint on this device.
 *
 * For an explicit "forget me on this device" action — routine sign-out does
 * not need it, since scoping already prevents cross-account inheritance.
 */
export function clearAllCheckpoints(): void {
  const store = storage();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key && key.startsWith(`${STORAGE_PREFIX}:`)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // Best-effort only.
  }
}
