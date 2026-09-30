/* LEGACY DAYFORGE COMPATIBILITY: cleancloud direct sync server-side automation */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { ENV } from "../_core/env";
import { browserSyncBindings } from "./schema";
import {
  executeCleanCloudIngestion,
  recordSyncAttempt,
  type CleanCloudIngestionResult,
} from "./ingestion";
import { pacificToday, validateRange } from "../../extensions/gumballpals/core";

export type CleanCloudDirectCredentials = {
  baseUrl?: string;
  username?: string;
  password?: string;
};

export type DirectSyncOptions = {
  tenantId?: string;
  actorId?: string;
  from?: string;
  to?: string;
  reportTypes?: Array<"orders_sales" | "orders_revenue">;
  credentials?: CleanCloudDirectCredentials;
};

export type DirectSyncResult = {
  success: boolean;
  tenantId: string;
  storeId: string;
  storeLabel: string;
  range: { from: string; to: string };
  salesReceipt?: CleanCloudIngestionResult | null;
  revenueReceipt?: CleanCloudIngestionResult | null;
};

export function getCleanCloudCredentials(
  override?: CleanCloudDirectCredentials
): { baseUrl: string; username: string; password: string } | null {
  const baseUrl =
    override?.baseUrl ||
    process.env.CLEANCLOUD_BASE_URL?.trim() ||
    "https://cleancloudapp.com/store";
  const username =
    override?.username ||
    process.env.CLEANCLOUD_USERNAME?.trim() ||
    "";
  const password =
    override?.password ||
    process.env.CLEANCLOUD_PASSWORD ||
    "";

  if (!username || !password) return null;
  return { baseUrl, username, password };
}

export function isCleanCloudDirectConfigured(
  override?: CleanCloudDirectCredentials
): boolean {
  return getCleanCloudCredentials(override) !== null;
}

/**
 * Authenticates against CleanCloud using credentials in Railway and fetches the export CSV.
 */
export async function fetchCleanCloudDirectExport(input: {
  from: string;
  to: string;
  storeId: string;
  reportType: "orders_sales" | "orders_revenue";
  credentials?: CleanCloudDirectCredentials;
}): Promise<{ csv: string; exportUrl: string }> {
  const creds = getCleanCloudCredentials(input.credentials);
  if (!creds) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "CleanCloud direct sync credentials are not configured in Railway (CLEANCLOUD_USERNAME, CLEANCLOUD_PASSWORD).",
    });
  }

  const range = validateRange(input.from, input.to);
  const [y1, m1, d1] = range.from.split("-");
  const [y2, m2, d2] = range.to.split("-");
  const typeParam = input.reportType === "orders_revenue" ? "2" : "1";

  // 1. Authenticate with CleanCloud
  const form = new URLSearchParams({
    login_email: creds.username,
    login_password: creds.password,
    choose_store_select: "0",
    remembermeSpotless: "1",
    station: "",
    plant_station: "",
    pos: "",
  });

  const loginRes = await fetch(
    "https://cleancloudapp.com/include/process_login_new.php",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://cleancloudapp.com/store",
      },
      body: form.toString(),
    }
  );

  if (!loginRes.ok) {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: `CleanCloud login HTTP failed with status ${loginRes.status}.`,
    });
  }

  const loginData = (await loginRes.json().catch(() => null)) as {
    login?: string;
    storeId?: string;
    error?: string;
  } | null;

  if (!loginData || loginData.login !== "1") {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: `CleanCloud login rejected: ${loginData?.error || "Unknown login error"}.`,
    });
  }

  const rawCookies = loginRes.headers.getSetCookie
    ? loginRes.headers.getSetCookie()
    : [loginRes.headers.get("set-cookie") || ""];

  const cookieHeader = rawCookies
    .filter(Boolean)
    .map(c => c.split(";")[0])
    .join("; ");

  // 2. Fetch Export CSV
  const exportUrl = `https://cleancloudapp.com/include/data-export-endpoint.php?type=${typeParam}&d1=${d1}&m1=${m1}&y1=${y1}&d2=${d2}&m2=${m2}&y2=${y2}&stores=[${input.storeId}]&group=`;

  const exportRes = await fetch(exportUrl, {
    headers: {
      Cookie: cookieHeader,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://cleancloudapp.com/store",
    },
  });

  if (!exportRes.ok) {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: `CleanCloud export HTTP failed with status ${exportRes.status}.`,
    });
  }

  const csv = await exportRes.text();
  if (/^\s*</.test(csv)) {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message:
        "CleanCloud returned an HTML page instead of CSV. Check credentials and store access.",
    });
  }

  return { csv, exportUrl };
}

/**
 * Executes a full direct server-side sync for a paired tenant.
 * Pulls latest Orders (Sales) and Orders (Revenue) and commits them through the canonical ingestion ledger.
 */
export async function runCleanCloudDirectSync(
  options: DirectSyncOptions = {}
): Promise<DirectSyncResult> {
  const tenantId = options.tenantId ?? "default";
  const actorId = options.actorId ?? "system:jawbreaker-direct";
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Database unavailable.",
    });
  }

  const [binding] = await db
    .select()
    .from(browserSyncBindings)
    .where(eq(browserSyncBindings.tenantId, tenantId));

  if (!binding) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No CleanCloud store binding found for tenant "${tenantId}". Complete initial store pairing first.`,
    });
  }

  const today = pacificToday();
  let from = options.from;
  let to = options.to ?? today;

  if (!from) {
    if (binding.lastSuccessAt) {
      // Default to 1 day before last success date to ensure overlapping boundary completeness
      const lastDate = new Date(binding.lastSuccessAt);
      const pacificParts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(lastDate);
      const y = pacificParts.find(p => p.type === "year")!.value;
      const m = pacificParts.find(p => p.type === "month")!.value;
      const d = pacificParts.find(p => p.type === "day")!.value;
      from = `${y}-${m}-${d}`;
    } else {
      // Default to 14 days ago if never synced before
      const d = new Date(Date.now() - 14 * 86400000);
      const pacificParts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(d);
      const y = pacificParts.find(p => p.type === "year")!.value;
      const m = pacificParts.find(p => p.type === "month")!.value;
      const day = pacificParts.find(p => p.type === "day")!.value;
      from = `${y}-${m}-${day}`;
    }
  }

  const range = validateRange(from, to, today);
  const reportTypes = options.reportTypes ?? ["orders_sales", "orders_revenue"];
  let salesReceipt: CleanCloudIngestionResult | null = null;
  let revenueReceipt: CleanCloudIngestionResult | null = null;

  try {
    if (reportTypes.includes("orders_sales")) {
      const salesExport = await fetchCleanCloudDirectExport({
        from: range.from,
        to: range.to,
        storeId: binding.storeId,
        reportType: "orders_sales",
        credentials: options.credentials,
      });

      salesReceipt = await executeCleanCloudIngestion({
        tenantId,
        actorId,
        bindingId: binding.id,
        storeId: binding.storeId,
        storeLabel: binding.storeLabel,
        requestId: randomUUID(),
        from: range.from,
        to: range.to,
        exportUrl: salesExport.exportUrl,
        csv: salesExport.csv,
        reportType: "orders_sales",
        sourcePrefix: "direct",
      });
    }

    if (reportTypes.includes("orders_revenue")) {
      const revExport = await fetchCleanCloudDirectExport({
        from: range.from,
        to: range.to,
        storeId: binding.storeId,
        reportType: "orders_revenue",
        credentials: options.credentials,
      });

      revenueReceipt = await executeCleanCloudIngestion({
        tenantId,
        actorId,
        bindingId: binding.id,
        storeId: binding.storeId,
        storeLabel: binding.storeLabel,
        requestId: randomUUID(),
        from: range.from,
        to: range.to,
        exportUrl: revExport.exportUrl,
        csv: revExport.csv,
        reportType: "orders_revenue",
        sourcePrefix: "direct",
      });
    }

    return {
      success: true,
      tenantId,
      storeId: binding.storeId,
      storeLabel: binding.storeLabel,
      range,
      salesReceipt,
      revenueReceipt,
    };
  } catch (error) {
    await recordSyncAttempt({
      tenantId,
      outcome: "direct_sync_failed",
      message: error instanceof Error ? error.message : String(error),
      from: range.from,
      to: range.to,
    });
    throw error;
  }
}
