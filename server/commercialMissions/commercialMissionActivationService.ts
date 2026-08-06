import { and, eq } from "drizzle-orm";
import {
  commercialMissionEvents,
  commercialMissions,
  dayforgeSaasMemberships,
  opsTasks,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  readCommercialMissionWith,
  transitionCommercialMissionWith,
} from "./commercialMissionStore";

export type CommercialMissionFieldAssignee = {
  openId: string;
  name: string;
  source: "membership" | "legacy_driver";
};

export async function listCommercialMissionFieldAssignees(
  tenantId: string
): Promise<CommercialMissionFieldAssignee[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [memberships, drivers] = await Promise.all([
    db
      .select({ openId: dayforgeSaasMemberships.userOpenId })
      .from(dayforgeSaasMemberships)
      .where(
        and(
          eq(dayforgeSaasMemberships.tenantId, tenantId),
          eq(dayforgeSaasMemberships.role, "field"),
          eq(dayforgeSaasMemberships.active, true)
        )
      ),
    db
      .select({ openId: users.openId, name: users.name })
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          eq(users.role, "driver")
        )
      ),
  ]);
  const result = new Map<string, CommercialMissionFieldAssignee>();
  for (const membership of memberships) {
    result.set(membership.openId, {
      openId: membership.openId,
      name: membership.openId,
      source: "membership",
    });
  }
  for (const driver of drivers) {
    result.set(driver.openId, {
      openId: driver.openId,
      name: driver.name?.trim() || driver.openId,
      source: "legacy_driver",
    });
  }
  return Array.from(result.values()).sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}

export async function activateCommercialMissionForField(input: {
  tenantId: string;
  missionId: number;
  expectedVersion: number;
  assignedTo: string;
  actorId: string;
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const replay = await tx
      .select({ missionId: commercialMissionEvents.missionId })
      .from(commercialMissionEvents)
      .where(
        and(
          eq(commercialMissionEvents.tenantId, input.tenantId),
          eq(
            commercialMissionEvents.idempotencyKey,
            `mission-activate:${input.requestId}`
          )
        )
      )
      .limit(1);
    if (replay[0]) {
      if (replay[0].missionId !== input.missionId)
        throw new Error("Mission activation request is bound to another mission");
      const existing = await readCommercialMissionWith(tx, input);
      if (!existing) throw new Error("Activated commercial mission is missing");
      return existing;
    }

    let mission = await readCommercialMissionWith(tx, input);
    if (!mission) throw new Error("Commercial mission not found");
    if (mission.version !== input.expectedVersion) {
      throw new Error(
        `Commercial mission version conflict: expected ${input.expectedVersion}, found ${mission.version}`
      );
    }
    if (!["candidate", "selected", "game_ready"].includes(mission.status)) {
      throw new Error(`Commercial mission cannot be activated from ${mission.status}`);
    }

    const [membership] = await tx
      .select({ openId: dayforgeSaasMemberships.userOpenId })
      .from(dayforgeSaasMemberships)
      .where(
        and(
          eq(dayforgeSaasMemberships.tenantId, input.tenantId),
          eq(dayforgeSaasMemberships.userOpenId, input.assignedTo),
          eq(dayforgeSaasMemberships.role, "field"),
          eq(dayforgeSaasMemberships.active, true)
        )
      )
      .limit(1);
    const [legacyDriver] = membership
      ? []
      : await tx
          .select({ openId: users.openId })
          .from(users)
          .where(
            and(
              eq(users.tenantId, input.tenantId),
              eq(users.openId, input.assignedTo),
              eq(users.role, "driver")
            )
          )
          .limit(1);
    if (!membership && !legacyDriver) {
      throw new Error("Select an active field user before activating the mission");
    }

    await tx
      .update(commercialMissions)
      .set({ assignedTo: input.assignedTo })
      .where(
        and(
          eq(commercialMissions.tenantId, input.tenantId),
          eq(commercialMissions.id, input.missionId)
        )
      );
    if (mission.opsTaskId) {
      await tx
        .update(opsTasks)
        .set({ assignedTo: input.assignedTo })
        .where(
          and(
            eq(opsTasks.tenantId, input.tenantId),
            eq(opsTasks.id, mission.opsTaskId)
          )
        );
    }
    await tx.insert(commercialMissionEvents).values({
      tenantId: input.tenantId,
      missionId: input.missionId,
      eventName: "mission_assigned",
      fromStatus: mission.status,
      toStatus: mission.status,
      actorType: "operator",
      actorId: input.actorId,
      idempotencyKey: `mission-activate:${input.requestId}`,
      metadataJson: { assignedTo: input.assignedTo },
    });
    mission = (await readCommercialMissionWith(tx, input))!;
    if (mission.status === "candidate") {
      mission = await transitionCommercialMissionWith(tx, {
        tenantId: input.tenantId,
        missionId: input.missionId,
        expectedVersion: mission.version,
        toStatus: "selected",
        actor: { type: "operator", id: input.actorId },
        idempotencyKey: `mission-selected:${input.requestId}`,
        metadata: { assignedTo: input.assignedTo },
      });
    }
    if (mission.status === "selected") {
      mission = await transitionCommercialMissionWith(tx, {
        tenantId: input.tenantId,
        missionId: input.missionId,
        expectedVersion: mission.version,
        toStatus: "game_ready",
        actor: { type: "operator", id: input.actorId },
        idempotencyKey: `mission-game-ready:${input.requestId}`,
        metadata: { assignedTo: input.assignedTo },
      });
    }
    return mission;
  });
}
