/**
 * Finds the physical entity a real record already belongs to.
 *
 * This is deliberately lookup-only. Creating an entity is an identity decision
 * that belongs to the resolver and its review states, so a customer event that
 * cannot find a building leaves `physicalEntityId` null and stays truthful
 * rather than inventing a place to attach itself to.
 */

import { and, eq } from "drizzle-orm";
import { physicalEntities, physicalEntityAliases, physicalEntityBindings } from "../../drizzle/schema";
import { getDb } from "../db";
import { normalizePhysicalAlias, physicalAliasesMatch } from "./identityResolver";

export async function findPhysicalEntityIdByAddress(input: {
  tenantId: string;
  address: string | null | undefined;
}): Promise<string | null> {
  if (!input.address?.trim()) return null;
  const db = await getDb();
  if (!db) return null;
  const normalized = normalizePhysicalAlias(input.address);
  if (!normalized) return null;
  /*
    Matching happens on the doorway rather than on the exact stored string, so
    a reference that spells the street differently or omits the city still
    finds the building it belongs to. Stored rows may also predate the current
    normaliser, which exact column equality would silently miss.
  */
  const rows = await db
    .select({
      physicalEntityId: physicalEntityAliases.physicalEntityId,
      aliasValue: physicalEntityAliases.aliasValue,
    })
    .from(physicalEntityAliases)
    .where(eq(physicalEntityAliases.tenantId, input.tenantId));
  const entities = await db
    .select({ id: physicalEntities.id, displayName: physicalEntities.displayName })
    .from(physicalEntities)
    .where(eq(physicalEntities.tenantId, input.tenantId));
  const unique = new Set([
    ...entities
      .filter(entity => physicalAliasesMatch(entity.displayName, input.address!))
      .map(entity => entity.id),
    ...rows
      .filter(row => physicalAliasesMatch(row.aliasValue, input.address!))
      .map(row => row.physicalEntityId)
  ]);
  // An address bound to two entities is an unresolved identity conflict, not a
  // coin flip. Attaching to either one would assert something untrue.
  return unique.size === 1 ? Array.from(unique)[0]! : null;
}

export async function findPhysicalEntityIdByBinding(input: {
  tenantId: string;
  bindingType: typeof physicalEntityBindings.$inferSelect["bindingType"];
  bindingKey: string;
}): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ physicalEntityId: physicalEntityBindings.physicalEntityId })
    .from(physicalEntityBindings)
    .where(
      and(
        eq(physicalEntityBindings.tenantId, input.tenantId),
        eq(physicalEntityBindings.bindingType, input.bindingType),
        eq(physicalEntityBindings.bindingKey, input.bindingKey)
      )
    );
  const unique = new Set(rows.map(row => row.physicalEntityId));
  return unique.size === 1 ? rows[0]!.physicalEntityId : null;
}
