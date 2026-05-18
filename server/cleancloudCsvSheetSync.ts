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
  laundryCents: number;
  dryCleanCents: number;
  reviewCents: number;
  orderCount: number;
  orderIds: string[];
  classifications: Record<LaundryFarmServiceClass, number>;
  reviewOrders: CleanCloudCsvReviewOrder[];
};

export type CleanCloudCsvReviewOrder = {
  cleancloudOrderId: string;
  customerName: string;
  amountCents: number;
  classification: Extract<LaundryFarmServiceClass, "mixed_needs_review" | "unknown_needs_review">;
  summaryText: string | null;
};

export type CleanCloudCsvSheetPlan = {
  sourceFileName: string;
  sourceReportType: CleanCloudPaidReportType;
  parsedRowCount: number;
  candidateRowCount: number;
  skippedRowCount: number;
  dailyTotals: CleanCloudCsvDailyTotal[];
};

export type CleanCloudCsvSheetWrite = {
  date: string;
  tabName: string;
  laundryCell: string;
  laundryPreviousValue: number;
  laundryNextValue: number;
  dryCleanCell: string;
  dryCleanPreviousValue: number;
  dryCleanNextValue: number;
  orderCount: number;
  orderIds: string[];
  reviewOrders: CleanCloudCsvReviewOrder[];
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
      laundryCents: 0,
      dryCleanCents: 0,
      reviewCents: 0,
      orderCount: 0,
      orderIds: [],
      classifications: {
        laundry: 0,
        dry_cleaning: 0,
        mixed_needs_review: 0,
        unknown_needs_review: 0,
      },
      reviewOrders: [],
    };

    existing.totalCents += result.normalized.totalCents;
    existing.orderCount += 1;
    existing.orderIds.push(result.normalized.cleancloudOrderId);
    existing.classifications[classification] += result.normalized.totalCents;
    if (classification === "laundry") existing.laundryCents += result.normalized.totalCents;
    else if (classification === "dry_cleaning") existing.dryCleanCents += result.normalized.totalCents;
    else {
      existing.reviewCents += result.normalized.totalCents;
      existing.reviewOrders.push({
        cleancloudOrderId: result.normalized.cleancloudOrderId,
        customerName: result.normalized.customerName,
        amountCents: result.normalized.totalCents,
        classification,
        summaryText: result.normalized.summaryText,
      });
    }
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

function reviewOrdersForPlan(plan: CleanCloudCsvSheetPlan): CleanCloudCsvReviewOrder[] {
  return plan.dailyTotals.flatMap((total) => total.reviewOrders);
}

export function assertCleanCloudCsvPlanWritable(plan: CleanCloudCsvSheetPlan, allowReviewRows = false) {
  const reviewOrders = reviewOrdersForPlan(plan);
  if (!allowReviewRows && reviewOrders.length) {
    const preview = reviewOrders
      .map((order) => `#${order.cleancloudOrderId} ${order.customerName} ${formatCents(order.amountCents)} ${order.classification}`)
      .join("; ");
    throw new Error(`CleanCloud CSV has unknown/mixed service rows; sheet write blocked until reviewed: ${preview}`);
  }
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
  laundryRowLabel?: string;
  dryCleanRowLabel?: string;
  allowReviewRows?: boolean;
}) {
  const laundryRowLabel = input.laundryRowLabel ?? "LF Laundry Rev";
  const dryCleanRowLabel = input.dryCleanRowLabel ?? "LF Dry Clean Rev";
  if (!input.dryRun) assertCleanCloudCsvPlanWritable(input.plan, input.allowReviewRows);
  const auth = await getSheetsAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: input.spreadsheetId, auth });
  const titles = meta.data.sheets?.map((sheet) => sheet.properties?.title).filter(Boolean) as string[];

  const writes: CleanCloudCsvSheetWrite[] = [];

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
    writes.push(
      ...buildCleanCloudCsvSheetWrites({
        tabName,
        values,
        dailyTotals: totals,
        laundryRowLabel,
        dryCleanRowLabel,
      })
    );
  }

  if (!input.dryRun) {
    for (const write of writes) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: input.spreadsheetId,
        range: `${escapeSheetName(write.tabName)}!${write.laundryCell}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[write.laundryNextValue.toFixed(2)]] },
        auth,
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: input.spreadsheetId,
        range: `${escapeSheetName(write.tabName)}!${write.dryCleanCell}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[write.dryCleanNextValue.toFixed(2)]] },
        auth,
      });
    }
  }

  return {
    dryRun: Boolean(input.dryRun),
    laundryRowLabel,
    dryCleanRowLabel,
    writes,
  };
}

export function buildCleanCloudCsvSheetWrites(input: {
  tabName: string;
  values: unknown[][];
  dailyTotals: CleanCloudCsvDailyTotal[];
  laundryRowLabel?: string;
  dryCleanRowLabel?: string;
}): CleanCloudCsvSheetWrite[] {
  const laundryRowLabel = input.laundryRowLabel ?? "LF Laundry Rev";
  const dryCleanRowLabel = input.dryCleanRowLabel ?? "LF Dry Clean Rev";
  const columnA = input.values.map((row) => row?.[0]);
  const laundryRow0 = findRowByLabel(columnA, laundryRowLabel);
  if (laundryRow0 == null) throw new Error(`Row label "${laundryRowLabel}" not found in ${input.tabName}`);
  const dryCleanRow0 = findRowByLabel(columnA, dryCleanRowLabel);
  if (dryCleanRow0 == null) throw new Error(`Row label "${dryCleanRowLabel}" not found in ${input.tabName}`);

  const header = input.values[0] ?? [];
  return input.dailyTotals.map((total) => {
    const col0 = findDayColumn(header, new Date(`${total.date}T00:00:00`));
    if (col0 == null) throw new Error(`No date column for ${total.date} in ${input.tabName}`);
    return {
      date: total.date,
      tabName: input.tabName,
      laundryCell: `${colIndex0ToLetter(col0)}${laundryRow0 + 1}`,
      laundryPreviousValue: parseNumericCell(input.values[laundryRow0]?.[col0]),
      laundryNextValue: Number(formatCents(total.laundryCents)),
      dryCleanCell: `${colIndex0ToLetter(col0)}${dryCleanRow0 + 1}`,
      dryCleanPreviousValue: parseNumericCell(input.values[dryCleanRow0]?.[col0]),
      dryCleanNextValue: Number(formatCents(total.dryCleanCents)),
      orderCount: total.orderCount,
      orderIds: total.orderIds,
      reviewOrders: total.reviewOrders,
    };
  });
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
