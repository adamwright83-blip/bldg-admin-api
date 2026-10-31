import { FIRST_TEN_PREVIEW_PARAM } from "@shared/firstTenMinutes";

/**
 * The first-ten preview code (/joystick-start?crew=<code>) grants preview access, so it must never be recorded. It is
 * taken out of the address bar at startup, before analytics or session recording begins (main.tsx), and kept only in
 * memory for the /joystick-start page to hand to the server once.
 */
let taken: string | null | undefined;

export function takePreviewCodeFromUrl(): string | null {
  if (taken !== undefined) return taken;
  if (typeof window === "undefined") return (taken = null);
  const url = new URL(window.location.href);
  taken = url.searchParams.get(FIRST_TEN_PREVIEW_PARAM) || null;
  if (url.searchParams.has(FIRST_TEN_PREVIEW_PARAM)) {
    url.searchParams.delete(FIRST_TEN_PREVIEW_PARAM);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
  return taken;
}

const PREVIEW_IN_URL = new RegExp(`([?&]${FIRST_TEN_PREVIEW_PARAM}=)[^&#\\s"']*`, "g");

/** Any URL-ish text with the preview code in it, redacted (analytics' last line of defence). */
export function redactPreviewCode(value: string): string {
  return value.replace(PREVIEW_IN_URL, "$1[redacted]");
}
