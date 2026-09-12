/**
 * Companion unlock tracking — local, not synced to the database.
 *
 * There is no server-side "did this driver complete Colosseum" record today;
 * ColosseumBossGate's onBossDefeated is a bare callback with no persistence
 * behind it. Rather than invent a database column under time pressure, this
 * stays a same-device localStorage flag, matching the existing convention in
 * driverMissionStorage.ts. Good enough to show a real reward on this device;
 * not a durable account-level unlock. If Colosseum completion later gets a
 * proper server record, read from that instead and retire this file.
 */
const COMPANION_UNLOCK_STORAGE_KEY = "driverCompanionUnlocks:v1";

export type CompanionId = "rook";

function readUnlocks(): Record<string, true> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(COMPANION_UNLOCK_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function isCompanionUnlocked(id: CompanionId): boolean {
  return readUnlocks()[id] === true;
}

export function unlockCompanion(id: CompanionId): void {
  if (typeof window === "undefined") return;
  try {
    const unlocks = readUnlocks();
    if (unlocks[id]) return;
    unlocks[id] = true;
    window.localStorage.setItem(COMPANION_UNLOCK_STORAGE_KEY, JSON.stringify(unlocks));
    window.dispatchEvent(new CustomEvent("companion-unlocked", { detail: { id } }));
  } catch {
    // Storage can throw in private-browsing contexts; the unlock simply
    // won't persist across a reload, which is a lesser failure than crashing.
  }
}
