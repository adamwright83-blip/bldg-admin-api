import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { cleancloudBrowserSyncRouter } from "./router";
import {
  grantGumballProofMembership,
  proveGumballImportCustomerTruth,
  provisionGumballCustomerTruthSchema,
} from "./gumballCustomerTruthDbProof";

/**
 * Real-MySQL coverage for Gumball import → Geographic Truth.
 * Requires DATABASE_URL (CI goldline_migrate_check / local proof MySQL).
 * Never uses production Railway.
 */

const databaseUrl = process.env.DATABASE_URL ?? "";
const skip = !databaseUrl || /railway\.app|rlwy\.net/i.test(databaseUrl);

const tenantId = `gumball_truth_${randomUUID().slice(0, 8)}`;
const actorId = "sync-proof";

function ctx() {
  return {
    tenantId,
    user: { id: 1, openId: actorId, role: "admin", name: "MySQL proof operator" },
    req: undefined,
    res: undefined,
    vendorSession: null,
  } as never;
}

describe.skipIf(skip)("Gumball import → Geographic Truth (real MySQL)", () => {
  afterAll(async () => {
    const connection = await mysql.createConnection(databaseUrl);
    try {
      await connection.query(
        "DELETE FROM cleancloud_paid_orders WHERE tenantId = ?",
        [tenantId]
      );
      await connection.query(
        "DELETE FROM cleancloud_import_batches WHERE tenantId = ?",
        [tenantId]
      );
      await connection.query(
        "DELETE FROM cleancloud_browser_sync_receipts WHERE tenantId = ?",
        [tenantId]
      );
      await connection.query(
        "DELETE FROM cleancloud_browser_sync_attempts WHERE tenantId = ?",
        [tenantId]
      );
      await connection.query(
        "DELETE FROM cleancloud_browser_sync_bindings WHERE tenantId = ?",
        [tenantId]
      );
      await connection.query(
        "DELETE FROM goldline_world_events WHERE tenantId = ?",
        [tenantId]
      );
      await connection.query(
        "DELETE FROM entity_locations WHERE tenantId = ?",
        [tenantId]
      );
    } finally {
      await connection.end();
    }
  });

  it("imports, appears in Geographic Truth and Strategy aggregates, and stays idempotent", async () => {
    const connection = await mysql.createConnection(databaseUrl);
    try {
      await provisionGumballCustomerTruthSchema(connection);
      await grantGumballProofMembership(connection, tenantId, actorId);
      const caller = cleancloudBrowserSyncRouter.createCaller(ctx());
      await proveGumballImportCustomerTruth({
        tenantId,
        actorId,
        caller,
        connection,
      });
    } finally {
      await connection.end();
    }
    expect(true).toBe(true);
  });
});
