import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  connectPickups,
  capturePickups,
  recordPickup,
  claimPickup,
  finishPickup,
  pickupViews,
  retryPickup,
  renewPickupLease,
} from "./service";
import {
  listExternalOrders,
  completeExternalOrder,
} from "../../../externalOrders/externalOrderService";
const url = process.env.DATABASE_URL ?? "";
const allowed = Boolean(
  url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname)
);
const tenantId = `pickup-proof-${randomUUID().slice(0, 8)}`;
const bindingId = randomUUID();
const actor = { tenantId, actorId: "pickup-proof-operator" };
const source = { bindingId, storeLabel: "Example Laundry" };
const snapshot = () => ({
  ...source,
  observedAt: new Date().toISOString(),
  rows: [101, 102, 103, 104].map((id, index) => ({
    externalOrderId: String(id),
    customerName: `Example Customer ${index}`,
    address: `${42 + index} Example Street`,
    scheduledDate: "2026-10-12",
    windowStart: "08:00",
    windowEnd: "10:00",
    notes: null,
  })),
});
let connection: mysql.Connection;
describe.skipIf(!allowed)(
  "CleanCloud pickup command queue (real local MySQL)",
  () => {
    beforeAll(async () => {
      connection = await mysql.createConnection(url);
      await connection.execute(
        "INSERT INTO cleancloud_browser_sync_bindings (tenantId,id,storeId,storeLabel,createdBy) VALUES (?,?,?,?,?)",
        [tenantId, bindingId, "42", source.storeLabel, actor.actorId]
      );
    });
    afterAll(async () => {
      if (!connection) return;
      for (const table of [
        "cleancloud_driver_pickups",
        "cleancloud_pickup_connections",
        "external_operational_orders",
        "cleancloud_browser_sync_bindings",
      ])
        await connection.execute(`DELETE FROM ${table} WHERE tenantId = ?`, [
          tenantId,
        ]);
      await connection.end();
    });
    it("imports three pickups, holds the fourth and updates the same records on repeated capture", async () => {
      expect(
        await connectPickups(actor, {
          ...snapshot(),
          excludedOrderIds: ["104"],
        })
      ).toMatchObject({ imported: 3, excluded: 1 });
      const first = await listExternalOrders({
        tenantId,
        scheduledDate: "2026-10-12",
      });
      expect(first).toHaveLength(3);
      expect(
        first.every(
          job =>
            job.pickupBridge?.state === "ready" &&
            job.ingestionMethod === "browser"
        )
      ).toBe(true);
      await capturePickups(actor, snapshot());
      expect(
        (await listExternalOrders({ tenantId, scheduledDate: "2026-10-12" }))
          .map(job => job.id)
          .sort()
      ).toEqual(first.map(job => job.id).sort());
      expect(await claimPickup(actor, source)).toBeNull();
    });
    it("records counts once, leases to one worker and requires exact Detail evidence", async () => {
      const [job] = await listExternalOrders({
        tenantId,
        scheduledDate: "2026-10-12",
      });
      const input = { id: job.id, bagCount: 2, garmentCount: 3 };
      await expect(
        completeExternalOrder({ tenantId, id: job.id })
      ).rejects.toThrow("Use Picked up");
      expect(await recordPickup(actor, input)).toMatchObject({
        state: "pending",
        alreadyRecorded: false,
      });
      expect(await recordPickup(actor, input)).toMatchObject({
        alreadyRecorded: true,
      });
      await expect(
        recordPickup(actor, { ...input, bagCount: 4 })
      ).rejects.toThrow("different counts");
      const claims = await Promise.all([
        claimPickup(actor, source),
        claimPickup(actor, source),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      const command = claims.find(Boolean)!;
      const receipt = {
        ...source,
        id: command.id,
        leaseToken: command.leaseToken,
        externalOrderId: command.externalOrderId,
        customerName: command.customerName,
        detailRowId: `det_${command.externalOrderId}`,
        observedAt: new Date().toISOString(),
        verified: true,
      };
      await expect(
        finishPickup(actor, { ...receipt, detailRowId: "det_999" })
      ).rejects.toThrow("exact order");
      await expect(
        finishPickup(actor, { ...receipt, leaseToken: randomUUID() })
      ).rejects.toThrow("stale");
      expect(await finishPickup(actor, receipt)).toEqual({ state: "synced" });
      expect(await finishPickup(actor, receipt)).toEqual({ state: "synced" });
      await capturePickups(actor, snapshot());
      const view = (await pickupViews(tenantId, [job.id])).get(job.id)!;
      expect(view).toMatchObject({
        state: "synced",
        bagCount: 2,
        garmentCount: 3,
      });
      expect(view.verifiedAt).not.toBeNull();
      expect(await claimPickup(actor, source)).toBeNull();
    });
    it("retains an uncertain pickup and checks it again after retry", async () => {
      const job = (await listExternalOrders({ tenantId })).find(
        job => job.pickupBridge?.state === "ready"
      )!;
      await recordPickup(actor, { id: job.id, bagCount: 0, garmentCount: 5 });
      const command = (await claimPickup(actor, source))!;
      await finishPickup(actor, {
        ...source,
        id: command.id,
        leaseToken: command.leaseToken,
        externalOrderId: command.externalOrderId,
        customerName: command.customerName,
        detailRowId: null,
        observedAt: new Date().toISOString(),
        verified: false,
        error: "Result unknown after connection interruption.",
      });
      const saved = (await listExternalOrders({ tenantId })).find(
        row => row.id === job.id
      )!;
      expect(saved.operationalStatus).toBe("completed");
      expect(saved.pickupBridge).toMatchObject({
        state: "attention",
        garmentCount: 5,
        verifiedAt: null,
      });
      await retryPickup(actor, job.id);
      const retried = (await claimPickup(actor, source))!;
      expect(retried.id).toBe(command.id);
      expect(retried.leaseToken).not.toBe(command.leaseToken);
    });
    it("reclaims a command after sleep and rejects its expired worker token", async () => {
      const [rows] = await connection.execute<mysql.RowDataPacket[]>(
        "SELECT id, leaseToken FROM cleancloud_driver_pickups WHERE tenantId = ? AND state = 'working'",
        [tenantId]
      );
      const old = rows[0];
      await connection.execute(
        "UPDATE cleancloud_driver_pickups SET leaseUntil = '2000-01-01 00:00:00' WHERE id = ? AND tenantId = ?",
        [old.id, tenantId]
      );
      expect(
        await renewPickupLease(actor, {
          ...source,
          id: old.id,
          leaseToken: old.leaseToken,
        })
      ).toBeNull();
      const command = (await claimPickup(actor, source))!;
      expect(command.id).toBe(old.id);
      expect(command.leaseToken).not.toBe(old.leaseToken);
      expect(
        await renewPickupLease(actor, {
          ...source,
          id: command.id,
          leaseToken: command.leaseToken,
        })
      ).not.toBeNull();
    });
    it("rejects foreign tenant, worker account, store and invalid physical counts", async () => {
      const job = (await listExternalOrders({ tenantId }))[0];
      await expect(
        recordPickup(
          { ...actor, tenantId: "foreign-tenant" },
          { id: job.id, bagCount: 1, garmentCount: 0 }
        )
      ).rejects.toThrow("unavailable");
      await expect(
        claimPickup({ ...actor, actorId: "other-operator" }, source)
      ).rejects.toThrow("changed");
      await expect(
        capturePickups(actor, { ...snapshot(), storeLabel: "Other Store" })
      ).rejects.toThrow("paired account");
      await expect(
        recordPickup(actor, { id: job.id, bagCount: 0, garmentCount: 0 })
      ).rejects.toThrow("at least one");
      expect(await listExternalOrders({ tenantId: "foreign-tenant" })).toEqual(
        []
      );
      const [orders] = await connection.execute<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM orders WHERE tenantId = ?",
        [tenantId]
      );
      expect(Number(orders[0].n)).toBe(0);
    });
    it("an uncollected pickup that leaves CleanCloud's list leaves the Driver, and comes back if it returns", async () => {
      const before = await listExternalOrders({ tenantId, scheduledDate: "2026-10-12" });
      const gone = before.find(job => job.pickupBridge?.state === "ready");
      expect(gone).toBeTruthy();
      const collected = before.filter(job => job.pickupBridge?.state !== "ready");
      const full = snapshot();
      const result = await capturePickups(actor, {
        ...full,
        rows: full.rows.filter(row => row.externalOrderId !== gone!.externalOrderId),
      });
      expect(result.removed).toBe(1);
      const after = await listExternalOrders({ tenantId, scheduledDate: "2026-10-12" });
      expect(after.map(job => job.id)).not.toContain(gone!.id);
      // Collected work is never removed by a later snapshot.
      for (const job of collected) expect(after.map(j => j.id)).toContain(job.id);
      await capturePickups(actor, snapshot());
      expect(
        (await listExternalOrders({ tenantId, scheduledDate: "2026-10-12" })).map(job => job.id)
      ).toContain(gone!.id);
    });
    it("an older snapshot arriving after a newer one changes nothing", async () => {
      const older = { ...snapshot(), observedAt: new Date(Date.now() - 60_000).toISOString() };
      const newer = snapshot();
      await capturePickups(actor, newer);
      const before = (await listExternalOrders({ tenantId, scheduledDate: "2026-10-12" })).map(job => job.id).sort();
      const result = await capturePickups(actor, { ...older, rows: older.rows.slice(0, 1) });
      expect(result).toMatchObject({ superseded: true, imported: 0, removed: 0 });
      expect(
        (await listExternalOrders({ tenantId, scheduledDate: "2026-10-12" })).map(job => job.id).sort()
      ).toEqual(before);
    });
  }
);
