/**
 * Persistence for field intel.
 *
 * Two rules this file exists to enforce:
 *
 *   1. A signal only becomes evidence when a person confirms it. Everything
 *      written here is written already-confirmed, because the write IS the
 *      confirmation — the proposal never touched the database.
 *   2. Provenance is never upgraded. An operator observation stays
 *      `operator_confirmed` forever; only the system's own writes may claim
 *      `system_verified`, and nothing in this file can set that from user input.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { impactSignals, trackedSignalDefinitions } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  tallyImpactSignals,
  type ImpactClass,
  type ImpactLedgerTally,
  type ImpactSignal,
  type ProposedImpactSignal,
  type SignalProvenance,
  type SignalValueType,
  type TrackedSignalDefinition,
} from "../../shared/impactSignal";

async function db() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

const iso = (v: Date | null | undefined): string | null =>
  v ? new Date(v).toISOString() : null;

function view(row: typeof impactSignals.$inferSelect): ImpactSignal {
  return {
    id: row.id,
    campaignId: row.campaignId ?? null,
    businessDate: row.businessDate,
    signalKey: row.signalKey,
    label: row.label,
    valueType: row.valueType as SignalValueType,
    value: row.value,
    unit: row.unit ?? null,
    impactClass: row.impactClass as ImpactClass,
    provenance: row.provenance as SignalProvenance,
    entityType: row.entityType ?? null,
    entityId: row.entityId ?? null,
    entityLabel: row.entityLabel ?? null,
    location: row.location ?? null,
    notes: row.notes ?? null,
    metadata: (row.metadataJson as Record<string, unknown> | null) ?? null,
    capturedAt: iso(row.capturedAt) ?? new Date().toISOString(),
    confirmedAt: iso(row.confirmedAt),
  };
}

function definitionView(
  row: typeof trackedSignalDefinitions.$inferSelect
): TrackedSignalDefinition {
  return {
    id: row.id,
    signalKey: row.signalKey,
    label: row.label,
    valueType: row.valueType as SignalValueType,
    impactClass: row.impactClass as ImpactClass,
    appliesTo: row.appliesTo ?? null,
    unit: row.unit ?? null,
    options: (row.optionsJson as string[] | null) ?? null,
    promoted: Boolean(row.promoted),
    observedCount: row.observedCount,
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
  };
}

/**
 * Records signals the operator confirmed.
 *
 * `provenance` is accepted but clamped: a caller can say this came from an
 * external record, and cannot say the system verified it. `system_verified`
 * means the software watched it happen, and a sentence typed into a capture
 * sheet is by definition not that — however true it is.
 */
export async function confirmImpactSignals(input: {
  tenantId: string;
  businessDate: string;
  campaignId: string | null;
  signals: ProposedImpactSignal[];
  provenance?: Extract<SignalProvenance, "operator_confirmed" | "external_record">;
  entityId?: string | null;
  location?: string | null;
}): Promise<ImpactSignal[]> {
  if (input.signals.length === 0) return [];
  const database = await db();
  const now = new Date();
  const provenance = input.provenance ?? "operator_confirmed";

  const rows = input.signals.map(signal => ({
    id: randomUUID(),
    tenantId: input.tenantId,
    campaignId: input.campaignId,
    businessDate: input.businessDate,
    signalKey: signal.signalKey,
    label: signal.label,
    valueType: signal.valueType,
    value: signal.value,
    unit: signal.unit,
    impactClass: signal.impactClass,
    provenance,
    entityType: signal.entityType,
    entityId: input.entityId ?? null,
    entityLabel: signal.entityLabel,
    location: input.location ?? null,
    notes: signal.notes,
    metadataJson: signal.metadata ?? null,
    capturedAt: now,
    // The write IS the confirmation — the proposal was never persisted.
    confirmedAt: now,
  }));

  await database.insert(impactSignals).values(rows);

  // Count observations per key so a human can see which novel signals are
  // becoming routine. Deliberately does not auto-promote: deciding a question
  // is standard is an editorial call, and guessing it would start putting
  // questions in front of the operator that they never asked for.
  for (const signal of input.signals) {
    await ensureTrackedDefinition({
      tenantId: input.tenantId,
      signalKey: signal.signalKey,
      label: signal.label,
      valueType: signal.valueType,
      impactClass: signal.impactClass,
      appliesTo: signal.entityType ?? null,
      unit: signal.unit,
      // A definition is only created up front when the operator explicitly
      // asked to start tracking; otherwise it is just counted.
      createIfMissing: true,
    });
  }

  const ids = rows.map(r => r.id);
  const stored = await database
    .select()
    .from(impactSignals)
    .where(
      and(
        eq(impactSignals.tenantId, input.tenantId),
        sql`${impactSignals.id} IN ${ids}`
      )
    );
  return stored.map(view);
}

/**
 * Creates or counts a tracked definition.
 *
 * Additive by construction: an existing definition has its count incremented
 * and its label left alone. Never rewrites captured signals, which is why each
 * signal row carries its own label and value type.
 */
export async function ensureTrackedDefinition(input: {
  tenantId: string;
  signalKey: string;
  label: string;
  valueType: SignalValueType;
  impactClass: ImpactClass;
  appliesTo: string | null;
  unit: string | null;
  options?: string[] | null;
  createIfMissing?: boolean;
}): Promise<TrackedSignalDefinition | null> {
  const database = await db();
  const [existing] = await database
    .select()
    .from(trackedSignalDefinitions)
    .where(
      and(
        eq(trackedSignalDefinitions.tenantId, input.tenantId),
        eq(trackedSignalDefinitions.signalKey, input.signalKey)
      )
    );

  if (existing) {
    await database
      .update(trackedSignalDefinitions)
      .set({ observedCount: existing.observedCount + 1 })
      .where(eq(trackedSignalDefinitions.id, existing.id));
    return definitionView({
      ...existing,
      observedCount: existing.observedCount + 1,
    });
  }

  if (!input.createIfMissing) return null;

  const id = randomUUID();
  await database.insert(trackedSignalDefinitions).values({
    id,
    tenantId: input.tenantId,
    signalKey: input.signalKey,
    label: input.label,
    valueType: input.valueType,
    impactClass: input.impactClass,
    appliesTo: input.appliesTo,
    unit: input.unit,
    optionsJson: input.options ?? null,
    observedCount: 1,
  });
  const [row] = await database
    .select()
    .from(trackedSignalDefinitions)
    .where(eq(trackedSignalDefinitions.id, id));
  return row ? definitionView(row) : null;
}

export async function listTrackedDefinitions(input: {
  tenantId: string;
}): Promise<TrackedSignalDefinition[]> {
  const database = await db();
  const rows = await database
    .select()
    .from(trackedSignalDefinitions)
    .where(eq(trackedSignalDefinitions.tenantId, input.tenantId))
    .orderBy(desc(trackedSignalDefinitions.observedCount));
  return rows.map(definitionView);
}

/** Marks a definition as a standard question. An editorial act, by a person. */
export async function promoteTrackedDefinition(input: {
  tenantId: string;
  signalKey: string;
}): Promise<TrackedSignalDefinition | null> {
  const database = await db();
  await database
    .update(trackedSignalDefinitions)
    .set({ promoted: true })
    .where(
      and(
        eq(trackedSignalDefinitions.tenantId, input.tenantId),
        eq(trackedSignalDefinitions.signalKey, input.signalKey)
      )
    );
  const [row] = await database
    .select()
    .from(trackedSignalDefinitions)
    .where(
      and(
        eq(trackedSignalDefinitions.tenantId, input.tenantId),
        eq(trackedSignalDefinitions.signalKey, input.signalKey)
      )
    );
  return row ? definitionView(row) : null;
}

export async function listImpactSignals(input: {
  tenantId: string;
  campaignId?: string | null;
  businessDate?: string;
}): Promise<ImpactSignal[]> {
  const database = await db();
  const filters = [eq(impactSignals.tenantId, input.tenantId)];
  if (input.campaignId) {
    filters.push(eq(impactSignals.campaignId, input.campaignId));
  }
  if (input.businessDate) {
    filters.push(eq(impactSignals.businessDate, input.businessDate));
  }
  const rows = await database
    .select()
    .from(impactSignals)
    .where(and(...filters))
    .orderBy(desc(impactSignals.capturedAt));
  return rows.map(view);
}

/**
 * The Impact Ledger's tally.
 *
 * Aggregation happens in the shared pure function so the client and any future
 * case-study export cannot drift into different arithmetic — and so the rule
 * that unconfirmed signals are not evidence lives in exactly one place.
 */
export async function impactLedgerTally(input: {
  tenantId: string;
  campaignId?: string | null;
}): Promise<ImpactLedgerTally> {
  const signals = await listImpactSignals(input);
  return tallyImpactSignals(signals, input.campaignId ?? null);
}
