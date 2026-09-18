import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "../db";
import { emptySendRecord, SPIRIT_HUMAN_VILLAGERS, type SpiritHumanRescueMission } from "../../shared/spiritHumanRescue";
import { DrizzleRescueMissionStore } from "./rescueMissionStore";

/**
 * Real-MySQL coverage for Spirit Human rescue durability. Excluded from
 * default `pnpm test`; CI wires it against goldline_migrate_check.
 */

function mission(overrides: Partial<SpiritHumanRescueMission> = {}): SpiritHumanRescueMission {
  const missionId = `shr_${randomUUID().slice(0, 12)}`;
  return {
    missionId,
    tenantId: "default",
    operatorUserId: "op-mysql",
    kind: "spirit_human_rescue",
    lifecycle: "available",
    villager: SPIRIT_HUMAN_VILLAGERS[0]!,
    spiritHuman: {
      snapshotCustomerId: `cust_${randomUUID().slice(0, 8)}`,
      firstName: "Priya",
      lastOrderAt: "2026-07-01T12:00:00.000Z",
      daysSinceLastOrder: 78,
    },
    draft: "Priya, it's Laundry Butler.",
    send: emptySendRecord(missionId),
    consequences: [],
    opsTaskId: null,
    deferredAt: null,
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("Spirit Human rescue MySQL durability", () => {
  it("reloads frozen target, villager, draft, and send truth through a second store", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const storeA = new DrizzleRescueMissionStore(db);
    const created = mission({
      send: {
        ...emptySendRecord("pending"),
        status: "sent",
        idempotencyKey: "spirit-human-send:mysql",
        approvedByUserId: "op-mysql",
        attemptedAt: "2026-09-17T01:00:00.000Z",
        acceptedAt: "2026-09-17T01:00:01.000Z",
        providerMessageId: "SM_mysql_1",
        providerStatus: "queued",
        evidenceName: "provider_accepted",
        failureReason: null,
      },
      lifecycle: "completed",
      consequences: [
        { kind: "customer_replied", observedAt: "2026-09-18T00:00:00.000Z", evidenceId: "in-1" },
      ],
    });
    created.send.idempotencyKey = `spirit-human-send:${created.missionId}`;
    await storeA.save(created);
    const storeB = new DrizzleRescueMissionStore(db);
    const reloaded = await storeB.get("default", created.missionId);
    expect(reloaded?.missionId).toBe(created.missionId);
    expect(reloaded?.spiritHuman.snapshotCustomerId).toBe(created.spiritHuman.snapshotCustomerId);
    expect(reloaded?.villager.id).toBe(created.villager.id);
    expect(reloaded?.draft).toBe(created.draft);
    expect(reloaded?.send.providerMessageId).toBe("SM_mysql_1");
    expect(reloaded?.send.status).toBe("sent");
    expect(reloaded?.consequences).toHaveLength(1);
  }, 20_000);

  it("compare-and-set allows only one send claim against real MySQL", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const store = new DrizzleRescueMissionStore(db);
    const created = mission();
    await store.save(created);
    const sendingA = {
      ...created,
      send: { ...created.send, status: "sending" as const },
      lifecycle: "active" as const,
    };
    const sendingB = {
      ...created,
      send: { ...created.send, status: "sending" as const, approvedByUserId: "other" },
      lifecycle: "active" as const,
    };
    const [first, second] = await Promise.all([
      store.compareAndSet({
        tenantId: created.tenantId,
        missionId: created.missionId,
        fromStatuses: ["awaiting_approval", "draft_ready", "send_failed"],
        next: sendingA,
      }),
      store.compareAndSet({
        tenantId: created.tenantId,
        missionId: created.missionId,
        fromStatuses: ["awaiting_approval", "draft_ready", "send_failed"],
        next: sendingB,
      }),
    ]);
    const claimed = [first, second].filter(item => item === "claimed");
    expect(claimed).toHaveLength(1);
    const latest = await store.get(created.tenantId, created.missionId);
    expect(latest?.send.status).toBe("sending");
  }, 20_000);
});
