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

export async function writeOrderToSheet(
  order: OrderForSheet,
  amountCents: number,
): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    console.warn("[Sheets] Skipped: GOOGLE_SHEETS_SPREADSHEET_ID not configured");
    return;
  }

  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim();
  const privateKeyRaw = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  const privateKey = privateKeyRaw?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) {
    console.warn(
      "[Sheets] Skipped: missing GOOGLE_SHEETS_CLIENT_EMAIL or GOOGLE_SHEETS_PRIVATE_KEY",
    );
    return;
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const chargeDate = new Date();
  const tabName = getMonthlyTabName(chargeDate);

  const meta = await sheets.spreadsheets.get({ spreadsheetId, auth });
  const titles =
    meta.data.sheets?.map((s) => s.properties?.title).filter(Boolean) as string[];
  if (!titles.includes(tabName)) {
    console.warn(`[Sheets] Skipped: monthly tab "${tabName}" not found`);
    return;
  }

  const gridRange = `${escapeSheetName(tabName)}!A1:ZZ1000`;
  const grid = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: gridRange,
    auth,
  });
  const values = grid.data.values ?? [];
  if (values.length === 0) {
    console.warn(`[Sheets] Skipped: empty tab "${tabName}"`);
    return;
  }

  const headerRow = values[0] ?? [];
  const dayCol0 = findDayColumn(headerRow, chargeDate);
  if (dayCol0 == null) {
    console.warn(`[Sheets] Skipped: no column found for ${format(chargeDate, "yyyy-MM-dd")}`);
    return;
  }

  const columnA = values.map((row) => row?.[0]);
  const colLetter = colIndex0ToLetter(dayCol0);
  const dollars = amountCents / 100;

  if (order.serviceType === "wash_fold") {
    const revRow0 = findRowByLabel(columnA, "LB Laundry Rev");
    if (revRow0 == null) {
      console.warn('[Sheets] Skipped: row label "LB Laundry Rev" not found');
      return;
    }
    const revRow1 = revRow0 + 1;
    const col1 = dayCol0 + 1;

    console.log(
      `[Sheets] Writing wash_fold charge: ${formatMoney(dollars)} to ${tabName}, column ${colLetter}`,
    );

    await incrementCell(auth, spreadsheetId, tabName, revRow1, col1, dollars, {
      logLabel: "LB Laundry Rev",
    });

    const loadsRow0 = findRowByLabel(columnA, "Number of Loads");
    if (loadsRow0 == null) {
      console.warn('[Sheets] Skipped: row label "Number of Loads" not found');
      return;
    }
    await incrementCell(auth, spreadsheetId, tabName, loadsRow0 + 1, col1, 1, {
      integerCell: true,
      logLabel: "Number of Loads",
    });
    return;
  }

  if (order.serviceType === "dry_cleaning") {
    const revRow0 = findRowByLabel(columnA, "LB Dry Clean Rev");
    if (revRow0 == null) {
      console.warn('[Sheets] Skipped: row label "LB Dry Clean Rev" not found');
      return;
    }
    const revRow1 = revRow0 + 1;
    const col1 = dayCol0 + 1;

    console.log(
      `[Sheets] Writing dry_cleaning charge: ${formatMoney(dollars)} to ${tabName}, column ${colLetter}`,
    );

    await incrementCell(auth, spreadsheetId, tabName, revRow1, col1, dollars, {
      logLabel: "LB Dry Clean Rev",
    });
    return;
  }

  console.warn(`[Sheets] Skipped: unknown serviceType "${order.serviceType}"`);
}
