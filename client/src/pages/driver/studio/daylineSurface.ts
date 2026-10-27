/**
 * Which Day Line the driver sees. Driver Studio is the default; the previous
 * GOLDLINE Day Line stays one switch away and the choice is remembered on the
 * device, so a driver who opts out is not pushed back on the next load.
 *
 *   ?dayline=studio   Studio, and forget any saved opt-out
 *   ?dayline=legacy   previous Day Line, remembered on this device
 *   ?dayline=classic  the older classic layout (QA only, not remembered)
 */
export type DaylineSurface = "studio" | "legacy" | "classic";

export const DAYLINE_SURFACE_STORAGE_KEY = "joystick:dayline";

export function resolveDaylineSurface(
  search: string,
  stored: string | null,
  fallback: DaylineSurface = "studio"
): DaylineSurface {
  const requested = new URLSearchParams(search).get("dayline");
  if (requested === "studio") return "studio";
  if (requested === "legacy" || requested === "world") return "legacy";
  if (requested === "classic") return "classic";
  if (stored === "legacy") return "legacy";
  if (stored === "studio") return "studio";
  return fallback;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Reads the surface for this page load and remembers an explicit studio/legacy choice. */
export function readDaylineSurface(fallback: DaylineSurface = "studio"): DaylineSurface {
  if (typeof window === "undefined") return fallback;
  const store = storage();
  let stored: string | null = null;
  try {
    stored = store?.getItem(DAYLINE_SURFACE_STORAGE_KEY) ?? null;
  } catch {
    stored = null;
  }
  const surface = resolveDaylineSurface(window.location.search, stored, fallback);
  const requested = new URLSearchParams(window.location.search).get("dayline");
  try {
    if (requested === "legacy" || requested === "world") store?.setItem(DAYLINE_SURFACE_STORAGE_KEY, "legacy");
    if (requested === "studio") store?.removeItem(DAYLINE_SURFACE_STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: the URL still decides this load.
  }
  return surface;
}

/** Reloads the Day Line on the other surface. A reload keeps the two trees' hooks separate. */
export function switchDaylineSurface(surface: "studio" | "legacy") {
  try {
    if (surface === "legacy") storage()?.setItem(DAYLINE_SURFACE_STORAGE_KEY, "legacy");
    else storage()?.removeItem(DAYLINE_SURFACE_STORAGE_KEY);
  } catch {
    // The URL below still carries the choice for this load.
  }
  const url = new URL(window.location.href);
  url.searchParams.set("dayline", surface);
  window.location.assign(url.toString());
}
