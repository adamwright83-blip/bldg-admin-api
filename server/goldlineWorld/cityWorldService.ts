import { and, asc, eq, inArray } from "drizzle-orm";
import {
  goldlineWorldEvents,
  physicalEntities,
  physicalEntityAliases,
  physicalEntityBindings,
  propertyEvidenceItems,
  towerAssetVersions,
} from "../../drizzle/schema";
import { deriveAttentionReasons, deriveEpistemicState, projectPhysicalWorldState, type GoldlineWorldEvent } from "../../shared/goldlineWorld";
import { getDb } from "../db";

function eventFromRow(row: typeof goldlineWorldEvents.$inferSelect): GoldlineWorldEvent {
  return {
    id: row.id, tenantId: row.tenantId, physicalEntityId: row.physicalEntityId,
    eventType: row.eventType, classification: row.classification, actorType: row.actorType,
    actorId: row.actorId, occurredAt: row.occurredAt.toISOString(), observedAt: row.observedAt?.toISOString() ?? null,
    sourceType: row.sourceType, sourceId: row.sourceId, sourceEvidenceReference: row.sourceEvidenceReference,
    provenanceClass: row.provenanceClass, verificationClass: row.verificationClass,
    confidence: row.confidence, idempotencyKey: row.idempotencyKey, correlationId: row.correlationId,
    metadata: (row.metadataJson ?? {}) as Record<string, unknown>,
  };
}

export async function listCityWorldEntities(input: { tenantId: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const entities = await db.select().from(physicalEntities).where(and(
    eq(physicalEntities.tenantId, input.tenantId),
    inArray(physicalEntities.identityStatus, ["confirmed", "provisional", "needs_review"])
  )).orderBy(asc(physicalEntities.displayName));
  if (!entities.length) return [];
  const ids = entities.map(entity => entity.id);
  const [aliases, bindings, eventRows, evidence, assets] = await Promise.all([
    db.select().from(physicalEntityAliases).where(and(eq(physicalEntityAliases.tenantId, input.tenantId), inArray(physicalEntityAliases.physicalEntityId, ids))),
    db.select().from(physicalEntityBindings).where(and(eq(physicalEntityBindings.tenantId, input.tenantId), inArray(physicalEntityBindings.physicalEntityId, ids))),
    db.select().from(goldlineWorldEvents).where(and(eq(goldlineWorldEvents.tenantId, input.tenantId), inArray(goldlineWorldEvents.physicalEntityId, ids))).orderBy(asc(goldlineWorldEvents.occurredAt)),
    db.select().from(propertyEvidenceItems).where(and(eq(propertyEvidenceItems.tenantId, input.tenantId), inArray(propertyEvidenceItems.physicalEntityId, ids))).orderBy(asc(propertyEvidenceItems.createdAt)),
    db.select().from(towerAssetVersions).where(and(eq(towerAssetVersions.tenantId, input.tenantId), inArray(towerAssetVersions.physicalEntityId, ids), eq(towerAssetVersions.approvalStatus, "approved"))),
  ]);
  return entities.map(entity => {
    const entityBindings = bindings.filter(binding => binding.physicalEntityId === entity.id);
    const events = eventRows.filter(event => event.physicalEntityId === entity.id).map(eventFromRow);
    const entityEvidence = evidence.filter(item => item.physicalEntityId === entity.id);
    const asset = assets.find(item => item.physicalEntityId === entity.id) ?? null;
    const hasConflict = entity.identityStatus === "needs_review" || entityBindings.some(binding => binding.reviewState === "review_required");
    const epistemicState = deriveEpistemicState({
      hasConfirmedEvidence: entity.identityStatus === "confirmed",
      hasConflict,
      hasInference: entity.identityStatus === "provisional",
      hasForecastPressure: false,
    });
    const latestField = [...events].reverse().find(event => event.provenanceClass === "operator_observed" || event.provenanceClass === "operator_reported");
    const attentionReasons = deriveAttentionReasons({
      unresolvedEvidence: hasConflict ? { count: 1, source: `physical_entities:${entity.id}` } : null,
      recentFieldSignal: latestField ? { occurredAt: latestField.occurredAt, source: latestField.sourceEvidenceReference } : null,
      commercialMomentum: [...events].reverse().find(event => ["visited", "proposal_sent", "account_won", "account_lost"].includes(event.eventType)) ? { eventAt: [...events].reverse().find(event => ["visited", "proposal_sent", "account_won", "account_lost"].includes(event.eventType))!.occurredAt, source: [...events].reverse().find(event => ["visited", "proposal_sent", "account_won", "account_lost"].includes(event.eventType))!.sourceEvidenceReference } : null,
    });
    return {
      id: entity.id,
      displayName: entity.displayName,
      identityStatus: entity.identityStatus,
      aliases: aliases.filter(alias => alias.physicalEntityId === entity.id),
      bindings: entityBindings,
      events,
      evidence: entityEvidence,
      canonicalAsset: asset,
      projection: projectPhysicalWorldState({
        physicalEntityId: entity.id, events,
        residentCount: entityBindings.filter(binding => binding.bindingType === "customer_cluster").length,
        activeResidentCount: 0,
        epistemicState, attentionReasons, canonicalTowerAssetId: asset?.id ?? null,
      }),
    };
  });
}

export type CityWorldEntity = Awaited<ReturnType<typeof listCityWorldEntities>>[number];
