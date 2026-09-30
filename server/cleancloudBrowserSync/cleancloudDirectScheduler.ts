/* LEGACY DAYFORGE COMPATIBILITY: cleancloud direct sync autonomous scheduler */
import { getDb } from "../db";
import { browserSyncBindings } from "./schema";
import {
  isCleanCloudDirectConfigured,
  runCleanCloudDirectSync,
} from "./cleancloudDirectSync";
import { pacificToday } from "../../extensions/gumballpals/core";

const DEFAULT_SCHEDULER_INTERVAL_MS = 60_000 * 15; // 15 minutes

type ActiveSync = Promise<unknown> | null;
const activeSyncs = new Map<string, ActiveSync>();

export function isTimeBasedSyncDue(
  lastSuccessAt: Date | null,
  now: Date = new Date()
): boolean {
  if (!lastSuccessAt) return true;

  const msSinceSuccess = now.getTime() - lastSuccessAt.getTime();
  // If older than 20 hours, definitely due
  if (msSinceSuccess >= 20 * 3600 * 1000) return true;

  // Check if today is a new Pacific day and we have crossed 6:00 PM Pacific (18:00)
  const pacificFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });

  const nowParts = Object.fromEntries(
    pacificFormatter.formatToParts(now).map(p => [p.type, p.value])
  );
  const successParts = Object.fromEntries(
    pacificFormatter.formatToParts(lastSuccessAt).map(p => [p.type, p.value])
  );

  const nowDay = `${nowParts.year}-${nowParts.month}-${nowParts.day}`;
  const successDay = `${successParts.year}-${successParts.month}-${successParts.day}`;
  const nowHour = Number(nowParts.hour);

  // If we are past 6 PM Pacific today and the last success was before today
  if (nowHour >= 18 && nowDay !== successDay) {
    return true;
  }

  return false;
}

/**
 * Evaluates whether direct sync is due for a specific tenant based on the canonical
 * business source coverage contract (Orders-created coverage, customer truth assimilation,
 * and economic-event/payment coverage through the scheduled checkpoint).
 */
export async function isTenantDirectSyncDue(
  tenantId: string,
  now: Date = new Date(),
  lastSuccessAt?: Date | null
): Promise<{ due: boolean; reason: string }> {
  try {
    const { loadBusinessSourceCoverage } = await import(
      "../analytics/sourceCoverage"
    );
    const snapshot = await loadBusinessSourceCoverage({ tenantId, now });
    const cleancloud = snapshot.sources.find(s => s.sourceId === "cleancloud");

    if (!cleancloud || cleancloud.availability === "not_held") {
      return {
        due: false,
        reason: `CleanCloud source is not held for tenant "${tenantId}".`,
      };
    }

    // 1. If CleanCloud coverage is not "fresh" (e.g. stale, partial, or unavailable)
    if (cleancloud.status !== "fresh") {
      return {
        due: true,
        reason: `CleanCloud coverage status is "${cleancloud.status}" (expected through ${cleancloud.expectedThrough ?? "unknown"}): ${cleancloud.reason}`,
      };
    }

    // 2. Even if status is "fresh" (orders-created covered and truth assimilated),
    // verify economic/payment events are proven through the expected checkpoint!
    if (!cleancloud.provenance?.paymentEventsProven) {
      return {
        due: true,
        reason: `CleanCloud orders-created coverage is fresh, but economic/payment events are not proven through ${cleancloud.expectedThrough}.`,
      };
    }

    return {
      due: false,
      reason: `CleanCloud coverage is fully fresh and payment events proven through ${cleancloud.expectedThrough}.`,
    };
  } catch (error) {
    const timeDue = isTimeBasedSyncDue(lastSuccessAt ?? null, now);
    return {
      due: timeDue,
      reason: timeDue
        ? `Coverage check error, time fallback triggered (${error instanceof Error ? error.message : error})`
        : `Coverage check error, time fallback not due (${error instanceof Error ? error.message : error})`,
    };
  }
}

export async function isDirectSyncDue(
  lastSuccessAt: Date | null,
  now: Date = new Date(),
  tenantId?: string
): Promise<boolean> {
  if (tenantId) {
    const res = await isTenantDirectSyncDue(tenantId, now, lastSuccessAt);
    return res.due;
  }
  return isTimeBasedSyncDue(lastSuccessAt, now);
}

/**
 * Triggers direct server-side sync for all paired tenants that are due.
 */
export async function triggerScheduledCleanCloudDirectSync(input?: {
  now?: Date;
  tenantId?: string;
}): Promise<void> {
  if (!isCleanCloudDirectConfigured()) {
    return;
  }

  const db = await getDb();
  if (!db) return;

  const now = input?.now ?? new Date();
  const bindings = await db.select().from(browserSyncBindings);

  for (const binding of bindings) {
    if (input?.tenantId && binding.tenantId !== input.tenantId) {
      continue;
    }

    const { due, reason } = await isTenantDirectSyncDue(
      binding.tenantId,
      now,
      binding.lastSuccessAt
    );
    if (!due) continue;

    console.info(
      `[JawbreakerDirect] Direct sync due for tenant ${binding.tenantId}: ${reason}`
    );

    const key = `direct-sync:${binding.tenantId}`;
    if (activeSyncs.has(key)) continue;

    const promise = runCleanCloudDirectSync({
      tenantId: binding.tenantId,
      actorId: "system:jawbreaker-direct-scheduler",
    })
      .then(result => {
        console.info(
          `[JawbreakerDirect] Successfully synced CleanCloud for tenant ${binding.tenantId} (store ${result.storeLabel}) through ${result.range.to}`
        );
      })
      .catch(error => {
        console.warn(
          `[JawbreakerDirect] Direct sync failed for tenant ${binding.tenantId}`,
          error instanceof Error ? error.message : error
        );
      })
      .finally(() => {
        activeSyncs.delete(key);
      });

    activeSyncs.set(key, promise);
    await promise;
  }
}

/**
 * Starts the background server-side timer for CleanCloud direct sync.
 */
export function startCleanCloudDirectScheduler(intervalMs: number = DEFAULT_SCHEDULER_INTERVAL_MS) {
  if (!isCleanCloudDirectConfigured()) {
    console.info(
      "[JawbreakerDirect] Direct sync credentials not configured; server-side direct scheduler disabled."
    );
    return () => undefined;
  }

  console.info(
    `[JawbreakerDirect] Starting server-side CleanCloud direct scheduler (interval: ${Math.round(intervalMs / 60000)}m)`
  );

  // Run initial check on boot after a brief grace period
  const initialTimer = setTimeout(() => {
    void triggerScheduledCleanCloudDirectSync();
  }, 10_000);

  const intervalTimer = setInterval(() => {
    void triggerScheduledCleanCloudDirectSync();
  }, intervalMs);

  return () => {
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}
