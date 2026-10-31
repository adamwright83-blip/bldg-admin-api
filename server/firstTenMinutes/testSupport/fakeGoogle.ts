/**
 * A controlled Google for provider-contract tests: Gmail (search with Gmail's query operators, messages, threads),
 * Drive (list with Drive's query grammar, export), Sheets (spreadsheet metadata, values:batchGet with A1 ranges and
 * render options) and Calendar (events with free text), answering the shapes Google documents. Synthetic data only.
 *
 * Failures can be injected per API ("sheets": 403 SERVICE_DISABLED) or per item (one document 403), so tests can
 * prove that a failure becomes incomplete coverage rather than absence.
 */

export type FakeMessage = {
  id: string;
  threadId: string;
  at: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  sent?: boolean;
  listUnsubscribe?: boolean;
};

export type FakeFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  createdTime?: string;
  owners?: Array<{ displayName?: string; emailAddress: string }>;
  lastModifyingUser?: { displayName?: string; emailAddress: string };
  shared?: boolean;
  /** a Doc's text */
  text?: string;
  /** a Sheet's tabs: rows of cells; a cell starting "=" is a formula whose formatted value is `values[r][c]` */
  sheets?: Array<{ title: string; hidden?: boolean; rows: string[][]; formulas?: Record<string, string>; rowCount?: number }>;
};

export type FakeEvent = {
  id: string;
  summary: string;
  start: string;
  end?: string;
  description?: string;
  location?: string;
  attendees?: Array<{ email: string; displayName?: string; self?: boolean }>;
  organizer?: { email: string; displayName?: string; self?: boolean };
  recurringEventId?: string;
};

export type FakeGoogleData = {
  owner: string;
  messages: FakeMessage[];
  files: FakeFile[];
  events: FakeEvent[];
  /** whole APIs that answer with an error */
  fail?: Partial<Record<"gmail" | "drive" | "sheets" | "calendar", { status: number; reason: string }>>;
  /** single items (file ids, thread ids) that answer with an error */
  failItems?: Record<string, { status: number; reason: string }>;
};

export type FakeGoogle = { fetch: typeof fetch; calls: string[] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const error = (failure: { status: number; reason: string }) =>
  json({ error: { code: failure.status, status: "PERMISSION_DENIED", details: [{ reason: failure.reason }] } }, failure.status);

const lower = (value: string) => value.toLowerCase();
const address = (value: string) => (value.match(/<([^>]+)>/)?.[1] ?? value).trim().toLowerCase();

// ------------------------------------------------------------------ Gmail query language (the subset research uses)

function tokens(query: string): string[] {
  const out: string[] = [];
  const pattern = /-?\w+:"[^"]*"|-?\w+:\S+|"[^"]*"|\(|\)|\S+/g;
  for (const match of query.matchAll(pattern)) out.push(match[0]);
  return out;
}

function messageMatches(message: FakeMessage, query: string, owner: string, now: number): boolean {
  // top-level OR: any branch matches
  const branches = query.split(/\s+OR\s+/);
  if (branches.length > 1) return branches.some(branch => messageMatches(message, branch.replace(/^\(|\)$/g, ""), owner, now));
  const at = Date.parse(message.at);
  const text = lower(`${message.subject}\n${message.body}\n${message.from}\n${message.to.join(" ")}`);
  const sent = message.sent ?? address(message.from) === owner;
  for (const raw of tokens(query)) {
    if (raw === "(" || raw === ")") continue;
    const negate = raw.startsWith("-");
    const token = negate ? raw.slice(1) : raw;
    const [key, ...rest] = token.split(":");
    const value = rest.join(":").replace(/^"|"$/g, "");
    let ok: boolean;
    if (rest.length && key === "in") ok = value === "sent" ? sent : value === "chats" ? false : true;
    else if (rest.length && key === "category") ok = false;
    else if (rest.length && key === "from") ok = address(message.from).includes(lower(value)) || lower(message.from).includes(lower(value));
    else if (rest.length && key === "to") ok = [...message.to, ...(message.cc ?? [])].some(item => lower(item).includes(lower(value)));
    else if (rest.length && key === "after") ok = at > Number(value) * 1000;
    else if (rest.length && key === "before") ok = at < Number(value) * 1000;
    else if (rest.length && key === "newer_than") {
      const n = Number(value.slice(0, -1));
      const unit = value.slice(-1) === "y" ? 365 : value.slice(-1) === "m" ? 30 : 1;
      ok = at > now - n * unit * 86_400_000;
    } else if (rest.length && key === "subject") ok = lower(message.subject).includes(lower(value));
    else ok = text.includes(lower(token.replace(/^"|"$/g, "")));
    if (negate ? ok : !ok) return false;
  }
  return true;
}

function gmailPayload(message: FakeMessage, format: string) {
  const headers = [
    { name: "From", value: message.from },
    { name: "To", value: message.to.join(", ") },
    ...(message.cc?.length ? [{ name: "Cc", value: message.cc.join(", ") }] : []),
    { name: "Subject", value: message.subject },
    { name: "Date", value: new Date(message.at).toUTCString() },
    ...(message.listUnsubscribe ? [{ name: "List-Unsubscribe", value: "<mailto:x@example.com>" }] : []),
  ];
  return {
    id: message.id,
    threadId: message.threadId,
    internalDate: String(Date.parse(message.at)),
    labelIds: message.sent ? ["SENT"] : ["INBOX"],
    snippet: message.body.slice(0, 140),
    payload:
      format === "full"
        ? { mimeType: "text/plain", headers, body: { data: Buffer.from(message.body).toString("base64url"), size: message.body.length } }
        : { headers },
  };
}

// ------------------------------------------------------------------ Drive query language (the subset research uses)

function fileMatches(file: FakeFile, q: string): boolean {
  const content = lower(`${file.name}\n${file.text ?? ""}\n${(file.sheets ?? []).flatMap(sheet => [sheet.title, ...sheet.rows.flat()]).join(" ")}`);
  // split top-level "and"
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const word of q.split(/(\s+and\s+|\(|\))/)) {
    if (word === "(") depth += 1;
    if (word === ")") depth -= 1;
    if (/^\s+and\s+$/.test(word) && depth === 0) {
      parts.push(current);
      current = "";
    } else current += word;
  }
  parts.push(current);
  const literal = (text: string) => text.match(/'((?:\\.|[^'])*)'/)?.[1]?.replace(/\\(.)/g, "$1") ?? "";
  const clause = (text: string): boolean => {
    const trimmed = text.trim().replace(/^\(|\)$/g, "");
    if (/\s+or\s+/.test(trimmed)) return trimmed.split(/\s+or\s+/).some(clause);
    if (/^trashed\s*=\s*false$/.test(trimmed)) return true;
    if (trimmed.startsWith("fullText contains")) return content.includes(lower(literal(trimmed)));
    if (trimmed.startsWith("name contains")) return lower(file.name).includes(lower(literal(trimmed)));
    if (trimmed.startsWith("modifiedTime >")) return Date.parse(file.modifiedTime) > Date.parse(literal(trimmed));
    if (trimmed.startsWith("mimeType =")) return file.mimeType === literal(trimmed);
    return true;
  };
  return parts.every(clause);
}

function driveFile(file: FakeFile) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    createdTime: file.createdTime ?? file.modifiedTime,
    shared: file.shared ?? false,
    webViewLink: `https://docs.google.com/d/${file.id}`,
    owners: file.owners ?? [],
    lastModifyingUser: file.lastModifyingUser,
  };
}

// ------------------------------------------------------------------ Sheets A1 ranges

function columnNumber(letters: string): number {
  let n = 0;
  for (const letter of letters.toUpperCase()) n = n * 26 + (letter.charCodeAt(0) - 64);
  return n;
}

function parseRange(range: string): { tab: string; c1: number; r1: number; c2: number; r2: number } {
  const bang = range.lastIndexOf("!");
  const tab = range.slice(0, bang).replace(/^'|'$/g, "").replace(/''/g, "'");
  const [a, b] = range.slice(bang + 1).split(":");
  const cell = (ref: string) => {
    const match = ref.match(/^([A-Z]+)(\d+)$/i)!;
    return { c: columnNumber(match[1]), r: Number(match[2]) };
  };
  const start = cell(a);
  const end = cell(b ?? a);
  return { tab, c1: start.c, r1: start.r, c2: end.c, r2: end.r };
}

function csvOf(rows: string[][]): string {
  return rows.map(row => row.map(cell => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(",")).join("\n");
}

export function fakeGoogle(data: FakeGoogleData, options: { now?: Date } = {}): FakeGoogle {
  const calls: string[] = [];
  const now = (options.now ?? new Date()).getTime();
  const owner = data.owner.toLowerCase();
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    calls.push(`${url.host}${url.pathname}${url.search}`);
    const path = url.pathname;

    if (url.host === "gmail.googleapis.com") {
      if (data.fail?.gmail) return error(data.fail.gmail);
      if (path.endsWith("/profile")) return json({ emailAddress: data.owner });
      const thread = path.match(/\/threads\/([^/]+)$/);
      if (thread) {
        const id = decodeURIComponent(thread[1]);
        if (data.failItems?.[id]) return error(data.failItems[id]);
        const messages = data.messages.filter(message => message.threadId === id).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
        if (!messages.length) return json({ error: { code: 404 } }, 404);
        return json({ id, messages: messages.map(message => gmailPayload(message, url.searchParams.get("format") ?? "full")) });
      }
      const single = path.match(/\/messages\/([^/]+)$/);
      if (single) {
        const message = data.messages.find(item => item.id === decodeURIComponent(single[1]));
        return message ? json(gmailPayload(message, url.searchParams.get("format") ?? "full")) : json({ error: { code: 404 } }, 404);
      }
      if (path.endsWith("/messages")) {
        const q = url.searchParams.get("q") ?? "";
        const max = Number(url.searchParams.get("maxResults") ?? 100);
        const offset = Number(url.searchParams.get("pageToken") ?? 0);
        const matched = data.messages.filter(message => messageMatches(message, q, owner, now)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
        const page = matched.slice(offset, offset + max);
        return json({
          messages: page.map(message => ({ id: message.id, threadId: message.threadId })),
          resultSizeEstimate: matched.length,
          ...(offset + max < matched.length ? { nextPageToken: String(offset + max) } : {}),
        });
      }
    }

    if (url.host === "www.googleapis.com" && path.startsWith("/drive/v3/files")) {
      if (data.fail?.drive) return error(data.fail.drive);
      const exported = path.match(/\/files\/([^/]+)\/export$/);
      if (exported) {
        const id = decodeURIComponent(exported[1]);
        if (data.failItems?.[id]) return error(data.failItems[id]);
        const file = data.files.find(item => item.id === id);
        if (!file) return json({ error: { code: 404 } }, 404);
        const mime = url.searchParams.get("mimeType");
        if (mime === "text/csv" && file.sheets) return new Response(csvOf(file.sheets[0]?.rows ?? []), { status: 200 });
        return new Response(file.text ?? "", { status: 200 });
      }
      if (path === "/drive/v3/files") {
        const q = url.searchParams.get("q") ?? "";
        const size = Number(url.searchParams.get("pageSize") ?? 100);
        const matched = data.files.filter(file => fileMatches(file, q)).sort((a, b) => Date.parse(b.modifiedTime) - Date.parse(a.modifiedTime));
        return json({ files: matched.slice(0, size).map(driveFile), ...(matched.length > size ? { nextPageToken: "more" } : {}) });
      }
    }

    if (url.host === "sheets.googleapis.com") {
      if (data.fail?.sheets) return error(data.fail.sheets);
      const match = path.match(/\/v4\/spreadsheets\/([^/:]+)(\/values:batchGet)?$/);
      const file = match && data.files.find(item => item.id === decodeURIComponent(match[1]));
      if (!match || !file?.sheets) return json({ error: { code: 404 } }, 404);
      if (data.failItems?.[file.id]) return error(data.failItems[file.id]);
      if (!match[2]) {
        return json({
          properties: { title: file.name },
          sheets: file.sheets.map((sheet, index) => ({
            properties: {
              sheetId: index + 100,
              title: sheet.title,
              index,
              hidden: sheet.hidden ?? false,
              gridProperties: { rowCount: sheet.rowCount ?? Math.max(1000, sheet.rows.length), columnCount: 26 },
            },
          })),
        });
      }
      const formulas = url.searchParams.get("valueRenderOption") === "FORMULA";
      const valueRanges = url.searchParams.getAll("ranges").map(range => {
        const { tab, c1, r1, c2, r2 } = parseRange(range);
        const sheet = file.sheets!.find(item => item.title === tab);
        const values: string[][] = [];
        for (let r = r1; r <= Math.min(r2, sheet?.rows.length ?? 0); r += 1) {
          const row = (sheet!.rows[r - 1] ?? []).slice(c1 - 1, c2).map((cell, index) => {
            const ref = `${String.fromCharCode(64 + c1 + index)}${r}`;
            return formulas && sheet!.formulas?.[ref] ? sheet!.formulas[ref] : cell;
          });
          while (row.length && row[row.length - 1] === "") row.pop();
          values.push(row);
        }
        while (values.length && !values[values.length - 1].length) values.pop();
        return { range, majorDimension: "ROWS", values };
      });
      return json({ spreadsheetId: file.id, valueRanges });
    }

    if (url.host === "www.googleapis.com" && path.startsWith("/calendar/v3")) {
      if (data.fail?.calendar) return error(data.fail.calendar);
      const from = Date.parse(url.searchParams.get("timeMin") ?? "1970-01-01");
      const to = Date.parse(url.searchParams.get("timeMax") ?? "2100-01-01");
      const q = lower(url.searchParams.get("q") ?? "");
      const items = data.events
        .filter(event => Date.parse(event.start) >= from && Date.parse(event.start) < to)
        .filter(event => !q || lower(`${event.summary} ${event.description ?? ""} ${(event.attendees ?? []).map(a => `${a.email} ${a.displayName ?? ""}`).join(" ")}`).includes(q))
        .map(event => ({
          id: event.id,
          status: "confirmed",
          summary: event.summary,
          description: event.description,
          location: event.location,
          recurringEventId: event.recurringEventId,
          htmlLink: `https://calendar.google.com/event?eid=${event.id}`,
          start: { dateTime: event.start },
          end: event.end ? { dateTime: event.end } : undefined,
          attendees: event.attendees,
          organizer: event.organizer,
        }));
      return json({ items });
    }

    return json({ error: { code: 404, message: `fake google has no ${url.host}${path}` } }, 404);
  };
  return { fetch: fetcher as typeof fetch, calls };
}

/** Google access for a fake account: every product granted unless told otherwise. */
export function fakeAccess(owner: string, scopes?: string[]) {
  return {
    accessToken: "fake-access-token",
    refreshToken: null,
    accessExpiresAt: null,
    grantedScopes: scopes ?? [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
    ownerEmail: owner,
    onRefreshed: async () => undefined,
  };
}
