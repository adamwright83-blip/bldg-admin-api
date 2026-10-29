import { GOOGLE_PRODUCT_SCOPES } from "../../../shared/firstTenMinutes";
import { refreshGoogleAccess } from "../google";
import { ProviderError, providerUrl, type FetchLike } from "../providerFetch";
import type { EventItem, FileItem, MailItem, Owner, ReadResult } from "./sources";
import { htmlToText, looksAutomated, parseAddressList, sameAddress, stripQuotedReply } from "./text";

/**
 * Read-only Gmail, Calendar and Drive for one connection. Tokens are refreshed when they near expiry and once more on
 * a 401. Nothing is written anywhere at Google. Errors never carry a token or a message body.
 */
export type GoogleAccess = {
  accessToken: string;
  refreshToken: string | null;
  accessExpiresAt: Date | null;
  grantedScopes: string[];
  ownerEmail: string;
  /** keeps a refreshed access token for the next reading */
  onRefreshed: (accessToken: string, expiresAt: Date) => Promise<void>;
};

type Deps = { fetch?: FetchLike; env?: NodeJS.ProcessEnv; now?: () => Date };

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const DRIVE = "https://www.googleapis.com/drive/v3/files";

export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function googleClient(access: GoogleAccess, deps: Deps = {}) {
  const fetcher = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  let token = access.accessToken;
  let expires = access.accessExpiresAt;

  async function refresh() {
    if (!access.refreshToken) throw new ProviderError("google", 401, "Google access expired and cannot be renewed");
    const renewed = await refreshGoogleAccess({ refreshToken: access.refreshToken }, { fetch: fetcher, env: deps.env });
    token = renewed.accessToken;
    expires = renewed.expiresAt;
    await access.onRefreshed(token, renewed.expiresAt);
  }

  async function request(url: string, as: "json" | "text"): Promise<unknown> {
    if (expires && expires.getTime() - now().getTime() < 60_000 && access.refreshToken) await refresh();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await fetcher(providerUrl(url, deps.env), {
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (response.status === 401 && attempt === 0 && access.refreshToken) {
          await refresh();
          continue;
        }
        if (!response.ok) throw new ProviderError("google", response.status, `Google answered ${response.status}`);
        return as === "json" ? await response.json() : await response.text();
      } finally {
        clearTimeout(timer);
      }
    }
    throw new ProviderError("google", 401, "Google refused the renewed access");
  }

  return {
    json: <T>(url: string) => request(url, "json") as Promise<T>,
    text: (url: string) => request(url, "text") as Promise<string>,
  };
}

// ------------------------------------------------------------------ Gmail

type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};
type GmailMessage = { id: string; threadId: string; internalDate?: string; payload?: GmailPart };

function decode(data: string | undefined): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

function walk(part: GmailPart | undefined, visit: (part: GmailPart) => void) {
  if (!part) return;
  visit(part);
  for (const child of part.parts ?? []) walk(child, visit);
}

export function parseGmailMessage(message: GmailMessage, ownerEmail: string, accountEmail: string): MailItem | null {
  const headers = new Map((message.payload?.headers ?? []).map(header => [header.name.toLowerCase(), header.value]));
  const from = parseAddressList(headers.get("from"))[0];
  if (!from) return null;
  let plain = "";
  let html = "";
  const attachments: MailItem["attachments"] = [];
  walk(message.payload, part => {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body.size ?? 0,
        attachmentId: part.body.attachmentId,
      });
      return;
    }
    if (part.mimeType === "text/plain" && !plain) plain = decode(part.body?.data);
    if (part.mimeType === "text/html" && !html) html = decode(part.body?.data);
  });
  const text = stripQuotedReply(plain || htmlToText(html));
  const at = message.internalDate ? new Date(Number(message.internalDate)) : new Date(headers.get("date") ?? Date.now());
  return {
    provider: "gmail",
    id: message.id,
    threadId: message.threadId,
    at,
    from,
    to: [...parseAddressList(headers.get("to")), ...parseAddressList(headers.get("cc"))],
    subject: headers.get("subject") ?? "",
    text,
    sentByOwner: sameAddress(from.email, ownerEmail),
    automated: looksAutomated({ from: from.email, listUnsubscribe: headers.has("list-unsubscribe") }),
    attachments,
    url: `https://mail.google.com/mail/u/${encodeURIComponent(accountEmail)}/#all/${message.threadId}`,
  };
}

async function listMessageIds(client: ReturnType<typeof googleClient>, query: string, limit: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < limit) {
    const params = new URLSearchParams({ q: query, maxResults: String(Math.min(100, limit - ids.length)) });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await client.json<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(`${GMAIL}/messages?${params}`);
    ids.push(...(page.messages ?? []).map(message => message.id));
    if (!page.nextPageToken || !page.messages?.length) break;
    pageToken = page.nextPageToken;
  }
  return ids.slice(0, limit);
}

export function gmailReader(access: GoogleAccess, deps: Deps = {}) {
  const client = googleClient(access, deps);
  const granted = access.grantedScopes.includes(GOOGLE_PRODUCT_SCOPES.gmail);

  async function read(query: string, limit: number): Promise<ReadResult<MailItem>> {
    if (!granted) return { items: [], unavailable: "Gmail wasn't shared." };
    const ids = await listMessageIds(client, query, limit);
    const messages = await mapLimit(ids, 8, async id => {
      try {
        const message = await client.json<GmailMessage>(`${GMAIL}/messages/${encodeURIComponent(id)}?format=full`);
        return parseGmailMessage(message, access.ownerEmail, access.ownerEmail);
      } catch (error) {
        if (error instanceof ProviderError && error.status === 404) return null;
        throw error;
      }
    });
    return {
      items: messages.filter((item): item is MailItem => Boolean(item)).sort((a, b) => a.at.getTime() - b.at.getTime()),
      unavailable: null,
    };
  }

  return {
    async owner(): Promise<Owner> {
      const profile = await client.json<{ emailAddress?: string }>(`${GMAIL}/profile`);
      return { name: null, email: profile.emailAddress ?? access.ownerEmail };
    },
    sentMail: (limit: number) => read("in:sent newer_than:1y", limit),
    receivedMail: (limit: number) =>
      read("newer_than:1y -in:sent -in:chats -category:promotions -category:social -category:updates -category:forums", limit),
    async attachment(messageId: string, attachmentId: string): Promise<Buffer> {
      const body = await client.json<{ data?: string }>(
        `${GMAIL}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`
      );
      return Buffer.from(body.data ?? "", "base64url");
    },
  };
}

// ------------------------------------------------------------------ Calendar

type CalendarEvent = {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  recurringEventId?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

export function calendarReader(access: GoogleAccess, deps: Deps = {}) {
  const client = googleClient(access, deps);
  return async function calendar(window: { from: Date; to: Date }): Promise<ReadResult<EventItem>> {
    if (!access.grantedScopes.includes(GOOGLE_PRODUCT_SCOPES.calendar)) return { items: [], unavailable: "Calendar wasn't shared." };
    const items: EventItem[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 4; page += 1) {
      const params = new URLSearchParams({
        timeMin: window.from.toISOString(),
        timeMax: window.to.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const body = await client.json<{ items?: CalendarEvent[]; nextPageToken?: string }>(`${CALENDAR}?${params}`);
      for (const event of body.items ?? []) {
        if (event.status === "cancelled") continue;
        const start = event.start?.dateTime ?? event.start?.date;
        if (!start) continue;
        const end = event.end?.dateTime ?? event.end?.date;
        items.push({
          provider: "calendar",
          id: event.id,
          at: new Date(start),
          // Google writes dateTime in the calendar's own offset ("2026-09-11T08:30:00-07:00"): its day is the person's day
          localDate: start.slice(0, 10),
          localTime: event.start?.dateTime ? start.slice(11, 16) : "00:00",
          end: end ? new Date(end) : null,
          title: event.summary?.trim() || "(untitled)",
          location: event.location?.trim() || null,
          seriesId: event.recurringEventId ?? null,
          url: event.htmlLink ?? null,
        });
      }
      if (!body.nextPageToken) break;
      pageToken = body.nextPageToken;
    }
    return { items, unavailable: null };
  };
}

// ------------------------------------------------------------------ Drive

type DriveFile = { id: string; name: string; mimeType: string; modifiedTime: string; md5Checksum?: string; webViewLink?: string };

const DOC_EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.presentation": "text/plain",
};

export function driveReader(access: GoogleAccess, deps: Deps = {}) {
  const client = googleClient(access, deps);
  return {
    async drive(limit: number, docLimit: number, since: Date): Promise<ReadResult<FileItem>> {
      if (!access.grantedScopes.includes(GOOGLE_PRODUCT_SCOPES.drive)) return { items: [], unavailable: "Drive wasn't shared." };
      const params = new URLSearchParams({
        q: `trashed = false and modifiedTime > '${since.toISOString()}'`,
        orderBy: "modifiedTime desc",
        pageSize: String(limit),
        fields: "files(id,name,mimeType,modifiedTime,md5Checksum,webViewLink)",
      });
      const body = await client.json<{ files?: DriveFile[] }>(`${DRIVE}?${params}`);
      const files = body.files ?? [];
      let docs = 0;
      const items = await mapLimit(files, 4, async (file): Promise<FileItem> => {
        let text: string | null = null;
        const exportAs = DOC_EXPORTS[file.mimeType];
        if (exportAs && docs < docLimit) {
          docs += 1;
          try {
            text = (await client.text(`${DRIVE}/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent(exportAs)}`)).slice(0, 6000);
          } catch {
            text = null;
          }
        }
        return {
          provider: "drive",
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          modifiedAt: new Date(file.modifiedTime),
          text,
          md5: file.md5Checksum ?? null,
          url: file.webViewLink ?? null,
        };
      });
      return { items, unavailable: null };
    },
    async media(fileId: string): Promise<Buffer> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await (deps.fetch ?? fetch)(providerUrl(`${DRIVE}/${encodeURIComponent(fileId)}?alt=media`, deps.env), {
          headers: { authorization: `Bearer ${access.accessToken}` },
          signal: controller.signal,
        });
        if (!response.ok) throw new ProviderError("google", response.status, `Google answered ${response.status}`);
        return Buffer.from(await response.arrayBuffer());
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
