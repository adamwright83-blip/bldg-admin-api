import { format } from "date-fns";
import { google, type Auth, type sheets_v4 } from "googleapis";

const MONTH_ABBREV = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

const MONTH_FULL = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
] as const;

const MONTH_TEMPLATE_TAB_NAME = "_MONTH_TEMPLATE";
const REQUIRED_MONTH_TEMPLATE_ROWS = [
  "Other Expenses",
  "Other Expense Spend",
  "LB Cost of Dry Cleaning",
] as const;

type SheetsClient = ReturnType<typeof google.sheets>;

export function getMonthlyTabName(date: Date): string {
  const m = MONTH_ABBREV[date.getMonth()];
  const yy = String(date.getFullYear()).slice(-2);
  return `${m} ${yy}`;
}

export function getMonthlyTabAliases(date: Date): string[] {
  const month = date.getMonth();
  const yy = String(date.getFullYear()).slice(-2);
  return [`${MONTH_ABBREV[month]} ${yy}`, `${MONTH_FULL[month]} ${yy}`];
}

export function normalizeMonthlyTabTitle(title: string): string {
  return title
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function monthTokenToIndex(token: string): number | null {
  const normalized = token.toUpperCase();
  const shortIndex = MONTH_ABBREV.findIndex(m => m === normalized);
  if (shortIndex >= 0) return shortIndex;
  const fullIndex = MONTH_FULL.findIndex(m => m === normalized);
  if (fullIndex >= 0) return fullIndex;
  if (normalized === "SEPT") return 8;
  return null;
}

function parseMonthlyTabTitle(
  title: string
): { monthIndex: number; year: number } | null {
  const normalized = normalizeMonthlyTabTitle(title);
  const match = normalized.match(/^([A-Z]+)\s+(\d{2}|\d{4})$/);
  if (!match) return null;
  const monthIndex = monthTokenToIndex(match[1]!);
  if (monthIndex == null) return null;
  const rawYear = Number(match[2]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  return { monthIndex, year };
}

function monthlyTabAliasesForTitle(title: string): string[] | null {
  const parsed = parseMonthlyTabTitle(title);
  if (!parsed) return null;
  const date = new Date(parsed.year, parsed.monthIndex, 1);
  return getMonthlyTabAliases(date);
}

function resolveMonthlyTabInfo(
  titles: string[],
  requestedTabName: string
): { tabName: string; duplicateAliases: string[] } | null {
  const aliases = monthlyTabAliasesForTitle(requestedTabName);
  if (!aliases) {
    const exact = titles.find(title => title === requestedTabName);
    if (exact) return { tabName: exact, duplicateAliases: [] };
    const normalizedRequested = normalizeMonthlyTabTitle(requestedTabName);
    const normalized = titles.find(
      title => normalizeMonthlyTabTitle(title) === normalizedRequested
    );
    return normalized ? { tabName: normalized, duplicateAliases: [] } : null;
  }

  const normalizedAliases = aliases.map(normalizeMonthlyTabTitle);
  const matches = titles.filter(title =>
    normalizedAliases.includes(normalizeMonthlyTabTitle(title))
  );
  if (matches.length === 0) return null;

  const canonicalShort = normalizeMonthlyTabTitle(aliases[0]!);
  const canonicalMatch = matches.find(
    title => normalizeMonthlyTabTitle(title) === canonicalShort
  );
  return {
    tabName: canonicalMatch ?? matches[0]!,
    duplicateAliases: matches.length > 1 ? matches : [],
  };
}

export function resolveMonthlyTabName(
  titles: string[],
  requestedTabName: string
): string | null {
  return resolveMonthlyTabInfo(titles, requestedTabName)?.tabName ?? null;
}

function validLocalDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function parseSheetTargetDateCandidate(
  raw: string | null | undefined
): Date | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  const slashDate = trimmed.match(
    /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})\b/
  );
  if (slashDate) {
    const month = Number(slashDate[1]);
    const day = Number(slashDate[2]);
    const rawYear = Number(slashDate[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return validLocalDate(year, month, day);
    }
    return null;
  }

  const isoDate = trimmed.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]);
    const day = Number(isoDate[3]);
    return validLocalDate(year, month, day);
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseSheetTargetDate(
  raw: string | null | undefined,
  fallback = new Date()
): Date {
  return parseSheetTargetDateCandidate(raw) ?? fallback;
}

export function getLosAngelesBusinessDate(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return new Date(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day)
  );
}

export type SafeReceiptSheetDate = {
  date: Date;
  basis: "parsed_receipt_date" | "los_angeles_upload_date";
  parsedDate: Date | null;
  uploadDate: Date;
  reason: string | null;
};

export function isStaleDriverExpenseDate(
  date: Date,
  now = new Date()
): boolean {
  const oldestAllowed = new Date(
    now.getFullYear() - 1,
    now.getMonth(),
    now.getDate()
  );
  const newestAllowed = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 2
  );
  return date < oldestAllowed || date > newestAllowed;
}

export function resolveSafeReceiptSheetDate(
  receiptDate: string | null | undefined,
  now = new Date()
): SafeReceiptSheetDate {
  const uploadDate = getLosAngelesBusinessDate(now);
  const parsedDate = parseSheetTargetDateCandidate(receiptDate);
  if (!parsedDate) {
    return {
      date: uploadDate,
      basis: "los_angeles_upload_date",
      parsedDate: null,
      uploadDate,
      reason: receiptDate?.trim()
        ? "receipt_date_unreadable"
        : "receipt_date_missing",
    };
  }
  if (isStaleDriverExpenseDate(parsedDate, uploadDate)) {
    return {
      date: uploadDate,
      basis: "los_angeles_upload_date",
      parsedDate,
      uploadDate,
      reason: "receipt_date_stale_or_suspicious",
    };
  }
  return {
    date: parsedDate,
    basis: "parsed_receipt_date",
    parsedDate,
    uploadDate,
    reason: null,
  };
}

/** Google Sheets / Excel serial date → UTC calendar YYYY-MM-DD */
function serialToYYYYMMDD(serial: number): string {
  const epochMs = (serial - 25569) * 86400 * 1000;
  const d = new Date(epochMs);
  return format(d, "yyyy-MM-dd");
}

export function normalizeSheetCellToYYYYMMDD(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && !Number.isNaN(value)) {
    return serialToYYYYMMDD(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const iso = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1]!;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return format(parsed, "yyyy-MM-dd");
    }
    const n = Number(trimmed);
    if (!Number.isNaN(n) && trimmed !== "") {
      return serialToYYYYMMDD(n);
    }
  }
  return null;
}

export function findDayColumn(
  rowValues: unknown[],
  targetDate: Date
): number | null {
  const target = format(targetDate, "yyyy-MM-dd");
  if (!rowValues?.length) return null;
  for (let c = 0; c < rowValues.length; c++) {
    const normalized = normalizeSheetCellToYYYYMMDD(rowValues[c]);
    if (normalized === target) return c;
  }
  return null;
}

export function findRowByLabel(
  columnAValues: unknown[],
  label: string
): number | null {
  for (let r = 0; r < columnAValues.length; r++) {
    const cell = columnAValues[r];
    const s = cell == null ? "" : String(cell).trim();
    if (s === label) return r;
  }
  return null;
}

export function colIndex0ToLetter(col0: number): string {
  let n = col0 + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function escapeSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

type SheetSummary = { title: string; sheetId: number };

function getSheetSummaries(meta: sheets_v4.Schema$Spreadsheet): SheetSummary[] {
  return (
    meta.sheets
      ?.map(sheet => ({
        title: sheet.properties?.title ?? "",
        sheetId: sheet.properties?.sheetId,
      }))
      .filter(
        (sheet): sheet is SheetSummary =>
          Boolean(sheet.title) && typeof sheet.sheetId === "number"
      ) ?? []
  );
}

async function fetchSheetSummaries(
  sheets: SheetsClient,
  spreadsheetId: string,
  auth: Auth.JWT
): Promise<SheetSummary[]> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, auth });
  return getSheetSummaries(meta.data);
}

function getTemplateSheet(summaries: SheetSummary[]): SheetSummary | null {
  return (
    summaries.find(sheet => sheet.title === MONTH_TEMPLATE_TAB_NAME) ?? null
  );
}

async function fetchTabValues(
  sheets: SheetsClient,
  spreadsheetId: string,
  auth: Auth.JWT,
  tabName: string
): Promise<unknown[][]> {
  const gridRange = `${escapeSheetName(tabName)}!A1:ZZ1000`;
  const grid = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: gridRange,
    auth,
  });
  return grid.data.values ?? [];
}

function validateRequiredRows(
  values: unknown[][],
  tabName: string
): string | null {
  const columnA = values.map(row => row?.[0]);
  const missing = REQUIRED_MONTH_TEMPLATE_ROWS.filter(
    label => findRowByLabel(columnA, label) == null
  );
  if (missing.length === 0) return null;
  return `${tabName} is missing required row label${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`;
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function getMonthlyDateHeaderValues(date: Date): string[] {
  return Array.from({ length: daysInMonth(date) }, (_, i) =>
    format(new Date(date.getFullYear(), date.getMonth(), i + 1), "yyyy-MM-dd")
  );
}

function inferDateHeaderStartColumn(values: unknown[][]): number {
  const headerRow = values[0] ?? [];
  const firstDateCol = headerRow.findIndex(
    cell => normalizeSheetCellToYYYYMMDD(cell) != null
  );
  return firstDateCol >= 0 ? firstDateCol : 1;
}

async function fillMonthlyDateHeaders(
  sheets: SheetsClient,
  spreadsheetId: string,
  auth: Auth.JWT,
  tabName: string,
  date: Date,
  startCol0: number
): Promise<void> {
  const headers = getMonthlyDateHeaderValues(date);
  const paddedHeaders = [
    ...headers,
    ...Array(Math.max(0, 31 - headers.length)).fill(""),
  ];
  const startLetter = colIndex0ToLetter(startCol0);
  const endLetter = colIndex0ToLetter(startCol0 + paddedHeaders.length - 1);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${escapeSheetName(tabName)}!${startLetter}1:${endLetter}1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [paddedHeaders] },
    auth,
  });
}

async function deleteCopiedSheetBestEffort(
  sheets: SheetsClient,
  spreadsheetId: string,
  auth: Auth.JWT,
  sheetId: number | null
): Promise<void> {
  if (sheetId == null) return;
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      auth,
      requestBody: {
        requests: [{ deleteSheet: { sheetId } }],
      },
    });
  } catch (error) {
    console.warn(
      "[Sheets] Failed to clean up copied template sheet after race",
      {
        sheetId,
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }
}

async function createMonthlyTabFromTemplate(
  sheets: SheetsClient,
  spreadsheetId: string,
  auth: Auth.JWT,
  date: Date
): Promise<{ tabName: string } | { error: string }> {
  const targetTabName = getMonthlyTabName(date);
  const requestedAliases = getMonthlyTabAliases(date);

  const latestSummaries = await fetchSheetSummaries(
    sheets,
    spreadsheetId,
    auth
  );
  const existing = resolveMonthlyTabInfo(
    latestSummaries.map(sheet => sheet.title),
    targetTabName
  );
  if (existing) {
    return { tabName: existing.tabName };
  }

  const templateSheet = getTemplateSheet(latestSummaries);
  if (!templateSheet) {
    return {
      error: `${MONTH_TEMPLATE_TAB_NAME} tab not found. Create it before receipt Sheet automation can create ${requestedAliases.join(" / ")}.`,
    };
  }

  const templateValues = await fetchTabValues(
    sheets,
    spreadsheetId,
    auth,
    templateSheet.title
  );
  if (templateValues.length === 0) {
    return {
      error: `${MONTH_TEMPLATE_TAB_NAME} is empty; cannot create ${targetTabName}`,
    };
  }
  const templateRowError = validateRequiredRows(
    templateValues,
    MONTH_TEMPLATE_TAB_NAME
  );
  if (templateRowError) {
    return { error: templateRowError };
  }

  let copiedSheetId: number | null = null;
  try {
    const copied = await sheets.spreadsheets.sheets.copyTo({
      spreadsheetId,
      sheetId: templateSheet.sheetId,
      requestBody: { destinationSpreadsheetId: spreadsheetId },
      auth,
    });
    copiedSheetId = copied.data.sheetId ?? null;
    if (copiedSheetId == null) {
      return {
        error: `Google Sheets did not return a sheet ID while creating ${targetTabName}`,
      };
    }

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      auth,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: copiedSheetId,
                title: targetTabName,
                hidden: false,
              },
              fields: "title,hidden",
            },
          },
        ],
      },
    });

    await fillMonthlyDateHeaders(
      sheets,
      spreadsheetId,
      auth,
      targetTabName,
      date,
      inferDateHeaderStartColumn(templateValues)
    );
    return { tabName: targetTabName };
  } catch (error) {
    const refreshedSummaries = await fetchSheetSummaries(
      sheets,
      spreadsheetId,
      auth
    );
    const racedExisting = resolveMonthlyTabInfo(
      refreshedSummaries.map(sheet => sheet.title),
      targetTabName
    );
    if (racedExisting) {
      console.warn(
        "[Sheets] Monthly tab was created concurrently; using existing tab",
        {
          requested: targetTabName,
          resolved: racedExisting.tabName,
          aliases: requestedAliases,
        }
      );
      await deleteCopiedSheetBestEffort(
        sheets,
        spreadsheetId,
        auth,
        copiedSheetId
      );
      return { tabName: racedExisting.tabName };
    }

    return {
      error: `Could not create monthly tab "${targetTabName}" from ${MONTH_TEMPLATE_TAB_NAME}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

async function resolveOrCreateMonthlyTab(
  sheets: SheetsClient,
  spreadsheetId: string,
  auth: Auth.JWT,
  date: Date
): Promise<{ tabName: string } | { error: string }> {
  const tabName = getMonthlyTabName(date);
  const summaries = await fetchSheetSummaries(sheets, spreadsheetId, auth);
  const resolved = resolveMonthlyTabInfo(
    summaries.map(sheet => sheet.title),
    tabName
  );
  if (resolved) {
    if (resolved.duplicateAliases.length > 1) {
      console.warn(
        "[Sheets] Duplicate monthly tab aliases found; using canonical short tab when available",
        {
          requested: tabName,
          chosen: resolved.tabName,
          duplicates: resolved.duplicateAliases,
        }
      );
    }
    return { tabName: resolved.tabName };
  }
  return createMonthlyTabFromTemplate(sheets, spreadsheetId, auth, date);
}

/** Parse cell as number: blank → 0, number, or "$1,234.56" style */
export function parseNumericCell(raw: unknown): number {
  if (raw == null || raw === "") return 0;
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[$,\s]/g, "").trim();
    if (cleaned === "") return 0;
    const n = parseFloat(cleaned);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

export type IncrementCellOptions = {
  /** Write whole numbers without decimals (e.g. load count) */
  integerCell?: boolean;
  /** Extra log line e.g. LB Laundry Rev */
  logLabel?: string;
};

export async function incrementCell(
  auth: Auth.JWT,
  spreadsheetId: string,
  tabName: string,
  row1Based: number,
  col1Based: number,
  amount: number,
  opts?: IncrementCellOptions
): Promise<void> {
  const sheets = google.sheets({ version: "v4", auth });
  const colLet = colIndex0ToLetter(col1Based - 1);
  const a1 = `${colLet}${row1Based}`;
  const range = `${escapeSheetName(tabName)}!${a1}`;

  const got = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    auth,
  });
  const raw = got.data.values?.[0]?.[0];
  const previous = parseNumericCell(raw);
  const next = previous + amount;

  const cellValue = opts?.integerCell
    ? String(Math.round(next))
    : next.toFixed(2);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[cellValue]] },
    auth,
  });

  if (opts?.logLabel) {
    if (opts.integerCell) {
      console.log(
        `[Sheets] ${opts.logLabel} updated: ${Math.round(previous)} → ${Math.round(next)}`
      );
    } else {
      console.log(
        `[Sheets] ${opts.logLabel} updated: ${formatMoney(previous)} → ${formatMoney(next)}`
      );
    }
  } else if (opts?.integerCell) {
    console.log(
      `[Sheets] Cell ${tabName}!${a1} updated: ${Math.round(previous)} → ${Math.round(next)}`
    );
  } else {
    console.log(
      `[Sheets] Cell ${tabName}!${a1} updated: ${formatMoney(previous)} → ${formatMoney(next)}`
    );
  }
}

export type OrderForSheet = {
  serviceType: "wash_fold" | "dry_cleaning";
};

export type WriteOrderToSheetResult =
  | { ok: true; tabName: string }
  | { ok: false; reason: string };

export async function getSheetsContext(date: Date): Promise<
  | {
      auth: Auth.JWT;
      spreadsheetId: string;
      tabName: string;
      values: unknown[][];
      dayCol0: number;
      col1: number;
      colLetter: string;
    }
  | { error: string }
> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    console.warn(
      "[Sheets] Skipped: GOOGLE_SHEETS_SPREADSHEET_ID not configured"
    );
    return { error: "GOOGLE_SHEETS_SPREADSHEET_ID not configured" };
  }

  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim();
  const privateKeyRaw = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  const privateKey = privateKeyRaw?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) {
    console.warn(
      "[Sheets] Skipped: missing GOOGLE_SHEETS_CLIENT_EMAIL or GOOGLE_SHEETS_PRIVATE_KEY"
    );
    return {
      error: "Missing GOOGLE_SHEETS_CLIENT_EMAIL or GOOGLE_SHEETS_PRIVATE_KEY",
    };
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const resolved = await resolveOrCreateMonthlyTab(
    sheets,
    spreadsheetId,
    auth,
    date
  );
  if ("error" in resolved) {
    console.warn(`[Sheets] Skipped: ${resolved.error}`);
    return { error: resolved.error };
  }

  const values = await fetchTabValues(
    sheets,
    spreadsheetId,
    auth,
    resolved.tabName
  );
  if (values.length === 0) {
    console.warn(`[Sheets] Skipped: empty tab "${resolved.tabName}"`);
    return { error: `Empty tab "${resolved.tabName}"` };
  }

  let currentValues = values;
  let headerRow = currentValues[0] ?? [];
  let dayCol0 = findDayColumn(headerRow, date);
  if (dayCol0 == null) {
    await fillMonthlyDateHeaders(
      sheets,
      spreadsheetId,
      auth,
      resolved.tabName,
      date,
      inferDateHeaderStartColumn(currentValues)
    );
    currentValues = await fetchTabValues(
      sheets,
      spreadsheetId,
      auth,
      resolved.tabName
    );
    headerRow = currentValues[0] ?? [];
    dayCol0 = findDayColumn(headerRow, date);
  }

  if (dayCol0 == null) {
    console.warn(
      `[Sheets] Skipped: no column found for ${format(date, "yyyy-MM-dd")}`
    );
    return { error: `No column found for ${format(date, "yyyy-MM-dd")}` };
  }

  return {
    auth,
    spreadsheetId,
    tabName: resolved.tabName,
    values: currentValues,
    dayCol0,
    col1: dayCol0 + 1,
    colLetter: colIndex0ToLetter(dayCol0),
  };
}

export async function setSheetCellValue(
  auth: Auth.JWT,
  spreadsheetId: string,
  tabName: string,
  row1Based: number,
  col1Based: number,
  value: string | number
): Promise<void> {
  const sheets = google.sheets({ version: "v4", auth });
  const colLet = colIndex0ToLetter(col1Based - 1);
  const a1 = `${colLet}${row1Based}`;
  const range = `${escapeSheetName(tabName)}!${a1}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[value]] },
    auth,
  });
}

export async function writeOrderToSheet(
  order: OrderForSheet,
  amountCents: number
): Promise<WriteOrderToSheetResult> {
  const chargeDate = new Date();
  const context = await getSheetsContext(chargeDate);
  if ("error" in context) return { ok: false, reason: context.error };

  const { auth, spreadsheetId, tabName, values, col1, colLetter } = context;
  const columnA = values.map(row => row?.[0]);
  const dollars = amountCents / 100;

  if (order.serviceType === "wash_fold") {
    const revRow0 = findRowByLabel(columnA, "LB Laundry Rev");
    if (revRow0 == null) {
      console.warn('[Sheets] Skipped: row label "LB Laundry Rev" not found');
      return { ok: false, reason: 'Row label "LB Laundry Rev" not found' };
    }
    const revRow1 = revRow0 + 1;

    console.log(
      `[Sheets] Writing wash_fold charge: ${formatMoney(dollars)} to ${tabName}, column ${colLetter}`
    );

    await incrementCell(auth, spreadsheetId, tabName, revRow1, col1, dollars, {
      logLabel: "LB Laundry Rev",
    });

    const loadsRow0 = findRowByLabel(columnA, "Number of Loads");
    if (loadsRow0 == null) {
      console.warn('[Sheets] Skipped: row label "Number of Loads" not found');
      return { ok: false, reason: 'Row label "Number of Loads" not found' };
    }
    await incrementCell(auth, spreadsheetId, tabName, loadsRow0 + 1, col1, 1, {
      integerCell: true,
      logLabel: "Number of Loads",
    });
    return { ok: true, tabName };
  }

  if (order.serviceType === "dry_cleaning") {
    const revRow0 = findRowByLabel(columnA, "LB Dry Clean Rev");
    if (revRow0 == null) {
      console.warn('[Sheets] Skipped: row label "LB Dry Clean Rev" not found');
      return { ok: false, reason: 'Row label "LB Dry Clean Rev" not found' };
    }
    const revRow1 = revRow0 + 1;

    console.log(
      `[Sheets] Writing dry_cleaning charge: ${formatMoney(dollars)} to ${tabName}, column ${colLetter}`
    );

    await incrementCell(auth, spreadsheetId, tabName, revRow1, col1, dollars, {
      logLabel: "LB Dry Clean Rev",
    });
    return { ok: true, tabName };
  }

  console.warn(`[Sheets] Skipped: unknown serviceType "${order.serviceType}"`);
  return { ok: false, reason: `Unknown serviceType "${order.serviceType}"` };
}

export type WriteDriverExpenseInput = {
  amountCents: number;
  vendorName?: string | null;
  category?: string | null;
  receiptDate?: string | null;
  note?: string | null;
};

export async function writeDriverExpenseToSheet(
  input: WriteDriverExpenseInput
): Promise<WriteOrderToSheetResult & { note?: string }> {
  const amountCents = Math.max(0, Math.round(input.amountCents));
  if (amountCents <= 0) {
    return { ok: false, reason: "Expense amount must be greater than zero" };
  }

  const safeDate = resolveSafeReceiptSheetDate(input.receiptDate);
  if (safeDate.basis === "los_angeles_upload_date") {
    console.warn(
      "[Sheets] Driver expense receipt date unavailable; using upload date instead",
      {
        receiptDate: input.receiptDate,
        reason: safeDate.reason,
        parsedDate: safeDate.parsedDate
          ? format(safeDate.parsedDate, "yyyy-MM-dd")
          : null,
        uploadDate: format(safeDate.uploadDate, "yyyy-MM-dd"),
      }
    );
  }
  const context = await getSheetsContext(safeDate.date);
  if ("error" in context) return { ok: false, reason: context.error };

  const { auth, spreadsheetId, tabName, values, col1, colLetter } = context;
  const columnA = values.map(row => row?.[0]);
  const expensesRow0 = findRowByLabel(columnA, "Other Expenses");
  if (expensesRow0 == null) {
    console.warn('[Sheets] Skipped: row label "Other Expenses" not found');
    return { ok: false, reason: 'Row label "Other Expenses" not found' };
  }

  const dollars = amountCents / 100;
  console.log(
    `[Sheets] Writing driver expense: ${formatMoney(dollars)} to ${tabName}, column ${colLetter}`
  );
  await incrementCell(
    auth,
    spreadsheetId,
    tabName,
    expensesRow0 + 1,
    col1,
    dollars,
    {
      logLabel: "Other Expenses",
    }
  );

  const vendor = input.vendorName?.trim() || "Unknown vendor";
  const category = input.category?.trim().toUpperCase() || "EXPENSE";
  const note = `${category} - ${vendor} - ${formatMoney(dollars)}`;
  const noteRow0 = findRowByLabel(columnA, "Other Expense Spend");
  if (noteRow0 != null) {
    const sheets = google.sheets({ version: "v4", auth });
    const a1 = `${colLetter}${noteRow0 + 1}`;
    const range = `${escapeSheetName(tabName)}!${a1}`;
    const got = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      auth,
    });
    const previous = String(got.data.values?.[0]?.[0] ?? "").trim();
    const next = previous ? `${previous} | ${note}` : note;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[next]] },
      auth,
    });
    console.log(`[Sheets] Other Expense Spend note updated: ${note}`);
  } else {
    console.warn(
      '[Sheets] Row label "Other Expense Spend" not found; numeric expense was still written'
    );
  }

  return { ok: true, tabName, note };
}

export async function writeDryCleaningCostToSheet(input: {
  costCents: number;
  receiptDate?: string | null;
}): Promise<WriteOrderToSheetResult> {
  const costCents = Math.max(0, Math.round(input.costCents));
  if (costCents <= 0) {
    return { ok: false, reason: "Dry-cleaning cost must be greater than zero" };
  }

  const safeDate = resolveSafeReceiptSheetDate(input.receiptDate);
  if (safeDate.basis === "los_angeles_upload_date") {
    console.warn(
      "[Sheets] Dry-clean receipt date unavailable; using upload date instead",
      {
        receiptDate: input.receiptDate,
        reason: safeDate.reason,
        parsedDate: safeDate.parsedDate
          ? format(safeDate.parsedDate, "yyyy-MM-dd")
          : null,
        uploadDate: format(safeDate.uploadDate, "yyyy-MM-dd"),
      }
    );
  }
  const context = await getSheetsContext(safeDate.date);
  if ("error" in context) return { ok: false, reason: context.error };

  const { auth, spreadsheetId, tabName, values, col1, colLetter } = context;
  const columnA = values.map(row => row?.[0]);
  const costRow0 = findRowByLabel(columnA, "LB Cost of Dry Cleaning");
  if (costRow0 == null) {
    console.warn(
      '[Sheets] Skipped: row label "LB Cost of Dry Cleaning" not found'
    );
    return {
      ok: false,
      reason: 'Row label "LB Cost of Dry Cleaning" not found',
    };
  }

  const dollars = costCents / 100;
  console.log(
    `[Sheets] Writing dry_cleaning partner cost: ${formatMoney(dollars)} to ${tabName}, column ${colLetter}`
  );
  await incrementCell(
    auth,
    spreadsheetId,
    tabName,
    costRow0 + 1,
    col1,
    dollars,
    {
      logLabel: "LB Cost of Dry Cleaning",
    }
  );

  return { ok: true, tabName };
}
