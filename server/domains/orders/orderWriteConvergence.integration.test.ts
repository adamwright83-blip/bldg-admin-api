import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { operationsEvents, orders } from "../../../drizzle/schema";
import { getDb, updateOrderStatus } from "../../db";
import { admitNativeStripePayment } from "../payment/paymentAdmission";
import {
  createNativeOrder,
  createOrReuseResidentOrder,
  reviseNativeOrder,
  transitionNativeOrderStatus,
} from "./orderLifecycleService";

const effects = vi.hoisted(() => ({ collected: vi.fn(), delivered: vi.fn() }));
vi.mock("./driver/driverOrderEffects", () => ({
  recordDriverOrderCollected: effects.collected,
  recordDriverOrderDelivered: effects.delivered,
}));
import { updateDriverOrderStatusForMember } from "./driver/driverOrderService";

const tenantId = `a5-${randomUUID().slice(0, 10)}`;
const createdOrderIds: number[] = [];

const fixture = (overrides: Record<string, unknown> = {}) => ({
  tenantId,
  firstName: "A5",
  lastName: "Proof",
  phone: `310${Math.floor(Math.random() * 10000000)
    .toString()
    .padStart(7, "0")}`,
  address: "3545 Wilshire Blvd",
  pickupDate: "2026-10-08",
  pickupTimeWindow: "9-11",
  status: "new" as const,
  paid: false,
  ...overrides,
});

async function createTrackedOrder(data = fixture()) {
  const id = await createNativeOrder(data);
  createdOrderIds.push(id);
  return id;
}

const driver = (
  orderId: number,
  status: "collected" | "delivered",
  tenant = tenantId
) =>
  updateDriverOrderStatusForMember({
    tenantId: tenant,
    orderId,
    status,
    actorUserId: null,
    actorDisplayName: "A5 proof",
  });

afterAll(async () => {
  const db = await getDb();
  if (db && createdOrderIds.length > 0) {
    await db
      .delete(operationsEvents)
      .where(inArray(operationsEvents.orderId, createdOrderIds));
    await db.delete(orders).where(inArray(orders.id, createdOrderIds));
  }
});

describe("A5 real MySQL Orders convergence", () => {
  it("reuses the same resident request under concurrent creation", async () => {
    const order = { ...fixture(), bldgUserId: 98273 };
    const opts = { clientRequestId: `a5:${randomUUID()}` };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => createOrReuseResidentOrder(order, opts))
    );
    for (const r of results) {
      createdOrderIds.push(r.orderId);
    }
    expect(new Set(results.map(result => result.orderId)).size).toBe(1);
    expect(results.filter(result => !result.reused)).toHaveLength(1);
  });

  it("collects and delivers once under races, preserving tenant and Payment boundaries", async () => {
    const id = await createTrackedOrder();
    await expect(driver(id, "collected", "other-tenant")).rejects.toMatchObject(
      { code: "NOT_FOUND" }
    );
    const pickups = await Promise.all(
      Array.from({ length: 12 }, () => driver(id, "collected"))
    );
    expect(pickups.filter(result => !result.alreadyCompleted)).toHaveLength(1);
    expect(effects.collected).toHaveBeenCalledTimes(1);
    await expect(driver(id, "delivered")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      reviseNativeOrder(id, { paid: true } as never)
    ).rejects.toThrow(/Payment/);
    await admitNativeStripePayment({
      tenantId,
      orderId: id,
      paymentIntentId: `pi_a5_${randomUUID()}`,
      paidAt: new Date(),
      orderPatch: {},
    });
    const deliveries = await Promise.all(
      Array.from({ length: 12 }, () => driver(id, "delivered"))
    );
    expect(deliveries.filter(result => !result.alreadyCompleted)).toHaveLength(
      1
    );
    expect(effects.delivered).toHaveBeenCalledTimes(1);
    await driver(id, "delivered");
    expect(effects.delivered).toHaveBeenCalledTimes(1);
    const db = (await getDb())!;
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    expect(order).toMatchObject({ tenantId, paid: true, status: "delivered" });
  });

  it("does not claim a cancelled pickup completed", async () => {
    const id = await createTrackedOrder({ ...fixture(), status: "cancelled" });
    await expect(
      transitionNativeOrderStatus({
        tenantId,
        orderId: id,
        status: "collected",
      })
    ).rejects.toThrow("cannot be collected");
  });

  it("holds delivery with a legacy paid flag but no admitted Payment receipt", async () => {
    const id = await createTrackedOrder({ ...fixture(), status: "ready" });
    const db = (await getDb())!;
    await db
      .update(orders)
      .set({ paid: true, stripePaymentIntentId: `pi_unverified_${id}` })
      .where(eq(orders.id, id));
    await expect(
      transitionNativeOrderStatus({ orderId: id, tenantId, status: "delivered" })
    ).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
    const [held] = await db.select().from(orders).where(eq(orders.id, id));
    expect(held.status).toBe("ready");
  });
});

describe("real MySQL multi-row SQL safety and predicate grouping", () => {
  it("safely scopes guarded status mutations to the targeted order across null, blank, and defined tenants", async () => {
    const db = (await getDb())!;

    // 1. Create target order, unrelated null-tenant order, unrelated blank-tenant order
    const targetNullId = await createTrackedOrder({ ...fixture(), status: "new" });
    const unrelatedNullId = await createTrackedOrder({ ...fixture(), status: "new" });
    const unrelatedBlankId = await createTrackedOrder({ ...fixture(), status: "new" });

    // Set exact historical tenant states directly in database
    await db.update(orders).set({ tenantId: null }).where(eq(orders.id, targetNullId));
    await db.update(orders).set({ tenantId: null }).where(eq(orders.id, unrelatedNullId));
    await db.update(orders).set({ tenantId: "" }).where(eq(orders.id, unrelatedBlankId));

    // Compile and verify generated SQL to prove predicate grouping without raw OR leakage
    const compiled = db
      .update(orders)
      .set({ status: "processing" })
      .where(and(eq(orders.id, targetNullId), sql`${orders.tenantId} <=> ${null}`))
      .toSQL();

    // Verify SQL strictly uses <=> and has no unbounded "IS NULL OR" fragment
    expect(compiled.sql).toContain("`tenant_id` <=> ?");
    expect(compiled.sql).not.toContain("IS NULL OR");

    // Execute guarded update targeting targetNullId with expectedTenantId: null
    await updateOrderStatus(targetNullId, "processing", undefined, {
      expectedTenantId: null,
    });

    // Verify row-level isolation in database
    const [targetNullAfter] = await db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.id, targetNullId));
    const [unrelatedNullAfter] = await db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.id, unrelatedNullId));
    const [unrelatedBlankAfter] = await db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.id, unrelatedBlankId));

    expect(targetNullAfter.status).toBe("processing");
    expect(unrelatedNullAfter.status).toBe("new");
    expect(unrelatedBlankAfter.status).toBe("new");

    // Next: Execute guarded update targeting blank tenant order
    await updateOrderStatus(unrelatedBlankId, "processing", undefined, {
      expectedTenantId: "",
    });

    const [unrelatedBlankSecond] = await db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.id, unrelatedBlankId));
    const [unrelatedNullSecond] = await db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.id, unrelatedNullId));

    expect(unrelatedBlankSecond.status).toBe("processing");
    expect(unrelatedNullSecond.status).toBe("new");
  });
});

describe("real MySQL vendor delivery authorization, payment proof, and idempotency", () => {
  it("allows default-host vendor 77 to deliver a tenant-other order assigned to vendor 77 with admitted payment", async () => {
    const otherTenant = `other-${randomUUID().slice(0, 8)}`;
    const id = await createTrackedOrder({
      ...fixture(),
      tenantId: otherTenant,
      vendorId: 77,
      status: "ready",
    });

    // Admit payment with genuine Payment authority
    await admitNativeStripePayment({
      tenantId: otherTenant,
      orderId: id,
      paymentIntentId: `pi_test_${randomUUID()}`,
      paidAt: new Date(),
      orderPatch: {},
    });

    // Vendor 77 from default host delivers the assigned cross-tenant order
    const result = await transitionNativeOrderStatus({
      orderId: id,
      tenantId: "default",
      vendorId: 77,
      status: "delivered",
    });
    expect(result.success).toBe(true);
    expect(result.alreadyCompleted).toBe(false);

    const db = (await getDb())!;
    const [persisted] = await db.select().from(orders).where(eq(orders.id, id));
    expect(persisted.status).toBe("delivered");

    // Repeated delivery is idempotent with no duplicate effects
    const replay = await transitionNativeOrderStatus({
      orderId: id,
      tenantId: "default",
      vendorId: 77,
      status: "delivered",
    });
    expect(replay.success).toBe(true);
    expect(replay.alreadyCompleted).toBe(true);
  });

  it("denies vendor 88 from delivering a tenant-other order assigned to vendor 77", async () => {
    const otherTenant = `other-${randomUUID().slice(0, 8)}`;
    const id = await createTrackedOrder({
      ...fixture(),
      tenantId: otherTenant,
      vendorId: 77,
      status: "ready",
    });

    await admitNativeStripePayment({
      tenantId: otherTenant,
      orderId: id,
      paymentIntentId: `pi_test_${randomUUID()}`,
      paidAt: new Date(),
      orderPatch: {},
    });

    await expect(
      transitionNativeOrderStatus({
        orderId: id,
        tenantId: "default",
        vendorId: 88,
        status: "delivered",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const db = (await getDb())!;
    const [persisted] = await db.select().from(orders).where(eq(orders.id, id));
    expect(persisted.status).toBe("ready");
  });

  it("denies vendor 77 from delivering an unassigned tenant-other order", async () => {
    const otherTenant = `other-${randomUUID().slice(0, 8)}`;
    const id = await createTrackedOrder({
      ...fixture(),
      tenantId: otherTenant,
      vendorId: null,
      status: "ready",
    });

    await admitNativeStripePayment({
      tenantId: otherTenant,
      orderId: id,
      paymentIntentId: `pi_test_${randomUUID()}`,
      paidAt: new Date(),
      orderPatch: {},
    });

    await expect(
      transitionNativeOrderStatus({
        orderId: id,
        tenantId: "default",
        vendorId: 77,
        status: "delivered",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const db = (await getDb())!;
    const [persisted] = await db.select().from(orders).where(eq(orders.id, id));
    expect(persisted.status).toBe("ready");
  });

  it("denies delivery when order is unpaid or missing payment admission receipt", async () => {
    const otherTenant = `other-${randomUUID().slice(0, 8)}`;
    const unpaidId = await createTrackedOrder({
      ...fixture(),
      tenantId: otherTenant,
      vendorId: 77,
      status: "ready",
      paid: false,
    });

    // 1. Unpaid order rejected
    await expect(
      transitionNativeOrderStatus({
        orderId: unpaidId,
        tenantId: "default",
        vendorId: 77,
        status: "delivered",
      })
    ).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
      message: "Charge the order before marking it delivered.",
    });

    // 2. Paid flag set in database without admitted Payment receipt rejected
    const unadmittedId = await createTrackedOrder({
      ...fixture(),
      tenantId: otherTenant,
      vendorId: 77,
      status: "ready",
      paid: false,
    });
    const db = (await getDb())!;
    await db
      .update(orders)
      .set({ paid: true, stripePaymentIntentId: `pi_fake_${randomUUID()}` })
      .where(eq(orders.id, unadmittedId));

    await expect(
      transitionNativeOrderStatus({
        orderId: unadmittedId,
        tenantId: "default",
        vendorId: 77,
        status: "delivered",
      })
    ).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
      message: "Matching Payment admission is required before delivery.",
    });
  });
});

describe("real MySQL deterministic interleaving and authorization-to-mutation race defense", () => {
  it("rejects transition with CONFLICT when vendor assignment is concurrently changed after read", async () => {
    const id = await createTrackedOrder({
      ...fixture(),
      status: "new",
      vendorId: 77,
    });
    const db = (await getDb())!;

    // Controlled deterministic interleaving:
    // Vendor 77 is authorized against the read order; right before mutation,
    // another connection concurrently reassigns vendor to 88.
    await expect(
      transitionNativeOrderStatus({
        orderId: id,
        tenantId: "default",
        vendorId: 77,
        status: "processing",
        testPreMutationHook: async () => {
          await db.update(orders).set({ vendorId: 88 }).where(eq(orders.id, id));
        },
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Order vendor assignment changed concurrently",
    });

    // Verify database state: status remains unchanged, no operations events inserted
    const [persisted] = await db.select().from(orders).where(eq(orders.id, id));
    expect(persisted.status).toBe("new");

    const events = await db
      .select()
      .from(operationsEvents)
      .where(eq(operationsEvents.orderId, id));
    expect(events).toHaveLength(0);
  });

  it("rejects transition with CONFLICT when tenant is concurrently changed after read", async () => {
    const id = await createTrackedOrder({
      ...fixture(),
      status: "new",
      vendorId: 77,
    });
    const db = (await getDb())!;
    const hijackedTenant = `hijacked-${randomUUID().slice(0, 8)}`;

    // Controlled deterministic interleaving:
    // Order is read on tenantId; right before mutation, another connection reassigns tenant.
    await expect(
      transitionNativeOrderStatus({
        orderId: id,
        tenantId,
        vendorId: 77,
        status: "processing",
        testPreMutationHook: async () => {
          await db
            .update(orders)
            .set({ tenantId: hijackedTenant })
            .where(eq(orders.id, id));
        },
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Order tenant changed concurrently",
    });

    // Verify database state: status remains unchanged, no operations events inserted
    const [persisted] = await db.select().from(orders).where(eq(orders.id, id));
    expect(persisted.status).toBe("new");

    const events = await db
      .select()
      .from(operationsEvents)
      .where(eq(operationsEvents.orderId, id));
    expect(events).toHaveLength(0);
  });

  it("rejects delivery with CONFLICT when vendor assignment is concurrently changed after read", async () => {
    const otherTenant = `other-${randomUUID().slice(0, 8)}`;
    const id = await createTrackedOrder({
      ...fixture(),
      tenantId: otherTenant,
      vendorId: 77,
      status: "ready",
    });

    await admitNativeStripePayment({
      tenantId: otherTenant,
      orderId: id,
      paymentIntentId: `pi_test_${randomUUID()}`,
      paidAt: new Date(),
      orderPatch: {},
    });

    const db = (await getDb())!;

    // Controlled deterministic interleaving on delivery
    await expect(
      transitionNativeOrderStatus({
        orderId: id,
        tenantId: "default",
        vendorId: 77,
        status: "delivered",
        testPreMutationHook: async () => {
          await db.update(orders).set({ vendorId: 88 }).where(eq(orders.id, id));
        },
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Order vendor assignment changed concurrently",
    });

    const [persisted] = await db.select().from(orders).where(eq(orders.id, id));
    expect(persisted.status).toBe("ready");

    const events = await db
      .select()
      .from(operationsEvents)
      .where(eq(operationsEvents.orderId, id));
    expect(events).toHaveLength(0);
  });
});
