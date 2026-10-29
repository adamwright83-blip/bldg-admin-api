import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { browserSyncAttempts } from "./schema";
import {
  DIRECT_AUTH_FAILED,
  loginCleanCloud,
  sanitizeCleanCloudMessage,
  type CleanCloudSession,
} from "./cleancloudDirectSync";
import { AUTH_FAILURE_BACKOFF_MS } from "./cleancloudDirectScheduler";

/**
 * One-shot, READ-ONLY feasibility probe: can the server's own CleanCloud
 * session see the live pickup and delivery schedule, without the browser
 * extension and without the paid API?
 *
 * It logs in once (the same login direct sync uses, including the Gmail
 * verification code), fetches the store page once, and reports what that page
 * structurally contains. It writes nothing: no sync attempt row, no order, no
 * pickup. It keeps no customer data in its report, only counts, element ids,
 * header labels and endpoint paths. It refuses to log in while a recent
 * authentication failure has not been followed by a Gmail reconnection, so it
 * never loops on CleanCloud's verification email.
 */

export type ScheduleProbeReport = {
  ranAt: string;
  outcome:
    | "read"
    | "refused"
    | "login_failed"
    | "store_unreadable"
    | "not_authenticated";
  message: string;
  storePage: { status: number; bytes: number } | null;
  pickups: {
    tableInPage: boolean;
    rowCount: number;
    counterValue: number | null;
    headers: string[];
    countMatchesCounter: boolean | null;
  } | null;
  deliveries: {
    candidateElementIds: string[];
    tableInPage: boolean;
  } | null;
  /** include/*.php paths the page references that look schedule-related. Not called by the probe. */
  candidateEndpoints: string[];
  /** Plain-language verdict on what this run proves. */
  findings: string[];
};

const STORE_URL = "https://cleancloudapp.com/store";
const PROBE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: STORE_URL,
};

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pure: whether a 200 response is the signed-in store page rather than a login
 * screen. A login page must never be read as "the pickup table is not there".
 */
export function isAuthenticatedStorePage(html: string): boolean {
  const loginForm =
    /name=["']login_email["']/i.test(html) ||
    (/process_login_new\.php/i.test(html) &&
      /type=["']password["']/i.test(html));
  const storeMarkers =
    /id=["'](?:online_page|awaiting_dc_pickup|pu_o_c)["']/i.test(html) ||
    /logout/i.test(html);
  return storeMarkers && !loginForm;
}

/** Pure: what a CleanCloud store page structurally offers for the schedule. Exported for tests. */
export function analyzeStorePage(
  html: string
): Pick<ScheduleProbeReport, "pickups" | "deliveries" | "candidateEndpoints"> {
  const tableMatch = html.match(
    /<table[^>]*id=["']awaiting_dc_pickup_table["'][\s\S]*?<\/table>/i
  );
  const table = tableMatch?.[0] ?? "";
  const rowCount = (
    table.match(/<tr[^>]*class=["'][^"']*\bdcPickup_row\b/gi) ?? []
  ).length;
  const counterMatch = html.match(/id=["']pu_o_c["'][^>]*>\s*([^<]*)</i);
  const counterRaw = counterMatch?.[1]?.trim() ?? "";
  const counterValue = /^\d+$/.test(counterRaw) ? Number(counterRaw) : null;
  const headerRow = table.match(/<tr[\s\S]*?<\/tr>/i)?.[0] ?? "";
  const headers = [...headerRow.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
    .map(m => stripTags(m[1] ?? ""))
    .slice(0, 16);

  const ids = [
    ...new Set(
      [...html.matchAll(/\bid=["']([A-Za-z0-9_-]+)["']/g)].map(m => m[1]!)
    ),
  ];
  const deliveryIds = ids
    .filter(id => /deliver|dropoff|drop_off|dc_del|route/i.test(id))
    .slice(0, 40);
  const deliveryTableInPage =
    deliveryIds.some(id => /table/i.test(id)) ||
    /<tr[^>]*class=["'][^"']*\bdc(?:Delivery|Del)_row\b/i.test(html);

  const endpoints = [
    ...new Set(
      [...html.matchAll(/["'(]\s*(\/?include\/[A-Za-z0-9_\-/]+\.php)/g)]
        .map(m => m[1]!.replace(/^\//, ""))
        .filter(path =>
          /pickup|deliver|dropoff|route|driver|schedul|awaiting|dc_/i.test(path)
        )
    ),
  ].slice(0, 40);

  return {
    pickups: {
      tableInPage: Boolean(tableMatch),
      rowCount,
      counterValue,
      headers,
      countMatchesCounter:
        counterValue == null ? null : counterValue === rowCount,
    },
    deliveries: {
      candidateElementIds: deliveryIds,
      tableInPage: deliveryTableInPage,
    },
    candidateEndpoints: endpoints,
  };
}

function findingsFor(
  report: Pick<
    ScheduleProbeReport,
    "pickups" | "deliveries" | "candidateEndpoints"
  >
): string[] {
  const out: string[] = [];
  const p = report.pickups!;
  if (p.tableInPage && p.countMatchesCounter) {
    out.push(
      `The server session sees the pickup table directly in the store page: ${p.rowCount} rows, matching CleanCloud's own counter.`
    );
  } else if (p.tableInPage) {
    out.push(
      `The pickup table is in the page with ${p.rowCount} rows, but it ${p.counterValue == null ? "has no readable counter" : `does not match CleanCloud's counter (${p.counterValue})`}, so completeness is not proven.`
    );
  } else {
    out.push(
      "The pickup table is not in the server-rendered store page; CleanCloud likely loads it on click. A server read would need the endpoint behind that panel."
    );
  }
  if (report.deliveries!.tableInPage)
    out.push("A delivery table appears in the store page.");
  else out.push("No delivery table appears in the server-rendered store page.");
  out.push(
    report.candidateEndpoints.length
      ? `The page references ${report.candidateEndpoints.length} schedule-looking endpoints (listed). None were called; testing them is the next read-only step.`
      : "The page references no schedule-looking endpoints."
  );
  return out;
}

export async function probeCleanCloudSchedule(input: {
  tenantId: string;
  now?: Date;
  fetchImpl?: typeof fetch;
  login?: (args: { tenantId: string }) => Promise<CleanCloudSession>;
  /** When the Gmail connection was last (re)authorized; a reconnection after a failure lifts the pause. */
  gmailConnectedAt?: Date | null;
  latestAttempt?: { outcome: string; createdAt: Date } | null;
}): Promise<ScheduleProbeReport> {
  const now = input.now ?? new Date();
  const base = {
    ranAt: now.toISOString(),
    storePage: null,
    pickups: null,
    deliveries: null,
    candidateEndpoints: [] as string[],
    findings: [] as string[],
  };

  let latest = input.latestAttempt;
  if (latest === undefined) {
    const db = await getDb();
    const [row] = db
      ? await db
          .select({
            outcome: browserSyncAttempts.outcome,
            createdAt: browserSyncAttempts.createdAt,
          })
          .from(browserSyncAttempts)
          .where(and(eq(browserSyncAttempts.tenantId, input.tenantId)))
          .orderBy(desc(browserSyncAttempts.createdAt))
          .limit(1)
      : [];
    latest = row ?? null;
  }
  const recentAuthFailure =
    latest?.outcome === DIRECT_AUTH_FAILED &&
    now.getTime() - latest.createdAt.getTime() < AUTH_FAILURE_BACKOFF_MS;
  const reconnectedSince = Boolean(
    latest &&
      input.gmailConnectedAt &&
      input.gmailConnectedAt > latest.createdAt
  );
  if (recentAuthFailure && !reconnectedSince) {
    return {
      ...base,
      outcome: "refused",
      message:
        "CleanCloud sign-in failed recently and Gmail has not been reconnected since. Reconnect Gmail first; the probe will not retry a failing login.",
    };
  }

  let session: CleanCloudSession;
  try {
    session = await (
      input.login ??
      (args =>
        loginCleanCloud({
          tenantId: args.tenantId,
          fetchImpl: input.fetchImpl,
        }))
    )({
      tenantId: input.tenantId,
    });
  } catch (error) {
    return {
      ...base,
      outcome: "login_failed",
      message: sanitizeCleanCloudMessage(
        error instanceof Error ? error.message : "CleanCloud login failed."
      ),
    };
  }

  const doFetch = input.fetchImpl ?? fetch;
  let html = "";
  let status = 0;
  try {
    const res = await doFetch(STORE_URL, {
      method: "GET",
      headers: { Cookie: session.cookieHeader, ...PROBE_HEADERS },
      redirect: "manual",
    });
    status = res.status;
    html = res.status === 200 ? await res.text() : "";
  } catch (error) {
    return {
      ...base,
      outcome: "store_unreadable",
      message: sanitizeCleanCloudMessage(
        error instanceof Error ? error.message : "Store page could not be read."
      ),
    };
  }
  if (status !== 200 || !html) {
    return {
      ...base,
      outcome: "store_unreadable",
      storePage: { status, bytes: html.length },
      message: `Signed in, but the store page answered ${status}. The session may not carry over to the store page.`,
    };
  }
  if (!isAuthenticatedStorePage(html)) {
    return {
      ...base,
      outcome: "not_authenticated",
      storePage: { status, bytes: html.length },
      message:
        "Login reported success, but the store page came back as a sign-in screen, not the store. Nothing about the pickup table can be concluded from it.",
    };
  }
  const analysis = analyzeStorePage(html);
  return {
    ...base,
    ...analysis,
    outcome: "read",
    storePage: { status, bytes: html.length },
    message:
      "Signed in once and read the store page once. Nothing was written.",
    findings: findingsFor(analysis),
  };
}
