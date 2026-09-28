/**
 * Public operating pulse for Gumball capture and Jawbreaker assimilation.
 * No customer names, amounts, phones, emails, addresses, or store labels.
 * A missing pulse is "not functioning," not a prompt to sign in.
 */
import { desc, eq } from "drizzle-orm";
import { loadBusinessSourceCoverage } from "../analytics/sourceCoverage";
import { getDb } from "../db";
import { isMysqlMissingTableError } from "../mysqlErrors";
import {
  browserSyncAttempts,
  browserSyncBindings,
  browserSyncReceipts,
} from "./schema";

export const OPERATING_PULSE_CACHE_MS = 60_000;

const PRIVATE_KEYS = [
  "customerName",
  "customerEmail",
  "customerPhone",
  "phone",
  "email",
  "address",
  "amountCents",
  "cents",
  "totalCents",
  "storeLabel",
  "storeId",
  "message",
  "orderNumber",
  "cleancloudOrderId",
  "rawJson",
  "csv",
] as const;

export type JawbreakerState =
  | "refreshed"
  | "failed"
  | "pending"
  | "skipped"
  | "never"
  | "mixed";

export type BookState =
  | "fresh"
  | "stale"
  | "partial"
  | "unavailable"
  | "not_held"
  | "unreadable";

export type PulseTenantInput = {
  tenantId: string;
  lastAttemptAt: string | null;
  lastAttemptOutcome: string | null;
  lastSuccessAt: string | null;
  customerTruth: "refreshed" | "failed" | "pending" | "skipped" | null;
  map: "refreshed" | "failed" | "pending" | "skipped" | null;
  book: BookState;
  expectedThrough: string | null;
  coveredThrough: string | null;
  lastImportRows: number | null;
};

export type OperatingPulseTenant = {
  tenantId: string;
  paired: true;
  lastAttemptAt: string | null;
  lastAttemptOutcome: string | null;
  lastSuccessAt: string | null;
  jawbreaker: Exclude<JawbreakerState, "mixed">;
  map: Exclude<JawbreakerState, "mixed">;
  book: BookState;
  expectedThrough: string | null;
  coveredThrough: string | null;
  lastImportRows: number | null;
  functioning: boolean;
};

export type OperatingPulse = {
  checkedAt: string;
  readable: boolean;
  functioning: boolean;
  jawbreaker: JawbreakerState;
  summary: string;
  tenants: OperatingPulseTenant[];
};

function stage(value: PulseTenantInput["customerTruth"]): Exclude<JawbreakerState, "mixed"> {
  if (
    value === "refreshed" ||
    value === "failed" ||
    value === "pending" ||
    value === "skipped"
  ) {
    return value;
  }
  return "never";
}

function captureReached(outcome: string | null): boolean {
  return outcome === "imported" || outcome === "replayed";
}

export function projectOperatingPulse(input: {
  now?: Date;
  tenants: PulseTenantInput[];
}): OperatingPulse {
  const checkedAt = (input.now ?? new Date()).toISOString();
  const tenants: OperatingPulseTenant[] = input.tenants.map(tenant => {
    const jawbreaker = stage(tenant.customerTruth);
    const map = stage(tenant.map);
    const functioning =
      captureReached(tenant.lastAttemptOutcome) &&
      jawbreaker === "refreshed" &&
      tenant.book === "fresh";
    return {
      tenantId: tenant.tenantId,
      paired: true,
      lastAttemptAt: tenant.lastAttemptAt,
      lastAttemptOutcome: tenant.lastAttemptOutcome,
      lastSuccessAt: tenant.lastSuccessAt,
      jawbreaker,
      map,
      book: tenant.book,
      expectedThrough: tenant.expectedThrough,
      coveredThrough: tenant.coveredThrough,
      lastImportRows: tenant.lastImportRows,
      functioning,
    };
  });

  if (!tenants.length) {
    return {
      checkedAt,
      readable: true,
      functioning: false,
      jawbreaker: "never",
      summary: "No Gumball binding. Export never captured.",
      tenants,
    };
  }

  const jawbreaker = combinedJawbreaker(tenants.map(tenant => tenant.jawbreaker));
  const functioning = tenants.every(tenant => tenant.functioning);
  return {
    checkedAt,
    readable: true,
    functioning,
    jawbreaker,
    summary: pulseSummary(tenants),
    tenants,
  };
}

function combinedJawbreaker(
  states: Array<Exclude<JawbreakerState, "mixed">>
): JawbreakerState {
  const unique = new Set(states);
  if (unique.size === 1) return states[0] ?? "never";
  return "mixed";
}

function pulseSummary(tenants: OperatingPulseTenant[]): string {
  const missed = tenants.filter(tenant => !captureReached(tenant.lastAttemptOutcome));
  if (missed.length) {
    const recordedFailure = missed.some(tenant => tenant.lastAttemptOutcome);
    return recordedFailure
      ? "Last Gumball capture failed. An older refresh is not a current capture."
      : "Gumball has not recorded a capture.";
  }
  if (tenants.some(tenant => tenant.jawbreaker === "failed")) {
    return "Gumball imported. Jawbreaker did not refresh customer truth.";
  }
  if (tenants.some(tenant => tenant.jawbreaker === "never")) {
    return "Gumball has not finished a customer-truth refresh.";
  }
  if (tenants.some(tenant => tenant.jawbreaker === "pending" || tenant.jawbreaker === "skipped")) {
    return "Jawbreaker has not refreshed customer truth.";
  }
  const stale = tenants.find(tenant => tenant.book !== "fresh");
  if (stale) {
    const through = stale.expectedThrough ? ` through ${stale.expectedThrough}` : "";
    return `Jawbreaker refreshed, but the CleanCloud book is not current${through}.`;
  }
  const through = tenants
    .map(tenant => tenant.coveredThrough)
    .filter((day): day is string => Boolean(day))
    .sort()
    .at(-1);
  return through
    ? `Jawbreaker refreshed. Book fresh through ${through}.`
    : "Jawbreaker refreshed. Book fresh.";
}

export function assertPublicPulse(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicPulse(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if ((PRIVATE_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Private field ${path}.${key} cannot be on the public pulse.`);
    }
    assertPublicPulse(child, `${path}.${key}`);
  }
}

type ReceiptJson = Record<string, unknown>;

function asStage(value: unknown): PulseTenantInput["customerTruth"] {
  if (
    value === "refreshed" ||
    value === "failed" ||
    value === "pending" ||
    value === "skipped"
  ) {
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

let cached: { at: number; pulse: OperatingPulse } | null = null;

export function clearOperatingPulseCache() {
  cached = null;
}

export async function loadOperatingPulse(now = new Date()): Promise<OperatingPulse> {
  if (cached && now.getTime() - cached.at < OPERATING_PULSE_CACHE_MS) {
    return { ...cached.pulse, checkedAt: now.toISOString() };
  }
  const db = await getDb();
  if (!db) {
    return {
      checkedAt: now.toISOString(),
      readable: false,
      functioning: false,
      jawbreaker: "never",
      summary: "Status unreadable.",
      tenants: [],
    };
  }

  let bindings: Array<{ tenantId: string; lastSuccessAt: Date | null }> = [];
  try {
    bindings = await db
      .select({
        tenantId: browserSyncBindings.tenantId,
        lastSuccessAt: browserSyncBindings.lastSuccessAt,
      })
      .from(browserSyncBindings)
      .limit(25);
  } catch (error) {
    if (isMysqlMissingTableError(error)) {
      const empty = projectOperatingPulse({ now, tenants: [] });
      cached = { at: now.getTime(), pulse: empty };
      return empty;
    }
    return {
      checkedAt: now.toISOString(),
      readable: false,
      functioning: false,
      jawbreaker: "never",
      summary: "Status unreadable.",
      tenants: [],
    };
  }

  const tenants: PulseTenantInput[] = [];
  for (const binding of bindings) {
    const [attempt] = await db
      .select({
        createdAt: browserSyncAttempts.createdAt,
        outcome: browserSyncAttempts.outcome,
      })
      .from(browserSyncAttempts)
      .where(eq(browserSyncAttempts.tenantId, binding.tenantId))
      .orderBy(desc(browserSyncAttempts.createdAt))
      .limit(1);
    const receipts = await db
      .select({
        receiptJson: browserSyncReceipts.receiptJson,
      })
      .from(browserSyncReceipts)
      .where(eq(browserSyncReceipts.tenantId, binding.tenantId))
      .orderBy(desc(browserSyncReceipts.createdAt))
      .limit(15);
    const imported = receipts
      .map(row => (row.receiptJson ?? {}) as ReceiptJson)
      .find(receipt => receipt.status !== "cancelled" && typeof receipt.completedAt === "string");
    let book: BookState = "unreadable";
    let expectedThrough: string | null = null;
    let coveredThrough: string | null = null;
    try {
      const coverage = await loadBusinessSourceCoverage({
        tenantId: binding.tenantId,
        now,
      });
      const cleancloud = coverage.sources.find(source => source.sourceId === "cleancloud");
      book = asBook(cleancloud?.status);
      expectedThrough = cleancloud?.expectedThrough ?? null;
      coveredThrough = cleancloud?.coveredThrough ?? null;
    } catch {
      book = "unreadable";
    }
    const rows = imported?.totalRows;
    tenants.push({
      tenantId: binding.tenantId,
      lastAttemptAt: attempt?.createdAt?.toISOString() ?? null,
      lastAttemptOutcome: attempt?.outcome ?? null,
      lastSuccessAt: binding.lastSuccessAt?.toISOString() ?? null,
      customerTruth: asStage(imported?.customerTruth),
      map: asStage(imported?.map),
      book,
      expectedThrough,
      coveredThrough,
      lastImportRows: typeof rows === "number" ? rows : rows == null ? null : Number(rows),
    });
  }

  const pulse = projectOperatingPulse({ now, tenants });
  assertPublicPulse(pulse);
  cached = { at: now.getTime(), pulse };
  return pulse;
}
