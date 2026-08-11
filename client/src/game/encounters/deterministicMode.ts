/**
 * Deterministic encounter mode — verification harness only.
 *
 * The Ghost beacon drifts and the Staller marker sweeps on requestAnimationFrame.
 * That motion is the mechanic, but it makes browser assertions timing-dependent,
 * and a flaky assertion tends to get loosened until it proves nothing.
 *
 * When this flag is set, motion is pinned to a known position. Everything that
 * actually matters still runs for real: the required hold duration, the
 * alignment tolerance, the hit/miss decision, the business-resolution gate, and
 * every truth guard. Only the position of a moving element is frozen.
 *
 * The flag is never set by application code — the harness installs it with
 * `page.addInitScript` before the app boots.
 */
declare global {
  interface Window {
    __GOLDLINE_DETERMINISTIC_ENCOUNTERS__?: boolean;
  }
}

export function deterministicEncounters(): boolean {
  return (
    typeof window !== "undefined" &&
    window.__GOLDLINE_DETERMINISTIC_ENCOUNTERS__ === true
  );
}

/** Centre of the tracking field, so a pointer at the centre holds contact. */
export const DETERMINISTIC_BEACON = { x: 50, y: 50 };

/** Marker and window share a centre, so a committed input is inside the window. */
export const DETERMINISTIC_ALIGNMENT = 50;
