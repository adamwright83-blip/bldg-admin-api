import { desc, eq } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { browserSyncAttempts, browserSyncBindings, browserSyncReceipts } from "../cleancloudBrowserSync/schema";
import { getDb } from "../db";

export type PipelineAttempt = {
  at: string;
  outcome: string;
  message: string | null;
  rowCount: number | null;
};

export type JawbreakerPipelineStatus = {
  checkedAt: string;
  timeZone: string;
  pairedStore: { storeId: string; storeLabel: string } | null;
  gumball: {
    latestExport: PipelineAttempt | null;
    latestFailure: PipelineAttempt | null;
  };
  jawbreaker: {
    latestSuccess: PipelineAttempt | null;
    latestFailure: PipelineAttempt | null;
    latestHeartbeat: PipelineAttempt | null;
    pendingCount: number | null;
    oldestPending: string | null;
    latestReceipt: Record<string, unknown> | null;
  };
};

function attempt(row: typeof browserSyncAttempts.$inferSelect | undefined): PipelineAttempt | null {
  if (!row) return null;
  return {
    at: row.createdAt.toISOString(),
    outcome: row.outcome,
    message: row.message ?? null,
    rowCount: row.rowCount ?? null,
  };
}

function transport(receiptJson: unknown): string | null {
  if (!receiptJson || typeof receiptJson !== "object") return null;
  const value = (receiptJson as Record<string, unknown>).transport;
  return typeof value === "string" ? value : null;
}

export async function loadJawbreakerPipelineStatus(input: {
  tenantId: string;
  timeZone: string;
  now?: Date;
}): Promise<JawbreakerPipelineStatus> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [bindings, attempts, receipts] = await Promise.all([
    db
      .select()
      .from(browserSyncBindings)
      .where(eq(browserSyncBindings.tenantId, input.tenantId))
      .limit(1),
    db
      .select()
      .from(browserSyncAttempts)
      .where(eq(browserSyncAttempts.tenantId, input.tenantId))
      .orderBy(desc(browserSyncAttempts.createdAt))
      .limit(100),
    db
      .select()
      .from(browserSyncReceipts)
      .where(eq(browserSyncReceipts.tenantId, input.tenantId))
      .orderBy(desc(browserSyncReceipts.createdAt))
      .limit(30),
  ]);

  const latestExport = attempts.find(row => row.outcome === "extension_exported");
  const latestGumballFailure = attempts.find(
    row => row.outcome.startsWith("extension_") && row.outcome !== "extension_exported"
  );
  const latestJawbreakerSuccess = attempts.find(
    row => row.outcome === "jawbreaker_imported" || row.outcome === "jawbreaker_replayed"
  );
  const latestJawbreakerFailure = attempts.find(
    row =>
      row.outcome === "jawbreaker_failed" ||
      row.outcome === "jawbreaker_rejected" ||
      row.outcome === "jawbreaker_conflict"
  );
  const latestHeartbeat = attempts.find(row => row.outcome === "jawbreaker_heartbeat");
  const latestReceiptRow = receipts.find(row => transport(row.receiptJson) === "jawbreaker");
  const binding = bindings[0] ?? null;

  return {
    checkedAt: (input.now ?? new Date()).toISOString(),
    timeZone: input.timeZone,
    pairedStore: binding
      ? { storeId: binding.storeId, storeLabel: binding.storeLabel }
      : null,
    gumball: {
      latestExport: attempt(latestExport),
      latestFailure: attempt(latestGumballFailure),
    },
    jawbreaker: {
      latestSuccess: attempt(latestJawbreakerSuccess),
      latestFailure: attempt(latestJawbreakerFailure),
      latestHeartbeat: attempt(latestHeartbeat),
      pendingCount: latestHeartbeat?.rowCount ?? null,
      oldestPending: latestHeartbeat?.message ?? null,
      latestReceipt:
        latestReceiptRow?.receiptJson && typeof latestReceiptRow.receiptJson === "object"
          ? (latestReceiptRow.receiptJson as Record<string, unknown>)
          : null,
    },
  };
}

function when(iso: string, timeZone: string): string {
  const date = new Date(iso);
  return formatInTimeZone(date, timeZone, "MMM d 'at' h:mm a");
}

function receiptCounts(receipt: Record<string, unknown> | null): string | null {
  if (!receipt) return null;
  const inserted = Number(receipt.inserted ?? NaN);
  const updated = Number(receipt.updated ?? NaN);
  const unchanged = Number(receipt.unchanged ?? NaN);
  if (![inserted, updated, unchanged].every(Number.isFinite)) return null;
  return `${inserted} new, ${updated} updated, ${unchanged} unchanged`;
}

export function speakJawbreakerPipelineStatus(status: JawbreakerPipelineStatus): string {
  const exportAt = status.gumball.latestExport?.at ?? null;
  const successAt = status.jawbreaker.latestSuccess?.at ?? null;
  const failureAt = status.jawbreaker.latestFailure?.at ?? null;
  const heartbeatAt = status.jawbreaker.latestHeartbeat?.at ?? null;
  const pending = status.jawbreaker.pendingCount;
  const counts = receiptCounts(status.jawbreaker.latestReceipt);

  if (!status.pairedStore) {
    return "Gumball is not paired to a CleanCloud store for this business, so I cannot verify a valid Gumball-to-Jawbreaker pipeline.";
  }

  if (pending !== null && pending > 0) {
    const exportSentence = exportAt
      ? `Gumball last completed an export ${when(exportAt, status.timeZone)}.`
      : "I do not have a completed Gumball export on record.";
    const oldest = status.jawbreaker.oldestPending
      ? ` The oldest queued artifact is ${status.jawbreaker.oldestPending}.`
      : "";
    return `${exportSentence} Jawbreaker reports ${pending} artifact${pending === 1 ? "" : "s"} still waiting in Gumball Inbox.${oldest}`;
  }

  if (failureAt && (!successAt || failureAt > successAt)) {
    const message = status.jawbreaker.latestFailure?.message
      ? `: ${status.jawbreaker.latestFailure.message}`
      : "";
    return `Jawbreaker last reported an import problem ${when(failureAt, status.timeZone)}${message}. The source artifact remains separate from Gumball's export status.`;
  }

  if (exportAt && (!successAt || exportAt > successAt)) {
    if (!heartbeatAt) {
      return `Gumball completed an export ${when(exportAt, status.timeZone)}, after the last confirmed Jawbreaker import. I cannot see the local inbox heartbeat, so I will not claim that file has been imported.`;
    }
    return `Gumball completed an export ${when(exportAt, status.timeZone)}, after the last confirmed Jawbreaker import. Jawbreaker currently reports no queued artifact, but I do not yet have a matching import receipt for that newer export.`;
  }

  if (successAt) {
    return `Jawbreaker last confirmed a CleanCloud import ${when(successAt, status.timeZone)}${counts ? `: ${counts}` : ""}. ${pending === 0 ? "Its latest heartbeat reports no waiting Gumball artifacts." : ""}`.trim();
  }

  if (exportAt) {
    return `Gumball completed an export ${when(exportAt, status.timeZone)}, but I do not have a confirmed Jawbreaker import yet.`;
  }

  const gumballFailure = status.gumball.latestFailure;
  if (gumballFailure) {
    return `The latest Gumball evidence is an export failure ${when(gumballFailure.at, status.timeZone)}${gumballFailure.message ? `: ${gumballFailure.message}` : ""}.`;
  }

  return "I do not have enough pipeline evidence yet to say that Gumball exported or that Jawbreaker imported a file.";
}
