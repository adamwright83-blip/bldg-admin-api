import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { dayDirectorCommitments } from "../../../drizzle/schema";
import type { ConfirmedWorkdayPlan } from "../../../shared/claireWorkday";
import { getDb } from "../../db";

export type WorkdayPlanSnapshotKey = {
  tenantId: string;
  actorId: string;
  businessDate: string;
  idempotencyKey: string;
};

function assertKey(input: WorkdayPlanSnapshotKey): void {
  if (!input.tenantId.trim()) throw new Error("Workday plan snapshot requires tenant authority");
  if (!input.actorId.trim()) throw new Error("Workday plan snapshot requires actor authority");
  if (!input.businessDate.trim()) throw new Error("Workday plan snapshot requires a business date");
  if (!input.idempotencyKey.trim()) throw new Error("Workday plan snapshot requires an idempotency key");
}

export async function loadWorkdayPlanSnapshot(
  input: WorkdayPlanSnapshotKey
): Promise<ConfirmedWorkdayPlan | null> {
  assertKey(input);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .select({ metadataJson: dayDirectorCommitments.metadataJson })
    .from(dayDirectorCommitments)
    .where(
      and(
        eq(dayDirectorCommitments.tenantId, input.tenantId),
        eq(dayDirectorCommitments.actorId, input.actorId),
        eq(dayDirectorCommitments.businessDate, input.businessDate),
        eq(dayDirectorCommitments.idempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);
  const snapshot = (row?.metadataJson as { snapshot?: ConfirmedWorkdayPlan } | null)?.snapshot;
  return snapshot && Array.isArray(snapshot.items) ? snapshot : null;
}

export async function upsertWorkdayPlanSnapshot(input: WorkdayPlanSnapshotKey & {
  snapshot: ConfirmedWorkdayPlan;
  sourceText: string;
}): Promise<ConfirmedWorkdayPlan> {
  assertKey(input);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const row = {
    id: randomUUID(),
    tenantId: input.tenantId,
    actorId: input.actorId,
    businessDate: input.businessDate,
    idempotencyKey: input.idempotencyKey,
    title: "Claire confirmed workday plan",
    kind: "operations" as const,
    quantity: null,
    provenance: "manual" as const,
    sourceText: input.sourceText,
    metadataJson: {
      hiddenFromDayPlan: true,
      snapshot: input.snapshot,
    },
  };
  await db
    .insert(dayDirectorCommitments)
    .values(row)
    .onDuplicateKeyUpdate({
      set: {
        metadataJson: row.metadataJson,
        sourceText: row.sourceText,
        title: row.title,
      },
    });
  const persisted = await loadWorkdayPlanSnapshot(input);
  if (!persisted) {
    throw new Error("Workday plan snapshot was not persisted");
  }
  return persisted;
}
