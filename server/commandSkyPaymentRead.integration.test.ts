import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { orders, commandSkyWins, commandSkySettings } from "../drizzle/schema";
import { getDb } from "./db";
import { createNativeOrder } from "./orders/orderLifecycleService";
import { admitNativeStripePayment } from "./domains/payment/paymentAdmission";
import { readCommandSkyFirstPayments } from "./commandSkyPaymentRead";
import { logCommandSkyWin, getCommandSkyState } from "./commandSky";

it("admits only owned first payments, dedupes manual/auto wins and excludes legacy invented wins", async () => {
  const tenantId = `b6-${randomUUID().slice(0, 8)}`;
  const db = (await getDb())!;
  const orderId = await createNativeOrder({ tenantId, firstName: "B6", lastName: "Proof", phone: "3105550166", address: "3545 Wilshire Blvd", pickupDate: "2026-10-08", pickupTimeWindow: "9-11" });
  try {
    await db.update(orders).set({ paid: true, stripePaymentIntentId: `pi_b6_${orderId}` }).where(eq(orders.id, orderId));
    expect(await readCommandSkyFirstPayments(tenantId)).toEqual([]);
    await expect(logCommandSkyWin({ tenantId, kind: "first_order", label: "Invented", dedupeKey: "manual:fake", orderId })).rejects.toThrow("Payment admission");
    await admitNativeStripePayment({ tenantId, orderId, paymentIntentId: `pi_b6_${orderId}`, paidAt: new Date(), orderPatch: {} });
    expect(await readCommandSkyFirstPayments("other-tenant")).toEqual([]);
    expect(await readCommandSkyFirstPayments(tenantId)).toHaveLength(1);
    const input = { tenantId, kind: "first_order" as const, label: "Caller invented label", dedupeKey: "caller-invented-key", orderId };
    await expect(logCommandSkyWin(input)).resolves.toMatchObject({ recorded: true });
    await expect(logCommandSkyWin(input)).resolves.toMatchObject({ deduped: true });
    await expect(logCommandSkyWin({ ...input, orderId: undefined })).rejects.toThrow("Payment admission");
    await db.insert(commandSkyWins).values({ tenantId, kind: "first_order", label: "Fake legacy win", dedupeKey: "manual:fake", hopeExpiresAt: new Date(Date.now() + 3600000) });
    const state = await getCommandSkyState({ tenantId, netCents: null });
    expect(state.campaign.count).toBe(1);
    const [win] = await db.select().from(commandSkyWins).where(and(eq(commandSkyWins.tenantId, tenantId), eq(commandSkyWins.dedupeKey, `first-order:3105550166:${orderId}`)));
    expect(win.label).toBe("B6 Proof — first order");
  } finally {
    await db.delete(orders).where(eq(orders.id, orderId));
    await db.delete(commandSkyWins).where(eq(commandSkyWins.tenantId, tenantId));
    await db.delete(commandSkySettings).where(eq(commandSkySettings.tenantId, tenantId));
  }
});
