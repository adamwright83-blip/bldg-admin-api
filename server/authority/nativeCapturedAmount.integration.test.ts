import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { it, expect } from "vitest";
import { orders, authorityReceipts } from "../../drizzle/schema";
import { getDb, listPaidOrdersForBuildingRevenue } from "../db";
import { buildCustomerProfile } from "../customerProfile";
import { readNativePaymentFacts, readNativePaymentAuthorityReceipts } from "./nativePaymentReadService";
import {
  createNativeOrder,
  reviseNativeOrder,
} from "../orders/orderLifecycleService";
import {
  admitNativeStripePayment,
  reconcileNativeStripeCapture,
} from "./paymentAdmission";
import { loadPaidOrderLedger } from "../analytics/paidOrderLedger";
import { listCustomerAssets } from "../customerAssets/customerAssetProjection";
import { loadCustomerOrderTruth } from "../geography/customerOrderTruth";
it("withholds missing capture, reconciles durable amounts, and ignores later price edits", async () => {
  const db = (await getDb())!;
  const tenantId = `c3-${randomUUID().slice(0, 8)}`;
  const orderId = await createNativeOrder({
    tenantId,
    firstName: "C3",
    lastName: "Capture",
    phone: "3105550141",
    address: "3545 Wilshire Blvd",
    pickupDate: "2026-10-08",
    pickupTimeWindow: "9-11",
    total: "42.00",
  });
  const paidAt = new Date("2026-10-07T12:00:00Z");
  const input = {
    tenantId,
    startUtc: new Date("2026-10-07T00:00:00Z"),
    endExclusiveUtc: new Date("2026-10-08T00:00:00Z"),
    timeZone: "UTC",
  };
  const capture = {
    paymentIntentId: `pi_c3_${orderId}`,
    status: "succeeded",
    amountReceivedCents: 4200,
    currency: "usd",
  };
  try {
    const receipt = await admitNativeStripePayment({
      tenantId,
      orderId,
      paymentIntentId: `pi_c3_${orderId}`,
      paidAt,
      orderPatch: {},
    });
    expect((await loadPaidOrderLedger(input)).events).toEqual([]);
    expect(
      (await listPaidOrdersForBuildingRevenue(tenantId))[0].total
    ).toBeNull();
    const initialRows = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(
      buildCustomerProfile(
        initialRows[0].phone,
        initialRows,
        await readNativePaymentAuthorityReceipts(initialRows)
      )?.overview.lifetimeSpend
    ).toBeNull();
    expect(
      (await listCustomerAssets({ tenantId }))[0].lifetimeValue.value
    ).toBeNull();
    expect((await loadCustomerOrderTruth(tenantId))[0]).toMatchObject({
      paid: true,
      totalCents: null,
    });
    await reviseNativeOrder(orderId, { total: "90.00" });
    const reconciled = await reconcileNativeStripeCapture({
      tenantId,
      orderId,
      capture,
    });
    expect(reconciled.id).toBe(receipt.id);
    for (let replay = 0; replay < 2; replay++) {
      const ledger = await loadPaidOrderLedger(input);
      expect((await listPaidOrdersForBuildingRevenue(tenantId))[0].total).toBe(
        "42.00"
      );
      const currentRows = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId));
      expect(
        buildCustomerProfile(
          currentRows[0].phone,
          currentRows,
          await readNativePaymentAuthorityReceipts(currentRows)
        )?.overview.lifetimeSpend
      ).toBe(42);
      expect(ledger.events).toHaveLength(1);
      expect(ledger.events[0]).toMatchObject({
        cents: 4200,
        authorityReceiptId: receipt.id,
      });
      expect(
        (await listCustomerAssets({ tenantId }))[0].lifetimeValue.value
      ).toBe(4200);
      expect((await loadCustomerOrderTruth(tenantId))[0]).toMatchObject({
        paid: true,
        totalCents: 4200,
      });
      await reconcileNativeStripeCapture({ tenantId, orderId, capture });
    }
    await expect(
      reconcileNativeStripeCapture({
        tenantId,
        orderId,
        capture: { ...capture, amountReceivedCents: 9000 },
      })
    ).rejects.toThrow("conflicts");
    await expect(
      reconcileNativeStripeCapture({ tenantId: "other", orderId, capture })
    ).rejects.toThrow("match tenant");
    await db.update(orders).set({ paid: false }).where(eq(orders.id, orderId));
    await reconcileNativeStripeCapture({ tenantId, orderId, capture });
    const [after] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(after.paid).toBe(false);
    expect(after.total).toBe("90.00");
  } finally {
    await db.delete(orders).where(eq(orders.id, orderId));
  }
});

it("persists provider capture on fresh admission and rejects non-succeeded evidence atomically", async () => {
  const db = (await getDb())!;
  const tenantId = `c3-new-${randomUUID().slice(0, 8)}`;
  const orderId = await createNativeOrder({
    tenantId,
    firstName: "Capture",
    lastName: "Admission",
    phone: "3105550142",
    address: "3545 Wilshire Blvd",
    pickupDate: "2026-10-08",
    pickupTimeWindow: "9-11",
    total: "90.00",
  });
  const capture = {
    paymentIntentId: `pi_c3_new_${orderId}`,
    status: "succeeded",
    amountReceivedCents: 4200,
    currency: "usd",
  };
  try {
    await expect(
      admitNativeStripePayment({
        tenantId,
        orderId,
        paymentIntentId: capture.paymentIntentId,
        paidAt: new Date(),
        orderPatch: {},
        capture: { ...capture, status: "processing" },
      })
    ).rejects.toThrow("succeeded provider");
    const [unpaid] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(unpaid.paid).toBe(false);
    const receipt = await admitNativeStripePayment({
      tenantId,
      orderId,
      paymentIntentId: capture.paymentIntentId,
      paidAt: new Date(),
      orderPatch: {},
      capture,
    });
    expect(receipt.metadata).toMatchObject({
      capturedAmountCents: 4200,
      capturedCurrency: "usd",
      captureEvidence: "stripe_amount_received_v1",
    });
    expect((await listPaidOrdersForBuildingRevenue(tenantId))[0].total).toBe(
      "42.00"
    );
  } finally {
    await db.delete(orders).where(eq(orders.id, orderId));
  }
});

it("dates native ledger revenue by admitted occurrence after mutable paidAt changes", async () => {
  const db = (await getDb())!;
  const tenantId = `c13-${randomUUID().slice(0, 8)}`;
  const id = await createNativeOrder({ tenantId, firstName: "Time", lastName: "Proof", phone: "3105550191", address: "3545 Wilshire Blvd", pickupDate: "2026-10-08", pickupTimeWindow: "9-11", total: "42.00" });
  const paymentIntentId = `pi_time_${id}`;
  try {
    await admitNativeStripePayment({ tenantId, orderId: id, paymentIntentId, paidAt: new Date("2026-10-07T12:00:00Z"), orderPatch: {}, capture: { paymentIntentId, status: "succeeded", amountReceivedCents: 4200, currency: "usd" } });
    await db.update(orders).set({ paidAt: new Date("2026-10-09T12:00:00Z"), total: "90.00" }).where(eq(orders.id, id));
    const ledger = await loadPaidOrderLedger({ tenantId, startUtc: new Date("2026-10-07T00:00:00Z"), endExclusiveUtc: new Date("2026-10-08T00:00:00Z"), timeZone: "UTC" });
    expect(ledger.events).toEqual([expect.objectContaining({ cents: 4200, occurredAt: new Date("2026-10-07T12:00:00Z") })]);
  } finally { await db.delete(orders).where(eq(orders.id, id)); }
});

it("cannot admit one whole provider capture as dollars on two different orders", async () => {
  const db = (await getDb())!;
  const tenantId = `exclusive-${randomUUID().slice(0, 8)}`;
  const ids = await Promise.all([1, 2].map(n => createNativeOrder({ tenantId, firstName: "Capture", lastName: String(n), phone: `310555018${n}`, address: "3545 Wilshire Blvd", pickupDate: "2026-10-08", pickupTimeWindow: "9-11" })));
  const paymentIntentId = `pi_exclusive_${randomUUID()}`;
  const capture = { paymentIntentId, status: "succeeded", amountReceivedCents: 4200, currency: "usd" };
  try {
    await admitNativeStripePayment({ tenantId, orderId: ids[0], paymentIntentId, paidAt: new Date(), orderPatch: {}, capture });
    await expect(admitNativeStripePayment({ tenantId, orderId: ids[1], paymentIntentId, paidAt: new Date(), orderPatch: {}, capture })).rejects.toThrow("capture");
  } finally { for (const id of ids) await db.delete(orders).where(eq(orders.id, id)); }
});

it("atomically fences competing capture owners and preserves refunded replay state", async () => {
  const db = (await getDb())!;
  const baseTenant = `capture-race-${randomUUID().slice(0, 8)}`;
  const tenants = [baseTenant, `${baseTenant}-other`];
  const ids = await Promise.all(tenants.map(tenantId => createNativeOrder({ tenantId, firstName: "Race", lastName: "Capture", phone: "3105550198", address: "3545 Wilshire Blvd", pickupDate: "2026-10-08", pickupTimeWindow: "9-11" })));
  const paymentIntentId = `pi_capture_race_${randomUUID()}`;
  const capture = { paymentIntentId, status: "succeeded", amountReceivedCents: 4200, currency: "usd" };
  try {
    const result = await Promise.allSettled(ids.map((orderId, index) => admitNativeStripePayment({ tenantId: tenants[index], orderId, paymentIntentId, paidAt: new Date(), orderPatch: {}, capture })));
    expect(result.filter(item => item.status === "fulfilled")).toHaveLength(1);
    const winner = result.findIndex(item => item.status === "fulfilled");
    await db.update(orders).set({ paid: false }).where(eq(orders.id, ids[winner]));
    await admitNativeStripePayment({ tenantId: tenants[winner], orderId: ids[winner], paymentIntentId, paidAt: new Date(), orderPatch: {}, capture });
    const [replayed] = await db.select().from(orders).where(eq(orders.id, ids[winner]));
    expect(replayed.paid).toBe(false);
    await expect(reconcileNativeStripeCapture({ tenantId: tenants[winner], orderId: ids[winner], capture: { ...capture, providerOrderId: String(ids[1 - winner]) } })).rejects.toThrow("metadata conflicts");
    await expect(admitNativeStripePayment({ tenantId: tenants[winner], orderId: ids[winner], paymentIntentId: `${paymentIntentId}_other`, paidAt: new Date(), orderPatch: {} })).rejects.toThrow("identity");
  } finally { for (const id of ids) await db.delete(orders).where(eq(orders.id, id)); }
});


it("withholds whole-capture dollars on ambiguous historical bindings without rewriting history", async () => {
  const db = (await getDb())!;
  const tenantId = `capture-history-${randomUUID().slice(0, 8)}`;
  const ids = await Promise.all([1, 2].map(n => createNativeOrder({ tenantId, firstName: "History", lastName: String(n), phone: `310555019${n}`, address: "3545 Wilshire Blvd", pickupDate: "2026-10-08", pickupTimeWindow: "9-11" })));
  const paymentIntentId = `pi_ambiguous_${randomUUID()}`;
  try {
    const receipt = await admitNativeStripePayment({ tenantId, orderId: ids[0], paymentIntentId, paidAt: new Date(), orderPatch: {}, capture: { paymentIntentId, status: "succeeded", amountReceivedCents: 4200, currency: "usd" } });
    const [stored] = await db.select().from(authorityReceipts).where(eq(authorityReceipts.id, receipt.id));
    // Simulated historical duplication, never an application admission path.
    await db.insert(authorityReceipts).values({ ...stored, id: `auth-${randomUUID()}`, subjectId: String(ids[1]), idempotencyKey: `fixture-${randomUUID()}` });
    await db.update(orders).set({ paid: true, stripePaymentIntentId: paymentIntentId }).where(eq(orders.id, ids[1]));
    const rows = await db.select().from(orders).where(eq(orders.tenantId, tenantId));
    const facts = await readNativePaymentFacts(rows);
    expect(facts.size).toBe(2);
    expect([...facts.values()].map(fact => fact.capturedAmountCents)).toEqual([null, null]);
    const [unchanged] = await db.select().from(authorityReceipts).where(eq(authorityReceipts.id, receipt.id));
    expect(unchanged.metadataJson).toEqual(stored.metadataJson);
  } finally { for (const id of ids) await db.delete(orders).where(eq(orders.id, id)); }
});
