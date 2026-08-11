/**
 * Haptic feedback with an explicit truth boundary.
 *
 * `arcadeFeedback()` — a light pulse for skill feedback (a clean weak-point
 * hit, a locked signal, an aligned window). This reflects mechanical
 * execution only.
 *
 * `businessVictoryFeedback()` — a stronger, distinct pattern reserved for an
 * authoritative business result (a verified capture). Callers must never
 * invoke this from arcade resolution alone; it exists specifically so the two
 * feelings are never confusable.
 *
 * Never called during a live phone call — every call site is responsible for
 * checking that itself, kept visible rather than hidden behind a flag here.
 */
const STORAGE_KEY = "goldline:haptics:enabled";

export function hapticsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setHapticsEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Best-effort; haptics simply won't persist across sessions.
  }
}

function supportsVibration(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

function vibrate(pattern: number | number[]): boolean {
  if (!hapticsEnabled() || !supportsVibration()) return false;
  try {
    return navigator.vibrate(pattern);
  } catch {
    // Some browsers throw when vibration is blocked (e.g. no user gesture yet).
    return false;
  }
}

/** Light skill-feedback pulse. Never implies a business result. */
export function arcadeFeedback() {
  vibrate(18);
}

/** Distinct, stronger pattern reserved for an authoritative business win. */
export function businessVictoryFeedback() {
  vibrate([30, 40, 60]);
}

export function missFeedback() {
  vibrate(12);
}
