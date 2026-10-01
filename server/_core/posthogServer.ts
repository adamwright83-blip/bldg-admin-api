import { PostHog, type EventMessage } from "posthog-node";

const DEFAULT_HOST = "https://us.i.posthog.com";
const SECRET_PROPERTY = /password|authorization|cookie|secret|api[_-]?key|bearer/i;

let client: PostHog | null | undefined;
let shutdownPromise: Promise<void> | null = null;

export function posthogProjectToken(): string {
  return process.env.POSTHOG_PROJECT_TOKEN?.trim() || "";
}

export function posthogHost(): string {
  const host = process.env.POSTHOG_HOST?.trim() || DEFAULT_HOST;
  return host.replace(/\/$/, "");
}

/** Opt-in. Default sends model, tokens, latency, and ids, not prompt text. */
export function posthogAiCapturesContent(): boolean {
  return process.env.POSTHOG_AI_CAPTURE_CONTENT === "1";
}

function scrubEvent(event: EventMessage | null): EventMessage | null {
  if (!event?.properties) return event;
  for (const key of Object.keys(event.properties)) {
    if (SECRET_PROPERTY.test(key)) delete event.properties[key];
  }
  return event;
}

/** Singleton. Null when POSTHOG_PROJECT_TOKEN is unset. Never throws. */
export function getServerPosthog(): PostHog | null {
  if (client !== undefined) return client;
  const token = posthogProjectToken();
  if (!token) {
    client = null;
    return null;
  }
  try {
    const captureContent = posthogAiCapturesContent();
    const secretKey = process.env.POSTHOG_SECRET_KEY?.trim();
    client = new PostHog(token, {
      host: posthogHost(),
      flushAt: 20,
      flushInterval: 5_000,
      // privacyMode nulls $ai_input / $ai_output_choices inside @posthog/ai.
      // It must be off only when content capture was explicitly enabled.
      privacyMode: !captureContent,
      enableFullAiCapture: captureContent,
      ...(secretKey ? { secretKey } : {}),
      before_send: scrubEvent,
    });
  } catch {
    client = null;
  }
  return client;
}

export async function shutdownServerPosthog(): Promise<void> {
  const current = client;
  if (!current) return;
  if (!shutdownPromise) {
    shutdownPromise = current.shutdown(2_000).catch(() => undefined);
  }
  await shutdownPromise;
}

export function resetServerPosthogForTests(): void {
  client = undefined;
  shutdownPromise = null;
}
