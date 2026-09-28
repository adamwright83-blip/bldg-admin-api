/**
 * Personal Armory evidence — layer B.
 *
 * Two operations, both append-only:
 *   1. record that a player selected a weapon in a real encounter
 *   2. associate a later authoritative business outcome with that usage
 *
 * Association is explicitly NOT attribution. A follow-up that appears after a
 * weapon was used is recorded as an observation; nothing here claims the
 * weapon caused it, and no stored record is ever rewritten.
 *
 * Everything is tenant + actor scoped. Personal evidence never crosses tenants.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { armoryWeaponOutcomes, armoryWeaponUsages } from "../../drizzle/schema";
import type {
  ObjectionArchetype,
  SalesIntelChannel,
} from "../../shared/salesIntel";
import { getDb } from "../db";

export const ARMORY_OUTCOME_KINDS = [
  "follow_up_created",
  "call_logged",
  "visit_completed",
  "account_won",
  "account_lost",
  "access_recorded",
  "no_change",
] as const;

export type ArmoryOutcomeKind = (typeof ARMORY_OUTCOME_KINDS)[number];

export const ARMORY_ASSOCIATION_STRENGTHS = [
  "decision_point",
  "encounter",
  "mission_window_legacy",
] as const;
export type ArmoryAssociationStrength =
  (typeof ARMORY_ASSOCIATION_STRENGTHS)[number];

export type ArmoryAssociationSummary = {
  usages: number;
  associations: number;
  businessOutcomes: number;
  wins: number;
};

export function filterArmoryUsagesForAssociation<T extends {
  decisionPointId: string | null;
  encounterReference: string | null;
}>(
  usages: readonly T[],
  input: {
    associationStrength: ArmoryAssociationStrength;
    decisionPointId?: string | null;
    encounterReference?: string | null;
  }
): T[] {
  if (input.associationStrength === "decision_point") {
    const decisionPointId = input.decisionPointId?.trim();
    if (!decisionPointId) {
      throw new Error("decisionPointId is required for decision_point association");
    }
    return usages.filter(usage => usage.decisionPointId === decisionPointId);
  }

  if (input.associationStrength === "encounter") {
    const encounterReference = input.encounterReference?.trim();
    if (!encounterReference) {
      throw new Error("encounterReference is required for encounter association");
    }
    return usages.filter(
      usage => usage.encounterReference === encounterReference
    );
  }

  return [...usages];
}

/** Pure aggregation: one stable outcome reference is one business outcome. */
export function summarizeArmoryAssociations(
  rows: ReadonlyArray<{
    usageId: string;
    outcomeKind: ArmoryOutcomeKind;
    outcomeReference: string;
  }>
): ArmoryAssociationSummary {
  const usages = new Set(rows.map(row => row.usageId));
  const businessOutcomes = new Set(
    rows.map(row => `${row.outcomeKind}:${row.outcomeReference}`)
  );
  const wins = new Set(
    rows
      .filter(row => row.outcomeKind === "account_won")
      .map(row => row.outcomeReference)
  );
  return {
    usages: usages.size,
    associations: rows.length,
    businessOutcomes: businessOutcomes.size,
    wins: wins.size,
  };
}

export type ArmoryWeaponUsageRecord = {
  id: string;
  weaponId: string;
  missionId: number;
  archetype: ObjectionArchetype;
  channel: SalesIntelChannel;
  usedAt: string;
};

/** Idempotent by `requestId` so a retried encounter never double-counts. */
export async function recordArmoryWeaponUsage(input: {
  tenantId: string;
  actorId: string;
  missionId: number;
  weaponId: string;
  frameworkId: string | null;
  archetype: ObjectionArchetype;
  channel: SalesIntelChannel;
  provenanceKind: "trainer_source" | "personal_evidence" | "foundation";
  decisionPointId?: string | null;
  encounterReference?: string | null;
  requestId: string;
}): Promise<ArmoryWeaponUsageRecord> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .insert(armoryWeaponUsages)
    .values({
      id: randomUUID(),
      tenantId: input.tenantId,
      actorId: input.actorId,
      missionId: input.missionId,
      weaponId: input.weaponId,
      frameworkId: input.frameworkId,
      archetype: input.archetype,
      channel: input.channel,
      provenanceKind: input.provenanceKind,
      decisionPointId: input.decisionPointId ?? null,
      encounterReference: input.encounterReference ?? null,
      requestId: input.requestId,
    })
    .onDuplicateKeyUpdate({ set: { requestId: input.requestId } });

  const [row] = await db
    .select()
    .from(armoryWeaponUsages)
    .where(
      and(
        eq(armoryWeaponUsages.tenantId, input.tenantId),
        eq(armoryWeaponUsages.requestId, input.requestId)
      )
    )
    .limit(1);
  if (!row) throw new Error("Armory weapon usage failed to persist");

  return {
    id: row.id,
    weaponId: row.weaponId,
    missionId: row.missionId,
    archetype: row.archetype as ObjectionArchetype,
    channel: row.channel as SalesIntelChannel,
    usedAt: row.usedAt.toISOString(),
  };
}

/**
 * How far back an outcome may reach when associating with prior weapon use.
 * Bounded so an unrelated win months later is not silently credited.
 */
export const OUTCOME_ASSOCIATION_WINDOW_MS = 14 * 24 * 60 * 60 * 1_000;

/**
 * Associates an authoritative outcome with recent weapon usage on the same
 * mission. Called from the encounter resolution paths once real business state
 * has actually changed — never on game performance alone.
 */
export async function associateArmoryOutcome(input: {
  tenantId: string;
  actorId: string;
  missionId: number;
  outcomeKind: ArmoryOutcomeKind;
  /** Stable id of the real record: follow-up id, event id, pipeline stage. */
  outcomeReference: string;
  observedAt?: Date;
  windowMs?: number;
  associationStrength?: ArmoryAssociationStrength;
  decisionPointId?: string | null;
  encounterReference?: string | null;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const observedAt = input.observedAt ?? new Date();
  const since = new Date(
    observedAt.getTime() - (input.windowMs ?? OUTCOME_ASSOCIATION_WINDOW_MS)
  );

  const usages = await db
    .select()
    .from(armoryWeaponUsages)
    .where(
      and(
        eq(armoryWeaponUsages.tenantId, input.tenantId),
        eq(armoryWeaponUsages.actorId, input.actorId),
        eq(armoryWeaponUsages.missionId, input.missionId),
        gte(armoryWeaponUsages.usedAt, since)
      )
    )
    .orderBy(desc(armoryWeaponUsages.usedAt));

  if (!usages.length) return 0;

  const associationStrength =
    input.associationStrength ?? "mission_window_legacy";
  const matchedUsages = filterArmoryUsagesForAssociation(usages, {
    associationStrength,
    decisionPointId: input.decisionPointId,
    encounterReference: input.encounterReference,
  });
  if (!matchedUsages.length) return 0;

  for (const usage of matchedUsages) {
    await db
      .insert(armoryWeaponOutcomes)
      .values({
        id: randomUUID(),
        usageId: usage.id,
        tenantId: input.tenantId,
        actorId: input.actorId,
        missionId: input.missionId,
        weaponId: usage.weaponId,
        outcomeKind: input.outcomeKind,
        outcomeReference: input.outcomeReference,
        associationStrength,
        observedAt,
      })
      // Re-reporting the same real outcome must not inflate the evidence.
      .onDuplicateKeyUpdate({ set: { outcomeReference: input.outcomeReference } });
  }

  return matchedUsages.length;
}

/** Usage history for one mission, for encounter resume and debugging. */
export async function listMissionWeaponUsage(input: {
  tenantId: string;
  actorId: string;
  missionId: number;
}): Promise<ArmoryWeaponUsageRecord[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(armoryWeaponUsages)
    .where(
      and(
        eq(armoryWeaponUsages.tenantId, input.tenantId),
        eq(armoryWeaponUsages.actorId, input.actorId),
        eq(armoryWeaponUsages.missionId, input.missionId)
      )
    )
    .orderBy(desc(armoryWeaponUsages.usedAt));
  return rows.map(row => ({
    id: row.id,
    weaponId: row.weaponId,
    missionId: row.missionId,
    archetype: row.archetype as ObjectionArchetype,
    channel: row.channel as SalesIntelChannel,
    usedAt: row.usedAt.toISOString(),
  }));
}
