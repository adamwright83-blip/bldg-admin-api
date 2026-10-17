import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { businessLineInboundMessages, customerContactPermissions } from "../../drizzle/schema";
import { getDb } from "../db";
import { checkCommunicationPermission } from "../strategy/communicationPermissionService";
import { loadDormantContactFacts, permissionForKeys } from "../strategy/dormantOutreachGate";
import { sendSMSWithReceipt } from "../_core/sms";
import { businessLineRecipientOptOutState, customerKeyHashForPhone, DrizzleBusinessLineInbox } from "./businessLineInbox";

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

  it("STOP blocks every send from the line to that number until the customer texts START", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const tenantId = `inbox_${randomUUID().slice(0, 8)}`;
    const line = "8885550199";
    const customer = `323555${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const inbox = new DrizzleBusinessLineInbox(db);
    const inbound = (sid: string, body: string, keyword: "stop" | "start" | null, at: string) =>
      inbox.recordInbound({
        tenantId,
        providerMessageSid: sid,
        toDigits: line,
        fromDigits: customer,
        customerKeyHash: customerKeyHashForPhone(tenantId, customer)!,
        body,
        numMedia: 0,
        optOutKeyword: keyword,
        receivedAt: new Date(at),
      });

    expect(await businessLineRecipientOptOutState(`+1${line}`, customer)).toBe("clear");
    await inbound(`SM${randomUUID().slice(0, 8)}a`, "hello", null, "2026-10-17T20:00:00.000Z");
    await inbound(`SM${randomUUID().slice(0, 8)}b`, "STOP", "stop", "2026-10-17T20:05:00.000Z");
    expect(await businessLineRecipientOptOutState(`+1${line}`, `+1${customer}`)).toBe("opted_out");
    // A different business number is not blocked by this STOP.
    expect(await businessLineRecipientOptOutState("+18885550100", customer)).toBe("clear");
    await inbound(`SM${randomUUID().slice(0, 8)}c`, "START", "start", "2026-10-17T20:10:00.000Z");
    expect(await businessLineRecipientOptOutState(`+1${line}`, customer)).toBe("clear");
  }, 20_000);

  it("the real send function refuses an opted-out recipient before any provider call", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const line = String(process.env.TWILIO_FROM_NUMBER ?? process.env.TWILIO_PHONE_NUMBER ?? "").replace(/\D/g, "").slice(-10);
    if (!line) {
      // Without a configured line number there is no line to block; the gate passes through.
      expect((await sendSMSWithReceipt("3235550142", "hi")).evidenceName).not.toBe("recipient_opted_out");
      return;
    }
    const tenantId = `inbox_${randomUUID().slice(0, 8)}`;
    await new DrizzleBusinessLineInbox(db).recordInbound({
      tenantId,
      providerMessageSid: `SM${randomUUID().slice(0, 12)}`,
      toDigits: line,
      fromDigits: "3235550142",
      customerKeyHash: customerKeyHashForPhone(tenantId, "3235550142")!,
      body: "stop",
      numMedia: 0,
      optOutKeyword: "stop",
      receivedAt: new Date(),
    });
    expect((await sendSMSWithReceipt("+13235550142", "Your laundry is ready")).evidenceName).toBe("recipient_opted_out");
  }, 20_000);
});
