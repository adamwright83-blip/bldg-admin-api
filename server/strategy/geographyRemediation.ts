import { and, eq } from "drizzle-orm";
import { strategyPlays } from "../../drizzle/schema";
import { getDb } from "../db";

/** Idempotent invalidation of unaccepted template records. Approved history stays immutable. */
export async function invalidateUnresolvedTemplateGeography(tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db
    .select()
    .from(strategyPlays)
    .where(eq(strategyPlays.tenantId, tenantId));
  const invalidated: string[] = [];
  const approvedHistory: string[] = [];
  for (const row of rows) {
    const provenance = row.provenanceJson as {
      source?: string;
      geographyVersion?: string;
      invalidation?: unknown;
    };
    if (
      provenance.geographyVersion === "tenant-market-v1" ||
      provenance.invalidation
    )
      continue;
    if (!provenance.source?.startsWith("verticalTemplate:")) continue;
    if (!["candidate", "offered"].includes(row.status)) {
      approvedHistory.push(row.id);
      continue;
    }
    await db
      .update(strategyPlays)
      .set({
        status: "retired",
        provenanceJson: {
          ...provenance,
          invalidation: {
            version: "tenant-market-v1",
            reason: "Template geography lacked tenant evidence",
            originalGeography: row.geography,
            invalidatedAt: new Date().toISOString(),
          },
        },
      })
      .where(
        and(
          eq(strategyPlays.tenantId, tenantId),
          eq(strategyPlays.id, row.id),
          eq(strategyPlays.status, row.status)
        )
      );
    invalidated.push(row.id);
  }
  return { invalidated, approvedHistory, historicalLocalClaimsVerified: false };
}
