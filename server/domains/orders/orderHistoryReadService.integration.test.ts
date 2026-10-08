import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import { orders } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { createNativeOrder } from "./orderLifecycleService";
import {
  readNativeCustomerHistory,
  readLegacyNativeCustomerHistoryAcrossTenants,
} from "./orderHistoryReadService";

it("fences Orders history by persisted tenant and isolates explicit operator compatibility", async () => {
  const db = (await getDb())!;
  const tenantId = `c1-${randomUUID().slice(0, 8)}`;
  const fixture = {
    firstName: "C1",
    lastName: "History",
    phone: "3105550155",
    address: "3545 Wilshire Blvd",
    pickupDate: "2026-10-08",
    pickupTimeWindow: "9-11",
    total: "42.00",
  };
  const ids = [] as number[];
  try {
    ids.push(await createNativeOrder({ ...fixture, tenantId }));
    ids.push(
      await createNativeOrder({ ...fixture, tenantId: `${tenantId}-other` })
    );
    ids.push(await createNativeOrder({ ...fixture, tenantId }));
    await db
      .update(orders)
      .set({ tenantId: null })
      .where(eq(orders.id, ids[2]));
    expect(
      (await readNativeCustomerHistory(tenantId)).map(row => row.id)
    ).toEqual([ids[0]]);
    await expect(readNativeCustomerHistory(" ")).rejects.toThrow(
      "tenant authority"
    );
    const legacy = await readLegacyNativeCustomerHistoryAcrossTenants();
    expect(legacy.filter(row => ids.includes(row.id))).toHaveLength(3);
    expect(legacy.find(row => row.id === ids[2])?.tenantId).toBeNull();
    expect(
      (await readNativeCustomerHistory(tenantId)).map(row => row.id)
    ).toEqual([ids[0]]);
  } finally {
    await db.delete(orders).where(inArray(orders.id, ids));
  }
});
