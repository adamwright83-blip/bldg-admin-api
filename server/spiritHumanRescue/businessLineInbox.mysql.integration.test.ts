import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { businessLineInboundMessages, customerContactPermissions } from "../../drizzle/schema";
import { getDb } from "../db";
import { checkCommunicationPermission } from "../strategy/communicationPermissionService";
import { loadDormantContactFacts, permissionForKeys } from "../strategy/dormantOutreachGate";
import { customerKeyHashForPhone, DrizzleBusinessLineInbox } from "./businessLineInbox";

/**
 * Real-MySQL coverage for the business line inbox. Excluded from default
 * `pnpm test`; CI runs it against goldline_migrate_check after scripts/migrate.mjs.
 */
describe("business line inbox on MySQL", () => {
  it("saves a reply once per MessageSid and reads it back", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const tenantId = `inbox_${randomUUID().slice(0, 8)}`;
    const sid = `SM${randomUUID().replace(/-/g, "")}`;
    const record = {
      tenantId,
      providerMessageSid: sid,
      toDigits: "8885550199",
      fromDigits: "3235550101",
      customerKeyHash: customerKeyHashForPhone(tenantId, "+13235550101")!,
      body: "Yes, can you pick up Thursday?",
      numMedia: 0,
      optOutKeyword: null,
      receivedAt: new Date("2026-10-17T21:00:00.123Z"),
    };
    const inbox = new DrizzleBusinessLineInbox(db);
    expect(await inbox.recordInbound(record)).toBe(true);
    expect(await inbox.recordInbound({ ...record, body: "a retried webhook must not overwrite" })).toBe(true);
    const rows = await db
      .select()
      .from(businessLineInboundMessages)
      .where(eq(businessLineInboundMessages.tenantId, tenantId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe("Yes, can you pick up Thursday?");
    expect(rows[0]?.receivedAt.toISOString()).toBe("2026-10-17T21:00:00.123Z");
  }, 20_000);

  it("a STOP blocks the Silver Lake consent gate and the rescue send check", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const tenantId = `inbox_${randomUUID().slice(0, 8)}`;
    const snapshotCustomerId = `cust_${randomUUID().slice(0, 8)}`;
    const customerKeyHash = customerKeyHashForPhone(tenantId, "+13235550101")!;
    const now = new Date("2026-10-17T21:00:00.000Z");
    await db.insert(customerContactPermissions).values({
      tenantId,
      customerKeyHash,
      status: "opted_in",
      sourceReference: "fixture:prior-consent",
      capturedAt: new Date("2026-09-01T00:00:00.000Z"),
      expiresAt: null,
      recordedBy: "fixture",
    });

    const inbox = new DrizzleBusinessLineInbox(db);
    expect(
      await inbox.recordOptOut({
        tenantId,
        customerKeyHash,
        snapshotCustomerIds: [snapshotCustomerId],
        providerMessageSid: "SMstopmysql",
        capturedAt: now,
      })
    ).toBe(true);

    const [permission] = await db
      .select()
      .from(customerContactPermissions)
      .where(
        and(
          eq(customerContactPermissions.tenantId, tenantId),
          eq(customerContactPermissions.customerKeyHash, customerKeyHash)
        )
      );
    expect(permission?.status).toBe("opted_out");
    expect(permission?.sourceReference).toBe("twilio:SMstopmysql");

    const facts = await loadDormantContactFacts({ tenantId, now });
    expect(facts.readable).toBe(true);
    expect(permissionForKeys(facts, tenantId, ["phone:3235550101"]).state).toBe("opted_out");
    const rescue = await checkCommunicationPermission({
      tenantId,
      subjectType: "customer",
      subjectId: snapshotCustomerId,
      channel: "sms",
      now,
    });
    expect(rescue.allowed).toBe(false);
    expect(rescue.permissionStatus).toBe("opted_out");

    // A second STOP is idempotent.
    expect(
      await inbox.recordOptOut({
        tenantId,
        customerKeyHash,
        snapshotCustomerIds: [snapshotCustomerId],
        providerMessageSid: "SMstopmysql2",
        capturedAt: now,
      })
    ).toBe(true);
  }, 20_000);
});
