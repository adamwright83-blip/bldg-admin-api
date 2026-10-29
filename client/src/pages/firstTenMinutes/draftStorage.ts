import { FIRST_TEN_PREVIEW_PARAM } from "@shared/firstTenMinutes";

/**
 * The first-ten draft's resume token lives in this origin's browser storage, like today's funnel keeps its own
 * (under a different key, so the two never read each other's drafts). Google, Slack and Stripe send the visitor
 * back to this origin, where these are still waiting.
 */
export type FirstTenCredentials = { sessionId: string; resumeToken: string };

const CREDENTIALS_KEY = "joystick_first_ten_credentials";
const PREVIEW_KEY = "joystick_first_ten_preview";

function safely<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

export function readFirstTenCredentials(): FirstTenCredentials | null {
  return safely(() => {
    const raw = sessionStorage.getItem(CREDENTIALS_KEY) || localStorage.getItem(CREDENTIALS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FirstTenCredentials>;
    return parsed.sessionId && parsed.resumeToken
      ? { sessionId: parsed.sessionId, resumeToken: parsed.resumeToken }
      : null;
  }, null);
}

export function saveFirstTenCredentials(credentials: FirstTenCredentials): void {
  safely(() => {
    const raw = JSON.stringify(credentials);
    sessionStorage.setItem(CREDENTIALS_KEY, raw);
    localStorage.setItem(CREDENTIALS_KEY, raw);
  }, undefined);
}

export function clearFirstTenCredentials(): void {
  safely(() => {
    sessionStorage.removeItem(CREDENTIALS_KEY);
    localStorage.removeItem(CREDENTIALS_KEY);
  }, undefined);
}

/**
 * While the flag is `preview`, /joystick-start?crew=1 opts this tab in. A draft already started here also counts,
 * so a return from Google or Stripe lands back in the same experience.
 */
export function readPreviewOptIn(search: string = typeof window === "undefined" ? "" : window.location.search): boolean {
  const fromUrl = new URLSearchParams(search).get(FIRST_TEN_PREVIEW_PARAM) === "1";
  return safely(() => {
    if (fromUrl) sessionStorage.setItem(PREVIEW_KEY, "1");
    return fromUrl || sessionStorage.getItem(PREVIEW_KEY) === "1" || Boolean(readFirstTenCredentials());
  }, fromUrl);
}

/** Today's funnel's own key (JoystickAcquisitionPage.tsx). Read only to keep a Stripe return with its own page. */
const TODAYS_FUNNEL_KEY = "joystick_acquisition_credentials";

/** ?session=<id> names a draft. A return for today's funnel's draft stays on today's page whatever the flag says. */
export function sessionBelongsToTodaysFunnel(search: string): boolean {
  const session = new URLSearchParams(search).get("session");
  if (!session) return false;
  if (readFirstTenCredentials()?.sessionId === session) return false;
  return safely(() => {
    const raw = sessionStorage.getItem(TODAYS_FUNNEL_KEY) || localStorage.getItem(TODAYS_FUNNEL_KEY);
    return Boolean(raw && (JSON.parse(raw) as { sessionId?: string }).sessionId === session);
  }, false);
}
