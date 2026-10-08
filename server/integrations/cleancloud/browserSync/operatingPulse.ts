/**
 * Signed-in CleanCloud operating pulse for one tenant.
 * Not a public endpoint. No customer names, amounts, phones, or addresses.
 */
import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { isMysqlMissingTableError } from "../../../mysqlErrors";
import { loadBusinessSourceCoverage } from "../../../analytics/sourceCoverage";
import { browserSyncAttempts, browserSyncBindings, browserSyncReceipts } from "./schema";

export type JawbreakerState = "refreshed" | "failed" | "pending" | "skipped" | "never";
export type BookState =
  | "fresh"
  | "stale"
  | "partial"
  | "unavailable"
  | "not_held"
  | "unreadable";

export type TenantOperatingPulse = {
  checkedAt: string;
  readable: boolean;
  tenantId: string;
  paired: boolean;
  lastAttemptAt: string | null;
  lastAttemptOutcome: string | null;
  lastSuccessAt: string | null;
  jawbreaker: JawbreakerState;
  map: JawbreakerState;
  book: BookState;
  expectedThrough: string | null;
  coveredThrough: string | null;
  paymentEventsProven: boolean;
  lastImportRows: number | null;
  functioning: boolean;
  summary: string;
};

const PRIVATE_KEYS = [
  "customerName",
  "customerEmail",
  "customerPhone",
  "address",
  "phone",
  "email",
  "amountCents",
  "totalCents",
  "csv",
];

export function assertNoPrivateFields(value: unknown, path = "pulse"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPrivateFields(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_KEYS.includes(key)) {
      throw new Error(`${path}.${key} is private and cannot be published`);
    }
    assertNoPrivateFields(child, `${path}.${key}`);
  }
}

export function assertPulseTenant(
  sessionTenantId: string,
  requestedTenantId?: string | null
): string {
  if (!sessionTenantId) throw new Error("No signed-in tenant.");
  if (requestedTenantId && requestedTenantId !== sessionTenantId) {
    throw new Error("Pulse is limited to the signed-in tenant.");
  }
  return sessionTenantId;
}

type PulseInput = {
  now?: Date;
  tenantId: string;
  paired: boolean;
  lastAttemptAt: string | null;
  lastAttemptOutcome: string | null;
  lastSuccessAt: string | null;
  customerTruth: JawbreakerState | null;
  map: JawbreakerState | null;
  book: BookState;
  expectedThrough: string | null;
  coveredThrough: string | null;
  paymentEventsProven: boolean;
  lastImportRows: number | null;
};

function captureReached(outcome: string | null): boolean {
  return outcome === "imported" || outcome === "replayed";
}

export function projectTenantPulse(input: PulseInput): TenantOperatingPulse {
  const jawbreaker = input.customerTruth ?? "never";
  const map = input.map ?? "never";
  const functioning =
    input.paired &&
    captureReached(input.lastAttemptOutcome) &&
    jawbreaker === "refreshed" &&
    input.book === "fresh";
  const pulse: TenantOperatingPulse = {
    checkedAt: (input.now ?? new Date()).toISOString(),
    readable: true,
    tenantId: input.tenantId,
    paired: input.paired,
    lastAttemptAt: input.lastAttemptAt,
    lastAttemptOutcome: input.lastAttemptOutcome,
    lastSuccessAt: input.lastSuccessAt,
    jawbreaker,
    map,
    book: input.book,
    expectedThrough: input.expectedThrough,
    coveredThrough: input.coveredThrough,
    paymentEventsProven: input.paymentEventsProven,
    lastImportRows: input.lastImportRows,
    functioning,
    summary: pulseSummary(input, jawbreaker),
  };
  assertNoPrivateFields(pulse);
  return pulse;
}

function pulseSummary(input: PulseInput, jawbreaker: JawbreakerState): string {
  if (!input.paired) return "No Gumball binding. Export never captured.";
  if (!captureReached(input.lastAttemptOutcome)) {
    return input.lastAttemptOutcome
      ? "Last Gumball capture failed. An older refresh is not a current capture."
      : "Gumball has not recorded a capture.";
  }
  if (jawbreaker === "failed") {
    return "Gumball imported. Jawbreaker did not refresh customer truth.";
  }
  if (jawbreaker === "never" || jawbreaker === "pending" || jawbreaker === "skipped") {
    return "Jawbreaker has not refreshed customer truth.";
  }
  if (input.book !== "fresh") {
    const through = input.expectedThrough ? ` through ${input.expectedThrough}` : "";
    return `Jawbreaker refreshed, but the CleanCloud book is not current${through}.`;
  }
  const payment = input.paymentEventsProven
    ? "Payment coverage is proven."
    : "Orders-created coverage is fresh. Payment completeness is not proven.";
  return input.coveredThrough
    ? `Jawbreaker refreshed. Book fresh through ${input.coveredThrough}. ${payment}`
    : `Jawbreaker refreshed. Book fresh. ${payment}`;
}

function asStage(value: unknown): JawbreakerState | null {
  if (value === "refreshed" || value === "failed" || value === "pending" || value === "skipped") {
    return value;
  }
  return null;
}

function asBook(value: unknown): BookState {
  if (
    value === "fresh" ||
    value === "stale" ||
    value === "partial" ||
    value === "unavailable" ||
    value === "not_held"
  ) {
    return value;
  }
  return "unreadable";
}

export async function loadTenantOperatingPulse(
  tenantId: string,
  now = new Date()
): Promise<TenantOperatingPulse> {
  const unread = (summary: string): TenantOperatingPulse => ({
    checkedAt: now.toISOString(),
    readable: false,
    tenantId,
    paired: false,
    lastAttemptAt: null,
    lastAttemptOutcome: null,
    lastSuccessAt: null,
    jawbreaker: "never",
    map: "never",
    book: "unreadable",
    expectedThrough: null,
    coveredThrough: null,
    paymentEventsProven: false,
    lastImportRows: null,
    functioning: false,
    summary,
  });
  const db = await getDb();
  if (!db) return unread("Status unreadable.");
  try {
    const [binding] = await db
      .select({
        lastSuccessAt: browserSyncBindings.lastSuccessAt,
      })
      .from(browserSyncBindings)
      .where(eq(browserSyncBindings.tenantId, tenantId))
      .limit(1);
    const [attempt] = await db
      .select({
        createdAt: browserSyncAttempts.createdAt,
        outcome: browserSyncAttempts.outcome,
      })
      .from(browserSyncAttempts)
      .where(eq(browserSyncAttempts.tenantId, tenantId))
      .orderBy(desc(browserSyncAttempts.createdAt))
      .limit(1);
    const receipts = await db
      .select({ receiptJson: browserSyncReceipts.receiptJson })
      .from(browserSyncReceipts)
      .where(eq(browserSyncReceipts.tenantId, tenantId))
      .orderBy(desc(browserSyncReceipts.createdAt))
      .limit(15);
    const imported = receipts
      .map(row => (row.receiptJson ?? {}) as Record<string, unknown>)
      .find(receipt => receipt.status !== "cancelled" && typeof receipt.completedAt === "string");
    let book: BookState = "unreadable";
    let expectedThrough: string | null = null;
    let coveredThrough: string | null = null;
    let paymentEventsProven = false;
    try {
      const coverage = await loadBusinessSourceCoverage({ tenantId, now });
      const cleancloud = coverage.sources.find(source => source.sourceId === "cleancloud");
      book = asBook(cleancloud?.status);
      expectedThrough = cleancloud?.expectedThrough ?? null;
      coveredThrough = cleancloud?.coveredThrough ?? null;
      paymentEventsProven = cleancloud?.provenance?.paymentEventsProven === true;
    } catch {
      book = "unreadable";
    }
    const rows = imported?.totalRows;
    return projectTenantPulse({
      now,
      tenantId,
      paired: Boolean(binding),
      lastAttemptAt: attempt?.createdAt?.toISOString() ?? null,
      lastAttemptOutcome: attempt?.outcome ?? null,
      lastSuccessAt: binding?.lastSuccessAt?.toISOString() ?? null,
      customerTruth: asStage(imported?.customerTruth),
      map: asStage(imported?.map),
      book,
      expectedThrough,
      coveredThrough,
      paymentEventsProven,
      lastImportRows: typeof rows === "number" ? rows : rows == null ? null : Number(rows),
    });
  } catch (error) {
    if (isMysqlMissingTableError(error)) {
      return projectTenantPulse({
        now,
        tenantId,
        paired: false,
        lastAttemptAt: null,
        lastAttemptOutcome: null,
        lastSuccessAt: null,
        customerTruth: null,
        map: null,
        book: "unavailable",
        expectedThrough: null,
        coveredThrough: null,
        paymentEventsProven: false,
        lastImportRows: null,
      });
    }
    return unread("Status unreadable.");
  }
}
