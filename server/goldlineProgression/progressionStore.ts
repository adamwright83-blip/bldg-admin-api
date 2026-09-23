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
};

export type DomainProgressionLookup =
  | { readable: true; row: DomainProgressionRow | null }
  | { readable: false };

function toRow(row: {
  levelColosseumResolvedAt: Date | null;
  companionRookOwnedAt: Date | null;
  kingdomBrassRepublicCompletedAt: Date | null;
}): DomainProgressionRow {
  return {
    levelColosseumResolvedAt: row.levelColosseumResolvedAt,
    companionRookOwnedAt: row.companionRookOwnedAt,
    kingdomBrassRepublicCompletedAt: row.kingdomBrassRepublicCompletedAt,
  };
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
 * Authored finale: level.colosseum resolved, then companion.rook owned.
 * One transaction. Existing timestamps stay. kingdom.brass_republic is not written.
 */
export async function recordAuthoredColosseumFinale(input: {
  tenantId: string;
  operatorId: string;
  at: Date;
}): Promise<void> {
  const db = await requireDb();
  const identity = and(
    eq(goldlineDomainProgression.tenantId, input.tenantId),
    eq(goldlineDomainProgression.operatorId, input.operatorId)
  );
  await db.transaction(async tx => {
    const [existing] = await tx
      .select({
        levelColosseumResolvedAt: goldlineDomainProgression.levelColosseumResolvedAt,
        companionRookOwnedAt: goldlineDomainProgression.companionRookOwnedAt,
      })
      .from(goldlineDomainProgression)
      .where(identity)
      .limit(1);
    if (!existing) {
      try {
        await tx.insert(goldlineDomainProgression).values({
          id: randomUUID(),
          tenantId: input.tenantId,
          operatorId: input.operatorId,
          levelColosseumResolvedAt: input.at,
          companionRookOwnedAt: input.at,
          kingdomBrassRepublicCompletedAt: null,
          overworldUnlocksJson: {},
        });
        return;
      } catch (error) {
        if (isMysqlMissingTableError(error)) {
          const missing = new Error("goldline_domain_progression is not present");
          missing.name = "ProgressionSchemaBlockedError";
          throw missing;
        }
        if (!isMysqlDuplicateKeyError(error)) throw error;
      }
    }
    await tx
      .update(goldlineDomainProgression)
      .set({ levelColosseumResolvedAt: input.at })
      .where(and(identity, isNull(goldlineDomainProgression.levelColosseumResolvedAt)));
    await tx
      .update(goldlineDomainProgression)
      .set({ companionRookOwnedAt: input.at })
      .where(
        and(
          identity,
          isNotNull(goldlineDomainProgression.levelColosseumResolvedAt),
          isNull(goldlineDomainProgression.companionRookOwnedAt)
        )
      );
  });
}

/** Sets Rook only after the level timestamp exists, and only while Rook is null. */
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
