/**
 * Every Google and Slack call the first ten minutes make goes through here.
 *
 * Outside production, JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN points all of them at a local stand-in (the e2e fake in
 * e2e/first-ten-minutes/) by rewriting `https://<host>/<path>` to `<origin>/<host>/<path>`. In production the variable
 * is ignored, so a real token can never be sent anywhere but the real provider.
 */
export function providerUrl(url: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN?.trim().replace(/\/$/, "");
  if (!override || env.NODE_ENV === "production") return url;
  const parsed = new URL(url);
  return `${override}/${parsed.host}${parsed.pathname}${parsed.search}`;
}

export class ProviderError extends Error {
  constructor(
    readonly provider: "google" | "slack",
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export type FetchLike = typeof fetch;

/** JSON from a provider, with a timeout. Error bodies are not echoed (they can carry tokens or codes). */
export async function providerJson<T>(
  provider: "google" | "slack",
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
  deps: { fetch?: FetchLike; env?: NodeJS.ProcessEnv } = {}
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15_000);
  try {
    const response = await (deps.fetch ?? fetch)(providerUrl(url, deps.env), { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new ProviderError(provider, response.status, `${provider} answered ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
