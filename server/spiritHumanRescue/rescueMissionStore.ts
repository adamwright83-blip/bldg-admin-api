/**
 * Durable Spirit Human rescue mission store.
 *
 * Production uses Drizzle/MySQL. MemoryRescueMissionStore is test-only.
 * There is no silent fallback from a configured/unavailable database to memory.
 */

import { and, eq, inArray } from "drizzle-orm";
import { spiritHumanRescueMissions } from "../../drizzle/schema";
import { getDb } from "../db";
import type { MissionLifecycleState, RescueSendState, SpiritHumanRescueMission } from "../../shared/spiritHumanRescue";

export type RescueMissionStore = {
  get(tenantId: string, missionId: string): Promise<SpiritHumanRescueMission | null>;
  listForOperator(tenantId: string, operatorUserId: string): Promise<SpiritHumanRescueMission[]>;
  save(mission: SpiritHumanRescueMission): Promise<SpiritHumanRescueMission>;
  compareAndSet(input: {
    tenantId: string;
    missionId: string;
    fromStatuses: readonly RescueSendState[];
    fromLifecycles?: readonly MissionLifecycleState[];
    next: SpiritHumanRescueMission;
  }): Promise<"claimed" | "lost">;
};

type RescueDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

function cloneMission(mission: SpiritHumanRescueMission): SpiritHumanRescueMission {
  return JSON.parse(JSON.stringify(mission)) as SpiritHumanRescueMission;
}

function parseMissionJson(value: unknown): SpiritHumanRescueMission {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Rescue mission JSON is unreadable.");
  }
  return parsed as SpiritHumanRescueMission;
}

function rowValues(mission: SpiritHumanRescueMission) {
  return {
    missionId: mission.missionId,
    tenantId: mission.tenantId,
    operatorUserId: mission.operatorUserId,
    snapshotCustomerId: mission.spiritHuman.snapshotCustomerId,
    villagerId: mission.villager.id,
    lifecycle: mission.lifecycle,
    sendStatus: mission.send.status,
    missionJson: mission,
    updatedAt: new Date(mission.updatedAt),
  };
}

function affectedRows(result: unknown): number {
  return Number(
    (result as { [0]?: { affectedRows?: number }; affectedRows?: number }).affectedRows ??
      (result as { [0]?: { affectedRows?: number } })[0]?.affectedRows ??
      0
  );
}

/** Test-only in-memory store. Production must never default here. */
export class MemoryRescueMissionStore implements RescueMissionStore {
  private readonly rows = new Map<string, SpiritHumanRescueMission>();

  private key(tenantId: string, missionId: string): string {
    return `${tenantId}:${missionId}`;
  }

  static fromSnapshot(missions: readonly SpiritHumanRescueMission[]): MemoryRescueMissionStore {
    const store = new MemoryRescueMissionStore();
    for (const mission of missions) {
      store.rows.set(store.key(mission.tenantId, mission.missionId), cloneMission(mission));
    }
    return store;
  }

  dump(): SpiritHumanRescueMission[] {
    return [...this.rows.values()].map(cloneMission);
  }

  async get(tenantId: string, missionId: string): Promise<SpiritHumanRescueMission | null> {
    const row = this.rows.get(this.key(tenantId, missionId));
    return row ? cloneMission(row) : null;
  }

  async listForOperator(tenantId: string, operatorUserId: string): Promise<SpiritHumanRescueMission[]> {
    return [...this.rows.values()]
      .filter(row => row.tenantId === tenantId && row.operatorUserId === operatorUserId)
      .map(cloneMission);
  }

  async save(mission: SpiritHumanRescueMission): Promise<SpiritHumanRescueMission> {
    this.rows.set(this.key(mission.tenantId, mission.missionId), cloneMission(mission));
    return cloneMission(mission);
  }

  async compareAndSet(input: {
    tenantId: string;
    missionId: string;
    fromStatuses: readonly RescueSendState[];
    fromLifecycles?: readonly MissionLifecycleState[];
    next: SpiritHumanRescueMission;
  }): Promise<"claimed" | "lost"> {
    const current = this.rows.get(this.key(input.tenantId, input.missionId));
    if (!current || !input.fromStatuses.includes(current.send.status)) return "lost";
    if (input.fromLifecycles && !input.fromLifecycles.includes(current.lifecycle)) return "lost";
    this.rows.set(this.key(input.tenantId, input.missionId), cloneMission(input.next));
    return "claimed";
  }
}

export class DrizzleRescueMissionStore implements RescueMissionStore {
  constructor(private readonly db: RescueDb) {}

  async get(tenantId: string, missionId: string): Promise<SpiritHumanRescueMission | null> {
    const rows = await this.db
      .select()
      .from(spiritHumanRescueMissions)
      .where(
        and(
          eq(spiritHumanRescueMissions.tenantId, tenantId),
          eq(spiritHumanRescueMissions.missionId, missionId)
        )
      )
      .limit(1);
    const row = rows[0];
    return row ? parseMissionJson(row.missionJson) : null;
  }

  async listForOperator(tenantId: string, operatorUserId: string): Promise<SpiritHumanRescueMission[]> {
    const rows = await this.db
      .select()
      .from(spiritHumanRescueMissions)
      .where(
        and(
          eq(spiritHumanRescueMissions.tenantId, tenantId),
          eq(spiritHumanRescueMissions.operatorUserId, operatorUserId)
        )
      );
    return rows.map(row => parseMissionJson(row.missionJson));
  }

  async save(mission: SpiritHumanRescueMission): Promise<SpiritHumanRescueMission> {
    const values = rowValues(mission);
    await this.db
      .insert(spiritHumanRescueMissions)
      .values({
        ...values,
        createdAt: new Date(mission.createdAt),
      })
      .onDuplicateKeyUpdate({
        set: {
          operatorUserId: values.operatorUserId,
          snapshotCustomerId: values.snapshotCustomerId,
          villagerId: values.villagerId,
          lifecycle: values.lifecycle,
          sendStatus: values.sendStatus,
          missionJson: values.missionJson,
          updatedAt: values.updatedAt,
        },
      });
    return mission;
  }

  async compareAndSet(input: {
    tenantId: string;
    missionId: string;
    fromStatuses: readonly RescueSendState[];
    fromLifecycles?: readonly MissionLifecycleState[];
    next: SpiritHumanRescueMission;
  }): Promise<"claimed" | "lost"> {
    const values = rowValues(input.next);
    const conditions = [
      eq(spiritHumanRescueMissions.tenantId, input.tenantId),
      eq(spiritHumanRescueMissions.missionId, input.missionId),
      inArray(spiritHumanRescueMissions.sendStatus, [...input.fromStatuses]),
    ];
    if (input.fromLifecycles && input.fromLifecycles.length > 0) {
      conditions.push(inArray(spiritHumanRescueMissions.lifecycle, [...input.fromLifecycles]));
    }
    const result = await this.db
      .update(spiritHumanRescueMissions)
      .set({
        operatorUserId: values.operatorUserId,
        snapshotCustomerId: values.snapshotCustomerId,
        villagerId: values.villagerId,
        lifecycle: values.lifecycle,
        sendStatus: values.sendStatus,
        missionJson: values.missionJson,
        updatedAt: values.updatedAt,
      })
      .where(and(...conditions));
    return affectedRows(result) === 1 ? "claimed" : "lost";
  }
}

export async function requireDurableRescueStore(): Promise<RescueMissionStore> {
  const db = await getDb();
  if (!db) {
    throw Object.assign(
      new Error("Rescue missions require a durable database. Persistence failed closed."),
      { code: "STORE_UNAVAILABLE" }
    );
  }
  return new DrizzleRescueMissionStore(db);
}
