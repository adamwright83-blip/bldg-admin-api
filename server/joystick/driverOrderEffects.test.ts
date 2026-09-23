import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../drizzle/schema";

const sms = vi.hoisted(() => ({ notifyPickupEnRoute: vi.fn(async () => false) }));
const war = vi.hoisted(() => ({ recordWarActionSafe: vi.fn() }));
const db = vi.hoisted(() => ({ getDb: vi.fn(async () => null) }));

vi.mock("../_core/sms", () => ({
  notifyPickupEnRoute: sms.notifyPickupEnRoute,
}));
vi.mock("../level4War", () => ({
  recordWarActionSafe: war.recordWarActionSafe,
}));
vi.mock("../db", () => ({
  getDb: db.getDb,
}));

import {
  recordDriverOrderCollected,
  recordDriverOrderDelivered,
} from "./driverOrderEffects";

function order(tenantId: string | null): Order {
  return {
    id: 11,
    tenantId,
    status: "new",
    paid: false,
    phone: "3105550101",
    pickupDate: "2026-09-23",
    deliveryDate: "2026-09-24",
  } as Order;
}

describe("driver order effects", () => {
  beforeEach(() => {
    sms.notifyPickupEnRoute.mockClear();
    war.recordWarActionSafe.mockClear();
    db.getDb.mockClear();
  });

  it("texts and records the authorized tenant after a collected pickup", async () => {
    await recordDriverOrderCollected({
      tenantId: "tenant-a",
      order: order("tenant-a"),
      actorUserId: 7,
      actorDisplayName: "Ada Field",
    });
    expect(sms.notifyPickupEnRoute).toHaveBeenCalledWith("3105550101");
    expect(war.recordWarActionSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        dedupeKey: "stage:11:collected",
      })
    );
  });

  it("does not text or record war for an order outside the authorized tenant", async () => {
    await recordDriverOrderCollected({
      tenantId: "tenant-a",
      order: order("tenant-b"),
      actorUserId: 7,
      actorDisplayName: "Ada Field",
    });
    await recordDriverOrderDelivered({
      tenantId: "tenant-a",
      order: order(null),
      actorUserId: 7,
      actorDisplayName: "Ada Field",
    });
    expect(sms.notifyPickupEnRoute).not.toHaveBeenCalled();
    expect(war.recordWarActionSafe).not.toHaveBeenCalled();
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
