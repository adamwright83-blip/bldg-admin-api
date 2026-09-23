/**
 * Whether this device still owes the player the Colosseum's first-entry
 * prologue (`ClockheadPrologue`).
 *
 * Presentation memory only, like the seal reveals' "seen" count: it decides
 * whether a cinematic fight plays, and can never touch the campaign. The
 * prologue only plays while the real hunt has no recorded outcome — it ends
 * with all five seals intact, and that is only true then.
 */
export type PrologueStorage = Pick<Storage, "getItem" | "setItem">;

/** Survives a storage write that fails, for the rest of this session. */
const seenThisSession = new Set<string>();

export function prologueKey(missionId: string): string {
  return `goldline:colosseum:prologue-seen:${missionId}`;
}

export function shouldPlayPrologue(
  storage: PrologueStorage | null,
  missionId: string,
  tracedCount: number
): boolean {
  if (tracedCount > 0 || seenThisSession.has(missionId) || !storage) return false;
  try {
    return storage.getItem(prologueKey(missionId)) == null;
  } catch {
    // Unknown memory: never risk trapping a player in the same cutscene.
    return false;
  }
}

export function markPrologueSeen(storage: PrologueStorage | null, missionId: string) {
  seenThisSession.add(missionId);
  try {
    storage?.setItem(prologueKey(missionId), "1");
  } catch {
    // The session memory above still keeps it from replaying this visit.
  }
}

export function browserStorage(): PrologueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
