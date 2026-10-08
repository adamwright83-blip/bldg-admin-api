/**
 * CleanCloud Metrics → Overview is a control total, not a second book.
 * Totals come only from captured text. A screenshot can be stored beside
 * them. It cannot supply a number.
 */
import { createHash } from "node:crypto";

export const DASHBOARD_WITNESS_SOURCE = "cleancloud_metrics_overview" as const;
export const DASHBOARD_EXTRACTION_VERSION = "metrics-overview-v1" as const;

export type WitnessField = { label: string; valueText: string };

export type DashboardWitnessInput = {
  expectedStoreLabel: string;
  observedStoreLabel: string;
  rangeFrom: string;
  rangeTo: string;
  rangeText: string;
  comparisonText?: string | null;
  fields: WitnessField[];
  observedAt: Date;
  screenshotBytes: Uint8Array;
  screenshotSha256: string;
};

export type DashboardWitnessRecord = {
  storeLabel: string;
  rangeFrom: string;
  rangeTo: string;
  comparisonFrom: string | null;
  comparisonTo: string | null;
  salesCents: number;
  comparisonSalesCents: number | null;
  revenueCents: number;
  comparisonRevenueCents: number | null;
  orders: number;
  comparisonOrders: number | null;
  newCustomers: number | null;
  observedAt: string;
  screenshotSha256: string;
  extractionVersion: typeof DASHBOARD_EXTRACTION_VERSION;
  source: typeof DASHBOARD_WITNESS_SOURCE;
};

export type DashboardWitnessFailure = { ok: false; reason: string };
export type DashboardWitnessSuccess = { ok: true; witness: DashboardWitnessRecord };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^\(?-?\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})\)?$/;
const INTEGER = /^-?\d{1,3}(?:,\d{3})*$/;
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
] as const;

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function moneyToCents(raw: string): number | null {
  const text = raw.trim();
  if (!MONEY.test(text)) return null;
  const negative = text.startsWith("(") || text.startsWith("-");
  const [whole, frac] = text.replace(/[(),$\s-]/g, "").split(".");
  if (!whole || frac?.length !== 2) return null;
  const cents = Number(whole.replace(/,/g, "")) * 100 + Number(frac);
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

export function integerText(raw: string): number | null {
  const text = raw.trim();
  if (!INTEGER.test(text)) return null;
  const value = Number(text.replace(/,/g, ""));
  return Number.isSafeInteger(value) ? value : null;
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthIndex(name: string): number | null {
  const lower = name.toLowerCase();
  const long = MONTHS.indexOf(lower as (typeof MONTHS)[number]);
  if (long >= 0) return long + 1;
  const short = MONTHS.findIndex(month => month.slice(0, 3) === lower);
  return short >= 0 ? short + 1 : null;
}

/** Dates written the way the Metrics page writes them. Extra dates make a range unproven. */
export function datesInText(text: string): string[] {
  const pattern = new RegExp(
    [
      "\\d{4}-\\d{2}-\\d{2}",
      `\\b(?:${MONTHS.join("|")}|${MONTHS.map(month => month.slice(0, 3)).join("|")})\\s+\\d{1,2},\\s*\\d{4}`,
      "\\b\\d{1,2}/\\d{1,2}/\\d{4}",
    ].join("|"),
    "gi"
  );
  const dates: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    let iso: string | null = null;
    if (YMD.test(token)) iso = isoDate(...token.split("-").map(Number) as [number, number, number]);
    else if (token.includes("/")) {
      const [month, day, year] = token.split("/").map(Number);
      iso = isoDate(year!, month!, day!);
    } else {
      const parsed = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(token);
      const month = parsed ? monthIndex(parsed[1]!) : null;
      iso = parsed && month ? isoDate(Number(parsed[3]), month, Number(parsed[2])) : null;
    }
    if (!iso) return [];
    dates.push(iso);
  }
  return dates;
}

export function parseProvenPeriod(text: string): { from: string; to: string } | null {
  const dates = datesInText(text);
  if (dates.length !== 2) return null;
  const [first, second] = dates;
  return first! <= second! ? { from: first!, to: second! } : { from: second!, to: first! };
}

function oneField(fields: WitnessField[], label: string): string | DashboardWitnessFailure {
  const matches = fields.filter(field => field.label.trim() === label);
  if (matches.length !== 1) {
    return {
      ok: false,
      reason: matches.length === 0 ? `${label} was not on the page.` : `${label} appeared more than once.`,
    };
  }
  return matches[0]!.valueText;
}

function optionalInteger(fields: WitnessField[], label: string): number | null | DashboardWitnessFailure {
  const matches = fields.filter(field => field.label.trim() === label);
  if (matches.length > 1) return { ok: false, reason: `${label} appeared more than once.` };
  if (matches.length === 0) return null;
  const value = integerText(matches[0]!.valueText);
  if (value === null) return { ok: false, reason: `${label} was not an unambiguous number.` };
  return value;
}

export function projectDashboardWitness(
  input: DashboardWitnessInput
): DashboardWitnessSuccess | DashboardWitnessFailure {
  if (input.observedStoreLabel.trim() !== input.expectedStoreLabel.trim() || !input.expectedStoreLabel.trim()) {
    return { ok: false, reason: "The open store is not the paired store." };
  }
  if (!YMD.test(input.rangeFrom) || !YMD.test(input.rangeTo) || input.rangeFrom > input.rangeTo) {
    return { ok: false, reason: "The requested date range is not valid." };
  }
  const period = parseProvenPeriod(input.rangeText);
  if (!period || period.from !== input.rangeFrom || period.to !== input.rangeTo) {
    return { ok: false, reason: "The page date range does not match the requested dates." };
  }
  const salesText = oneField(input.fields, "Sales");
  const revenueText = oneField(input.fields, "Revenue");
  const ordersText = oneField(input.fields, "Orders");
  if (typeof salesText !== "string") return salesText;
  if (typeof revenueText !== "string") return revenueText;
  if (typeof ordersText !== "string") return ordersText;
  const salesCents = moneyToCents(salesText);
  const revenueCents = moneyToCents(revenueText);
  const orders = integerText(ordersText);
  if (salesCents === null || revenueCents === null || orders === null) {
    return { ok: false, reason: "A required total was not an unambiguous number." };
  }

  let comparisonFrom: string | null = null;
  let comparisonTo: string | null = null;
  let comparisonSalesCents: number | null = null;
  let comparisonRevenueCents: number | null = null;
  let comparisonOrders: number | null = null;
  const comparisonText = input.comparisonText?.trim() || null;
  if (comparisonText) {
    const comparison = parseProvenPeriod(comparisonText);
    if (!comparison) return { ok: false, reason: "The comparison period is incomplete." };
    if (comparison.from === input.rangeFrom && comparison.to === input.rangeTo) {
      return { ok: false, reason: "The comparison period is not distinct from the requested period." };
    }
    const comparisonSales = oneField(input.fields, "Comparison Sales");
    const comparisonRevenue = oneField(input.fields, "Comparison Revenue");
    if (typeof comparisonSales !== "string") return comparisonSales;
    if (typeof comparisonRevenue !== "string") return comparisonRevenue;
    comparisonSalesCents = moneyToCents(comparisonSales);
    comparisonRevenueCents = moneyToCents(comparisonRevenue);
    const parsedComparisonOrders = optionalInteger(input.fields, "Comparison Orders");
    if (parsedComparisonOrders && typeof parsedComparisonOrders === "object") return parsedComparisonOrders;
    comparisonOrders = parsedComparisonOrders;
    if (comparisonSalesCents === null || comparisonRevenueCents === null) {
      return { ok: false, reason: "A comparison total was not an unambiguous number." };
    }
    comparisonFrom = comparison.from;
    comparisonTo = comparison.to;
  }

  const newCustomers = optionalInteger(input.fields, "New Customers");
  if (newCustomers && typeof newCustomers === "object") return newCustomers;

  const actualHash = sha256Bytes(input.screenshotBytes);
  if (!/^[a-f0-9]{64}$/.test(input.screenshotSha256) || actualHash !== input.screenshotSha256) {
    return { ok: false, reason: "The screenshot does not match its hash." };
  }
  if (input.screenshotBytes.byteLength < 32 || !isPng(input.screenshotBytes)) {
    return { ok: false, reason: "The screenshot is missing." };
  }

  return {
    ok: true,
    witness: {
      storeLabel: input.expectedStoreLabel.trim(),
      rangeFrom: input.rangeFrom,
      rangeTo: input.rangeTo,
      comparisonFrom,
      comparisonTo,
      salesCents,
      comparisonSalesCents,
      revenueCents,
      comparisonRevenueCents,
      orders,
      comparisonOrders,
      newCustomers,
      observedAt: input.observedAt.toISOString(),
      screenshotSha256: actualHash,
      extractionVersion: DASHBOARD_EXTRACTION_VERSION,
      source: DASHBOARD_WITNESS_SOURCE,
    },
  };
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

export const PUBLIC_WITNESS_KEYS = [
  "storeLabel",
  "rangeFrom",
  "rangeTo",
  "comparisonFrom",
  "comparisonTo",
  "salesCents",
  "comparisonSalesCents",
  "revenueCents",
  "comparisonRevenueCents",
  "orders",
  "comparisonOrders",
  "newCustomers",
  "observedAt",
  "screenshotSha256",
  "extractionVersion",
  "source",
] as const;

export function witnessHasNoScreenshotTruth(witness: DashboardWitnessRecord): boolean {
  return !("screenshotBytes" in witness) && !("pngBase64" in witness) && !("screenshotBase64" in witness);
}

export type WitnessWrite = {
  tenantId: string;
  storeId: string;
  witness: DashboardWitnessRecord;
};

/** Tenant and store id come from the paired binding, never from page text. */
export function witnessWrite(args: {
  tenantId: string;
  storeId: string;
  input: DashboardWitnessInput;
}): { ok: true; write: WitnessWrite } | DashboardWitnessFailure {
  if (!args.tenantId.trim() || !/^[1-9]\d{0,15}$/.test(args.storeId)) {
    return { ok: false, reason: "The store pairing is missing." };
  }
  const projected = projectDashboardWitness(args.input);
  if (!projected.ok) return projected;
  return {
    ok: true,
    write: { tenantId: args.tenantId, storeId: args.storeId, witness: projected.witness },
  };
}
