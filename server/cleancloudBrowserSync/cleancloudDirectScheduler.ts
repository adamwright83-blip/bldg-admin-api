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

export async function isDirectSyncDue(
  lastSuccessAt: Date | null,
  now: Date = new Date()
): Promise<boolean> {
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

    const due = await isDirectSyncDue(binding.lastSuccessAt, now);
    if (!due) continue;

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
