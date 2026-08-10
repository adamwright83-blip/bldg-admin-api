import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  commercialAccountLocations,
  commercialAccounts,
  commercialFollowUps,
  commercialMissions,
  commercialPipelineRecords,
  driverGameWorldNodes,
} from "../../drizzle/schema";
import {
  visualStateForBusinessStatus,
  type DriverGameWorldNode,
} from "../../shared/driverGameWorld";
import type { CommercialMissionStatus } from "../../shared/commercialMission";
import { getDb } from "../db";

let tableReady: Promise<void> | null = null;

async function ensureDriverGameWorldTable() {
  if (tableReady) return tableReady;
  tableReady = (async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS driver_game_world_nodes (
      id varchar(36) NOT NULL PRIMARY KEY, tenantId varchar(64) NOT NULL, actorId varchar(128) NOT NULL,
      missionId int NOT NULL, entityType varchar(64) NOT NULL DEFAULT 'commercial_mission', entityId varchar(191) NOT NULL,
      locationId int NULL, visualState enum('available','approaching','active','captured','contested','recovery_available','recovery_active','watching','closed') NOT NULL,
      worldAnchor varchar(64) NOT NULL DEFAULT 'fortress_gate', unlockedPath varchar(64) NULL,
      discoveryState enum('hidden','discovered','engaged') NOT NULL DEFAULT 'discovered', lastResolvedAt timestamp NULL,
      metadataJson json NULL, version int NOT NULL DEFAULT 1, createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_driver_game_world_actor_mission (tenantId,actorId,missionId),
      KEY idx_driver_game_world_tenant_actor_state (tenantId,actorId,visualState,updatedAt)
    )`));
  })().catch(error => {
    tableReady = null;
    throw error;
  });
  return tableReady;
}

export async function listDriverGameWorld(input: {
  tenantId: string;
  actorId: string;
}): Promise<DriverGameWorldNode[]> {
  await ensureDriverGameWorldTable();
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select({
      missionId: commercialMissions.id,
      missionStatus: commercialMissions.status,
      accountId: commercialAccounts.id,
      accountName: commercialAccounts.name,
      locationId: commercialAccountLocations.id,
      pipelineStage: commercialPipelineRecords.stage,
      approvedContractValueCents:
        commercialPipelineRecords.approvedContractValueCents,
      realizedRevenueCents: commercialPipelineRecords.realizedRevenueCents,
      lossReason: commercialPipelineRecords.lossReason,
      followUpDue: commercialFollowUps.dueAt,
      savedVisualState: driverGameWorldNodes.visualState,
      savedWorldAnchor: driverGameWorldNodes.worldAnchor,
      savedUnlockedPath: driverGameWorldNodes.unlockedPath,
      savedDiscoveryState: driverGameWorldNodes.discoveryState,
      savedVersion: driverGameWorldNodes.version,
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
      driverGameWorldNodes,
      and(
        eq(driverGameWorldNodes.tenantId, commercialMissions.tenantId),
        eq(driverGameWorldNodes.actorId, input.actorId),
        eq(driverGameWorldNodes.missionId, commercialMissions.id)
      )
    )
    .where(
      and(
        eq(commercialMissions.tenantId, input.tenantId),
        eq(commercialMissions.assignedTo, input.actorId)
      )
    )
    .orderBy(asc(commercialFollowUps.dueAt));

  const byMission = new Map<number, DriverGameWorldNode>();
  for (const row of rows) {
    const visualState = visualStateForBusinessStatus({
      missionStatus: row.missionStatus as CommercialMissionStatus,
      savedVisualState: row.savedVisualState,
    });
    const existing = byMission.get(row.missionId);
    const followUpDue = row.followUpDue?.toISOString() ?? null;
    if (existing) {
      if (!existing.contestedUntil && followUpDue) {
        existing.contestedUntil = followUpDue;
      }
      continue;
    }
    byMission.set(row.missionId, {
      missionId: row.missionId,
      entityType: "commercial_mission",
      entityId: String(row.missionId),
      accountId: row.accountId,
      accountName: row.accountName,
      locationId: row.locationId ?? null,
      missionStatus: row.missionStatus as CommercialMissionStatus,
      visualState,
      worldAnchor:
        visualState === "recovery_active"
          ? "gold_side_entrance"
          : (row.savedWorldAnchor ?? "fortress_gate"),
      unlockedPath:
        visualState === "contested" || visualState === "recovery_active"
          ? (row.savedUnlockedPath ?? "gold_recovery_path")
          : null,
      discoveryState: row.savedDiscoveryState ?? "discovered",
      contestedUntil: followUpDue,
      verifiedAnnualValueCents:
        row.missionStatus === "won" && row.pipelineStage === "won"
          ? (row.approvedContractValueCents ?? null)
          : null,
      realizedRevenueCents: row.realizedRevenueCents ?? 0,
      lossReason: row.lossReason ?? null,
      version: row.savedVersion ?? 0,
    });
  }
  return Array.from(byMission.values());
}

export async function beginDriverRekindle(input: {
  tenantId: string;
  actorId: string;
  missionId: number;
}): Promise<DriverGameWorldNode> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const world = await listDriverGameWorld(input);
  const node = world.find(item => item.missionId === input.missionId);
  if (!node) throw new Error("Commercial mission not found in this field world");
  if (node.missionStatus === "lost") {
    throw new Error("Closed opportunities cannot enter recovery");
  }
  if (node.missionStatus !== "follow_up") {
    throw new Error("A real follow-up must exist before recovery can begin");
  }
  if (node.visualState === "recovery_active") return node;
  const id = randomUUID();
  const resolvedAt = new Date();
  await db
    .insert(driverGameWorldNodes)
    .values({
      id,
      tenantId: input.tenantId,
      actorId: input.actorId,
      missionId: input.missionId,
      entityType: "commercial_mission",
      entityId: String(input.missionId),
      locationId: node.locationId,
      visualState: "recovery_active",
      worldAnchor: "gold_side_entrance",
      unlockedPath: "gold_recovery_path",
      discoveryState: "engaged",
      lastResolvedAt: resolvedAt,
      metadataJson: { source: "follow_up_due" },
    })
    .onDuplicateKeyUpdate({
      set: {
        visualState: "recovery_active",
        worldAnchor: "gold_side_entrance",
        unlockedPath: "gold_recovery_path",
        discoveryState: "engaged",
        lastResolvedAt: resolvedAt,
        version: sql`${driverGameWorldNodes.version} + 1`,
      },
    });
  return {
    ...node,
    visualState: "recovery_active",
    worldAnchor: "gold_side_entrance",
    unlockedPath: "gold_recovery_path",
    discoveryState: "engaged",
    version: node.version + 1,
  };
}
