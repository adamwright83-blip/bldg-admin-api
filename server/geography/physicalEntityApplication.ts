import type { PropertyEvidence } from "../../shared/propertyEvidence";
/** Physical identity/alias/binding persistence. Native customers, Orders and Payment are not owned here. */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { physicalEntities, physicalEntityAliases, physicalEntityBindings, propertyEvidenceItems } from "../../drizzle/schema";
import { getDb } from "../db";
import { normalizePhysicalAlias, resolvePhysicalIdentity, type PhysicalIdentityCandidate } from "./physicalIdentityResolver";

async function identityCandidates(tenantId: string): Promise<PhysicalIdentityCandidate[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [entities, aliases] = await Promise.all([
    db.select().from(physicalEntities).where(and(
      eq(physicalEntities.tenantId, tenantId),
      inArray(physicalEntities.identityStatus, ["confirmed", "provisional", "needs_review"])
    )),
    db.select().from(physicalEntityAliases).where(eq(physicalEntityAliases.tenantId, tenantId)),
  ]);
  return entities.map(entity => {
    const bound = aliases.filter(alias => alias.physicalEntityId === entity.id);
    return {
      physicalEntityId: entity.id,
      displayName: entity.displayName,
      googlePlaceId: bound.find(alias => alias.aliasType === "google_place_id")?.aliasValue ?? null,
      canonicalAddress: bound.find(alias => alias.aliasType === "normalized_address")?.aliasValue ?? null,
      aliases: bound.map(alias => alias.aliasValue),
    };
  });
}

async function persistAlias(input: {
  tenantId: string;
  physicalEntityId: string;
  aliasType: "name" | "normalized_address" | "google_place_id" | "operator_alias";
  value: string;
  evidenceReference: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(physicalEntityAliases).values({
    id: randomUUID(),
    tenantId: input.tenantId,
    physicalEntityId: input.physicalEntityId,
    aliasType: input.aliasType,
    aliasValue: input.value,
    normalizedAliasValue: input.aliasType === "google_place_id" ? input.value.trim() : normalizePhysicalAlias(input.value),
    evidenceReference: input.evidenceReference,
  }).onDuplicateKeyUpdate({ set: { evidenceReference: input.evidenceReference } });
}

export async function bindPhysicalEntity(input: {
  tenantId: string;
  physicalEntityId: string;
  bindingType: (typeof physicalEntityBindings.$inferInsert)["bindingType"];
  bindingKey: string;
  evidenceReference: string;
  confidence?: "high" | "medium" | "low";
  reviewState?: "accepted" | "review_required" | "rejected";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(physicalEntityBindings).values({
    id: randomUUID(),
    tenantId: input.tenantId,
    physicalEntityId: input.physicalEntityId,
    bindingType: input.bindingType,
    bindingKey: input.bindingKey,
    evidenceReference: input.evidenceReference,
    confidence: input.confidence ?? "high",
    reviewState: input.reviewState ?? "accepted",
  }).onDuplicateKeyUpdate({ set: { evidenceReference: input.evidenceReference } });
}

export async function createOrResolvePhysicalEntity(input: {
  tenantId: string;
  jobId: string;
  name: string;
  placeId: string | null;
  address: string | null;
  evidenceReference: string;
}) {
  const resolution = resolvePhysicalIdentity({
    displayName: input.name,
    googlePlaceId: input.placeId,
    canonicalAddress: input.address,
  }, await identityCandidates(input.tenantId));
  if (resolution.status === "needs_review") return resolution;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const physicalEntityId = resolution.status === "matched" ? resolution.physicalEntityId : randomUUID();
  if (resolution.status === "new_entity") {
    await db.insert(physicalEntities).values({
      id: physicalEntityId,
      tenantId: input.tenantId,
      displayName: input.name,
      identityStatus: input.placeId || input.address ? "confirmed" : "provisional",
    });
  }
  await bindPhysicalEntity({ tenantId: input.tenantId, physicalEntityId, bindingType: "journal_entry", bindingKey: input.jobId, evidenceReference: input.evidenceReference });
  await persistAlias({ tenantId: input.tenantId, physicalEntityId, aliasType: "name", value: input.name, evidenceReference: input.evidenceReference });
  if (input.address) await persistAlias({ tenantId: input.tenantId, physicalEntityId, aliasType: "normalized_address", value: input.address, evidenceReference: input.evidenceReference });
  if (input.placeId) {
    await persistAlias({ tenantId: input.tenantId, physicalEntityId, aliasType: "google_place_id", value: input.placeId, evidenceReference: input.evidenceReference });
    await bindPhysicalEntity({ tenantId: input.tenantId, physicalEntityId, bindingType: "provider_place", bindingKey: input.placeId, evidenceReference: input.evidenceReference });
  }
  return { status: "matched" as const, physicalEntityId };
}

export async function persistEvidence(input: {
  tenantId: string;
  physicalEntityId: string;
  forgeJobId: string;
  items: PropertyEvidence[];
  category: "real_identity" | "field_evidence" | "official_property_intelligence";
  sourceUrl?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (!input.items.length) return;
  await db.insert(propertyEvidenceItems).values(input.items.map(item => ({
    id: item.id,
    tenantId: input.tenantId,
    physicalEntityId: input.physicalEntityId,
    forgeJobId: input.forgeJobId,
    category: input.category,
    factType: item.factType,
    valueJson: { value: item.value },
    provenanceClass: item.provenance,
    sourceUrl: input.sourceUrl ?? null,
    sourceReference: item.sourceReference,
    retrievedAt: input.category === "official_property_intelligence" ? new Date() : null,
  })));
}

