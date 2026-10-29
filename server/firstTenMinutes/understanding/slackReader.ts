import { ProviderError, providerUrl, type FetchLike } from "../providerFetch";
import type { ReadResult, SlackItem } from "./sources";

/**
 * Read-only Slack for one user token: the person's own messages, and messages sent to them, from the last ninety
 * days. Nothing is posted, reacted to or changed.
 */
type Deps = { fetch?: FetchLike; env?: NodeJS.ProcessEnv; now?: () => Date };

type SearchMatch = {
  ts?: string;
  text?: string;
  user?: string;
  username?: string;
  permalink?: string;
  channel?: { id?: string; name?: string };
};

async function slackGet<T extends { ok?: boolean }>(token: string, method: string, params: Record<string, string>, deps: Deps): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await (deps.fetch ?? fetch)(
      providerUrl(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, deps.env),
      { headers: { authorization: `Bearer ${token}` }, signal: controller.signal }
    );
    if (!response.ok) throw new ProviderError("slack", response.status, `Slack answered ${response.status}`);
    const body = (await response.json()) as T;
    if (!body.ok) throw new ProviderError("slack", 400, `Slack refused ${method}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export function slackReader(access: { accessToken: string; userId: string | null }, deps: Deps = {}) {
  return async function slack(limit: number): Promise<ReadResult<SlackItem>> {
    const now = (deps.now ?? (() => new Date()))();
    const after = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const me = access.userId ?? (await slackGet<{ ok?: boolean; user_id?: string }>(access.accessToken, "auth.test", {}, deps)).user_id ?? "";
    const items = new Map<string, SlackItem>();
    for (const [query, mine] of [
      [`from:<@${me}> after:${after}`, true],
      [`to:<@${me}> after:${after}`, false],
    ] as const) {
      const body = await slackGet<{ ok?: boolean; messages?: { matches?: SearchMatch[] } }>(
        access.accessToken,
        "search.messages",
        { query, count: String(Math.min(100, limit)), sort: "timestamp", sort_dir: "desc" },
        deps
      );
      for (const match of body.messages?.matches ?? []) {
        if (!match.ts || !match.text) continue;
        const id = `${match.channel?.id ?? "?"}:${match.ts}`;
        items.set(id, {
          provider: "slack",
          id,
          at: new Date(Number(match.ts) * 1000),
          channel: match.channel?.name ?? "a conversation",
          from: { name: match.username ?? null, email: match.user ?? "" },
          text: match.text,
          sentByOwner: mine || match.user === me,
          url: match.permalink ?? null,
        });
      }
    }
    return { items: [...items.values()].sort((a, b) => a.at.getTime() - b.at.getTime()).slice(-limit), unavailable: null };
  };
}
