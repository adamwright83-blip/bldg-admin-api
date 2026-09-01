/**
 * Finds the physical entity a real record already belongs to.
 *
 * This is deliberately lookup-only. Creating an entity is an identity decision
 * that belongs to the resolver and its review states, so a customer event that
 * cannot find a building leaves `physicalEntityId` null and stays truthful
 * rather than inventing a place to attach itself to.
 */

import { and, eq } from "drizzle-orm";
import { physicalEntityAliases, physicalEntityBindings } from "../../drizzle/schema";
import { getDb } from "../db";
import { normalizePhysicalAlias } from "./identityResolver";

export async function findPhysicalEntityIdByAddress(input: {
  tenantId: string;
  address: string | null | undefined;
}): Promise<string | null> {
  if (!input.address?.trim()) return null;
  const db = await getDb();
  if (!db) return null;
  const normalized = normalizePhysicalAlias(input.address);
  if (!normalized) return null;
  const rows = await db
    .select({ physicalEntityId: physicalEntityAliases.physicalEntityId })
    .from(physicalEntityAliases)
    .where(
      and(
        eq(physicalEntityAliases.tenantId, input.tenantId),
        eq(physicalEntityAliases.aliasType, "normalized_address"),
        eq(physicalEntityAliases.normalizedAliasValue, normalized)
      )
    );
  const unique = new Set(rows.map(row => row.physicalEntityId));
  // An address bound to two entities is an unresolved identity conflict, not a
  // coin flip. Attaching to either one would assert something untrue.
  return unique.size === 1 ? rows[0]!.physicalEntityId : null;
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
