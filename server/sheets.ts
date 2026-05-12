import { format } from "date-fns";
import { google, type Auth } from "googleapis";

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

export function getMonthlyTabName(date: Date): string {
  const m = MONTH_ABBREV[date.getMonth()];
  const yy = String(date.getFullYear()).slice(-2);
  return `${m} ${yy}`;
}

export function normalizeMonthlyTabTitle(title: string): string {
  return title.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}

export function resolveMonthlyTabName(titles: string[], requestedTabName: string): string | null {
  const exact = titles.find((title) => title === requestedTabName);
  if (exact) return exact;
  const normalizedRequested = normalizeMonthlyTabTitle(requestedTabName);
  return titles.find((title) => normalizeMonthlyTabTitle(title) === normalizedRequested) ?? null;
}

export function parseSheetTargetDate(raw: string | null | undefined, fallback = new Date()): Date {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;

  const slashDate = trimmed.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})\b/);
  if (slashDate) {
    const month = Number(slashDate[1]);
    const day = Number(slashDate[2]);
    const rawYear = Number(slashDate[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(year, month - 1, day);
    }
  }

  const isoDate = trimmed.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]);
    const day = Number(isoDate[3]);
    return new Date(year, month - 1, day);
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

/** Google Sheets / Excel serial date → UTC calendar YYYY-MM-DD */
function serialToYYYYMMDD(serial: number): string {
  const epochMs = (serial - 25569) * 86400 * 1000;
  const d = new Date(epochMs);
  return format(d, "yyyy-MM-dd");
}

function normalizeCellToYYYYMMDD(value: unknown): string | null {
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

export function findDayColumn(rowValues: unknown[], targetDate: Date): number | null {
  const target = format(targetDate, "yyyy-MM-dd");
  if (!rowValues?.length) return null;
  for (let c = 0; c < rowValues.length; c++) {
    const normalized = normalizeCellToYYYYMMDD(rowValues[c]);
    if (normalized === target) return c;
  }
  return null;
}

export function findRowByLabel(columnAValues: unknown[], label: string): number | null {
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
  opts?: IncrementCellOptions,
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

  const cellValue = opts?.integerCell ? String(Math.round(next)) : next.toFixed(2);

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
        `[Sheets] ${opts.logLabel} updated: ${Math.round(previous)} → ${Math.round(next)}`,
      );
    } else {
      console.log(
        `[Sheets] ${opts.logLabel} updated: ${formatMoney(previous)} → ${formatMoney(next)}`,
      );
    }
  } else if (opts?.integerCell) {
    console.log(
      `[Sheets] Cell ${tabName}!${a1} updated: ${Math.round(previous)} → ${Math.round(next)}`,
    );
  } else {
    console.log(
      `[Sheets] Cell ${tabName}!${a1} updated: ${formatMoney(previous)} → ${formatMoney(next)}`,
    );
  }
}

export type OrderForSheet = {
  serviceType: "wash_fold" | "dry_cleaning";
};

export type WriteOrderToSheetResult =
  | { ok: true; tabName: string }
  | { ok: false; reason: string };

async function getSheetsContext(date: Date): Promise<
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
    console.warn("[Sheets] Skipped: GOOGLE_SHEETS_SPREADSHEET_ID not configured");
    return { error: "GOOGLE_SHEETS_SPREADSHEET_ID not configured" };
  }

  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim();
  const privateKeyRaw = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  const privateKey = privateKeyRaw?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) {
    console.warn(
      "[Sheets] Skipped: missing GOOGLE_SHEETS_CLIENT_EMAIL or GOOGLE_SHEETS_PRIVATE_KEY",
    );
    return { error: "Missing GOOGLE_SHEETS_CLIENT_EMAIL or GOOGLE_SHEETS_PRIVATE_KEY" };
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const tabName = getMonthlyTabName(date);

  const meta = await sheets.spreadsheets.get({ spreadsheetId, auth });
  const titles =
    meta.data.sheets?.map((s) => s.properties?.title).filter(Boolean) as string[];
  const resolvedTabName = resolveMonthlyTabName(titles, tabName);
  if (!resolvedTabName) {
    const availableTabs = titles.join(", ");
    console.warn(
      `[Sheets] Skipped: monthly tab "${tabName}" not found. Available tabs: ${availableTabs}`,
    );
    return { error: `Monthly tab "${tabName}" not found` };
  }

  const gridRange = `${escapeSheetName(resolvedTabName)}!A1:ZZ1000`;
  const grid = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: gridRange,
    auth,
  });
  const values = grid.data.values ?? [];
  if (values.length === 0) {
    console.warn(`[Sheets] Skipped: empty tab "${resolvedTabName}"`);
    return { error: `Empty tab "${resolvedTabName}"` };
  }

  const headerRow = values[0] ?? [];
  const dayCol0 = findDayColumn(headerRow, date);
  if (dayCol0 == null) {
    console.warn(`[Sheets] Skipped: no column found for ${format(date, "yyyy-MM-dd")}`);
    return { error: `No column found for ${format(date, "yyyy-MM-dd")}` };
  }

  return {
    auth,
    spreadsheetId,
    tabName: resolvedTabName,
    values,
    dayCol0,
    col1: dayCol0 + 1,
    colLetter: colIndex0ToLetter(dayCol0),
  };
}

export async function writeOrderToSheet(
  order: OrderForSheet,
  amountCents: number,
): Promise<WriteOrderToSheetResult> {
  const chargeDate = new Date();
  const context = await getSheetsContext(chargeDate);
  if ("error" in context) return { ok: false, reason: context.error };

  const { auth, spreadsheetId, tabName, values, col1, colLetter } = context;
  const columnA = values.map((row) => row?.[0]);
  const dollars = amountCents / 100;

  if (order.serviceType === "wash_fold") {
    const revRow0 = findRowByLabel(columnA, "LB Laundry Rev");
    if (revRow0 == null) {
      console.warn('[Sheets] Skipped: row label "LB Laundry Rev" not found');
      return { ok: false, reason: 'Row label "LB Laundry Rev" not found' };
    }
    const revRow1 = revRow0 + 1;

    console.log(
      `[Sheets] Writing wash_fold charge: ${formatMoney(dollars)} to ${tabName}, column ${colLetter}`,
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
      `[Sheets] Writing dry_cleaning charge: ${formatMoney(dollars)} to ${tabName}, column ${colLetter}`,
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
  input: WriteDriverExpenseInput,
): Promise<WriteOrderToSheetResult & { note?: string }> {
  const amountCents = Math.max(0, Math.round(input.amountCents));
  if (amountCents <= 0) {
    return { ok: false, reason: "Expense amount must be greater than zero" };
  }

  const targetDate = parseSheetTargetDate(input.receiptDate);
  const context = await getSheetsContext(targetDate);
  if ("error" in context) return { ok: false, reason: context.error };

  const { auth, spreadsheetId, tabName, values, col1, colLetter } = context;
  const columnA = values.map((row) => row?.[0]);
  const expensesRow0 = findRowByLabel(columnA, "Other Expenses");
  if (expensesRow0 == null) {
    console.warn('[Sheets] Skipped: row label "Other Expenses" not found');
    return { ok: false, reason: 'Row label "Other Expenses" not found' };
  }

  const dollars = amountCents / 100;
  console.log(
    `[Sheets] Writing driver expense: ${formatMoney(dollars)} to ${tabName}, column ${colLetter}`,
  );
  await incrementCell(auth, spreadsheetId, tabName, expensesRow0 + 1, col1, dollars, {
    logLabel: "Other Expenses",
  });

  const vendor = input.vendorName?.trim() || "Unknown vendor";
  const category = input.category?.trim().toUpperCase() || "EXPENSE";
  const note = `${category} - ${vendor} - ${formatMoney(dollars)}`;
  const noteRow0 = findRowByLabel(columnA, "Other Expense Spend");
  if (noteRow0 != null) {
    const sheets = google.sheets({ version: "v4", auth });
    const a1 = `${colLetter}${noteRow0 + 1}`;
    const range = `${escapeSheetName(tabName)}!${a1}`;
    const got = await sheets.spreadsheets.values.get({ spreadsheetId, range, auth });
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
    console.warn('[Sheets] Row label "Other Expense Spend" not found; numeric expense was still written');
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

  const targetDate = parseSheetTargetDate(input.receiptDate);
  const context = await getSheetsContext(targetDate);
  if ("error" in context) return { ok: false, reason: context.error };

  const { auth, spreadsheetId, tabName, values, col1, colLetter } = context;
  const columnA = values.map((row) => row?.[0]);
  const costRow0 = findRowByLabel(columnA, "LB Cost of Dry Cleaning");
  if (costRow0 == null) {
    console.warn('[Sheets] Skipped: row label "LB Cost of Dry Cleaning" not found');
    return { ok: false, reason: 'Row label "LB Cost of Dry Cleaning" not found' };
  }

  const dollars = costCents / 100;
  console.log(
    `[Sheets] Writing dry_cleaning partner cost: ${formatMoney(dollars)} to ${tabName}, column ${colLetter}`,
  );
  await incrementCell(auth, spreadsheetId, tabName, costRow0 + 1, col1, dollars, {
    logLabel: "LB Cost of Dry Cleaning",
  });

  return { ok: true, tabName };
}
