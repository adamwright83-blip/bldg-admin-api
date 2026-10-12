import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  captureIntake,
  listIntake,
  commandIntake,
  claimIntake,
  finishIntake,
  authorizeIntakeSubmit,
  pauseIntake,
} from "./service";
import {
  intakeFingerprintText,
  type IntakePrepared,
} from "../../../../shared/cleancloudIntake";
const url = process.env.DATABASE_URL ?? "";
const allowed = Boolean(
  url &&
    ["localhost", "127.0.0.1"].includes(new URL(url).hostname) &&
    new URL(url).pathname === "/intake_test"
);
const actor = {
  tenantId: "intake-proof-" + randomUUID().slice(0, 8),
  actorId: "test-operator",
};
const source = { bindingId: randomUUID(), storeLabel: "Example Laundry" };
const catalog = [
  { id: "201", label: "Laundry", unit: "lb" as const, section: "Laundry" },
  {
    id: "202",
    label: "Shirt",
    unit: "piece" as const,
    section: "Dry Cleaning",
  },
];
const snapshot = () => ({
  ...source,
  observedAt: new Date().toISOString(),
  catalog,
  rows: [101, 102, 103, 104].map(id => ({
    externalOrderId: String(id),
    customerName: "Example " + id,
    readyBy: "Tomorrow",
  })),
});
const plan = { lines: [{ productId: "202", quantity: 4 }] };
let db: mysql.Connection;
async function first(id = "101") {
  return (await listIntake(actor)).orders.find(x => x.externalOrderId === id)!;
}
async function prepare(id = "101") {
  const row = await first(id);
  await commandIntake(actor, { id: row.id, action: "prepare", plan });
  const claim = (await claimIntake(actor, source))!;
  const prepared: IntakePrepared = {
    externalOrderId: id,
    customerName: "Example " + id,
    readyBy: "Tomorrow",
    priceListId: "default",
    totalCents: 2000,
    bags: 0,
    notes: "",
    tableText: "4 Shirts",
    quantities: [{ productId: "202", quantity: 4 }],
    observedAt: new Date().toISOString(),
    fingerprint: "",
  };
  prepared.fingerprint = createHash("sha256")
    .update(intakeFingerprintText(prepared))
    .digest("hex");
  await finishIntake(actor, {
    ...source,
    id: row.id,
    revision: claim.revision!,
    leaseToken: claim.leaseToken!,
    prepared,
  });
  return { row, claim, prepared };
}
describe.skipIf(!allowed)("CleanCloud intake real disposable MySQL", () => {
  beforeAll(async () => {
    db = await mysql.createConnection(url);
    for (const filename of [
      "../browserSync/schema.sql",
      "../pickups/schema.sql",
      "schema.sql",
    ]) {
      const sql = await readFile(new URL(filename, import.meta.url), "utf8");
      for (const statement of sql
        .split(";")
        .map(x => x.trim())
        .filter(Boolean))
        await db.query(statement);
    }
    await db.execute(
      "INSERT INTO cleancloud_browser_sync_bindings (tenantId,id,storeId,storeLabel,createdBy) VALUES (?,?,?,?,?)",
      [actor.tenantId, source.bindingId, "42", source.storeLabel, actor.actorId]
    );
    await db.execute(
      "INSERT INTO cleancloud_pickup_connections (tenantId,bindingId,actorId,enabled,excludedOrderIds) VALUES (?,?,?,true,?)",
      [actor.tenantId, source.bindingId, actor.actorId, JSON.stringify(["104"])]
    );
  });
  afterAll(async () => {
    if (!db) return;
    for (const table of [
      "cleancloud_intake_orders",
      "cleancloud_intake_connections",
      "cleancloud_pickup_connections",
      "cleancloud_browser_sync_bindings",
    ])
      await db.execute(`DELETE FROM ${table} WHERE tenantId=?`, [
        actor.tenantId,
      ]);
    await db.end();
  });
  it("captures stable exact identities and excludes held order", async () => {
    expect(await captureIntake(actor, snapshot(), true)).toEqual({
      imported: 3,
    });
    const rows = (await listIntake(actor)).orders;
    expect(rows).toHaveLength(3);
    await captureIntake(actor, snapshot());
    expect((await listIntake(actor)).orders.map(x => x.id).sort()).toEqual(
      rows.map(x => x.id).sort()
    );
  });
  it("rejects other tenants, stale capture, different actor and fractional garments", async () => {
    await expect(
      captureIntake({ ...actor, actorId: "other" }, snapshot())
    ).rejects.toThrow("paired browser");
    await expect(
      captureIntake(actor, {
        ...snapshot(),
        observedAt: "2000-01-01T00:00:00Z",
      })
    ).rejects.toThrow("expired");
    const row = await first();
    await expect(
      commandIntake(
        { ...actor, tenantId: "other" },
        { id: row.id, action: "prepare", plan }
      )
    ).rejects.toThrow();
    await expect(
      commandIntake(actor, {
        id: row.id,
        action: "prepare",
        plan: { lines: [{ productId: "202", quantity: 1.5 }] },
      })
    ).rejects.toThrow("whole");
  });
  it("leases preparation to one worker and rejects incorrect proof", async () => {
    const row = await first();
    await commandIntake(actor, { id: row.id, action: "prepare", plan });
    const claims = await Promise.all([
      claimIntake(actor, source),
      claimIntake(actor, source),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const command = claims.find(Boolean)!;
    await expect(
      finishIntake(actor, {
        ...source,
        id: row.id,
        revision: command.revision!,
        leaseToken: randomUUID(),
        error: "unknown",
      })
    ).rejects.toThrow("lease");
    await finishIntake(actor, {
      ...source,
      id: row.id,
      revision: command.revision!,
      leaseToken: command.leaseToken!,
      error: "Preparation interrupted",
    });
    expect((await first()).state).toBe("attention");
  });
  it("approval binds to exact fingerprint and revision", async () => {
    const { row, claim, prepared } = await prepare();
    await expect(
      commandIntake(actor, {
        id: row.id,
        action: "approve",
        revision: randomUUID(),
        fingerprint: prepared.fingerprint,
      })
    ).rejects.toThrow("changed");
    await expect(
      commandIntake(actor, {
        id: row.id,
        action: "approve",
        revision: claim.revision!,
        fingerprint: "0".repeat(64),
      })
    ).rejects.toThrow("changed");
    expect((await first()).state).toBe("review");
    await commandIntake(actor, {
      id: row.id,
      action: "approve",
      revision: claim.revision!,
      fingerprint: prepared.fingerprint,
    });
    const submit = (await claimIntake(actor, source))!;
    expect(submit.operation).toBe("submit");
    expect(
      await authorizeIntakeSubmit(actor, {
        ...source,
        id: row.id,
        revision: submit.revision!,
        leaseToken: submit.leaseToken!,
      })
    ).toEqual({ authorized: true });
    await finishIntake(actor, {
      ...source,
      id: row.id,
      revision: submit.revision!,
      leaseToken: submit.leaseToken!,
      error: "Connection lost after click",
    });
    expect((await first()).state).toBe("attention");
    expect(await claimIntake(actor, source)).toBeNull();
    await expect(
      commandIntake(actor, { id: row.id, action: "prepare", plan })
    ).rejects.toThrow("submitted");
  });
  it("unknown submission can only queue read-only verification and matching proof saves", async () => {
    const row = await first();
    await commandIntake(actor, { id: row.id, action: "verify" });
    const verify = (await claimIntake(actor, source))!;
    expect(verify.operation).toBe("verify");
    const proof = {
      ...verify.preparedJson!,
      observedAt: new Date().toISOString(),
    };
    await finishIntake(actor, {
      ...source,
      id: row.id,
      revision: verify.revision!,
      leaseToken: verify.leaseToken!,
      prepared: proof,
      verified: true,
    });
    expect((await first()).resultJson).toMatchObject({
      stage: "cleaning",
      paymentStatus: "not_verified",
    });
    expect(await claimIntake(actor, source)).toBeNull();
  });
  it("expired submit lease is never reclaimed for another Submit", async () => {
    const { row, claim, prepared } = await prepare("102");
    await commandIntake(actor, {
      id: row.id,
      action: "approve",
      revision: claim.revision!,
      fingerprint: prepared.fingerprint,
    });
    const submit = (await claimIntake(actor, source))!;
    await db.execute(
      "UPDATE cleancloud_intake_orders SET leaseUntil='2000-01-01' WHERE id=?",
      [row.id]
    );
    expect(await claimIntake(actor, source)).toBeNull();
    expect((await first("102")).state).toBe("attention");
    await expect(
      authorizeIntakeSubmit(actor, {
        ...source,
        id: row.id,
        revision: submit.revision!,
        leaseToken: submit.leaseToken!,
      })
    ).rejects.toThrow("stopped");
  });
  it("wrong prepared quantity remains unapproved", async () => {
    const row = await first("103");
    await commandIntake(actor, { id: row.id, action: "prepare", plan });
    const command = (await claimIntake(actor, source))!;
    const proof: IntakePrepared = {
      externalOrderId: "103",
      customerName: "Example 103",
      readyBy: "Tomorrow",
      priceListId: "default",
      totalCents: 2000,
      bags: 0,
      notes: "",
      tableText: "5 Shirts",
      quantities: [{ productId: "202", quantity: 5 }],
      observedAt: new Date().toISOString(),
      fingerprint: "",
    };
    proof.fingerprint = createHash("sha256")
      .update(intakeFingerprintText(proof))
      .digest("hex");
    await finishIntake(actor, {
      ...source,
      id: row.id,
      revision: command.revision!,
      leaseToken: command.leaseToken!,
      prepared: proof,
    });
    expect((await first("103")).state).toBe("attention");
    expect((await first("103")).lastError).toContain("quantities");
  });
  it("expired review approval stops and server pause blocks connector", async () => {
    const { row, claim, prepared } = await prepare("103");
    await db.execute(
      "UPDATE cleancloud_intake_orders SET preparedAt='2000-01-01' WHERE id=?",
      [row.id]
    );
    await expect(
      commandIntake(actor, {
        id: row.id,
        action: "approve",
        revision: claim.revision!,
        fingerprint: prepared.fingerprint,
      })
    ).rejects.toThrow("expired");
    await pauseIntake(actor);
    await expect(claimIntake(actor, source)).rejects.toThrow("paused");
  });
});
