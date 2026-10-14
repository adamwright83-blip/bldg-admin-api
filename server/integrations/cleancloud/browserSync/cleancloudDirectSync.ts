/* LEGACY DAYFORGE COMPATIBILITY: cleancloud direct sync server-side automation */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../../../db";
import { ENV } from "../../../_core/env";
import { browserSyncBindings } from "./schema";
import {
  executeCleanCloudIngestion,
  recordSyncAttempt,
  type CleanCloudIngestionResult,
} from "./ingestion";
import { pacificToday, validateRange } from "../../../../extensions/gumballpals/core";

export const DIRECT_AUTH_FAILED = "direct_auth_failed";

export type CleanCloudDirectCredentials = {
  baseUrl?: string;
  username?: string;
  password?: string;
};

export type DirectSyncOptions = {
  tenantId: string;
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

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://cleancloudapp.com/store",
};

export type CleanCloudSession = { cookieHeader: string };

/** Authentication failures stop automatic retries; they are recorded distinctly. */
export class CleanCloudAuthError extends TRPCError {
  readonly cleanCloudAuth = true;
  constructor(message: string) {
    super({ code: "UNAUTHORIZED", message });
  }
}

/** CleanCloud error text can echo submitted values; never let a code reach logs. */
export function sanitizeCleanCloudMessage(message: string): string {
  return message.replace(/\b\d{6}\b/g, "******").slice(0, 200);
}

function mergeCookies(jar: Map<string, string>, res: Response) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie") || ""];
  for (const cookie of raw.filter(Boolean)) {
    const pair = cookie.split(";")[0]!;
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
}
const cookieHeaderOf = (jar: Map<string, string>) =>
  [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

type LoginResponse = {
  login?: string;
  error?: string;
  doEmailConfirm?: boolean | string | number;
  twoFA?: boolean | string | number;
};

/**
 * Logs in to CleanCloud's store login, completing the email-verification step
 * with a code read from the connected Jawbreaker Gmail when CleanCloud asks.
 * The same cookie jar carries the session across both requests.
 */
export async function loginCleanCloud(input: {
  tenantId: string;
  credentials?: CleanCloudDirectCredentials;
  fetchImpl?: typeof fetch;
  waitForCode?: (args: { tenantId: string; notBefore: Date }) => Promise<string>;
}): Promise<CleanCloudSession> {
  const creds = getCleanCloudCredentials(input.credentials);
  if (!creds) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "CleanCloud direct sync credentials are not configured in Railway (CLEANCLOUD_USERNAME, CLEANCLOUD_PASSWORD).",
    });
  }
  const doFetch = input.fetchImpl ?? fetch;
  const jar = new Map<string, string>();
  const payload: Record<string, string> = {
    login_email: creds.username,
    login_password: creds.password,
    choose_store_select: "0",
    remembermeSpotless: "1",
    station: "",
    plant_station: "",
    pos: "",
  };
  const post = async (body: Record<string, string>) => {
    const res = await doFetch("https://cleancloudapp.com/include/process_login_new.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        ...BROWSER_HEADERS,
        ...(jar.size ? { Cookie: cookieHeaderOf(jar) } : {}),
      },
      body: new URLSearchParams(body).toString(),
    });
    if (!res.ok) {
      throw new TRPCError({
        code: "BAD_GATEWAY",
        message: `CleanCloud login HTTP failed with status ${res.status}.`,
      });
    }
    mergeCookies(jar, res);
    return (await res.json().catch(() => null)) as LoginResponse | null;
  };

  const attemptStartedAt = new Date();
  let data = await post(payload);
  if (data?.doEmailConfirm && data.login !== "1") {
    const waitForCode =
      input.waitForCode ??
      (async args => {
        const { waitForCleanCloudVerificationCode } = await import("./gmailVerification");
        return waitForCleanCloudVerificationCode(args);
      });
    let code: string;
    try {
      code = await waitForCode({ tenantId: input.tenantId, notBefore: attemptStartedAt });
    } catch (error) {
      throw new CleanCloudAuthError(
        `CleanCloud email verification could not be completed: ${error instanceof Error ? error.message : "code unavailable"}.`
      );
    }
    data = await post({ ...payload, emailCodeEntered: code });
  }
  if (data?.twoFA && data.login !== "1") {
    throw new CleanCloudAuthError(
      "CleanCloud requires authenticator-app 2FA; Jawbreaker supports email verification codes only."
    );
  }
  if (!data || data.login !== "1") {
    throw new CleanCloudAuthError(
      `CleanCloud login rejected: ${sanitizeCleanCloudMessage(data?.error || "Unknown login error")}.`
    );
  }
  return { cookieHeader: cookieHeaderOf(jar) };
}

/**
 * Fetches one export CSV using an authenticated CleanCloud session
 * (logging in first when no session is supplied).
 */
export async function fetchCleanCloudDirectExport(input: {
  from: string;
  to: string;
  storeId: string;
  reportType: "orders_sales" | "orders_revenue";
  credentials?: CleanCloudDirectCredentials;
  session?: CleanCloudSession;
  tenantId?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ csv: string; exportUrl: string }> {
  const range = validateRange(input.from, input.to);
  const [y1, m1, d1] = range.from.split("-");
  const [y2, m2, d2] = range.to.split("-");
  const typeParam = input.reportType === "orders_revenue" ? "2" : "1";
  const session =
    input.session ??
    (await loginCleanCloud({
      tenantId: input.tenantId ?? "default",
      credentials: input.credentials,
      fetchImpl: input.fetchImpl,
    }));

  const exportUrl = `https://cleancloudapp.com/include/data-export-endpoint.php?type=${typeParam}&d1=${d1}&m1=${m1}&y1=${y1}&d2=${d2}&m2=${m2}&y2=${y2}&stores=[${input.storeId}]&group=`;
  const exportRes = await (input.fetchImpl ?? fetch)(exportUrl, {
    headers: { Cookie: session.cookieHeader, ...BROWSER_HEADERS },
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
  options: DirectSyncOptions
): Promise<DirectSyncResult> {
  const tenantId = options.tenantId;
  if (!tenantId?.trim()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "tenantId is required for CleanCloud direct sync.",
    });
  }
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
    try {
      const { loadBusinessSourceCoverage } = await import(
        "../../../analytics/sourceCoverage"
      );
      const snapshot = await loadBusinessSourceCoverage({ tenantId });
      const cleancloud = snapshot.sources.find(s => s.sourceId === "cleancloud");
      if (cleancloud?.coveredThrough) {
        // Start from coveredThrough (overlapping day) to ensure contiguous boundary
        from = cleancloud.coveredThrough;
      }
    } catch {
      // fallback to binding.lastSuccessAt
    }
  }

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
    // One authenticated session serves every export in this run.
    const session = await loginCleanCloud({ tenantId, credentials: options.credentials });
    if (reportTypes.includes("orders_sales")) {
      const salesExport = await fetchCleanCloudDirectExport({
        from: range.from,
        to: range.to,
        storeId: binding.storeId,
        reportType: "orders_sales",
        session,
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
        session,
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
      outcome: error instanceof CleanCloudAuthError ? DIRECT_AUTH_FAILED : "direct_sync_failed",
      message: sanitizeCleanCloudMessage(error instanceof Error ? error.message : String(error)),
      from: range.from,
      to: range.to,
    });
    throw error;
  }
}
