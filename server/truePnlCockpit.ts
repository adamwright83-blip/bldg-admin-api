import { format } from "date-fns";
import { google, type Auth } from "googleapis";
import {
  getLosAngelesBusinessDate,
  getMonthlyTabName,
  normalizeSheetCellToYYYYMMDD,
  parseNumericCell,
  resolveMonthlyTabName,
} from "./sheets";

export type TruePnlCloudLevel =
  | "setup_needed"
  | "cliff"
  | "hover"
  | "cloud1"
  | "cloud2"
  | "cloud3";

export type TruePnlPeriod = "today" | "week" | "month";

export type TruePnlWarning = {
  severity: "info" | "warning" | "critical";
  code:
    | "missing_google_sheets_env"
    | "missing_month_tab"
    | "missing_date_columns"
    | "missing_core_revenue_rows"
    | "missing_optional_expense_rows"
    | "expenses_not_entered"
    | "previous_month_missing"
    | "sheet_read_failed";
  message: string;
  labels?: string[];
};

export type TruePnlLine = {
  key:
    | "grossRevenue"
    | "storeLabor"
    | "driverOperatorPay"
    | "gasFuel"
    | "vehicleInsurance"
    | "mileageVehicleExpenses"
    | "dryCleaningPartnerCost";
  label: string;
  amountCents: number;
  matchedLabels: string[];
  missing: boolean;
  core: boolean;
};

export type TruePnlSummary = {
  source: "google_sheets";
  period: TruePnlPeriod;
  month: string;
  monthLabel: string;
  periodLabel: string;
  tabName: string | null;
  generatedAt: string;
  trusted: boolean;
  grossRevenueCents: number;
  totalExpenseCents: number;
  trueNetCents: number;
  marginPct: number | null;
  expensePressurePct: number | null;
  cliffDistanceCents: number;
  cloudLevel: TruePnlCloudLevel;
  cloudLabel: string;
  fuel:
    | { status: "ready"; runwayDays: number; label: string }
    | { status: "setup_needed"; runwayDays: null; label: string };
  lines: TruePnlLine[];
  warnings: TruePnlWarning[];
  dateColumnCount: number;
  previousMonth: null | {
    month: string;
    monthLabel: string;
    tabName: string;
    grossRevenueCents: number;
    trueNetCents: number;
    marginPct: number | null;
    cloudLevel: TruePnlCloudLevel;
  };
};

type PnlLineConfig = {
  key: TruePnlLine["key"];
  label: string;
  aliases: string[];
  core: boolean;
};

export const TRUE_PNL_ROW_ALIASES: PnlLineConfig[] = [
  {
    key: "grossRevenue",
    label: "CleanCloud / gross revenue",
    core: true,
    aliases: [
      "LB Laundry Rev",
      "LB Dry Clean Rev",
      "LF Laundry Rev",
      "LF Dry Clean Rev",
      "CleanCloud Revenue",
      "Pickup & Delivery Revenue",
    ],
  },
  {
    key: "storeLabor",
    label: "Store labor",
    core: false,
    aliases: ["Store Labor", "Laundry Labor", "Processing Labor"],
  },
  {
    key: "driverOperatorPay",
    label: "Driver / operator pay",
    core: false,
    aliases: [
      "Driver Pay",
      "Operator Pay",
      "Driver / Operator Pay",
      "Driver Operator Pay",
    ],
  },
  {
    key: "gasFuel",
    label: "Gas / fuel",
    core: false,
    aliases: ["Gas", "Fuel", "Other Expenses"],
  },
  {
    key: "vehicleInsurance",
    label: "Vehicle insurance",
    core: false,
    aliases: ["Vehicle Insurance", "Car Insurance", "Auto Insurance"],
  },
  {
    key: "mileageVehicleExpenses",
    label: "Mileage / vehicle expenses",
    core: false,
    aliases: [
      "Mileage",
      "Vehicle Expenses",
      "Other Vehicle Cost",
      "Repairs",
      "Maintenance",
      "Vehicle Repairs",
      "Vehicle Maintenance",
    ],
  },
  {
    key: "dryCleaningPartnerCost",
    label: "Dry-cleaning partner cost",
    core: false,
    aliases: [
      "LB Cost of Dry Cleaning",
      "LF Cost of Dry Cleaning",
      "Dry Cleaning Partner Cost",
      "Dry-Cleaning Partner Cost",
      "Dry Clean Partner Cost",
    ],
  },
];

const CASH_RUNWAY_ALIASES = [
  "Cash Runway",
  "Runway Days",
  "Days of Operating Cash",
  "Operating Cash Days",
];

type SheetMonthData = {
  tabName: string;
  values: unknown[][];
};

type BuildInput = {
  monthDate: Date;
  current: SheetMonthData | null;
  previous?: SheetMonthData | null;
  period?: TruePnlPeriod;
  warnings?: TruePnlWarning[];
  generatedAt?: Date;
};

function normalizeRowLabel(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function centsFromSheetNumber(value: number): number {
  return Math.round(value * 100);
}

function monthKey(date: Date): string {
  return format(date, "yyyy-MM");
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function parseTruePnlMonth(raw?: string | null, now = new Date()): Date {
  const trimmed = raw?.trim();
  const match = trimmed?.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) return new Date(year, month - 1, 1);
  }
  const laDate = getLosAngelesBusinessDate(now);
  return new Date(laDate.getFullYear(), laDate.getMonth(), 1);
}

function previousMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() - 1, 1);
}

function monthDateColumns(values: unknown[][], monthDate: Date): number[] {
  const targetMonth = format(monthDate, "yyyy-MM");
  const header = values[0] ?? [];
  return header
    .map((cell, index) => ({ ymd: normalizeSheetCellToYYYYMMDD(cell), index }))
    .filter((cell): cell is { ymd: string; index: number } =>
      Boolean(cell.ymd?.startsWith(targetMonth))
    )
    .map(cell => cell.index);
}

function matchingRowIndexes(values: unknown[][], aliases: string[]): number[] {
  const normalizedAliases = new Set(aliases.map(normalizeRowLabel));
  const indexes: number[] = [];
  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const label = normalizeRowLabel(values[rowIndex]?.[0]);
    if (label && normalizedAliases.has(label)) indexes.push(rowIndex);
  }
  return indexes;
}

// Columns (within the month) where revenue was actually recorded — used to find
// the latest real day and to slice today/week without landing on empty future days.
function populatedColumns(values: unknown[][], dateColumns: number[]): number[] {
  const revenueAliases =
    TRUE_PNL_ROW_ALIASES.find(c => c.key === "grossRevenue")?.aliases ?? [];
  const revenueRows = matchingRowIndexes(values, revenueAliases);
  if (!revenueRows.length) return dateColumns;
  return dateColumns.filter(col =>
    revenueRows.some(rowIndex => parseNumericCell(values[rowIndex]?.[col]) !== 0)
  );
}

// Slice the populated columns into the current period + a like-for-like previous
// period (today vs yesterday, week vs last week). Month uses all columns and
// compares against the previous-month tab elsewhere.
function periodSlices(
  populated: number[],
  monthColumns: number[],
  period: TruePnlPeriod
): { current: number[]; previous: number[] } {
  if (period === "today") {
    const n = populated.length;
    return {
      current: n >= 1 ? [populated[n - 1]!] : [],
      previous: n >= 2 ? [populated[n - 2]!] : [],
    };
  }
  if (period === "week") {
    return {
      current: populated.slice(-7),
      previous: populated.slice(-14, -7),
    };
  }
  return { current: monthColumns, previous: [] };
}

function columnDateLabel(values: unknown[][], colIndex: number): string | null {
  const ymd = normalizeSheetCellToYYYYMMDD(values[0]?.[colIndex]);
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function sumRows(
  values: unknown[][],
  rowIndexes: number[],
  dateColumns: number[]
): number {
  let total = 0;
  for (const rowIndex of rowIndexes) {
    const row = values[rowIndex] ?? [];
    for (const colIndex of dateColumns) {
      total += parseNumericCell(row[colIndex]);
    }
  }
  return centsFromSheetNumber(total);
}

function latestRunwayDays(
  values: unknown[][],
  dateColumns: number[]
): number | null {
  const rowIndexes = matchingRowIndexes(values, CASH_RUNWAY_ALIASES);
  for (let i = dateColumns.length - 1; i >= 0; i -= 1) {
    const colIndex = dateColumns[i]!;
    for (const rowIndex of rowIndexes) {
      const days = parseNumericCell(values[rowIndex]?.[colIndex]);
      if (days > 0) return Math.round(days);
    }
  }
  return null;
}

export function resolveTruePnlCloudLevel(input: {
  grossRevenueCents: number;
  trueNetCents: number;
  trusted: boolean;
}): TruePnlCloudLevel {
  if (!input.trusted) return "setup_needed";
  const margin =
    input.grossRevenueCents > 0
      ? input.trueNetCents / input.grossRevenueCents
      : null;
  if (input.trueNetCents < 0) return "cliff";
  if (margin == null || margin < 0.05 || input.trueNetCents < 50_000)
    return "hover";
  if (input.trueNetCents >= 300_000 && margin >= 0.25) return "cloud3";
  if (input.trueNetCents >= 150_000 && margin >= 0.15) return "cloud2";
  return "cloud1";
}

function cloudLabel(level: TruePnlCloudLevel): string {
  switch (level) {
    case "setup_needed":
      return "Setup Needed";
    case "cliff":
      return "Cliff";
    case "hover":
      return "Hover";
    case "cloud1":
      return "Cloud 1";
    case "cloud2":
      return "Cloud 2";
    case "cloud3":
      return "Cloud 3";
  }
}

function buildMonthSnapshot(input: {
  monthDate: Date;
  sheet: SheetMonthData;
  columns?: number[];
  periodLabelOverride?: string;
}): Omit<
  TruePnlSummary,
  "source" | "generatedAt" | "fuel" | "previousMonth" | "period"
> & { fuelRunwayDays: number | null } {
  const warnings: TruePnlWarning[] = [];
  const dateColumns =
    input.columns ?? monthDateColumns(input.sheet.values, input.monthDate);
  if (!dateColumns.length) {
    warnings.push({
      severity: "critical",
      code: "missing_date_columns",
      message: `No date columns were found for ${monthLabel(input.monthDate)} in ${input.sheet.tabName}.`,
    });
  }

  const lines = TRUE_PNL_ROW_ALIASES.map(config => {
    const rows = matchingRowIndexes(input.sheet.values, config.aliases);
    const matchedLabels = rows.map(rowIndex =>
      String(input.sheet.values[rowIndex]?.[0] ?? "")
    );
    return {
      key: config.key,
      label: config.label,
      amountCents:
        rows.length && dateColumns.length
          ? sumRows(input.sheet.values, rows, dateColumns)
          : 0,
      matchedLabels,
      missing: rows.length === 0,
      core: config.core,
    };
  });

  const revenueLine = lines.find(line => line.key === "grossRevenue")!;
  if (revenueLine.missing) {
    warnings.push({
      severity: "critical",
      code: "missing_core_revenue_rows",
      message:
        "Core revenue rows are missing, so this True P&L cannot be trusted yet.",
      labels: TRUE_PNL_ROW_ALIASES.find(line => line.key === "grossRevenue")
        ?.aliases,
    });
  }

  const missingExpenseLines = lines.filter(line => !line.core && line.missing);
  if (missingExpenseLines.length) {
    warnings.push({
      severity: "warning",
      code: "missing_optional_expense_rows",
      message: "Some optional expense rows are missing and are counted as $0.",
      labels: missingExpenseLines.map(line => line.label),
    });
  }

  const grossRevenueCents = revenueLine.amountCents;
  const totalExpenseCents = lines
    .filter(line => !line.core)
    .reduce((sum, line) => sum + line.amountCents, 0);

  // Honesty guard: revenue recorded but zero expenses → margin is overstated
  // (expenses not entered for this period). Don't present a fake 100%-margin win.
  if (grossRevenueCents > 0 && totalExpenseCents === 0) {
    warnings.push({
      severity: "warning",
      code: "expenses_not_entered",
      message:
        "Revenue is recorded but no expenses were entered for this period, so profit is overstated.",
    });
  }
  const trueNetCents = grossRevenueCents - totalExpenseCents;
  const marginPct =
    grossRevenueCents > 0 ? (trueNetCents / grossRevenueCents) * 100 : null;
  const expensePressurePct =
    grossRevenueCents > 0
      ? (totalExpenseCents / grossRevenueCents) * 100
      : null;
  const trusted =
    !revenueLine.missing && dateColumns.length > 0 && grossRevenueCents > 0;
  const cloudLevel = resolveTruePnlCloudLevel({
    grossRevenueCents,
    trueNetCents,
    trusted,
  });

  return {
    month: monthKey(input.monthDate),
    monthLabel: monthLabel(input.monthDate),
    periodLabel: input.periodLabelOverride ?? monthLabel(input.monthDate),
    tabName: input.sheet.tabName,
    trusted,
    grossRevenueCents,
    totalExpenseCents,
    trueNetCents,
    marginPct,
    expensePressurePct,
    cliffDistanceCents: Math.max(0, trueNetCents),
    cloudLevel,
    cloudLabel: cloudLabel(cloudLevel),
    lines,
    warnings,
    dateColumnCount: dateColumns.length,
    fuelRunwayDays: latestRunwayDays(input.sheet.values, dateColumns),
  };
}

export function buildTruePnlCockpitSummary(input: BuildInput): TruePnlSummary {
  const generatedAt = input.generatedAt ?? new Date();
  const baseWarnings = [...(input.warnings ?? [])];

  if (!input.current) {
    return {
      source: "google_sheets",
      period: input.period ?? "month",
      month: monthKey(input.monthDate),
      monthLabel: monthLabel(input.monthDate),
      periodLabel: monthLabel(input.monthDate),
      tabName: null,
      generatedAt: generatedAt.toISOString(),
      trusted: false,
      grossRevenueCents: 0,
      totalExpenseCents: 0,
      trueNetCents: 0,
      marginPct: null,
      expensePressurePct: null,
      cliffDistanceCents: 0,
      cloudLevel: "setup_needed",
      cloudLabel: "Setup Needed",
      fuel: {
        status: "setup_needed",
        runwayDays: null,
        label: "Add cash runway rows to enable fuel.",
      },
      lines: TRUE_PNL_ROW_ALIASES.map(config => ({
        key: config.key,
        label: config.label,
        amountCents: 0,
        matchedLabels: [],
        missing: true,
        core: config.core,
      })),
      warnings: baseWarnings,
      dateColumnCount: 0,
      previousMonth: null,
    };
  }

  const period = input.period ?? "month";
  const monthColumns = monthDateColumns(input.current.values, input.monthDate);
  const populated =
    period === "month"
      ? monthColumns
      : populatedColumns(input.current.values, monthColumns);
  const slices = periodSlices(populated, monthColumns, period);
  const currentColumns = slices.current.length ? slices.current : monthColumns;

  const currentLabel =
    period === "today"
      ? (columnDateLabel(input.current.values, currentColumns[currentColumns.length - 1]!) ??
        "Today")
      : period === "week"
        ? "This Week"
        : undefined;

  const current = buildMonthSnapshot({
    monthDate: input.monthDate,
    sheet: input.current,
    columns: currentColumns,
    periodLabelOverride: currentLabel,
  });

  // Like-for-like previous: today→yesterday, week→last week (same sheet);
  // month→previous-month tab.
  const previous =
    period === "month"
      ? input.previous
        ? buildMonthSnapshot({
            monthDate: previousMonth(input.monthDate),
            sheet: input.previous,
          })
        : null
      : slices.previous.length
        ? buildMonthSnapshot({
            monthDate: input.monthDate,
            sheet: input.current,
            columns: slices.previous,
            periodLabelOverride:
              period === "today" ? "Yesterday" : "Last Week",
          })
        : null;

  return {
    source: "google_sheets",
    period,
    generatedAt: generatedAt.toISOString(),
    ...current,
    warnings: [...baseWarnings, ...current.warnings],
    fuel:
      current.fuelRunwayDays == null
        ? {
            status: "setup_needed",
            runwayDays: null,
            label: "Cash runway setup needed",
          }
        : {
            status: "ready",
            runwayDays: current.fuelRunwayDays,
            label: `${current.fuelRunwayDays} days of operating cash`,
          },
    previousMonth: previous
      ? {
          month: previous.month,
          monthLabel: previous.periodLabel,
          tabName: previous.tabName!,
          grossRevenueCents: previous.grossRevenueCents,
          trueNetCents: previous.trueNetCents,
          marginPct: previous.marginPct,
          cloudLevel: previous.cloudLevel,
        }
      : null,
  };
}

function sheetsAuth():
  | { auth: Auth.JWT; spreadsheetId: string }
  | { error: TruePnlWarning } {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n"
  );
  if (!spreadsheetId || !clientEmail || !privateKey) {
    return {
      error: {
        severity: "critical",
        code: "missing_google_sheets_env",
        message:
          "Google Sheets credentials are missing, so the True P&L Cockpit cannot read finance data.",
      },
    };
  }
  return {
    spreadsheetId,
    auth: new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    }),
  };
}

async function loadMonthSheet(input: {
  sheets: ReturnType<typeof google.sheets>;
  spreadsheetId: string;
  auth: Auth.JWT;
  monthDate: Date;
}): Promise<SheetMonthData | null> {
  const meta = await input.sheets.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    auth: input.auth,
  });
  const titles = meta.data.sheets
    ?.map(sheet => sheet.properties?.title)
    .filter(Boolean) as string[];
  const requestedTabName = getMonthlyTabName(input.monthDate);
  const tabName = resolveMonthlyTabName(titles, requestedTabName);
  if (!tabName) return null;

  const safeTab = `'${tabName.replace(/'/g, "''")}'`;
  const grid = await input.sheets.spreadsheets.values.get({
    spreadsheetId: input.spreadsheetId,
    auth: input.auth,
    range: `${safeTab}!A1:ZZ1000`,
  });
  return { tabName, values: grid.data.values ?? [] };
}

export async function getTruePnlCockpitSummary(
  input: {
    month?: string | null;
    period?: TruePnlPeriod;
  } = {}
): Promise<TruePnlSummary> {
  const monthDate = parseTruePnlMonth(input.month);
  const period = input.period ?? "month";
  const authContext = sheetsAuth();
  if ("error" in authContext) {
    return buildTruePnlCockpitSummary({
      monthDate,
      current: null,
      period,
      warnings: [authContext.error],
    });
  }

  const sheets = google.sheets({ version: "v4", auth: authContext.auth });
  try {
    const [current, previous] = await Promise.all([
      loadMonthSheet({
        sheets,
        spreadsheetId: authContext.spreadsheetId,
        auth: authContext.auth,
        monthDate,
      }),
      loadMonthSheet({
        sheets,
        spreadsheetId: authContext.spreadsheetId,
        auth: authContext.auth,
        monthDate: previousMonth(monthDate),
      }),
    ]);

    const warnings: TruePnlWarning[] = [];
    if (!current) {
      warnings.push({
        severity: "critical",
        code: "missing_month_tab",
        message: `No Sheet tab was found for ${getMonthlyTabName(monthDate)}.`,
      });
    }
    if (!previous) {
      warnings.push({
        severity: "info",
        code: "previous_month_missing",
        message:
          "Previous-month tab was not found, so comparison is unavailable.",
      });
    }

    return buildTruePnlCockpitSummary({
      monthDate,
      current,
      previous,
      period,
      warnings,
    });
  } catch (error) {
    return buildTruePnlCockpitSummary({
      monthDate,
      current: null,
      period,
      warnings: [
        {
          severity: "critical",
          code: "sheet_read_failed",
          message: `Google Sheets read failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    });
  }
}
