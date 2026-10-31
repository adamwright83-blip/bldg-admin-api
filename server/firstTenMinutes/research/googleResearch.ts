import { GOOGLE_PRODUCT_SCOPES } from "../../../shared/firstTenMinutes";
import { ProviderError, type FetchLike } from "../providerFetch";
import { googleClient, mapLimit, parseGmailMessage, type GoogleAccess } from "../understanding/googleReaders";
import type { Mailbox } from "../understanding/sources";
import { clip, looksAutomated, parseAddressList, sameAddress } from "../understanding/text";
import { CoverageLedger, failureReason, type ResearchSource } from "./coverage";
import { REDACTED, redactSensitive, sensitiveDocumentReason, sensitiveHeader } from "./privacy";

/**
 * Targeted, bounded, read-only research over a person's Google account: the tools the investigator uses to ask its
 * own questions of Gmail, Drive (Docs and Sheets) and Calendar. Nothing here writes anything at Google.
 *
 * Every call:
 *  - is bounded (a result limit, a character limit, a range limit) and says when it was cut short;
 *  - records what it searched, over which window, and how it ended in the CoverageLedger, so a failure reads as
 *    incomplete coverage and never as "nothing happened";
 *  - redacts personal financial and identity numbers before returning text, and leaves out whole documents that are
 *    about the person's private finances or records (privacy.ts);
 *  - returns provider ids and passage / cell locators, so every piece of evidence can be found again.
 *
 * Sheets are read with Google's Sheets API under the already-granted drive.readonly scope (the Sheets API accepts it
 * for reads). If the Sheets API refuses (for example it isn't enabled in the OAuth client's Cloud project), the
 * spreadsheet's first tab is read through Drive's CSV export instead, and coverage says so.
 */

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const CALENDAR = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export const GOOGLE_DOC = "application/vnd.google-apps.document";
export const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
export const GOOGLE_SLIDES = "application/vnd.google-apps.presentation";

/** Hard ceilings, whatever a caller asks for. */
export const RESEARCH_LIMITS = {
  searchResults: 50,
  threadMessages: 25,
  messageChars: 4000,
  documentChars: 250_000,
  passageChars: 1400,
  passagesReturned: 16,
  sheetTabs: 8,
  sheetHeadRows: 30,
  sheetTailRows: 15,
  sheetColumns: 20,
  sheetScanRows: 5000,
  sheetFormulas: 20,
  calendarEvents: 250,
  driveResults: 50,
} as const;

export type MailHeader = {
  id: string;
  threadId: string;
  at: Date;
  from: Mailbox;
  to: Mailbox[];
  subject: string;
  /** Gmail's own short snippet, redacted */
  snippet: string;
  sentByOwner: boolean;
  automated: boolean;
  url: string;
};

export type MailMessage = MailHeader & {
  /** the sender's own words (quoted history removed), redacted and bounded */
  text: string;
  attachments: Array<{ filename: string; mimeType: string }>;
};

export type MailSearch = { query: string; items: MailHeader[]; estimate: number; truncated: boolean };

export type SentWindow = { from: Date; to: Date; estimate: number; items: MailHeader[]; truncated: boolean; failed: boolean };

export type DriveEntry = {
  id: string;
  name: string;
  mimeType: string;
  modifiedAt: Date;
  createdAt: Date | null;
  owners: Mailbox[];
  lastModifiedBy: Mailbox | null;
  shared: boolean;
  url: string | null;
};

export type DocumentPassage = { index: number; offset: number; text: string };

export type DocumentRead = {
  file: DriveEntry;
  totalChars: number;
  totalPassages: number;
  passages: DocumentPassage[];
  /** more of the document existed than was returned */
  truncated: boolean;
  /** why the document was left out entirely, when it was */
  excluded: string | null;
};

export type SheetRow = { row: number; cells: string[] };

export type SheetTab = {
  title: string;
  sheetId: number | null;
  /** the last row with anything in column A, when known */
  lastRow: number | null;
  headers: string[];
  rows: SheetRow[];
  formulas: Array<{ cell: string; formula: string }>;
  /** headings whose columns were not read (bank details, credentials) */
  droppedColumns: string[];
  truncated: boolean;
};

export type SpreadsheetRead = {
  file: DriveEntry;
  title: string;
  tabs: SheetTab[];
  /** every tab the spreadsheet has, read or not */
  tabTitles: string[];
  via: "sheets_api" | "drive_csv_export";
  excluded: string | null;
  note: string | null;
};

export type CalendarEntry = {
  id: string;
  at: Date;
  end: Date | null;
  title: string;
  location: string | null;
  /** redacted, bounded */
  description: string | null;
  attendees: Mailbox[];
  organizer: Mailbox | null;
  seriesId: string | null;
  url: string | null;
};

type Deps = { fetch?: FetchLike; env?: NodeJS.ProcessEnv; now?: () => Date; sleep?: (ms: number) => Promise<void> };

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** Retry rate limits, server errors and timeouts, with backoff; anything else (403, 404) answers at once. */
export async function withRetry<T>(fn: () => Promise<T>, sleep: (ms: number) => Promise<void>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      const retryable = (error instanceof ProviderError && RETRYABLE.has(error.status)) || (error instanceof Error && error.name === "AbortError");
      if (!retryable || attempt === attempts - 1) throw error;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw last;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const decodeEntities = (text: string) => text.replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, match => ENTITIES[match] ?? match);

/** A Gmail search term's date bound: whole seconds since the epoch. */
export const gmailAfter = (date: Date) => `after:${Math.floor(date.getTime() / 1000)}`;
export const gmailBefore = (date: Date) => `before:${Math.floor(date.getTime() / 1000)}`;

/** A Drive query string literal. */
export const driveLiteral = (value: string) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** A1 column letters for a 1-based column number. */
export function columnLetters(column: number): string {
  let n = column;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const quoteTab = (title: string) => `'${title.replace(/'/g, "''")}'`;

/** Split a document into passages on paragraph boundaries, each about `size` characters, with their offsets. */
export function passagesOf(text: string, size: number = RESEARCH_LIMITS.passageChars): DocumentPassage[] {
  const out: DocumentPassage[] = [];
  const paragraphs = text.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  let offset = 0;
  let current = "";
  let start = 0;
  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) out.push({ index: out.length, offset: start, text: trimmed });
    current = "";
  };
  for (const paragraph of paragraphs) {
    const at = text.indexOf(paragraph, offset);
    const position = at >= 0 ? at : offset;
    if (current && current.length + paragraph.length > size) flush();
    if (!current) start = position;
    // one paragraph longer than a passage is cut into pieces
    if (paragraph.length > size) {
      for (let i = 0; i < paragraph.length; i += size) {
        out.push({ index: out.length, offset: position + i, text: paragraph.slice(i, i + size).trim() });
      }
      start = position + paragraph.length;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
    offset = position + paragraph.length;
  }
  flush();
  return out.filter(passage => passage.text.length > 0).map((passage, index) => ({ ...passage, index }));
}

/** The passages most worth reading: those that mention a focus term (most mentions first), then the opening ones. */
export function selectPassages(passages: DocumentPassage[], focus: readonly string[], limit: number): DocumentPassage[] {
  const terms = focus.map(term => term.trim().toLowerCase()).filter(term => term.length >= 2);
  const scored = passages.map(passage => {
    const lower = passage.text.toLowerCase();
    return { passage, hits: terms.reduce((sum, term) => sum + (lower.split(term).length - 1), 0) };
  });
  const chosen = new Map<number, DocumentPassage>();
  for (const { passage } of scored.filter(item => item.hits > 0).sort((a, b) => b.hits - a.hits)) {
    if (chosen.size >= Math.max(1, limit - 2)) break;
    chosen.set(passage.index, passage);
  }
  for (const passage of passages) {
    if (chosen.size >= limit) break;
    chosen.set(passage.index, passage);
  }
  return [...chosen.values()].sort((a, b) => a.index - b.index);
}

type GmailMeta = {
  id: string;
  threadId: string;
  internalDate?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: { headers?: Array<{ name: string; value: string }> };
};

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  createdTime?: string;
  shared?: boolean;
  webViewLink?: string;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
  lastModifyingUser?: { displayName?: string; emailAddress?: string };
};

const DRIVE_FIELDS = "id,name,mimeType,modifiedTime,createdTime,shared,webViewLink,owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress)";

function driveEntry(file: DriveFile): DriveEntry {
  const box = (user?: { displayName?: string; emailAddress?: string }): Mailbox | null =>
    user?.emailAddress ? { name: user.displayName ?? null, email: user.emailAddress.toLowerCase() } : null;
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedAt: new Date(file.modifiedTime),
    createdAt: file.createdTime ? new Date(file.createdTime) : null,
    owners: (file.owners ?? []).map(box).filter((owner): owner is Mailbox => Boolean(owner)),
    lastModifiedBy: box(file.lastModifyingUser),
    shared: Boolean(file.shared),
    url: file.webViewLink ?? null,
  };
}

export type GoogleResearch = ReturnType<typeof googleResearch>;

export function googleResearch(access: GoogleAccess, ledger: CoverageLedger, deps: Deps = {}) {
  const client = googleClient(access, deps);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => new Date());
  const scopes = new Set(access.grantedScopes);
  const grants = {
    gmail: scopes.has(GOOGLE_PRODUCT_SCOPES.gmail),
    drive: scopes.has(GOOGLE_PRODUCT_SCOPES.drive),
    calendar: scopes.has(GOOGLE_PRODUCT_SCOPES.calendar),
  };
  const json = <T>(url: string) => withRetry(() => client.json<T>(url), sleep);
  const text = (url: string) => withRetry(() => client.text(url), sleep);
  const owner = access.ownerEmail;

  /** Run `fn`; record a failure as coverage and answer null rather than pretending there was nothing. */
  async function guarded<T>(source: ResearchSource, operation: string, target: string, window: { from: Date; to: Date } | null, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (error) {
      ledger.record({ source, operation, target, status: "failed", items: 0, reason: failureReason(error), window });
      return null;
    }
  }

  function notGranted(source: ResearchSource, operation: string, target: string) {
    ledger.record({ source, operation, target, status: "not_granted", items: 0 });
  }

  function header(meta: GmailMeta): MailHeader | null {
    const headers = new Map((meta.payload?.headers ?? []).map(item => [item.name.toLowerCase(), item.value]));
    const from = parseAddressList(headers.get("from"))[0];
    if (!from) return null;
    return {
      id: meta.id,
      threadId: meta.threadId,
      at: new Date(Number(meta.internalDate ?? 0)),
      from,
      to: [...parseAddressList(headers.get("to")), ...parseAddressList(headers.get("cc"))],
      subject: redactSensitive(headers.get("subject") ?? ""),
      snippet: redactSensitive(decodeEntities(meta.snippet ?? "")),
      sentByOwner: sameAddress(from.email, owner) || Boolean(meta.labelIds?.includes("SENT")),
      automated: looksAutomated({ from: from.email, listUnsubscribe: headers.has("list-unsubscribe") }),
      url: `https://mail.google.com/mail/u/${encodeURIComponent(owner)}/#all/${meta.threadId}`,
    };
  }

  const METADATA = "format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe";

  async function list(query: string, limit: number): Promise<{ ids: string[]; estimate: number; more: boolean }> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    let estimate = 0;
    let more = false;
    while (ids.length < limit) {
      const params = new URLSearchParams({ q: query, maxResults: String(Math.min(100, limit - ids.length)) });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await json<{ messages?: Array<{ id: string }>; nextPageToken?: string; resultSizeEstimate?: number }>(`${GMAIL}/messages?${params}`);
      estimate = Math.max(estimate, page.resultSizeEstimate ?? 0);
      ids.push(...(page.messages ?? []).map(message => message.id));
      more = Boolean(page.nextPageToken);
      if (!page.nextPageToken || !page.messages?.length) break;
      pageToken = page.nextPageToken;
    }
    return { ids: ids.slice(0, limit), estimate: Math.max(estimate, ids.length), more: more || ids.length > limit };
  }

  async function headers(ids: string[]): Promise<MailHeader[]> {
    const items = await mapLimit(ids, 8, async id => {
      try {
        return header(await json<GmailMeta>(`${GMAIL}/messages/${encodeURIComponent(id)}?${METADATA}`));
      } catch (error) {
        if (error instanceof ProviderError && error.status === 404) return null;
        throw error;
      }
    });
    return items.filter((item): item is MailHeader => Boolean(item)).sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  function fullMessage(message: Parameters<typeof parseGmailMessage>[0] & { snippet?: string; labelIds?: string[] }): MailMessage | null {
    const parsed = parseGmailMessage(message, owner, owner);
    if (!parsed) return null;
    return {
      id: parsed.id,
      threadId: parsed.threadId,
      at: parsed.at,
      from: parsed.from,
      to: parsed.to,
      subject: redactSensitive(parsed.subject),
      snippet: redactSensitive(decodeEntities(message.snippet ?? "")),
      sentByOwner: parsed.sentByOwner || Boolean(message.labelIds?.includes("SENT")),
      automated: parsed.automated,
      url: parsed.url ?? "",
      text: redactSensitive(clip(parsed.text, RESEARCH_LIMITS.messageChars)),
      attachments: parsed.attachments.map(item => ({ filename: item.filename, mimeType: item.mimeType })),
    };
  }

  const tools = {
    grants,

    // ---------------------------------------------------------------- Gmail

    /**
     * A Gmail search (Gmail's own query language), returning headers and Gmail's snippet, not bodies. `window`
     * bounds it in time and is recorded as the span this search covered.
     */
    async searchMail(query: string, options: { limit?: number; window?: { from: Date; to: Date } } = {}): Promise<MailSearch | null> {
      const window = options.window ?? null;
      const q = [query.trim(), window ? `${gmailAfter(window.from)} ${gmailBefore(window.to)}` : ""].filter(Boolean).join(" ");
      if (!grants.gmail) {
        notGranted("gmail", "search", q);
        return null;
      }
      const limit = Math.min(options.limit ?? 20, RESEARCH_LIMITS.searchResults);
      return guarded("gmail", "search", q, window, async () => {
        const found = await list(q, limit);
        const items = await headers(found.ids);
        ledger.record({ source: "gmail", operation: "search", target: q, status: found.more ? "partial" : items.length ? "ok" : "empty", items: items.length, window });
        return { query: q, items, estimate: found.estimate, truncated: found.more };
      });
    },

    /** How many messages match, by Gmail's estimate, without reading any. */
    async countMail(query: string, window?: { from: Date; to: Date }): Promise<number | null> {
      const q = [query.trim(), window ? `${gmailAfter(window.from)} ${gmailBefore(window.to)}` : ""].filter(Boolean).join(" ");
      if (!grants.gmail) {
        notGranted("gmail", "count", q);
        return null;
      }
      return guarded("gmail", "count", q, window ?? null, async () => {
        const page = await json<{ messages?: unknown[]; resultSizeEstimate?: number }>(`${GMAIL}/messages?${new URLSearchParams({ q, maxResults: "1" })}`);
        const count = page.resultSizeEstimate ?? page.messages?.length ?? 0;
        ledger.record({ source: "gmail", operation: "count", target: q, status: count ? "ok" : "empty", items: count, window: window ?? null });
        return count;
      });
    },

    /**
     * The person's own outgoing mail across a long history, a few messages from each month: what they have been
     * doing over time, without reading the whole mailbox. Each month is its own bounded search, so a gap reads as
     * "nothing sent then" only when that month's search succeeded.
     */
    async sentHistory(options: { months?: number; perWindow?: number } = {}): Promise<SentWindow[] | null> {
      if (!grants.gmail) {
        notGranted("gmail", "sent_window", "in:sent");
        return null;
      }
      const months = Math.min(options.months ?? 24, 36);
      const perWindow = Math.min(options.perWindow ?? 12, 25);
      const end = now();
      const windows: Array<{ from: Date; to: Date }> = [];
      for (let i = 0; i < months; i += 1) {
        const to = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i + 1, 1));
        const from = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
        windows.push({ from, to: i === 0 ? end : to });
      }
      return mapLimit(windows, 3, async window => {
        const q = `in:sent ${gmailAfter(window.from)} ${gmailBefore(window.to)}`;
        try {
          const found = await list(q, perWindow);
          const items = (await headers(found.ids)).filter(item => item.sentByOwner && !item.automated);
          ledger.record({ source: "gmail", operation: "sent_window", target: q, status: found.more ? "partial" : items.length ? "ok" : "empty", items: items.length, window });
          return { ...window, estimate: found.estimate, items, truncated: found.more, failed: false };
        } catch (error) {
          ledger.record({ source: "gmail", operation: "sent_window", target: q, status: "failed", items: 0, reason: failureReason(error), window });
          return { ...window, estimate: 0, items: [], truncated: false, failed: true };
        }
      });
    },

    /** One whole conversation, each message's own words (quoted history removed), bounded and redacted. */
    async readThread(threadId: string): Promise<MailMessage[] | null> {
      if (!grants.gmail) {
        notGranted("gmail", "read_thread", threadId);
        return null;
      }
      return guarded("gmail", "read_thread", threadId, null, async () => {
        const thread = await json<{ messages?: Array<Parameters<typeof fullMessage>[0]> }>(`${GMAIL}/threads/${encodeURIComponent(threadId)}?format=full`);
        const all = thread.messages ?? [];
        const messages = all.slice(-RESEARCH_LIMITS.threadMessages).map(fullMessage).filter((item): item is MailMessage => Boolean(item));
        ledger.record({ source: "gmail", operation: "read_thread", target: threadId, status: all.length > messages.length ? "partial" : "ok", items: messages.length });
        return messages;
      });
    },

    /** One message in full. */
    async readMessage(messageId: string): Promise<MailMessage | null> {
      if (!grants.gmail) {
        notGranted("gmail", "read_message", messageId);
        return null;
      }
      return guarded("gmail", "read_message", messageId, null, async () => {
        const message = fullMessage(await json<Parameters<typeof fullMessage>[0]>(`${GMAIL}/messages/${encodeURIComponent(messageId)}?format=full`));
        ledger.record({ source: "gmail", operation: "read_message", target: messageId, status: message ? "ok" : "empty", items: message ? 1 : 0 });
        return message;
      });
    },

    // ---------------------------------------------------------------- Drive

    /** Files whose name or contents mention any of `terms` (Drive's own full-text index), newest first. */
    async searchDrive(terms: readonly string[], options: { limit?: number; modifiedAfter?: Date; mimeTypes?: readonly string[] } = {}): Promise<DriveEntry[] | null> {
      const words = terms.map(term => term.trim()).filter(term => term.length >= 2).slice(0, 6);
      const clauses = ["trashed = false"];
      if (words.length) clauses.push(`(${words.map(term => `fullText contains ${driveLiteral(term)} or name contains ${driveLiteral(term)}`).join(" or ")})`);
      if (options.modifiedAfter) clauses.push(`modifiedTime > ${driveLiteral(options.modifiedAfter.toISOString())}`);
      if (options.mimeTypes?.length) clauses.push(`(${options.mimeTypes.map(type => `mimeType = ${driveLiteral(type)}`).join(" or ")})`);
      const q = clauses.join(" and ");
      if (!grants.drive) {
        notGranted("drive", "search", q);
        return null;
      }
      const window = options.modifiedAfter ? { from: options.modifiedAfter, to: now() } : null;
      return guarded("drive", "search", q, window, async () => {
        const limit = Math.min(options.limit ?? 20, RESEARCH_LIMITS.driveResults);
        const params = new URLSearchParams({ q, orderBy: "modifiedTime desc", pageSize: String(limit), fields: `nextPageToken,files(${DRIVE_FIELDS})` });
        const body = await json<{ files?: DriveFile[]; nextPageToken?: string }>(`${DRIVE}?${params}`);
        const files = (body.files ?? []).map(driveEntry);
        ledger.record({ source: "drive", operation: "search", target: q, status: body.nextPageToken ? "partial" : files.length ? "ok" : "empty", items: files.length, window });
        return files;
      });
    },

    /** The files changed most recently: a starting point, never proof that anything in them is active. */
    async recentFiles(options: { since: Date; limit?: number; mimeTypes?: readonly string[] }): Promise<DriveEntry[] | null> {
      return tools.searchDrive([], { modifiedAfter: options.since, limit: options.limit ?? 40, mimeTypes: options.mimeTypes });
    },

    /**
     * A Google Doc's (or Slides deck's) actual text, split into passages with their offsets. The whole document is
     * read (up to 250k characters); the passages returned are those that mention `focus`, then the opening ones.
     * A document about the person's private finances or records is left out entirely.
     */
    async readDocument(file: DriveEntry, options: { focus?: readonly string[]; maxPassages?: number } = {}): Promise<DocumentRead | null> {
      if (!grants.drive) {
        notGranted("docs", "read_document", file.id);
        return null;
      }
      const excludedByName = sensitiveDocumentReason(file.name);
      if (excludedByName) {
        ledger.record({ source: "docs", operation: "read_document", target: file.id, status: "excluded", items: 0, reason: excludedByName });
        return { file, totalChars: 0, totalPassages: 0, passages: [], truncated: false, excluded: excludedByName };
      }
      return guarded("docs", "read_document", file.id, null, async () => {
        const raw = await text(`${DRIVE}/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent("text/plain")}`);
        const excluded = sensitiveDocumentReason(file.name, raw);
        if (excluded) {
          ledger.record({ source: "docs", operation: "read_document", target: file.id, status: "excluded", items: 0, reason: excluded });
          return { file, totalChars: raw.length, totalPassages: 0, passages: [], truncated: false, excluded };
        }
        const body = raw.slice(0, RESEARCH_LIMITS.documentChars);
        const all = passagesOf(body);
        const limit = Math.min(options.maxPassages ?? 10, RESEARCH_LIMITS.passagesReturned);
        const passages = selectPassages(all, options.focus ?? [], limit).map(passage => ({ ...passage, text: redactSensitive(passage.text) }));
        const truncated = raw.length > body.length || passages.length < all.length;
        ledger.record({ source: "docs", operation: "read_document", target: file.id, status: truncated ? "partial" : passages.length ? "ok" : "empty", items: passages.length });
        return { file, totalChars: raw.length, totalPassages: all.length, passages, truncated, excluded: null };
      });
    },

    /**
     * A spreadsheet's contents: its tabs, each tab's headings, its first rows and its most recent rows (the last
     * populated rows in column A), and a few formulas. Bounded per tab; columns whose headings name bank details or
     * credentials are never read; a personal-finance spreadsheet is left out entirely.
     */
    async readSpreadsheet(file: DriveEntry, options: { tabs?: readonly string[] } = {}): Promise<SpreadsheetRead | null> {
      if (!grants.drive) {
        notGranted("sheets", "read_spreadsheet", file.id);
        return null;
      }
      const excludedByName = sensitiveDocumentReason(file.name);
      if (excludedByName) {
        ledger.record({ source: "sheets", operation: "read_spreadsheet", target: file.id, status: "excluded", items: 0, reason: excludedByName });
        return { file, title: file.name, tabs: [], tabTitles: [], via: "sheets_api", excluded: excludedByName, note: null };
      }
      try {
        return await readViaSheetsApi(file, options.tabs ?? []);
      } catch (error) {
        const reason = failureReason(error);
        if (error instanceof ProviderError && error.status === 404) {
          ledger.record({ source: "sheets", operation: "read_spreadsheet", target: file.id, status: "failed", items: 0, reason });
          return null;
        }
        // The Sheets API refused (not enabled for this OAuth client, or a transient failure): read the first tab
        // through Drive's CSV export, and say that only the first tab was read.
        try {
          const csv = await text(`${DRIVE}/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent("text/csv")}`);
          const { droppedColumnIndexes: _dropped, ...tab } = tabFromRows("(first tab)", null, parseCsv(csv), null);
          const excluded = sensitiveDocumentReason(file.name, [tab.headers.join(" "), ...tab.rows.slice(0, 10).map(row => row.cells.join(" "))].join("\n"));
          if (excluded) {
            ledger.record({ source: "sheets", operation: "read_spreadsheet", target: file.id, status: "excluded", items: 0, reason: excluded });
            return { file, title: file.name, tabs: [], tabTitles: [], via: "drive_csv_export", excluded, note: null };
          }
          ledger.record({ source: "sheets", operation: "read_spreadsheet", target: file.id, status: "partial", items: tab.rows.length, reason: `sheets_api ${reason}; first tab only via Drive export` });
          return { file, title: file.name, tabs: [tab], tabTitles: [], via: "drive_csv_export", excluded: null, note: "Only the first tab could be read." };
        } catch (fallback) {
          ledger.record({ source: "sheets", operation: "read_spreadsheet", target: file.id, status: "failed", items: 0, reason: `sheets_api ${reason}; drive_export ${failureReason(fallback)}` });
          return null;
        }
      }
    },

    // ---------------------------------------------------------------- Calendar

    /** Events in a window, optionally matching free text, with who attended and whether they repeat. */
    async searchCalendar(options: { from: Date; to: Date; query?: string; limit?: number }): Promise<CalendarEntry[] | null> {
      const target = options.query?.trim() || "(all events)";
      const window = { from: options.from, to: options.to };
      if (!grants.calendar) {
        notGranted("calendar", "search", target);
        return null;
      }
      return guarded("calendar", "search", target, window, async () => {
        const limit = Math.min(options.limit ?? 250, RESEARCH_LIMITS.calendarEvents);
        const params = new URLSearchParams({
          timeMin: options.from.toISOString(),
          timeMax: options.to.toISOString(),
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: String(limit),
        });
        if (options.query?.trim()) params.set("q", options.query.trim());
        type Event = {
          id: string;
          status?: string;
          summary?: string;
          description?: string;
          location?: string;
          recurringEventId?: string;
          htmlLink?: string;
          start?: { dateTime?: string; date?: string };
          end?: { dateTime?: string; date?: string };
          attendees?: Array<{ email?: string; displayName?: string; self?: boolean; resource?: boolean }>;
          organizer?: { email?: string; displayName?: string; self?: boolean };
        };
        const body = await json<{ items?: Event[]; nextPageToken?: string }>(`${CALENDAR}?${params}`);
        const items: CalendarEntry[] = [];
        for (const event of body.items ?? []) {
          const start = event.start?.dateTime ?? event.start?.date;
          if (event.status === "cancelled" || !start) continue;
          const end = event.end?.dateTime ?? event.end?.date;
          items.push({
            id: event.id,
            at: new Date(start),
            end: end ? new Date(end) : null,
            title: redactSensitive(event.summary?.trim() || "(untitled)"),
            location: event.location?.trim() || null,
            description: event.description ? redactSensitive(clip(event.description.replace(/<[^>]+>/g, " "), 300)) : null,
            attendees: (event.attendees ?? [])
              .filter(attendee => attendee.email && !attendee.self && !attendee.resource)
              .map(attendee => ({ name: attendee.displayName ?? null, email: attendee.email!.toLowerCase() })),
            organizer: event.organizer?.email && !event.organizer.self ? { name: event.organizer.displayName ?? null, email: event.organizer.email.toLowerCase() } : null,
            seriesId: event.recurringEventId ?? null,
            url: event.htmlLink ?? null,
          });
        }
        ledger.record({ source: "calendar", operation: "search", target, status: body.nextPageToken ? "partial" : items.length ? "ok" : "empty", items: items.length, window });
        return items;
      });
    },
  };
  return tools;

  // ---------------------------------------------------------------- Sheets internals

  async function readViaSheetsApi(file: DriveEntry, wanted: readonly string[]): Promise<SpreadsheetRead> {
    const fields = "properties(title),sheets(properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount)))";
    const meta = await json<{
      properties?: { title?: string };
      sheets?: Array<{ properties?: { sheetId?: number; title?: string; index?: number; hidden?: boolean; gridProperties?: { rowCount?: number; columnCount?: number } } }>;
    }>(`${SHEETS}/${encodeURIComponent(file.id)}?fields=${encodeURIComponent(fields)}`);
    const all = (meta.sheets ?? [])
      .map(sheet => sheet.properties ?? {})
      .filter(props => props.title)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const visible = all.filter(props => !props.hidden);
    const named = wanted.length ? visible.filter(props => wanted.some(name => name.toLowerCase() === props.title!.toLowerCase())) : [];
    const chosen = (named.length ? named : visible).slice(0, RESEARCH_LIMITS.sheetTabs);
    const lastColumn = columnLetters(RESEARCH_LIMITS.sheetColumns);

    // one request: every chosen tab's opening rows, and its column A (to find the last populated row)
    const first: string[] = [];
    for (const props of chosen) {
      const rows = Math.min(props.gridProperties?.rowCount ?? RESEARCH_LIMITS.sheetScanRows, RESEARCH_LIMITS.sheetScanRows);
      first.push(`${quoteTab(props.title!)}!A1:${lastColumn}${RESEARCH_LIMITS.sheetHeadRows}`, `${quoteTab(props.title!)}!A1:A${rows}`);
    }
    const batch = async (ranges: string[], render: "FORMATTED_VALUE" | "FORMULA") => {
      if (!ranges.length) return [] as string[][][];
      const params = new URLSearchParams({ valueRenderOption: render, majorDimension: "ROWS" });
      for (const range of ranges) params.append("ranges", range);
      const body = await json<{ valueRanges?: Array<{ values?: unknown[][] }> }>(`${SHEETS}/${encodeURIComponent(file.id)}/values:batchGet?${params}`);
      return (body.valueRanges ?? []).map(range => (range.values ?? []).map(row => row.map(cell => (cell === null || cell === undefined ? "" : String(cell)))));
    };
    const opening = await batch(first, "FORMATTED_VALUE");
    const lastRows = chosen.map((_, index) => {
      const columnA = opening[index * 2 + 1] ?? [];
      let last = 0;
      columnA.forEach((row, rowIndex) => {
        if ((row[0] ?? "").trim()) last = rowIndex + 1;
      });
      return last;
    });

    // a second request: each tab's most recent rows, where they lie past the opening rows; and the opening rows'
    // formulas, which say how the sheet works (a total, a lookup) without reading more values
    const tails: string[] = [];
    const tailOf: Array<number | null> = [];
    chosen.forEach((props, index) => {
      const last = lastRows[index];
      if (last > RESEARCH_LIMITS.sheetHeadRows) {
        const from = Math.max(RESEARCH_LIMITS.sheetHeadRows + 1, last - RESEARCH_LIMITS.sheetTailRows + 1);
        tailOf.push(tails.length);
        tails.push(`${quoteTab(props.title!)}!A${from}:${lastColumn}${last}`);
      } else {
        tailOf.push(null);
      }
    });
    const formulaRanges = chosen.map(props => `${quoteTab(props.title!)}!A1:${lastColumn}${RESEARCH_LIMITS.sheetHeadRows}`);
    const [tailValues, formulaValues] = await Promise.all([
      batch(tails, "FORMATTED_VALUE"),
      batch([...formulaRanges, ...tails], "FORMULA").catch(() => [] as string[][][]),
    ]);

    const tabs: SheetTab[] = [];
    for (const [index, props] of chosen.entries()) {
      const head = opening[index * 2] ?? [];
      const last = lastRows[index];
      const tailIndex = tailOf[index];
      const tailStart = tailIndex === null ? 0 : Math.max(RESEARCH_LIMITS.sheetHeadRows + 1, last - RESEARCH_LIMITS.sheetTailRows + 1);
      const rows: Array<{ row: number; cells: string[] }> = head.map((cells, rowIndex) => ({ row: rowIndex + 1, cells }));
      if (tailIndex !== null) (tailValues[tailIndex] ?? []).forEach((cells, rowIndex) => rows.push({ row: tailStart + rowIndex, cells }));
      const formulas: SheetTab["formulas"] = [];
      const collect = (rowsOf: string[][], firstRow: number) =>
        rowsOf.forEach((cells, rowIndex) =>
          cells.forEach((cell, columnIndex) => {
            if (cell.startsWith("=") && formulas.length < RESEARCH_LIMITS.sheetFormulas) formulas.push({ cell: `${columnLetters(columnIndex + 1)}${firstRow + rowIndex}`, formula: clip(cell, 160) });
          })
        );
      collect(formulaValues[index] ?? [], 1);
      if (tailIndex !== null) collect(formulaValues[formulaRanges.length + tailIndex] ?? [], tailStart);
      const tab = tabFromRows(props.title!, props.sheetId ?? null, rows, last || null);
      tab.formulas = formulas.filter(formula => !tab.droppedColumnIndexes.has(columnIndexOf(formula.cell)));
      tab.truncated = tab.truncated || (props.gridProperties?.columnCount ?? 0) > RESEARCH_LIMITS.sheetColumns || last > RESEARCH_LIMITS.sheetHeadRows + RESEARCH_LIMITS.sheetTailRows;
      const { droppedColumnIndexes: _dropped, ...rest } = tab;
      tabs.push(rest);
    }
    const sample = tabs.flatMap(tab => [tab.title, tab.headers.join(" "), ...tab.rows.slice(0, 8).map(row => row.cells.join(" "))]).join("\n");
    const excluded = sensitiveDocumentReason(file.name, sample);
    if (excluded) {
      ledger.record({ source: "sheets", operation: "read_spreadsheet", target: file.id, status: "excluded", items: 0, reason: excluded });
      return { file, title: meta.properties?.title ?? file.name, tabs: [], tabTitles: all.map(props => props.title!), via: "sheets_api", excluded, note: null };
    }
    const truncated = tabs.some(tab => tab.truncated) || chosen.length < visible.length;
    ledger.record({ source: "sheets", operation: "read_spreadsheet", target: file.id, status: truncated ? "partial" : "ok", items: tabs.reduce((sum, tab) => sum + tab.rows.length, 0) });
    return { file, title: meta.properties?.title ?? file.name, tabs, tabTitles: all.map(props => props.title!), via: "sheets_api", excluded: null, note: null };
  }
}

function columnIndexOf(cell: string): number {
  const letters = cell.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const letter of letters) n = n * 26 + (letter.charCodeAt(0) - 64);
  return n - 1;
}

/** A tab's headings (its first non-empty row), its rows with sensitive columns removed and every cell redacted. */
function tabFromRows(title: string, sheetId: number | null, rows: SheetRow[], lastRow: number | null): SheetTab & { droppedColumnIndexes: Set<number> } {
  const headerRow = rows.find(row => row.cells.some(cell => cell.trim()));
  const headers = (headerRow?.cells ?? []).slice(0, RESEARCH_LIMITS.sheetColumns).map(cell => clip(cell.trim(), 60));
  const dropped = new Set<number>();
  headers.forEach((heading, index) => {
    if (sensitiveHeader(heading)) dropped.add(index);
  });
  const keep = (cells: string[]) =>
    cells.slice(0, RESEARCH_LIMITS.sheetColumns).map((cell, index) => (dropped.has(index) ? REDACTED : redactSensitive(clip(cell, 120))));
  const limited = rows.filter(row => row.cells.some(cell => cell.trim())).slice(0, RESEARCH_LIMITS.sheetHeadRows + RESEARCH_LIMITS.sheetTailRows);
  return {
    title,
    sheetId,
    lastRow,
    headers: headers.map((heading, index) => (dropped.has(index) ? heading : redactSensitive(heading))),
    rows: limited.filter(row => row !== headerRow).map(row => ({ row: row.row, cells: keep(row.cells) })),
    formulas: [],
    droppedColumns: [...dropped].map(index => headers[index]),
    truncated: rows.length > limited.length,
    droppedColumnIndexes: dropped,
  };
}

/** A small RFC 4180 CSV reader: quoted fields, doubled quotes, CRLF. Bounded to the rows a tab read keeps. */
export function parseCsv(csv: string, maxRows = RESEARCH_LIMITS.sheetHeadRows + RESEARCH_LIMITS.sheetTailRows): SheetRow[] {
  const rows: SheetRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length && rows.length < maxRows; i += 1) {
    const char = csv[i];
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && csv[i + 1] === "\n") i += 1;
      cells.push(cell);
      rows.push({ row: rows.length + 1, cells });
      cells = [];
      cell = "";
    } else cell += char;
  }
  if ((cell || cells.length) && rows.length < maxRows) {
    cells.push(cell);
    rows.push({ row: rows.length + 1, cells });
  }
  return rows;
}
