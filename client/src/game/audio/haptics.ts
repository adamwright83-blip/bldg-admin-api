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
  return (
    typeof navigator !== "undefined" && typeof navigator.vibrate === "function"
  );
}

function reducedMotionRequested(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function vibrate(pattern: number | number[]): boolean {
  if (!hapticsEnabled() || !supportsVibration() || reducedMotionRequested())
    return false;
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

/** Fictional shield impact: tactile, but intentionally not a business-win pattern. */
export function combatGuardFeedback() {
  vibrate([14, 18, 30]);
}

/** Fictional damage/stagger. Stronger than a UI tap, distinct from a real win. */
export function combatHurtFeedback() {
  vibrate([26, 16, 18]);
}

/** Fictional boss reveal / arena fracture. Never implies a real-world outcome. */
export function combatRevealFeedback() {
  vibrate([16, 24, 28]);
}

/** Distinct, stronger pattern reserved for an authoritative business win. */
export function businessVictoryFeedback() {
  vibrate([30, 40, 60]);
}

export function missFeedback() {
  vibrate(12);
}

const feedbackTokens = new Set<string>();

function vibrateOnce(token: string, pattern: number | number[]) {
  if (feedbackTokens.has(token)) return;
  feedbackTokens.add(token);
  if (feedbackTokens.size > 128) {
    const oldest = feedbackTokens.values().next().value;
    if (oldest) feedbackTokens.delete(oldest);
  }
  vibrate(pattern);
}

export function missionApproachFeedback(missionId: number) {
  vibrateOnce(`mission-approach:${missionId}`, 10);
}

export function actionReadyFeedback(encounterId: string) {
  vibrateOnce(`action-ready:${encounterId}`, [12, 24, 18]);
}

export function authoritativeMutationFeedback(revision: string) {
  vibrateOnce(`authoritative-mutation:${revision}`, [18, 32, 26]);
}

export function corridorTransitionFeedback(requestId: number) {
  vibrateOnce(`corridor-transition:${requestId}`, 16);
}
