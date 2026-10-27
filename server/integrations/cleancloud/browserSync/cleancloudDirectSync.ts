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
import { isLegacyDayforgeTenant } from "../../../saas/tenantAccess";

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
  /** Referral Code Usage, read after the exports. Never fails the sync. */
  referrals?: { status: "imported" | "no_address_yet" | "unrecognised" | "failed"; upserted?: number; error?: string };
};

/**
 * CLEANCLOUD_USERNAME / CLEANCLOUD_PASSWORD are the owner business's own CleanCloud
 * login. Only the tenants listed in CLEANCLOUD_ENV_CREDENTIAL_TENANTS may fall back
 * to them; when that list is unset, only the owner's legacy tenants may. Any other
 * tenant must supply its own credentials, so a second business can never sync the
 * owner's CleanCloud data into its own tenant.
 */
export function tenantMayUseEnvCleanCloudCredentials(tenantId: string): boolean {
  const listed = process.env.CLEANCLOUD_ENV_CREDENTIAL_TENANTS?.trim();
  if (listed) {
    return listed
      .split(",")
      .map(value => value.trim())
      .filter(Boolean)
      .includes(tenantId);
  }
  return isLegacyDayforgeTenant(tenantId);
}

/**
 * Explicit credentials always win. The environment login is used only when
 * `tenantId` names a tenant allowed to use it; without a tenant there is no fallback.
 */
export function getCleanCloudCredentials(
  override?: CleanCloudDirectCredentials,
  tenantId?: string
): { baseUrl: string; username: string; password: string } | null {
  const envAllowed = tenantId !== undefined && tenantMayUseEnvCleanCloudCredentials(tenantId);
  const baseUrl =
    override?.baseUrl ||
    process.env.CLEANCLOUD_BASE_URL?.trim() ||
    "https://cleancloudapp.com/store";
  const username =
    override?.username ||
    (envAllowed ? process.env.CLEANCLOUD_USERNAME?.trim() : "") ||
    "";
  const password =
    override?.password ||
    (envAllowed ? process.env.CLEANCLOUD_PASSWORD : "") ||
    "";

  if (!username || !password) return null;
  return { baseUrl, username, password };
}

/**
 * With a tenant: whether that tenant can log in. Without one: whether the
 * owner's environment login exists at all (the scheduler's on/off switch).
 */
export function isCleanCloudDirectConfigured(
  override?: CleanCloudDirectCredentials,
  tenantId?: string
): boolean {
  if (tenantId === undefined && !override?.username && !override?.password) {
    return Boolean(process.env.CLEANCLOUD_USERNAME?.trim() && process.env.CLEANCLOUD_PASSWORD);
  }
  return getCleanCloudCredentials(override, tenantId) !== null;
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
  const creds = getCleanCloudCredentials(input.credentials, input.tenantId);
  if (!creds) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: tenantMayUseEnvCleanCloudCredentials(input.tenantId)
        ? "CleanCloud direct sync credentials are not configured in Railway (CLEANCLOUD_USERNAME, CLEANCLOUD_PASSWORD)."
        : "This business has no CleanCloud credentials of its own, so CleanCloud direct sync is off for it.",
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
  if (!input.session && !input.tenantId?.trim()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "tenantId is required to log in to CleanCloud.",
    });
  }
  const session =
    input.session ??
    (await loginCleanCloud({
      tenantId: input.tenantId!,
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
  if (!isCleanCloudDirectConfigured(options.credentials, tenantId)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This business has no CleanCloud credentials of its own, so CleanCloud direct sync is off for it.",
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

    const referrals = await syncCleanCloudReferralUsage({ tenantId, session });

    return {
      success: true,
      tenantId,
      storeId: binding.storeId,
      storeLabel: binding.storeLabel,
      range,
      salesReceipt,
      revenueReceipt,
      referrals,
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

/**
 * Fetches CleanCloud's Referral Code Usage window with this run's session. Its address is the one GumballPals saw the
 * window load from; until GumballPals has synced once there is nothing to fetch. Never throws: referrals must not
 * fail the sales sync, and the page's freshness label shows when the copy is old.
 */
export async function syncCleanCloudReferralUsage(input: {
  tenantId: string;
  session: CleanCloudSession;
  fetchImpl?: typeof fetch;
}): Promise<NonNullable<DirectSyncResult["referrals"]>> {
  try {
    const { getCleanCloudReferralUsageUrl, importCleanCloudReferralUsageResponse } = await import(
      "../../../domains/referral/referralService"
    );
    const url = await getCleanCloudReferralUsageUrl(input.tenantId);
    if (!url) return { status: "no_address_yet" };
    const response = await (input.fetchImpl ?? fetch)(url, {
      headers: { ...BROWSER_HEADERS, Cookie: input.session.cookieHeader, "X-Requested-With": "XMLHttpRequest" },
      redirect: "manual",
    });
    if (!response.ok) return { status: "failed", error: `CleanCloud answered ${response.status}` };
    const result = await importCleanCloudReferralUsageResponse(input.tenantId, await response.text());
    return result.recognised ? { status: "imported", upserted: result.upserted } : { status: "unrecognised" };
  } catch (error) {
    return { status: "failed", error: sanitizeCleanCloudMessage(error instanceof Error ? error.message : String(error)) };
  }
}
