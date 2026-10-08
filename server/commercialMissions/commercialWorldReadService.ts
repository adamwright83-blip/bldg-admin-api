import { and, asc, eq } from "drizzle-orm";
import {
  commercialAccountLocations,
  commercialAccounts,
  commercialFollowUps,
  commercialMissionEvents,
  commercialMissions,
  commercialPipelineRecords,
  commercialVisitOutcomes,
} from "../../drizzle/schema";
import { PARKING_LOT_CLERK_EVENT_NAME } from "../../shared/commercialMissionField";
import { getDb } from "../db";

type ActorScope = { tenantId: string; actorId: string };
function requireScope(input: ActorScope): ActorScope {
  const tenantId = input.tenantId.trim();
  const actorId = input.actorId.trim();
  if (!tenantId || !actorId)
    throw new Error(
      "Commercial world reads require tenant and actor authority"
    );
  return { tenantId, actorId };
}

/** Commercial-owned business facts. Game state cannot participate in this read. */
export async function readCommercialWorldFactsForActor(scope: ActorScope) {
  const input = requireScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select({
      missionId: commercialMissions.id,
      missionStatus: commercialMissions.status,
      missionCompletedAt: commercialMissions.completedAt,
      accountId: commercialAccounts.id,
      accountName: commercialAccounts.name,
      locationId: commercialAccountLocations.id,
      pipelineStage: commercialPipelineRecords.stage,
      approvedContractValueCents:
        commercialPipelineRecords.approvedContractValueCents,
      realizedRevenueCents: commercialPipelineRecords.realizedRevenueCents,
      lossReason: commercialPipelineRecords.lossReason,
      followUpDue: commercialFollowUps.dueAt,
      clerkActorId: commercialMissionEvents.actorId,
      clerkCreatedAt: commercialMissionEvents.createdAt,
    })
    .from(commercialMissions)
    .innerJoin(
      commercialPipelineRecords,
      and(
        eq(commercialPipelineRecords.tenantId, commercialMissions.tenantId),
        eq(commercialPipelineRecords.missionId, commercialMissions.id)
      )
    )
    .innerJoin(
      commercialAccounts,
      and(
        eq(commercialAccounts.tenantId, commercialMissions.tenantId),
        eq(commercialAccounts.id, commercialPipelineRecords.accountId)
      )
    )
    .leftJoin(
      commercialAccountLocations,
      and(
        eq(commercialAccountLocations.tenantId, commercialMissions.tenantId),
        eq(
          commercialAccountLocations.accountId,
          commercialPipelineRecords.accountId
        ),
        eq(commercialAccountLocations.isPrimary, true)
      )
    )
    .leftJoin(
      commercialFollowUps,
      and(
        eq(commercialFollowUps.tenantId, commercialMissions.tenantId),
        eq(commercialFollowUps.missionId, commercialMissions.id),
        eq(commercialFollowUps.status, "open")
      )
    )
    .leftJoin(
      commercialMissionEvents,
      and(
        eq(commercialMissionEvents.tenantId, commercialMissions.tenantId),
        eq(commercialMissionEvents.missionId, commercialMissions.id),
        eq(commercialMissionEvents.eventName, PARKING_LOT_CLERK_EVENT_NAME)
      )
    )
    .where(
      and(
        eq(commercialMissions.tenantId, input.tenantId),
        eq(commercialMissions.assignedTo, input.actorId)
      )
    )
    .orderBy(asc(commercialFollowUps.dueAt));
}

/** Canonical Commercial inputs for downstream progression; SELECT-only. */
export async function readCommercialProgressionFactsForActor(
  scope: ActorScope
) {
  const input = requireScope(scope);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [missionRows, callRows, followUpRows, visitRows] = await Promise.all([
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
  ]);
  return { missionRows, callRows, followUpRows, visitRows };
}
