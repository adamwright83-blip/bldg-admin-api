/**
 * Haptic feedback utilities using the Web Vibration API.
 * Falls back silently on devices that don't support it (iOS Safari, etc.).
 */

function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

export const haptics = {
  /** Light tap — button press, menu selection */
  tap: () => vibrate(10),

  /** Medium impact — scan confirmation, score increment */
  impact: () => vibrate([15, 30, 15]),

  /** Heavy slam — override success, mission complete */
  slam: () => vibrate([30, 50, 30, 50, 80]),

  /** Double pulse — camera shutter */
  shutter: () => vibrate([20, 40, 20]),

  /** Error buzz — failure state */
  error: () => vibrate([50, 30, 50, 30, 50]),

  /** Rising pattern — countdown urgency */
  countdown: () => vibrate([10, 100, 20, 80, 30, 60, 50]),
};
