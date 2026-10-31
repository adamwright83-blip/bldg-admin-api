
/**
 * The first-ten draft's resume token lives in this origin's browser storage, like today's funnel keeps its own
 * (under a different key, so the two never read each other's drafts). Google, Slack and Stripe send the visitor
 * back to this origin, where these are still waiting.
 */
export type FirstTenCredentials = { sessionId: string; resumeToken: string };

const CREDENTIALS_KEY = "joystick_first_ten_credentials";

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

const HANDOFF = /^#first-ten=([0-9a-f-]{36})\.([A-Za-z0-9_-]{32,128})$/;

/**
 * A journey carried here from another origin (checkout returns to one origin only): its credentials arrive in the
 * URL fragment, which is never sent to a server, are kept, and the fragment is cleared at once.
 */
export function adoptFirstTenHandoff(): boolean {
  if (typeof window === "undefined") return false;
  const match = window.location.hash.match(HANDOFF);
  if (!match) return false;
  saveFirstTenCredentials({ sessionId: match[1], resumeToken: match[2] });
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return true;
}

export function firstTenHandoffUrl(origin: string, credentials: FirstTenCredentials): string {
  // in `preview`, that origin needs its own preview pass (the cookie is per origin); the link carries no preview code
  return `${origin}/joystick-start#first-ten=${credentials.sessionId}.${credentials.resumeToken}`;
}

export function clearFirstTenCredentials(): void {
  safely(() => {
    sessionStorage.removeItem(CREDENTIALS_KEY);
    localStorage.removeItem(CREDENTIALS_KEY);
  }, undefined);
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
