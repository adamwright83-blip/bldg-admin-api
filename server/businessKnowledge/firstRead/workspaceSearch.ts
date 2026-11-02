/**
 * Google's Universal Search MCP server (Workspace Developer Preview): one tool, `search_corpus`, fanning a query out
 * across Gmail, Drive, Calendar and Chat with the person's own OAuth token. It returns ranked items with snippets and
 * links. It does not return an answer, a summary or dates (checked against the server's own tools/list output,
 * 2026-10-31): Gmail's and Drive's AI Overviews are not exposed through it.
 *
 * Only `search_corpus` (annotated readOnlyHint) can leave this module: `workspaceSearchFetch` refuses any other
 * JSON-RPC call, and any other host, before it leaves the process.
 */
export const WORKSPACE_MCP_URL = "https://workspacemcp.googleapis.com/mcp/v1";
export const SEARCH_TOOL = "search_corpus";
const PROTOCOL_VERSION = "2025-06-18";
const ALLOWED_METHODS = new Set(["initialize", "notifications/initialized", "tools/list"]);

type JsonRpc = { jsonrpc?: string; id?: number; method?: string; params?: { name?: string } };

/** A fetch that only lets the MCP handshake, tools/list and `search_corpus` through to Google's MCP endpoint. */
export function workspaceSearchFetch(base: typeof fetch = fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    let call: JsonRpc = {};
    try {
      call = typeof init?.body === "string" ? (JSON.parse(init.body) as JsonRpc) : {};
    } catch {
      call = {};
    }
    const allowed =
      href === WORKSPACE_MCP_URL &&
      method === "POST" &&
      (ALLOWED_METHODS.has(call.method ?? "") || (call.method === "tools/call" && call.params?.name === SEARCH_TOOL));
    if (!allowed) throw new Error(`Refused: only ${SEARCH_TOOL} may be called (${method} ${href} ${call.method ?? ""} ${call.params?.name ?? ""})`.trim());
    return base(input, init);
  }) as typeof fetch;
}

export type WorkspaceHit = {
  corpus: "gmail" | "drive" | "calendar" | "chat";
  rank: number;
  title: string;
  snippet: string;
  /** Gmail sender, Drive mime type, Calendar start: whatever the item carries that a reader would want */
  detail: string;
  url: string | null;
};

export type WorkspaceSearch = {
  query: string;
  ok: boolean;
  status: number;
  /** Google's own message when the call was refused (no token or body is ever echoed) */
  error: string | null;
  latencyMs: number;
  hits: WorkspaceHit[];
};

type GmailMessage = { subject?: string; snippet?: string; sender?: string; recipients?: string[]; viewUrl?: string };
type SearchItem = {
  gmailResult?: { thread?: { threadId?: string; messages?: GmailMessage[] } };
  driveResult?: { title?: string; contentSnippet?: string; mimeType?: string; viewUrl?: string };
  calendarResult?: { title?: string; description?: string; start?: { date?: string; dateTime?: string }; viewUrl?: string };
  chatResult?: { messages?: Array<{ plaintextBody?: string; sender?: { displayName?: string }; viewUrl?: string; createTime?: string }> };
};

/** The items of a `search_corpus` result, whether it came back as structured content or as JSON text. */
export function hitsOf(result: unknown): WorkspaceHit[] {
  const body = (result ?? {}) as { structuredContent?: { items?: SearchItem[] }; content?: Array<{ type?: string; text?: string }> };
  let items = body.structuredContent?.items;
  if (!items) {
    for (const part of body.content ?? []) {
      if (part.type !== "text" || !part.text) continue;
      try {
        const parsed = JSON.parse(part.text) as { items?: SearchItem[] };
        if (Array.isArray(parsed.items)) items = parsed.items;
      } catch {
        // a plain-text part is a message, not results
      }
    }
  }
  return (items ?? []).flatMap((item, rank): WorkspaceHit[] => {
    if (item.gmailResult) {
      const messages = item.gmailResult.thread?.messages ?? [];
      const last = messages[messages.length - 1] ?? {};
      return [{ corpus: "gmail", rank, title: last.subject ?? "", snippet: messages.map(m => m.snippet ?? "").join(" … "), detail: `${last.sender ?? ""} → ${(last.recipients ?? []).join(", ")}`, url: last.viewUrl ?? null }];
    }
    if (item.driveResult) {
      const drive = item.driveResult;
      return [{ corpus: "drive", rank, title: drive.title ?? "", snippet: drive.contentSnippet ?? "", detail: drive.mimeType ?? "", url: drive.viewUrl ?? null }];
    }
    if (item.calendarResult) {
      const event = item.calendarResult;
      return [{ corpus: "calendar", rank, title: event.title ?? "", snippet: event.description ?? "", detail: event.start?.dateTime ?? event.start?.date ?? "", url: event.viewUrl ?? null }];
    }
    if (item.chatResult) {
      const messages = item.chatResult.messages ?? [];
      return [{ corpus: "chat", rank, title: messages[0]?.sender?.displayName ?? "", snippet: messages.map(m => m.plaintextBody ?? "").join(" … "), detail: messages[0]?.createTime ?? "", url: messages[0]?.viewUrl ?? null }];
    }
    return [];
  });
}

function errorText(result: unknown): string | null {
  const body = (result ?? {}) as { isError?: boolean; content?: Array<{ text?: string }> };
  if (!body.isError) return null;
  return (body.content ?? []).map(part => part.text ?? "").join(" ").slice(0, 400) || "the tool reported an error";
}

let nextId = 1;

/** One `search_corpus` call with the person's access token. Never throws: a refusal is a result to report. */
export async function searchCorpus(
  input: { accessToken: string; query: string; pageSize?: number; timeoutMs?: number },
  deps: { fetch?: typeof fetch } = {}
): Promise<WorkspaceSearch> {
  const fetcher = workspaceSearchFetch(deps.fetch ?? fetch);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 30_000);
  try {
    const response = await fetcher(WORKSPACE_MCP_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL_VERSION,
        authorization: `Bearer ${input.accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: nextId++,
        method: "tools/call",
        params: { name: SEARCH_TOOL, arguments: { query: input.query, ...(input.pageSize ? { pageSize: input.pageSize } : {}) } },
      }),
    });
    const text = await response.text();
    const latencyMs = Date.now() - started;
    let body: { result?: unknown; error?: { message?: string } } = {};
    try {
      body = JSON.parse(text.startsWith("event:") || text.startsWith("data:") ? text.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5)).join("") : text);
    } catch {
      return { query: input.query, ok: false, status: response.status, error: `unreadable reply (${response.headers.get("content-type") ?? "no content type"})`, latencyMs, hits: [] };
    }
    const refused = body.error?.message ?? errorText(body.result);
    if (!response.ok || refused) return { query: input.query, ok: false, status: response.status, error: refused ?? `HTTP ${response.status}`, latencyMs, hits: [] };
    return { query: input.query, ok: true, status: response.status, error: null, latencyMs, hits: hitsOf(body.result) };
  } catch (error) {
    const message = error instanceof Error ? (error.name === "AbortError" ? "timed out" : error.message) : String(error);
    return { query: input.query, ok: false, status: 0, error: message, latencyMs: Date.now() - started, hits: [] };
  } finally {
    clearTimeout(timer);
  }
}
