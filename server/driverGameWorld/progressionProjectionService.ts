import { and, eq, inArray } from "drizzle-orm";
import {
  armoryWeaponOutcomes,
  armoryWeaponUsages,
  commercialFollowUps,
  commercialMissionEvents,
  commercialMissions,
  commercialPipelineRecords,
  commercialVisitOutcomes,
  driverScoutDiscoveries,
  driverScoutReports,
  salesIntelFrameworks,
  salesIntelSourceArtifacts,
} from "../../drizzle/schema";
import {
  projectGoldlineProgression,
  type GoldlineCommercialCallOutcome,
  type GoldlineProgressionEvidence,
  type GoldlineProgressionProjection,
} from "../../shared/goldlineProgression";
import type {
  ObjectionArchetype,
  SalesIntelChannel,
} from "../../shared/salesIntel";
import { getDb } from "../db";
import { FOUNDATION_WEAPONS } from "../armory/armoryFoundation";
import { listDriverGameWorld } from "./driverGameWorldService";

const REAL_SALES_INTEL_SOURCE_TYPES = [
  "manual_url",
  "instagram",
  "youtube",
  "podcast",
  "uploaded_transcript",
  "other",
] as const;

const CALL_OUTCOMES: readonly GoldlineCommercialCallOutcome[] = [
  "no_answer",
  "left_voicemail",
  "spoke",
  "visit_booked",
  "not_a_fit",
  "contact_unavailable",
];

function readCallOutcome(value: unknown): GoldlineCommercialCallOutcome | null {
  if (!value || typeof value !== "object") return null;
  const outcome = (value as Record<string, unknown>).outcome;
  return CALL_OUTCOMES.find(candidate => candidate === outcome) ?? null;
}

function iso(value: Date): string {
  return value.toISOString();
}

export async function loadGoldlineProgressionEvidence(input: {
  tenantId: string;
  actorId: string;
}): Promise<GoldlineProgressionEvidence> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [
    missionRows,
    callRows,
    followUpRows,
    visitRows,
    world,
    usageRows,
    outcomeRows,
    frameworkRows,
    discoveryRows,
  ] = await Promise.all([
    db
      .select({
        mission: commercialMissions,
        pipeline: commercialPipelineRecords,
      })
      .from(commercialMissions)
      .innerJoin(
        commercialPipelineRecords,
        and(
          eq(commercialPipelineRecords.tenantId, commercialMissions.tenantId),
          eq(commercialPipelineRecords.missionId, commercialMissions.id)
        )
      )
      .where(
        and(
          eq(commercialMissions.tenantId, input.tenantId),
          eq(commercialMissions.assignedTo, input.actorId)
        )
      ),
    db
      .select({ event: commercialMissionEvents })
      .from(commercialMissionEvents)
      .innerJoin(
        commercialMissions,
        and(
          eq(commercialMissions.tenantId, commercialMissionEvents.tenantId),
          eq(commercialMissions.id, commercialMissionEvents.missionId),
          eq(commercialMissions.assignedTo, input.actorId)
        )
      )
      .where(
        and(
          eq(commercialMissionEvents.tenantId, input.tenantId),
          eq(commercialMissionEvents.actorId, input.actorId),
          eq(commercialMissionEvents.eventName, "cold_call_logged")
        )
      ),
    db
      .select({ followUp: commercialFollowUps })
      .from(commercialFollowUps)
      .innerJoin(
        commercialMissions,
        and(
          eq(commercialMissions.tenantId, commercialFollowUps.tenantId),
          eq(commercialMissions.id, commercialFollowUps.missionId),
          eq(commercialMissions.assignedTo, input.actorId)
        )
      )
      .where(eq(commercialFollowUps.tenantId, input.tenantId)),
    db
      .select({ visit: commercialVisitOutcomes })
      .from(commercialVisitOutcomes)
      .innerJoin(
        commercialMissions,
        and(
          eq(commercialMissions.tenantId, commercialVisitOutcomes.tenantId),
          eq(commercialMissions.id, commercialVisitOutcomes.missionId),
          eq(commercialMissions.assignedTo, input.actorId)
        )
      )
      .where(
        and(
          eq(commercialVisitOutcomes.tenantId, input.tenantId),
          eq(commercialVisitOutcomes.recordedBy, input.actorId)
        )
      ),
    listDriverGameWorld(input),
    db
      .select({ usage: armoryWeaponUsages })
      .from(armoryWeaponUsages)
      .innerJoin(
        commercialMissions,
        and(
          eq(commercialMissions.tenantId, armoryWeaponUsages.tenantId),
          eq(commercialMissions.id, armoryWeaponUsages.missionId),
          eq(commercialMissions.assignedTo, input.actorId)
        )
      )
      .where(
        and(
          eq(armoryWeaponUsages.tenantId, input.tenantId),
          eq(armoryWeaponUsages.actorId, input.actorId)
        )
      ),
    db
      .select()
      .from(armoryWeaponOutcomes)
      .where(
        and(
          eq(armoryWeaponOutcomes.tenantId, input.tenantId),
          eq(armoryWeaponOutcomes.actorId, input.actorId)
        )
      ),
    db
      .select({
        framework: salesIntelFrameworks,
        source: salesIntelSourceArtifacts,
      })
      .from(salesIntelFrameworks)
      .innerJoin(
        salesIntelSourceArtifacts,
        eq(salesIntelSourceArtifacts.id, salesIntelFrameworks.sourceArtifactId)
      )
      .where(
        and(
          eq(salesIntelFrameworks.reviewState, "accepted"),
          eq(salesIntelFrameworks.active, true),
          eq(salesIntelSourceArtifacts.status, "extracted"),
          inArray(
            salesIntelSourceArtifacts.sourceType,
            REAL_SALES_INTEL_SOURCE_TYPES
          )
        )
      ),
    db
      .select({
        discovery: driverScoutDiscoveries,
        report: driverScoutReports,
        missionStatus: commercialMissions.status,
      })
      .from(driverScoutDiscoveries)
      .innerJoin(
        driverScoutReports,
        and(
          eq(driverScoutReports.id, driverScoutDiscoveries.reportId),
          eq(driverScoutReports.tenantId, driverScoutDiscoveries.tenantId),
          eq(driverScoutReports.actorId, input.actorId)
        )
      )
      .innerJoin(
        commercialMissions,
        and(
          eq(commercialMissions.tenantId, driverScoutDiscoveries.tenantId),
          eq(commercialMissions.id, driverScoutDiscoveries.missionId),
          eq(commercialMissions.assignedTo, input.actorId)
        )
      )
      .where(
        and(
          eq(driverScoutDiscoveries.tenantId, input.tenantId),
          eq(driverScoutDiscoveries.actorId, input.actorId)
        )
      ),
  ]);

  const supportByDoctrine = new Map<string, Set<string>>();
  for (const row of frameworkRows) {
    const key = [
      row.framework.archetype,
      row.framework.channel,
      row.framework.responseFamily,
    ].join(":");
    const sources = supportByDoctrine.get(key) ?? new Set<string>();
    sources.add(row.framework.sourceArtifactId);
    supportByDoctrine.set(key, sources);
  }
  const acceptedFrameworkById = new Map(
    frameworkRows.map(row => [row.framework.id, row.framework])
  );
  const foundationById = new Map(
    FOUNDATION_WEAPONS.map(weapon => [weapon.id, weapon])
  );
  const validatedUsages = usageRows
    .map(row => row.usage)
    .filter(usage => {
      if (usage.frameworkId) {
        const framework = acceptedFrameworkById.get(usage.frameworkId);
        return (
          usage.weaponId === `framework:${usage.frameworkId}` &&
          framework?.archetype === usage.archetype &&
          framework.channel === usage.channel
        );
      }
      const foundation = foundationById.get(usage.weaponId);
      return (
        foundation?.archetype === usage.archetype &&
        foundation.channels.includes(usage.channel as SalesIntelChannel)
      );
    });
  const validatedUsageIds = new Set(validatedUsages.map(usage => usage.id));

  return {
    tenantId: input.tenantId,
    actorId: input.actorId,
    missions: missionRows.map(({ mission, pipeline }) => ({
      missionId: mission.id,
      accountId: pipeline.accountId,
      assignedTo: mission.assignedTo ?? "",
      status: mission.status,
      pipelineStage: pipeline.stage,
      completedAt: mission.completedAt ? iso(mission.completedAt) : null,
      updatedAt: iso(mission.updatedAt),
    })),
    calls: callRows.flatMap(({ event }) => {
      const outcome = readCallOutcome(event.metadataJson);
      return outcome
        ? [
            {
              eventId: event.id,
              missionId: event.missionId,
              actorId: event.actorId ?? "",
              outcome,
              createdAt: iso(event.createdAt),
            },
          ]
        : [];
    }),
    followUps: followUpRows.map(({ followUp }) => ({
      followUpId: followUp.id,
      missionId: followUp.missionId,
      status: followUp.status,
      dueAt: iso(followUp.dueAt),
      assignedTo: followUp.assignedTo,
      createdBy: followUp.createdBy,
      createdAt: iso(followUp.createdAt),
      completedAt: followUp.completedAt ? iso(followUp.completedAt) : null,
      completedBy: followUp.completedBy,
    })),
    visits: visitRows.map(({ visit }) => ({
      visitOutcomeId: visit.id,
      missionId: visit.missionId,
      recordedBy: visit.recordedBy,
      outcome: visit.outcome,
      createdAt: iso(visit.createdAt),
    })),
    recoveries: world
      .filter(
        node =>
          node.visualState === "recovery_available" ||
          node.visualState === "recovery_active"
      )
      .map(node => ({
        missionId: node.missionId,
        actorId: input.actorId,
        state: node.visualState as "recovery_available" | "recovery_active",
        verifiedAt:
          node.visualState === "recovery_active" ? node.resolvedAt : null,
        sourceRef:
          node.visualState === "recovery_active"
            ? `driver_game_world_nodes:mission:${node.missionId}`
            : `commercial_follow_ups:mission:${node.missionId}`,
      })),
    armoryUsages: validatedUsages.map(usage => ({
      usageId: usage.id,
      missionId: usage.missionId,
      actorId: usage.actorId,
      weaponId: usage.weaponId,
      frameworkId: usage.frameworkId,
      archetype: usage.archetype as ObjectionArchetype,
      channel: usage.channel as SalesIntelChannel,
      requestId: usage.requestId,
      usedAt: iso(usage.usedAt),
    })),
    armoryOutcomes: outcomeRows
      .filter(outcome => validatedUsageIds.has(outcome.usageId))
      .map(outcome => ({
        outcomeId: outcome.id,
        usageId: outcome.usageId,
        missionId: outcome.missionId,
        actorId: outcome.actorId,
        outcomeKind: outcome.outcomeKind,
        outcomeReference: outcome.outcomeReference,
        observedAt: iso(outcome.observedAt),
      })),
    trainerFrameworks: frameworkRows.map(({ framework }) => {
      const key = [
        framework.archetype,
        framework.channel,
        framework.responseFamily,
      ].join(":");
      const support = supportByDoctrine.get(key)?.size ?? 0;
      return {
        frameworkId: framework.id,
        sourceArtifactId: framework.sourceArtifactId,
        archetype: framework.archetype as ObjectionArchetype,
        channel: framework.channel as SalesIntelChannel,
        responseFamily: framework.responseFamily,
        independentSourceSupportCount: Math.max(0, support - 1),
        acceptedAt: iso(framework.reviewedAt ?? framework.createdAt),
      };
    }),
    scoutDiscoveries: discoveryRows
      .filter(
        row => row.missionStatus !== "won" && row.missionStatus !== "lost"
      )
      .map(({ discovery, report }) => ({
        reportId: report.id,
        missionId: discovery.missionId,
        actorId: discovery.actorId,
        sourceRef: discovery.sourceReference,
        generatedAt: iso(report.generatedAt),
      })),
  };
}

export async function projectGoldlineProgressionForIdentity(input: {
  tenantId: string;
  actorId: string;
  now?: Date;
}): Promise<GoldlineProgressionProjection> {
  const evidence = await loadGoldlineProgressionEvidence(input);
  return projectGoldlineProgression(evidence, input.now ?? new Date());
}
