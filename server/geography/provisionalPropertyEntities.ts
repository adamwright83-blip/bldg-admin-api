import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { physicalEntities, physicalEntityAliases } from "../../drizzle/schema";
import { getDb } from "../db";
import { getGeographicTruth, normalizeSourceAddress } from "./geographicTruthService";
import { normalizePhysicalAlias } from "./physicalIdentityResolver";
type GeographicTruth = Awaited<ReturnType<typeof getGeographicTruth>>;

/**
 * A paid order's address is already geocoded tenant-wide (see
 * `getGeographicTruth`), whether or not it belongs to a recognised tower. A
 * customer who never matches an existing alias would otherwise have a real
 * doorway and no lantern to stand in. This gives them one: a plain `property`
 * entity, `provisional` (never `confirmed` — nobody has verified it by hand),
 * keyed to the same normalized address the resident-matching pass already
 * checks against. Buildings are untouched; this only fills gaps.
 *
 * This runs on a read path, so two first reads can arrive concurrently. The
 * database unique key on tenant + alias type + normalized alias is the ownership
 * lock. Each candidate entity and its alias are created in one transaction. If
 * another request wins that unique key, this transaction rolls back (so it
 * cannot leave an orphan entity), then we verify the winning alias exists and
 * treat the address as already materialized.
 */
export async function ensurePropertyEntitiesForUnmatchedCustomers(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  tenantId: string,
  geography: GeographicTruth
): Promise<void> {
  const existingAliases = await db
    .select()
    .from(physicalEntityAliases)
    .where(
      and(
        eq(physicalEntityAliases.tenantId, tenantId),
        eq(physicalEntityAliases.aliasType, "normalized_address")
      )
    );
  const knownNormalized = new Set(
    existingAliases.map(alias => normalizePhysicalAlias(alias.aliasValue))
  );
  const seenThisPass = new Set<string>();

  for (const customer of geography.customers) {
    const address = customer.location?.canonicalAddress ?? null;
    if (!address) continue;

    const normalized = normalizePhysicalAlias(address);
    const normalizedAliasValue = normalizeSourceAddress(address);
    if (
      !normalized ||
      !normalizedAliasValue ||
      knownNormalized.has(normalized) ||
      seenThisPass.has(normalizedAliasValue)
    ) {
      continue;
    }
    seenThisPass.add(normalizedAliasValue);

    try {
      await db.transaction(async tx => {
        // Re-check against the exact value protected by uq_physical_alias. The
        // snapshot above is only an optimisation; this is the concurrency gate.
        const [existing] = await tx
          .select({ id: physicalEntityAliases.id })
          .from(physicalEntityAliases)
          .where(
            and(
              eq(physicalEntityAliases.tenantId, tenantId),
              eq(physicalEntityAliases.aliasType, "normalized_address"),
              eq(
                physicalEntityAliases.normalizedAliasValue,
                normalizedAliasValue
              )
            )
          )
          .limit(1);
        if (existing) return;

        const entityId = randomUUID();
        await tx.insert(physicalEntities).values({
          id: entityId,
          tenantId,
          kind: "property",
          displayName: address,
          identityStatus: "provisional",
        });
        await tx.insert(physicalEntityAliases).values({
          id: randomUUID(),
          tenantId,
          physicalEntityId: entityId,
          aliasType: "normalized_address",
          aliasValue: address,
          normalizedAliasValue,
          evidenceReference: "cleancloud_order_geocode",
        });
      });
      knownNormalized.add(normalized);
    } catch (error) {
      // A concurrent first read may have inserted the same unique alias after
      // our in-transaction re-check. Let the transaction roll back its candidate
      // entity, then accept the winner only if the authoritative alias now
      // exists. Any other database failure remains a real failure.
      const [winner] = await db
        .select({ id: physicalEntityAliases.id })
        .from(physicalEntityAliases)
        .where(
          and(
            eq(physicalEntityAliases.tenantId, tenantId),
            eq(physicalEntityAliases.aliasType, "normalized_address"),
            eq(
              physicalEntityAliases.normalizedAliasValue,
              normalizedAliasValue
            )
          )
        )
        .limit(1);
      if (winner) {
        knownNormalized.add(normalized);
        continue;
      }
      throw error;
    }
  }
}

