/**
 * The city, assembled once, on the server.
 *
 * Lantern City used to match customers to buildings in the browser with its own
 * address normaliser, which meant the client could disagree with the resolver
 * that owns physical identity and split one building across two markers. The
 * matching lives here instead, against the same `normalizePhysicalAlias()` the
 * identity resolver uses, so a building is one building everywhere.
 *
 * Geography is deliberately not stored on the physical entity. Real coordinates
 * belong to the records bound to it, so an entity's location is read back from
 * whichever bound record actually has a verified one — never estimated, never
 * back-filled from a neighbour.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import {
  goldlineWorldEvents,
  physicalEntities,
  physicalEntityAliases,
  physicalEntityBindings,
  propertyEvidenceItems,
  towerAssetVersions,
} from "../../drizzle/schema";
import {
  deriveAttentionReasons,
  deriveEpistemicState,
  projectPhysicalWorldState,
  type GoldlineWorldEvent,
} from "../../shared/goldlineWorld";
import { presentWorldState } from "../../shared/goldlineWorldPresentation";
import { getGeographicTruth } from "../geography/geographicTruthService";
import { normalizePhysicalAlias } from "./identityResolver";
import { getDb } from "../db";

function eventFromRow(row: typeof goldlineWorldEvents.$inferSelect): GoldlineWorldEvent {
  return {
    id: row.id,
    tenantId: row.tenantId,
    physicalEntityId: row.physicalEntityId,
    eventType: row.eventType,
    classification: row.classification,
    actorType: row.actorType,
    actorId: row.actorId,
    occurredAt: row.occurredAt.toISOString(),
    observedAt: row.observedAt?.toISOString() ?? null,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    sourceEvidenceReference: row.sourceEvidenceReference,
    provenanceClass: row.provenanceClass,
    verificationClass: row.verificationClass,
    confidence: row.confidence,
    idempotencyKey: row.idempotencyKey,
    correlationId: row.correlationId,
    metadata: (row.metadataJson ?? {}) as Record<string, unknown>,
  };
}

type GeographicTruth = Awaited<ReturnType<typeof getGeographicTruth>>;
type TruthCustomer = GeographicTruth["customers"][number];
type TruthPursuit = GeographicTruth["pursued"][number];

const COMMERCIAL_MOVEMENT_EVENTS = [
  "visited",
  "visit_attempted",
  "proposal_sent",
  "account_won",
  "account_lost",
];

const FIELD_PROVENANCE = ["operator_observed", "operator_reported"];

/** The most recent event matching a predicate, or null. Events arrive ordered. */
function latestEvent(
  events: GoldlineWorldEvent[],
  matches: (event: GoldlineWorldEvent) => boolean
): GoldlineWorldEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (matches(event)) return event;
  }
  return null;
}

export async function listCityWorldEntities(input: { tenantId: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const entities = await db
    .select()
    .from(physicalEntities)
    .where(
      and(
        eq(physicalEntities.tenantId, input.tenantId),
        inArray(physicalEntities.identityStatus, [
          "confirmed",
          "provisional",
          "needs_review",
        ])
      )
    )
    .orderBy(asc(physicalEntities.displayName));
  if (!entities.length) return [];

  const ids = entities.map(entity => entity.id);
  const [aliases, bindings, eventRows, evidence, assets, geography] =
    await Promise.all([
      db
        .select()
        .from(physicalEntityAliases)
        .where(
          and(
            eq(physicalEntityAliases.tenantId, input.tenantId),
            inArray(physicalEntityAliases.physicalEntityId, ids)
          )
        ),
      db
        .select()
        .from(physicalEntityBindings)
        .where(
          and(
            eq(physicalEntityBindings.tenantId, input.tenantId),
            inArray(physicalEntityBindings.physicalEntityId, ids)
          )
        ),
      db
        .select()
        .from(goldlineWorldEvents)
        .where(
          and(
            eq(goldlineWorldEvents.tenantId, input.tenantId),
            inArray(goldlineWorldEvents.physicalEntityId, ids)
          )
        )
        .orderBy(asc(goldlineWorldEvents.occurredAt)),
      db
        .select()
        .from(propertyEvidenceItems)
        .where(
          and(
            eq(propertyEvidenceItems.tenantId, input.tenantId),
            inArray(propertyEvidenceItems.physicalEntityId, ids)
          )
        )
        .orderBy(asc(propertyEvidenceItems.createdAt)),
      db
        .select()
        .from(towerAssetVersions)
        .where(
          and(
            eq(towerAssetVersions.tenantId, input.tenantId),
            inArray(towerAssetVersions.physicalEntityId, ids),
            eq(towerAssetVersions.approvalStatus, "approved")
          )
        ),
      getGeographicTruth({ tenantId: input.tenantId }),
    ]);

  /**
   * Residents reach a building by the address the geocoder canonicalised,
   * compared through the resolver's own normaliser. A customer with no verified
   * address simply does not join a building — it is not guessed onto one.
   */
  const residentsByEntity = new Map<string, TruthCustomer[]>();
  const addressOwner = new Map<string, string>();
  for (const alias of aliases) {
    if (alias.aliasType !== "normalized_address") continue;
    const key = normalizePhysicalAlias(alias.aliasValue);
    if (!key || addressOwner.has(key)) continue;
    addressOwner.set(key, alias.physicalEntityId);
  }
  for (const customer of geography.customers) {
    const address = customer.location?.canonicalAddress ?? customer.address;
    if (!address) continue;
    const owner = addressOwner.get(normalizePhysicalAlias(address));
    if (!owner) continue;
    const roster = residentsByEntity.get(owner) ?? [];
    roster.push(customer);
    residentsByEntity.set(owner, roster);
  }

  const pursuitByAccountId = new Map<string, TruthPursuit>(
    geography.pursued.map(item => [String(item.accountId), item])
  );

  return entities.map(entity => {
    const entityBindings = bindings.filter(
      binding => binding.physicalEntityId === entity.id
    );
    const events = eventRows
      .filter(event => event.physicalEntityId === entity.id)
      .map(eventFromRow);
    const entityEvidence = evidence.filter(
      item => item.physicalEntityId === entity.id
    );
    const asset = assets.find(item => item.physicalEntityId === entity.id) ?? null;
    const residents = residentsByEntity.get(entity.id) ?? [];
    const pursuit =
      entityBindings
        .filter(binding => binding.bindingType === "commercial_account")
        .map(binding => pursuitByAccountId.get(binding.bindingKey))
        .find(Boolean) ?? null;

    /**
     * One coordinate, taken from a real geocode on a record actually bound to
     * this entity. The pursuit is preferred only because a commercial record is
     * addressed at the building; a resident's verified address is equally real.
     */
    const location =
      pursuit?.location ?? residents.find(item => item.location)?.location ?? null;

    const dormantResidents = residents.filter(
      resident => resident.cadence.state === "dark"
    );
    const activeResidents = residents.filter(
      resident => resident.cadence.state === "active"
    );
    const latestDormant = dormantResidents
      .slice()
      .sort(
        (a, b) => b.cadence.daysSinceLastOrder - a.cadence.daysSinceLastOrder
      )[0];

    const hasConflict =
      entity.identityStatus === "needs_review" ||
      entityBindings.some(binding => binding.reviewState === "review_required");

    /**
     * A resident past their own observed cadence is real history pushing on the
     * present, which is pressure rather than fact — so it colours the world only
     * where nothing better is known, never over a confirmed identity.
     */
    const epistemicState = deriveEpistemicState({
      hasConfirmedEvidence: entity.identityStatus === "confirmed",
      hasConflict,
      hasInference: entity.identityStatus === "provisional",
      hasForecastPressure: dormantResidents.length > 0,
    });

    const latestField = latestEvent(events, event =>
      FIELD_PROVENANCE.includes(event.provenanceClass)
    );
    const latestMovement = latestEvent(events, event =>
      COMMERCIAL_MOVEMENT_EVENTS.includes(event.eventType)
    );

    const attentionReasons = deriveAttentionReasons({
      cadenceRisk:
        latestDormant && latestDormant.cadence.daysSinceLastOrder > 0
          ? {
              daysLate: latestDormant.cadence.daysSinceLastOrder,
              source: `customers:${latestDormant.identityKey}`,
            }
          : null,
      residentCount: residents.length
        ? { count: residents.length, source: `physical_entities:${entity.id}` }
        : null,
      unresolvedEvidence: hasConflict
        ? { count: 1, source: `physical_entities:${entity.id}` }
        : null,
      recentFieldSignal: latestField
        ? {
            occurredAt: latestField.occurredAt,
            source: latestField.sourceEvidenceReference,
          }
        : null,
      commercialMomentum: latestMovement
        ? {
            eventAt: latestMovement.occurredAt,
            source: latestMovement.sourceEvidenceReference,
          }
        : null,
    });

    const projection = projectPhysicalWorldState({
      physicalEntityId: entity.id,
      events,
      residentCount: residents.length,
      activeResidentCount: activeResidents.length,
      epistemicState,
      attentionReasons,
      canonicalTowerAssetId: asset?.id ?? null,
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
      location,
      /** The real residents of this one building, with their own real cadence. */
      residents: residents.map(resident => ({
        identityKey: resident.identityKey,
        displayName: resident.displayName,
        phone: resident.phone,
        cadence: resident.cadence,
        totalOrders: resident.totalOrders,
        lastOrderAt: resident.lastOrderAt,
      })),
      pursuit: pursuit
        ? {
            pipelineId: pursuit.pipelineId,
            accountId: pursuit.accountId,
            name: pursuit.name,
            stage: pursuit.stage,
            address: pursuit.address,
            updatedAt: pursuit.updatedAt,
          }
        : null,
      projection,
      presentation: presentWorldState(projection),
    };
  });
}

export type CityWorldEntity = Awaited<
  ReturnType<typeof listCityWorldEntities>
>[number];
