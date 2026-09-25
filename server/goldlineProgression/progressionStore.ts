/**
 * Reads and writes goldline_domain_progression. Does not create the table
 * and does not insert a row for an operator who has not crossed a write.
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { goldlineDomainProgression } from "../../drizzle/schema";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError, isMysqlMissingTableError } from "../mysqlErrors";

export type DomainProgressionRow = {
  levelColosseumResolvedAt: Date | null;
  companionRookOwnedAt: Date | null;
  kingdomBrassRepublicCompletedAt: Date | null;
  overworldUnlocksJson: unknown;
};

export type AuthoredProgressionReceipts = {
  coastalMarketHunt?: {
    runId: string;
    startedAt: string;
    caughtAt?: string;
  };
  waywardContactGate?: {
    runId: string;
    startedAt: string;
    completedAt?: string;
  };
};

export type DomainProgressionLookup =
  | { readable: true; row: DomainProgressionRow | null }
  | { readable: false };

function toRow(row: {
  levelColosseumResolvedAt: Date | null;
  companionRookOwnedAt: Date | null;
  kingdomBrassRepublicCompletedAt: Date | null;
  overworldUnlocksJson: unknown;
}): DomainProgressionRow {
  return {
    levelColosseumResolvedAt: row.levelColosseumResolvedAt,
    companionRookOwnedAt: row.companionRookOwnedAt,
    kingdomBrassRepublicCompletedAt: row.kingdomBrassRepublicCompletedAt,
    overworldUnlocksJson: row.overworldUnlocksJson,
  };
}

function receipts(value: unknown): AuthoredProgressionReceipts {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AuthoredProgressionReceipts)
    : {};
}

export async function findDomainProgression(input: {
  tenantId: string;
  operatorId: string;
}): Promise<DomainProgressionLookup> {
  try {
    const db = await getDb();
    if (!db) return { readable: false };
    const [row] = await db
      .select({
        levelColosseumResolvedAt: goldlineDomainProgression.levelColosseumResolvedAt,
        companionRookOwnedAt: goldlineDomainProgression.companionRookOwnedAt,
        kingdomBrassRepublicCompletedAt: goldlineDomainProgression.kingdomBrassRepublicCompletedAt,
        overworldUnlocksJson: goldlineDomainProgression.overworldUnlocksJson,
      })
      .from(goldlineDomainProgression)
      .where(
        and(
          eq(goldlineDomainProgression.tenantId, input.tenantId),
          eq(goldlineDomainProgression.operatorId, input.operatorId)
        )
      )
      .limit(1);
    return { readable: true, row: row ? toRow(row) : null };
  } catch (error) {
    if (isMysqlMissingTableError(error)) return { readable: false };
    throw error;
  }
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

export async function insertLevelColosseumResolved(input: {
  tenantId: string;
  operatorId: string;
  resolvedAt: Date;
}): Promise<void> {
  const db = await requireDb();
  try {
    await db.insert(goldlineDomainProgression).values({
      id: randomUUID(),
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      levelColosseumResolvedAt: input.resolvedAt,
      companionRookOwnedAt: null,
      kingdomBrassRepublicCompletedAt: null,
      overworldUnlocksJson: {},
    });
  } catch (error) {
    if (isMysqlMissingTableError(error)) {
      const missing = new Error("goldline_domain_progression is not present");
      missing.name = "ProgressionSchemaBlockedError";
      throw missing;
    }
    if (!isMysqlDuplicateKeyError(error)) throw error;
  }
}

/** Sets the level timestamp only while it is still null. Does not touch Rook or the Kingdom. */
export async function setLevelColosseumResolvedAt(input: {
  tenantId: string;
  operatorId: string;
  resolvedAt: Date;
}): Promise<void> {
  const db = await requireDb();
  await db
    .update(goldlineDomainProgression)
    .set({ levelColosseumResolvedAt: input.resolvedAt })
    .where(
      and(
        eq(goldlineDomainProgression.tenantId, input.tenantId),
        eq(goldlineDomainProgression.operatorId, input.operatorId),
        isNull(goldlineDomainProgression.levelColosseumResolvedAt)
      )
    );
}

/**
 * Authored Clockhead finale: records level.colosseum only.
 * Rook is revealed on the line here, but durable companion ownership is
 * intentionally deferred to the Coastal Market stealing/catch beat.
 */
export async function recordAuthoredColosseumFinale(input: {
  tenantId: string;
  operatorId: string;
  at: Date;
}): Promise<void> {
  const existing = await findDomainProgression(input);
  if (!existing.readable) {
    const missing = new Error("goldline_domain_progression is not readable");
    missing.name = "ProgressionSchemaBlockedError";
    throw missing;
  }
  if (!existing.row) {
    await insertLevelColosseumResolved({
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      resolvedAt: input.at,
    });
    return;
  }
  if (!existing.row.levelColosseumResolvedAt) {
    await setLevelColosseumResolvedAt({
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      resolvedAt: input.at,
    });
  }
}

/** Sets Rook only after the level timestamp exists, and only while Rook is null. */
export async function beginCoastalMarketRookHunt(input: {
  tenantId: string;
  operatorId: string;
  runId: string;
  startedAt: Date;
}): Promise<void> {
  const existing = await findDomainProgression(input);
  if (!existing.readable || !existing.row?.levelColosseumResolvedAt) {
    throw new Error("Coastal Market requires server-recorded level.colosseum");
  }
  if (existing.row.companionRookOwnedAt) return;
  const db = await requireDb();
  const current = receipts(existing.row.overworldUnlocksJson);
  await db
    .update(goldlineDomainProgression)
    .set({
      overworldUnlocksJson: {
        ...current,
        coastalMarketHunt: {
          runId: input.runId,
          startedAt: input.startedAt.toISOString(),
        },
      },
    })
    .where(
      and(
        eq(goldlineDomainProgression.tenantId, input.tenantId),
        eq(goldlineDomainProgression.operatorId, input.operatorId)
      )
    );
}

export async function recordAuthoredCoastalMarketRookCatch(input: {
  tenantId: string;
  operatorId: string;
  runId: string;
  at: Date;
}): Promise<void> {
  const existing = await findDomainProgression(input);
  if (!existing.readable || !existing.row?.levelColosseumResolvedAt) {
    throw new Error("Coastal Market Rook catch requires server-recorded level.colosseum");
  }
  if (existing.row.companionRookOwnedAt) return;
  const current = receipts(existing.row.overworldUnlocksJson);
  const hunt = current.coastalMarketHunt;
  if (!hunt || hunt.runId !== input.runId) {
    throw new Error("Coastal Market Rook catch requires the server-started hunt run");
  }
  const startedAt = Date.parse(hunt.startedAt);
  if (!Number.isFinite(startedAt) || input.at.getTime() - startedAt < 5_000) {
    throw new Error("Coastal Market Rook catch cannot precede the authored hunt");
  }
  const db = await requireDb();
  const identity = and(
    eq(goldlineDomainProgression.tenantId, input.tenantId),
    eq(goldlineDomainProgression.operatorId, input.operatorId)
  );
  await db.transaction(async tx => {
    await tx
      .update(goldlineDomainProgression)
      .set({ companionRookOwnedAt: input.at })
      .where(and(identity, isNull(goldlineDomainProgression.companionRookOwnedAt)));
    await tx
      .update(goldlineDomainProgression)
      .set({
        overworldUnlocksJson: {
          ...current,
          coastalMarketHunt: {
            ...hunt,
            caughtAt: input.at.toISOString(),
          },
        },
      })
      .where(identity);
  });
}

export async function beginWaywardContactGate(input: {
  tenantId: string;
  operatorId: string;
  runId: string;
  startedAt: Date;
}): Promise<void> {
  const existing = await findDomainProgression(input);
  if (!existing.readable || !existing.row?.companionRookOwnedAt) {
    throw new Error("Wayward CONTACT gate requires durable companion.rook ownership");
  }
  const db = await requireDb();
  const current = receipts(existing.row.overworldUnlocksJson);
  await db
    .update(goldlineDomainProgression)
    .set({
      overworldUnlocksJson: {
        ...current,
        waywardContactGate: {
          runId: input.runId,
          startedAt: input.startedAt.toISOString(),
        },
      },
    })
    .where(
      and(
        eq(goldlineDomainProgression.tenantId, input.tenantId),
        eq(goldlineDomainProgression.operatorId, input.operatorId)
      )
    );
}

export async function recordWaywardContactGateCompleted(input: {
  tenantId: string;
  operatorId: string;
  runId: string;
  at: Date;
}): Promise<void> {
  const existing = await findDomainProgression(input);
  if (!existing.readable || !existing.row?.companionRookOwnedAt) {
    throw new Error("Wayward CONTACT gate requires durable companion.rook ownership");
  }
  const current = receipts(existing.row.overworldUnlocksJson);
  const gate = current.waywardContactGate;
  if (!gate || gate.runId !== input.runId) {
    throw new Error("Wayward CONTACT completion requires the server-started gate run");
  }
  const startedAt = Date.parse(gate.startedAt);
  if (!Number.isFinite(startedAt) || input.at.getTime() - startedAt < 5_000) {
    throw new Error("Wayward CONTACT completion cannot precede the authored gate");
  }
  const db = await requireDb();
  await db
    .update(goldlineDomainProgression)
    .set({
      overworldUnlocksJson: {
        ...current,
        waywardContactGate: {
          ...gate,
          completedAt: input.at.toISOString(),
        },
      },
    })
    .where(
      and(
        eq(goldlineDomainProgression.tenantId, input.tenantId),
        eq(goldlineDomainProgression.operatorId, input.operatorId)
      )
    );
}

export async function hasServerAuthoritativeWaywardContactGate(input: {
  tenantId: string;
  operatorId: string;
}): Promise<boolean> {
  const existing = await findDomainProgression(input);
  if (!existing.readable || !existing.row) return false;
  const gate = receipts(existing.row.overworldUnlocksJson).waywardContactGate;
  return Boolean(gate?.runId && gate.completedAt);
}

export async function setCompanionRookOwnedAt(input: {
  tenantId: string;
  operatorId: string;
  ownedAt: Date;
}): Promise<void> {
  const db = await requireDb();
  await db
    .update(goldlineDomainProgression)
    .set({ companionRookOwnedAt: input.ownedAt })
    .where(
      and(
        eq(goldlineDomainProgression.tenantId, input.tenantId),
        eq(goldlineDomainProgression.operatorId, input.operatorId),
        isNotNull(goldlineDomainProgression.levelColosseumResolvedAt),
        isNull(goldlineDomainProgression.companionRookOwnedAt)
      )
    );
}
