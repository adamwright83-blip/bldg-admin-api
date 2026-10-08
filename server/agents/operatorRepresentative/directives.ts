import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { operatorRepresentativeDirectives } from "../../../drizzle/schema";
import { getDb } from "../../db";

export type OperatorRepresentativeDirectiveKind =
  | "correction"
  | "suppress"
  | "ask_instead"
  | "approve";

export type OperatorRepresentativeDirectiveRecord = {
  id: string;
  tenantId: string;
  canonicalOperatorId: string;
  targetItemId: string;
  targetKey: string | null;
  directiveKind: OperatorRepresentativeDirectiveKind;
  operatorDeclaredValue: Record<string, unknown> | null;
  status: "active" | "revoked";
  createdByOpenId: string;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
};

function mapRow(row: typeof operatorRepresentativeDirectives.$inferSelect): OperatorRepresentativeDirectiveRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    canonicalOperatorId: row.canonicalOperatorId,
    targetItemId: row.targetItemId,
    targetKey: row.targetKey ?? null,
    directiveKind: row.directiveKind,
    operatorDeclaredValue:
      row.operatorDeclaredValueJson && typeof row.operatorDeclaredValueJson === "object"
        ? (row.operatorDeclaredValueJson as Record<string, unknown>)
        : null,
    status: row.status,
    createdByOpenId: row.createdByOpenId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revokedAt: row.revokedAt ?? null,
  };
}

export async function listOperatorRepresentativeDirectives(input: {
  tenantId: string;
  canonicalOperatorId: string;
  includeRevoked?: boolean;
  limit?: number;
}): Promise<OperatorRepresentativeDirectiveRecord[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const limit = Math.max(1, Math.min(input.limit ?? 100, 250));
  const predicates = [
    eq(operatorRepresentativeDirectives.tenantId, input.tenantId),
    eq(operatorRepresentativeDirectives.canonicalOperatorId, input.canonicalOperatorId),
  ];
  if (!input.includeRevoked) {
    predicates.push(eq(operatorRepresentativeDirectives.status, "active"));
  }
  const rows = await db
    .select()
    .from(operatorRepresentativeDirectives)
    .where(and(...predicates))
    .orderBy(desc(operatorRepresentativeDirectives.createdAt))
    .limit(limit);
  return rows.map(mapRow);
}


export async function listActiveOperatorRepresentativeDirectives(input: {
  tenantId: string;
  canonicalOperatorId: string;
}): Promise<OperatorRepresentativeDirectiveRecord[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db
    .select()
    .from(operatorRepresentativeDirectives)
    .where(
      and(
        eq(operatorRepresentativeDirectives.tenantId, input.tenantId),
        eq(operatorRepresentativeDirectives.canonicalOperatorId, input.canonicalOperatorId),
        eq(operatorRepresentativeDirectives.status, "active")
      )
    )
    .orderBy(desc(operatorRepresentativeDirectives.createdAt));
  return rows.map(mapRow);
}

export async function listRecentRevokedOperatorRepresentativeDirectives(input: {
  tenantId: string;
  canonicalOperatorId: string;
  limit?: number;
}): Promise<OperatorRepresentativeDirectiveRecord[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const limit = Math.max(1, Math.min(input.limit ?? 100, 250));
  const rows = await db
    .select()
    .from(operatorRepresentativeDirectives)
    .where(
      and(
        eq(operatorRepresentativeDirectives.tenantId, input.tenantId),
        eq(operatorRepresentativeDirectives.canonicalOperatorId, input.canonicalOperatorId),
        eq(operatorRepresentativeDirectives.status, "revoked")
      )
    )
    .orderBy(desc(operatorRepresentativeDirectives.createdAt))
    .limit(limit);
  return rows.map(mapRow);
}

export async function loadOperatorRepresentativeDirectiveSnapshot(
  input: {
    tenantId: string;
    canonicalOperatorId: string;
    recentHistoryLimit?: number;
  },
  deps: {
    listActive?: typeof listActiveOperatorRepresentativeDirectives;
    listRecentRevoked?: typeof listRecentRevokedOperatorRepresentativeDirectives;
  } = {}
): Promise<{
  active: OperatorRepresentativeDirectiveRecord[];
  recentHistory: OperatorRepresentativeDirectiveRecord[];
  directives: OperatorRepresentativeDirectiveRecord[];
}> {
  const listActive = deps.listActive ?? listActiveOperatorRepresentativeDirectives;
  const listRecentRevoked =
    deps.listRecentRevoked ?? listRecentRevokedOperatorRepresentativeDirectives;

  const [active, recentHistory] = await Promise.all([
    listActive({
      tenantId: input.tenantId,
      canonicalOperatorId: input.canonicalOperatorId,
    }),
    listRecentRevoked({
      tenantId: input.tenantId,
      canonicalOperatorId: input.canonicalOperatorId,
      limit: input.recentHistoryLimit ?? 100,
    }),
  ]);

  // Active directives are authoritative current state and must never be
  // displaced by a bounded history window. Prefer the active copy if a row
  // appears in both reads because of a concurrent revoke between queries.
  const activeIds = new Set(active.map(item => item.id));
  const dedupedRecentHistory = recentHistory.filter(item => !activeIds.has(item.id));

  return {
    active,
    recentHistory: dedupedRecentHistory,
    directives: [...active, ...dedupedRecentHistory],
  };
}

export async function setOperatorRepresentativeDirective(input: {
  tenantId: string;
  canonicalOperatorId: string;
  targetItemId: string;
  targetKey?: string | null;
  directiveKind: OperatorRepresentativeDirectiveKind;
  operatorDeclaredValue?: Record<string, unknown> | null;
  createdByOpenId: string;
}): Promise<OperatorRepresentativeDirectiveRecord> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const id = randomUUID();
  const now = new Date();
  await db.transaction(async tx => {
    const activeForTarget = await tx
      .select()
      .from(operatorRepresentativeDirectives)
      .where(
        and(
          eq(operatorRepresentativeDirectives.tenantId, input.tenantId),
          eq(operatorRepresentativeDirectives.canonicalOperatorId, input.canonicalOperatorId),
          eq(operatorRepresentativeDirectives.targetItemId, input.targetItemId),
          eq(operatorRepresentativeDirectives.status, "active")
        )
      );

    const supersededIds = activeForTarget
      .filter(existing => {
        if (input.directiveKind === "correction") return existing.directiveKind === "correction";
        return (
          existing.directiveKind === "suppress" ||
          existing.directiveKind === "ask_instead" ||
          existing.directiveKind === "approve"
        );
      })
      .map(existing => existing.id);

    for (const existingId of supersededIds) {
      await tx
        .update(operatorRepresentativeDirectives)
        .set({ status: "revoked", revokedAt: now, updatedAt: now })
        .where(eq(operatorRepresentativeDirectives.id, existingId));
    }

    await tx.insert(operatorRepresentativeDirectives).values({
      id,
      tenantId: input.tenantId,
      canonicalOperatorId: input.canonicalOperatorId,
      targetItemId: input.targetItemId,
      targetKey: input.targetKey ?? null,
      directiveKind: input.directiveKind,
      operatorDeclaredValueJson: input.operatorDeclaredValue ?? null,
      status: "active",
      createdByOpenId: input.createdByOpenId,
      createdAt: now,
      updatedAt: now,
    });
  });

  const [row] = await db
    .select()
    .from(operatorRepresentativeDirectives)
    .where(eq(operatorRepresentativeDirectives.id, id))
    .limit(1);
  if (!row) throw new Error("Directive write did not persist");
  return mapRow(row);
}

export async function revokeOperatorRepresentativeDirective(input: {
  tenantId: string;
  canonicalOperatorId: string;
  directiveId: string;
}): Promise<OperatorRepresentativeDirectiveRecord | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const now = new Date();
  await db
    .update(operatorRepresentativeDirectives)
    .set({ status: "revoked", revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(operatorRepresentativeDirectives.id, input.directiveId),
        eq(operatorRepresentativeDirectives.tenantId, input.tenantId),
        eq(operatorRepresentativeDirectives.canonicalOperatorId, input.canonicalOperatorId),
        eq(operatorRepresentativeDirectives.status, "active")
      )
    );

  const [row] = await db
    .select()
    .from(operatorRepresentativeDirectives)
    .where(
      and(
        eq(operatorRepresentativeDirectives.id, input.directiveId),
        eq(operatorRepresentativeDirectives.tenantId, input.tenantId),
        eq(operatorRepresentativeDirectives.canonicalOperatorId, input.canonicalOperatorId)
      )
    )
    .limit(1);
  return row ? mapRow(row) : null;
}
