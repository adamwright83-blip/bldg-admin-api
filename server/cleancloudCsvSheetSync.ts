import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { google, type Auth } from "googleapis";
import { formatInTimeZone } from "date-fns-tz";
import {
  normalizeCleanCloudPaidOrderRow,
  parseCleanCloudPaidReportType,
  type CleanCloudPaidReportType,
} from "./cleancloudPaidOrders";
import { parseCsv } from "./externalSystems/csvIngestion";
import {
  colIndex0ToLetter,
  findDayColumn,
  findRowByLabel,
  getMonthlyTabName,
  parseNumericCell,
  resolveMonthlyTabName,
} from "./sheets";
import { classifyCleanCloudService, type LaundryFarmServiceClass } from "./laundryFarmSheetSync";

const OPERATOR_TIME_ZONE = "America/Los_Angeles";

export type CleanCloudCsvDailyTotal = {
  date: string;
  totalCents: number;
  orderCount: number;
  orderIds: string[];
  classifications: Record<LaundryFarmServiceClass, number>;
};

export type CleanCloudCsvSheetPlan = {
  sourceFileName: string;
  sourceReportType: CleanCloudPaidReportType;
  parsedRowCount: number;
  candidateRowCount: number;
  skippedRowCount: number;
  dailyTotals: CleanCloudCsvDailyTotal[];
};

function isCleanCloudClearentPaidCard(order: {
  paid?: boolean | null;
  paymentType?: string | null;
  cardPaymentType?: string | null;
}) {
  return Boolean(
    order.paid &&
      String(order.paymentType ?? "").toLowerCase() === "card" &&
      String(order.cardPaymentType ?? "").toLowerCase().includes("clearent")
  );
}

function candidateDate(row: { sourceReportType: CleanCloudPaidReportType; paymentDateUtc: Date | null; paidDateUtc: Date | null }) {
  const value = row.sourceReportType === "orders_sales" ? row.paymentDateUtc : row.paidDateUtc;
  return value ? formatInTimeZone(value, OPERATOR_TIME_ZONE, "yyyy-MM-dd") : null;
}

export function buildCleanCloudCsvSheetPlan(input: {
  csvText: string;
  sourceFileName: string;
  sourceReportType: CleanCloudPaidReportType;
}): CleanCloudCsvSheetPlan {
  const rows = parseCsv(input.csvText);
  const byDate = new Map<string, CleanCloudCsvDailyTotal>();
  let candidateRowCount = 0;
  let skippedRowCount = 0;

  for (const row of rows) {
    const result = normalizeCleanCloudPaidOrderRow(row, {
      sourceFileName: input.sourceFileName,
      sourceReportType: input.sourceReportType,
      importBatchId: 0,
      tenantId: "laundry_farm",
    });
    if (!result.normalized || !isCleanCloudClearentPaidCard(result.normalized)) {
      skippedRowCount += 1;
      continue;
    }

    const date = candidateDate(result.normalized);
    if (!date) {
      skippedRowCount += 1;
      continue;
    }

    candidateRowCount += 1;
    const classification = classifyCleanCloudService(result.normalized);
    const existing = byDate.get(date) ?? {
      date,
      totalCents: 0,
      orderCount: 0,
      orderIds: [],
      classifications: {
        laundry: 0,
        dry_cleaning: 0,
        mixed_needs_review: 0,
        unknown_needs_review: 0,
      },
    };

    existing.totalCents += result.normalized.totalCents;
    existing.orderCount += 1;
    existing.orderIds.push(result.normalized.cleancloudOrderId);
    existing.classifications[classification] += result.normalized.totalCents;
    byDate.set(date, existing);
  }

  return {
    sourceFileName: input.sourceFileName,
    sourceReportType: input.sourceReportType,
    parsedRowCount: rows.length,
    candidateRowCount,
    skippedRowCount,
    dailyTotals: Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function escapeSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

async function getSheetsAuth(): Promise<Auth.JWT> {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) {
    throw new Error("Missing GOOGLE_SHEETS_CLIENT_EMAIL or GOOGLE_SHEETS_PRIVATE_KEY");
  }
  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

export async function writeCleanCloudCsvPlanToSheet(input: {
  spreadsheetId: string;
  plan: CleanCloudCsvSheetPlan;
  dryRun?: boolean;
  rowLabel?: string;
}) {
  const rowLabel = input.rowLabel ?? "LF Laundry Rev";
  const auth = await getSheetsAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: input.spreadsheetId, auth });
  const titles = meta.data.sheets?.map((sheet) => sheet.properties?.title).filter(Boolean) as string[];

  const writes: Array<{
    date: string;
    tabName: string;
    cell: string;
    previousValue: number;
    nextValue: number;
    orderCount: number;
    orderIds: string[];
  }> = [];

  const grouped = new Map<string, CleanCloudCsvDailyTotal[]>();
  for (const total of input.plan.dailyTotals) {
    const monthKey = total.date.slice(0, 7);
    grouped.set(monthKey, [...(grouped.get(monthKey) ?? []), total]);
  }

  for (const [monthKey, totals] of grouped) {
    const [year, month] = monthKey.split("-").map(Number);
    const requestedTab = getMonthlyTabName(new Date(year, (month ?? 1) - 1, 1));
    const tabName = resolveMonthlyTabName(titles, requestedTab);
    if (!tabName) throw new Error(`Monthly tab "${requestedTab}" not found`);

    const gridRange = `${escapeSheetName(tabName)}!A1:ZZ100`;
    const got = await sheets.spreadsheets.values.get({
      spreadsheetId: input.spreadsheetId,
      range: gridRange,
      valueRenderOption: "UNFORMATTED_VALUE",
      auth,
    });
    const values = got.data.values ?? [];
    const row0 = findRowByLabel(values.map((row) => row?.[0]), rowLabel);
    if (row0 == null) throw new Error(`Row label "${rowLabel}" not found in ${tabName}`);

    const header = values[0] ?? [];
    for (const total of totals) {
      const col0 = findDayColumn(header, new Date(`${total.date}T00:00:00`));
      if (col0 == null) throw new Error(`No date column for ${total.date} in ${tabName}`);
      const previousValue = parseNumericCell(values[row0]?.[col0]);
      const nextValue = Number(formatCents(total.totalCents));
      writes.push({
        date: total.date,
        tabName,
        cell: `${colIndex0ToLetter(col0)}${row0 + 1}`,
        previousValue,
        nextValue,
        orderCount: total.orderCount,
        orderIds: total.orderIds,
      });
    }
  }

  if (!input.dryRun) {
    for (const write of writes) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: input.spreadsheetId,
        range: `${escapeSheetName(write.tabName)}!${write.cell}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[write.nextValue.toFixed(2)]] },
        auth,
      });
    }
  }

  return {
    dryRun: Boolean(input.dryRun),
    rowLabel,
    writes,
  };
}

export function buildCleanCloudCsvSheetPlanFromFile(input: {
  path: string;
  sourceReportType?: string | null;
}) {
  const csvText = readFileSync(input.path, "utf8");
  return buildCleanCloudCsvSheetPlan({
    csvText,
    sourceFileName: basename(input.path),
    sourceReportType: parseCleanCloudPaidReportType(input.sourceReportType ?? "orders_sales"),
  });
}
