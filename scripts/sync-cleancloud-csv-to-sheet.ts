import dotenv from "dotenv";
import {
  buildCleanCloudCsvSheetPlanFromFile,
  writeCleanCloudCsvPlanToSheet,
} from "../server/cleancloudCsvSheetSync";

if (process.env.NODE_ENV !== "production") {
  dotenv.config();
  dotenv.config({ path: ".env.local", override: false });
}

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const ordersPath = argValue("orders") ?? argValue("csv");
const sourceReportType = argValue("sourceReportType") ?? "orders_sales";
const spreadsheetId =
  argValue("spreadsheet") ??
  argValue("spreadsheetId") ??
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID ??
  "";
const laundryRowLabel = argValue("laundryRowLabel") ?? "LF Laundry Rev";
const dryCleanRowLabel = argValue("dryCleanRowLabel") ?? "LF Dry Clean Rev";
const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--dryRun");
const allowReviewRows = process.argv.includes("--allow-review-rows") || process.argv.includes("--allowReviewRows");

if (!ordersPath) {
  console.error("Missing --orders=/path/to/CC-Orders.csv");
  process.exit(1);
}

const plan = buildCleanCloudCsvSheetPlanFromFile({
  path: ordersPath,
  sourceReportType,
});

const printablePlan = {
  ...plan,
  targetRows: {
    laundry: laundryRowLabel,
    dryCleaning: dryCleanRowLabel,
  },
  dailyTotals: plan.dailyTotals.map((day) => ({
    ...day,
    total: (day.totalCents / 100).toFixed(2),
    laundry: (day.laundryCents / 100).toFixed(2),
    dryCleaning: (day.dryCleanCents / 100).toFixed(2),
    review: (day.reviewCents / 100).toFixed(2),
    reviewOrders: day.reviewOrders.map((order) => ({
      ...order,
      amount: (order.amountCents / 100).toFixed(2),
    })),
    classifications: Object.fromEntries(
      Object.entries(day.classifications).map(([key, cents]) => [key, (cents / 100).toFixed(2)])
    ),
  })),
};

if (!spreadsheetId || (dryRun && (!process.env.GOOGLE_SHEETS_CLIENT_EMAIL || !process.env.GOOGLE_SHEETS_PRIVATE_KEY))) {
  console.log(JSON.stringify({
    dryRun: true,
    sheetWriteSkipped: !spreadsheetId ? "missing spreadsheet id" : "missing Google Sheets service-account credentials",
    plan: printablePlan,
  }, null, 2));
  process.exit(0);
}

const sheetResult = await writeCleanCloudCsvPlanToSheet({
  spreadsheetId,
  plan,
  dryRun,
  laundryRowLabel,
  dryCleanRowLabel,
  allowReviewRows,
});

console.log(JSON.stringify({ plan: printablePlan, sheet: sheetResult }, null, 2));
