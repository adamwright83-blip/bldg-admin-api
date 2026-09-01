/**
 * Published Goldline territories.
 *
 * Definitions persist. Progress does not — it is derived from Chronicle every
 * time the world is asked. Compiling a new candidate cannot steal members from
 * a published territory. Guardian defeat writes only game_projection events.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  goldlineTerritoryDefinitions,
  goldlineWorldEvents,
} from "../../drizzle/schema";
import { compileTerritoryCandidates } from "../../shared/goldlineTerritoryCompiler";
import {
  deriveTerritoryState,
  territoryGameEventContract,
  type PresentedTerritory,
  type TerritoryDefinition,
  type TerritoryMember,
  type TerritorySourceOpportunity,
} from "../../shared/goldlineTerritories";
import type { GoldlineWorldEvent } from "../../shared/goldlineWorld";
import { getDb } from "../db";
import { listCityWorldEntities, type CityWorldEntity } from "./cityWorldService";
import { appendGoldlineWorldEvent } from "./worldEventStore";

function toDefinition(
  row: typeof goldlineTerritoryDefinitions.$inferSelect
): TerritoryDefinition {
  return {
    id: row.id,
    tenantId: row.tenantId,
    stableKey: row.stableKey,
    version: row.version,
    fantasyTitle: row.fantasyTitle,
    realGeographyLabel: row.realGeographyLabel,
    grammar: row.grammar,
    guardianId: row.guardianId,
    members: (row.membersJson as TerritoryMember[]) ?? [],
    geometryMode: row.geometryMode,
    createdFrom: row.createdFrom,
    publishedAt: row.publishedAt.toISOString(),
    classification: "game_projection",
  };
}

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

export function sourcesFromCityEntities(
  entities: readonly CityWorldEntity[]
): TerritorySourceOpportunity[] {
  return entities.flatMap(entity => {
    const latitude = entity.location?.latitude;
    const longitude = entity.location?.longitude;
    if (typeof latitude !== "number" || typeof longitude !== "number") return [];
    const events = entity.events ?? [];
    const commercialState = entity.projection?.commercialState;
    return [
      {
        physicalEntityId: entity.id,
        displayName: entity.displayName,
        latitude,
        longitude,
        pipelineStage: entity.pursuit?.stage ?? null,
        hasVisitEvidence: events.some(
          event => event.eventType === "visited" || event.eventType === "visit_attempted"
        ),
        hasContactEvidence: events.some(event =>
          ["call_completed", "text_sent", "email_sent", "recovery_outreach_completed"].includes(
            event.eventType
          )
        ),
        hasProposalEvidence: events.some(event => event.eventType === "proposal_sent"),
        isWonAccount: commercialState === "won",
        realGeographyLabel: entity.pursuit?.address ?? entity.displayName,
      },
    ];
  });
}

export async function listPublishedTerritoryDefinitions(input: {
  tenantId: string;
}): Promise<TerritoryDefinition[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(goldlineTerritoryDefinitions)
    .where(eq(goldlineTerritoryDefinitions.tenantId, input.tenantId))
    .orderBy(desc(goldlineTerritoryDefinitions.publishedAt));
  return rows.map(toDefinition);
}

async function publishCandidate(input: {
  tenantId: string;
  candidate: ReturnType<typeof compileTerritoryCandidates>[number];
}): Promise<TerritoryDefinition> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const id = randomUUID();
  const publishedAt = new Date();
  await db.insert(goldlineTerritoryDefinitions).values({
    id,
    tenantId: input.tenantId,
    stableKey: input.candidate.stableKey,
    version: 1,
    fantasyTitle: input.candidate.fantasyTitle,
    realGeographyLabel: input.candidate.realGeographyLabel,
    grammar: input.candidate.grammar,
    guardianId: input.candidate.guardianId,
    geometryMode: input.candidate.geometryMode,
    membersJson: input.candidate.members,
    createdFrom: input.candidate.createdFrom,
    classification: "game_projection",
    publishedAt,
  });
  const definition: TerritoryDefinition = {
    id,
    tenantId: input.tenantId,
    stableKey: input.candidate.stableKey,
    version: 1,
    fantasyTitle: input.candidate.fantasyTitle,
    realGeographyLabel: input.candidate.realGeographyLabel,
    grammar: input.candidate.grammar,
    guardianId: input.candidate.guardianId,
    members: input.candidate.members,
    geometryMode: input.candidate.geometryMode,
    createdFrom: input.candidate.createdFrom,
    publishedAt: publishedAt.toISOString(),
    classification: "game_projection",
  };
  await appendGoldlineWorldEvent({
    tenantId: input.tenantId,
    physicalEntityId: null,
    eventType: "territory_published",
    classification: "game_projection",
    actorType: "system",
    actorId: null,
    occurredAt: publishedAt.toISOString(),
    observedAt: publishedAt.toISOString(),
    sourceType: "goldline_territory",
    sourceId: id,
    sourceEvidenceReference: `goldline_territory_definitions:${id}`,
    provenanceClass: "generated_game_fiction",
    verificationClass: "CLAIMED",
    confidence: "unknown",
    idempotencyKey: `territory-published:${input.tenantId}:${input.candidate.stableKey}:1`,
    correlationId: id,
    metadata: {
      territoryId: id,
      guardianId: input.candidate.guardianId,
      memberPhysicalEntityIds: input.candidate.members.map(member => member.physicalEntityId),
      classification: "game_projection",
    },
  });
  return definition;
}

export async function compileAndPublishTerritories(input: {
  tenantId: string;
}): Promise<TerritoryDefinition[]> {
  const published = await listPublishedTerritoryDefinitions(input);
  const occupied = new Set(
    published.flatMap(definition => definition.members.map(member => member.physicalEntityId))
  );
  const entities = await listCityWorldEntities({ tenantId: input.tenantId });
  const candidates = compileTerritoryCandidates({
    tenantId: input.tenantId,
    sources: sourcesFromCityEntities(entities),
    occupiedPhysicalEntityIds: occupied,
  });
  const knownKeys = new Set(published.map(definition => definition.stableKey));
  const created: TerritoryDefinition[] = [];
  for (const candidate of candidates) {
    if (knownKeys.has(candidate.stableKey)) continue;
    created.push(await publishCandidate({ tenantId: input.tenantId, candidate }));
  }
  return [...published, ...created];
}

export async function listTerritoryChronicle(input: {
  tenantId: string;
  definition: TerritoryDefinition;
}): Promise<GoldlineWorldEvent[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const memberIds = input.definition.members.map(member => member.physicalEntityId);
  const rows = await db
    .select()
    .from(goldlineWorldEvents)
    .where(
      and(
        eq(goldlineWorldEvents.tenantId, input.tenantId),
        memberIds.length
          ? or(
              inArray(goldlineWorldEvents.physicalEntityId, memberIds),
              eq(goldlineWorldEvents.sourceId, input.definition.id)
            )
          : eq(goldlineWorldEvents.sourceId, input.definition.id)
      )
    )
    .orderBy(goldlineWorldEvents.occurredAt);
  return rows.map(eventFromRow);
}

export async function listPresentedTerritories(input: {
  tenantId: string;
}): Promise<PresentedTerritory[]> {
  const definitions = await compileAndPublishTerritories(input);
  const presented: PresentedTerritory[] = [];
  for (const definition of definitions) {
    const events = await listTerritoryChronicle({ tenantId: input.tenantId, definition });
    presented.push({
      definition,
      state: deriveTerritoryState({ definition, events }),
    });
  }
  return presented;
}

export async function recordGuardianDefeated(input: {
  tenantId: string;
  territoryId: string;
  guardianId: string;
  actorId: string | null;
  confrontationReady: boolean;
}): Promise<{ recorded: boolean; reason: string }> {
  if (!input.confrontationReady) {
    return { recorded: false, reason: "Guardian cannot be permanently cleared before confrontation readiness." };
  }
  const definitions = await listPublishedTerritoryDefinitions(input);
  const definition = definitions.find(item => item.id === input.territoryId);
  if (!definition) return { recorded: false, reason: "Unknown territory." };
  if (definition.guardianId !== input.guardianId) {
    return { recorded: false, reason: "Guardian does not belong to this territory." };
  }
  const events = await listTerritoryChronicle({ tenantId: input.tenantId, definition });
  const state = deriveTerritoryState({ definition, events });
  if (!state.confrontationReady && !state.cleared) {
    return { recorded: false, reason: "Derived readiness is not confrontation-ready." };
  }
  if (state.cleared) return { recorded: true, reason: "Already cleared." };

  const payload = {
    classification: "game_projection" as const,
    provenanceClass: "generated_game_fiction" as const,
    eventType: "guardian_defeated",
  };
  if (!territoryGameEventContract(payload)) {
    return { recorded: false, reason: "Territory events must remain game projection." };
  }

  const occurredAt = new Date().toISOString();
  const shared = {
    tenantId: input.tenantId,
    physicalEntityId: null,
    actorType: "operator" as const,
    actorId: input.actorId,
    occurredAt,
    observedAt: occurredAt,
    sourceType: "goldline_territory",
    sourceId: definition.id,
    sourceEvidenceReference: `goldline_territory_definitions:${definition.id}`,
    provenanceClass: "generated_game_fiction" as const,
    verificationClass: "CLAIMED" as const,
    confidence: "unknown" as const,
    correlationId: definition.id,
    metadata: {
      territoryId: definition.id,
      guardianId: input.guardianId,
      memberPhysicalEntityIds: definition.members.map(member => member.physicalEntityId),
      progressSnapshot: {
        completedMemberIds: state.completedMemberIds,
        remainingMemberIds: state.remainingMemberIds,
      },
      classification: "game_projection",
    },
  };

  await appendGoldlineWorldEvent({
    ...shared,
    eventType: "guardian_defeated",
    classification: "game_projection",
    idempotencyKey: `guardian-defeated:${input.tenantId}:${definition.id}:${definition.version}`,
  });
  await appendGoldlineWorldEvent({
    ...shared,
    eventType: "territory_cleared",
    classification: "game_projection",
    idempotencyKey: `territory-cleared:${input.tenantId}:${definition.id}:${definition.version}`,
  });
  return { recorded: true, reason: "Guardian defeated recorded as game projection only." };
}
