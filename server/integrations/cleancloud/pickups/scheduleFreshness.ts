import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { externalOperationalOrders } from "../../../../drizzle/schema";
import { pickupConnections } from "./schema";
import {
  NOT_APPLICABLE_SCHEDULE,
  assessScheduleFreshness,
  unreadableScheduleFreshness,
  type ScheduleFreshness,
} from "../../../../shared/cleancloudScheduleFreshness";

/**
 * Reads the facts behind the Driver's schedule-freshness line. Never throws:
 * an error is `freshness_unreadable`, which is never presented as current.
 * With no database at all (local tests) the check does not apply.
 */
export async function loadScheduleFreshness(input: {
  tenantId: string;
  now?: Date;
  timeZone?: string;
}): Promise<ScheduleFreshness> {
  const now = input.now ?? new Date();
  try {
    const db = await getDb();
    if (!db) return NOT_APPLICABLE_SCHEDULE;
    const [connection] = await db
      .select({
        enabled: pickupConnections.enabled,
        capturedAt: pickupConnections.capturedAt,
        lastError: pickupConnections.lastError,
      })
      .from(pickupConnections)
      .where(eq(pickupConnections.tenantId, input.tenantId))
      .limit(1);
    let usesCleanCloud = Boolean(connection);
    if (!usesCleanCloud) {
      const [row] = await db
        .select({ id: externalOperationalOrders.id })
        .from(externalOperationalOrders)
        .where(
          and(
            eq(externalOperationalOrders.tenantId, input.tenantId),
            eq(externalOperationalOrders.sourceSystem, "cleancloud")
          )
        )
        .limit(1);
      usesCleanCloud = Boolean(row);
    }
    return assessScheduleFreshness(
      {
        usesCleanCloud,
        pickupConnection: connection
          ? {
              enabled: Boolean(connection.enabled),
              capturedAt: connection.capturedAt ?? null,
              lastError: connection.lastError ?? null,
            }
          : null,
        deliveriesSynced: false,
      },
      now,
      input.timeZone
    );
  } catch (error) {
    console.warn("[ScheduleFreshness] could not read", {
      tenantId: input.tenantId,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return unreadableScheduleFreshness();
  }
}
