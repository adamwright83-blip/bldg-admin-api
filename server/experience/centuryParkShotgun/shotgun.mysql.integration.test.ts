import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CPE_SHOTGUN_APPROVAL,
  type ShotgunSubmission,
} from "../../../shared/centuryParkShotgun";
import { shotgunDraft } from "../../../shared/centuryParkShotgunDraft";
import type {
  PersonalOutreachContact,
  PersonalOutreachRoster,
} from "../../strategy/personalOutreachWrite";
import type { TrpcContext } from "../../_core/context";

// Only the upstream customer-eligibility read is substituted. The ledger, membership guard,
// G14 permission read, outbox, revision, approval audit and result readers use disposable MySQL.
const fixtures = vi.hoisted(() => ({
  contacts: new Map<string, PersonalOutreachContact[]>(),
  stale: false,
}));
vi.mock("../../strategy/personalOutreachWrite", async original => {
  const module =
    await original<typeof import("../../strategy/personalOutreachWrite")>();
  return {
    ...module,
    readPersonalOutreachRoster: async (input: {
      tenantId: string;
      territoryId?: string;
    }) => {
      if (input.territoryId !== "century-park-east")
        throw new Error("Wrong building");
      return {
        area: "Century Park East",
        freshness: fixtures.stale ? "source_unavailable" : "current",
        lapsedCount: 1,
        emptyMeansNoLapsedCustomers: false,
        withheldReason: null,
        contacts: fixtures.contacts.get(input.tenantId) ?? [],
      } satisfies PersonalOutreachRoster;
    },
    assertPersonalOutreachHandoff: async (input: {
      tenantId: string;
      customerId: string;
      messageBody: string;
      territoryId?: string;
    }) => {
      const c = fixtures.contacts
        .get(input.tenantId)
        ?.find(c => c.identityId === input.customerId);
      if (!c || fixtures.stale || input.territoryId !== "century-park-east")
        throw new Error("Ineligible customer");
      return {
        customerId: c.identityId,
        customerName: c.name,
        phone: c.phone!,
        daysSinceLastOrder: 72,
        territoryId: "century-park-east",
        territoryName: "Century Park East",
        suggestedMessage: "Existing eligible customer fixture",
      };
    },
  };
});

import { getDb, resetDbForTesting, withUtcTimezone } from "../../db";
import { recordCommunicationPermission } from "../../strategy/communicationPermissionService";
import {
  fireCenturyParkShotgun,
  type ShotgunDependencies,
  type ShotgunScope,
} from "./service";
import { shotgunStore } from "./store";
import { centuryParkShotgunRouter } from "./router";
import { evidenceReaders, loadCenturyParkShotgunTimeline } from "./evidence";
import {
  commitPersonalOutreachDraft,
  approveDurablePersonalOutreach,
} from "../lanternCity/cozyVillagerOutreachService";
import { readPersonalOutreachRoster } from "../../strategy/personalOutreachWrite";
import {
  orders,
  personalOutreachReplies,
  scheduledOutreachMessages,
} from "../../../drizzle/schema";
import { admitAuthorityClaimWith } from "../../platform/authority/authorityReceipt";
import { smsComposeHandoffSnapshot } from "../lanternCity/personalNumber/smsComposeHandoffAudit";
import { and, eq } from "drizzle-orm";

const enabled = process.env.CPE_SHOTGUN_DISPOSABLE_DB === "1";
const suite = enabled ? describe : describe.skip;
const now = new Date("2026-10-25T18:00:00Z");
const suffix = randomUUID().slice(0, 8);
const tenantA = `cpe_test_a_${suffix}`;
const tenantB = `cpe_test_b_${suffix}`;
const scope: ShotgunScope = {
  tenantId: tenantA,
  operatorId: "cpe_operator",
  canonicalOperatorId: "cpe_canonical",
};
const realDeps: ShotgunDependencies = {
  store: shotgunStore,
  roster: readPersonalOutreachRoster,
  schedule: commitPersonalOutreachDraft,
  approve: approveDurablePersonalOutreach,
  approvalSnapshot: smsComposeHandoffSnapshot,
};
let counter = 0;
function customer(tenantId = tenantA) {
  const digits = `213555${String(++counter).padStart(4, "0")}`;
  const c: PersonalOutreachContact = {
    identityId: `phone:${digits}`,
    name: "Chloe Fixture",
    phone: `+1${digits}`,
    daysSinceLastOrder: 72,
    paidOrders: 6,
    lifetimeCents: 21800,
    lastOrderDate: "2026-08-13T08:40:00Z",
    lastOrderSummary: "wash and fold",
    smsConsent: "unknown",
    blocks: [],
  };
  fixtures.contacts.set(tenantId, [
    ...(fixtures.contacts.get(tenantId) ?? []),
    c,
  ]);
  return c;
}
function submission(
  c: PersonalOutreachContact,
  patch: Partial<ShotgunSubmission> = {}
): ShotgunSubmission {
  return {
    requestId: randomUUID(),
    customerId: c.identityId,
    openingId: "regular",
    hypothesis: "seasonal",
    shell: "none",
    messageBody: shotgunDraft(
      c,
      { openingId: "regular", hypothesis: "seasonal" },
      "your laundry service"
    ),
    scheduledFor: "2026-10-28T18:00:00.000Z",
    confirmation: CPE_SHOTGUN_APPROVAL,
    ...patch,
  };
}
function caller(patch: Partial<TrpcContext> = {}) {
  return centuryParkShotgunRouter.createCaller({
    tenantId: tenantA,
    user: { id: 911, openId: scope.operatorId, role: "user" },
    req: { headers: {} },
    res: {},
    vendorSession: null,
    ...patch,
  } as TrpcContext);
}

suite("Century Park shotgun: disposable MySQL mechanic", () => {
  let sql: mysql.Connection;
  beforeAll(async () => {
    const parsed = new URL(process.env.DATABASE_URL!);
    if (
      !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
      !parsed.pathname.startsWith("/cpe_shotgun_disposable")
    )
      throw new Error(
        "Only a local cpe_shotgun_disposable database is permitted"
      );
    sql = await mysql.createConnection(withUtcTimezone(parsed.toString()));
    const ddl = await readFile(
      new URL("./migration.sql", import.meta.url),
      "utf8"
    );
    for (let run = 0; run < 2; run++)
      for (const statement of ddl
        .split(";")
        .map(s => s.trim())
        .filter(Boolean))
        await sql.execute(statement);
    await sql.execute(
      "INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'operator',1),(?,?,'operator',1),(?,?,'field',1)",
      [
        tenantA,
        scope.operatorId,
        tenantB,
        scope.operatorId,
        tenantA,
        "cpe_field",
      ]
    );
  });
  afterAll(async () => {
    resetDbForTesting();
    if (sql) await sql.end();
  });

  it("saves a tenant-scoped approval, identity, hypothesis, shell and schedule with one outbox and approval audit", async () => {
    const c = customer();
    const input = submission(c);
    const result = await fireCenturyParkShotgun(scope, input, realDeps, now);
    expect(result.execution).toBe("awaiting_sender_setup");
    expect(result.offerFulfilled).toBe(false);
    const [rows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM century_park_shots WHERE tenant_id=? AND id=?",
      [tenantA, result.shot.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].customer_id).toBe(c.identityId);
    expect(rows[0].customer_name).toBe(c.name);
    expect(rows[0].recipient_phone).toBe(c.phone);
    expect(rows[0].approval_json).toMatchObject({
      hypothesis: "seasonal",
      shell: "none",
      confirmation: CPE_SHOTGUN_APPROVAL,
    });
    const [audits] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM sms_compose_handoff_audits WHERE tenant_id=? AND message_id=?",
      [tenantA, result.shot.messageId]
    );
    expect(audits.some(a => a.handoff_state === "approved")).toBe(true);
    // A fresh server reader (another device) needs no browser state or current roster.
    fixtures.contacts.set(tenantA, []);
    resetDbForTesting();
    const timeline = await loadCenturyParkShotgunTimeline(
      tenantA,
      undefined,
      new Date("2026-10-26T18:00:00Z")
    );
    expect(timeline.shots.find(s => s.id === result.shot.id)).toMatchObject({
      execution: "awaiting_sender_setup",
      approval: input,
      offerFulfilled: false,
    });
    expect(
      (await fireCenturyParkShotgun(scope, input, realDeps, now)).shot.id
    ).toBe(result.shot.id);
  });

  it("arbitrates simultaneous clicks, fresh request ids and device refreshes using MySQL uniqueness", async () => {
    const c = customer();
    const input = submission(c);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        fireCenturyParkShotgun(
          scope,
          { ...input, requestId: randomUUID() },
          realDeps,
          now
        )
      )
    );
    expect(new Set(results.map(r => r.shot.id)).size).toBe(1);
    expect(new Set(results.map(r => r.shot.messageId)).size).toBe(1);
    const [counts] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM scheduled_outreach_messages WHERE tenant_id=? AND customer_id=?",
      [tenantA, c.identityId]
    );
    expect(Number(counts[0].n)).toBe(1);
    await expect(
      fireCenturyParkShotgun(
        scope,
        { ...input, requestId: results[0].shot.requestId, hypothesis: "price" },
        realDeps,
        now
      )
    ).rejects.toThrow(/different approved action/);
    await expect(
      fireCenturyParkShotgun(
        { ...scope, operatorId: "other" },
        input,
        realDeps,
        now
      )
    ).rejects.toThrow(/another operator/);
  });

  it("recovers a reservation when scheduling fails before any outbox write", async () => {
    const c = customer();
    const input = submission(c);
    await expect(
      fireCenturyParkShotgun(
        scope,
        input,
        {
          ...realDeps,
          schedule: async () => {
            throw new Error("offline");
          },
        },
        now
      )
    ).rejects.toThrow("offline");
    expect(
      (await shotgunStore.byRequest(tenantA, input.requestId))?.state
    ).toBe("retryable_failure");
    expect(
      (await fireCenturyParkShotgun(scope, input, realDeps, now)).execution
    ).toBe("awaiting_sender_setup");
  });

  it("recovers an outbox commit whose acknowledgment was lost, even after the scheduled time", async () => {
    const c = customer();
    const input = submission(c);
    await expect(
      fireCenturyParkShotgun(
        scope,
        input,
        {
          ...realDeps,
          schedule: async i => {
            await realDeps.schedule(i);
            throw new Error("ack lost");
          },
        },
        now
      )
    ).rejects.toThrow("ack lost");
    const saved = await shotgunStore.byRequest(tenantA, input.requestId);
    const outbox = await shotgunStore.outbox(saved!);
    expect(outbox?.id).toBeTruthy();
    const resumed = await fireCenturyParkShotgun(
      scope,
      input,
      {
        ...realDeps,
        schedule: async () => {
          throw new Error("must not schedule twice");
        },
      },
      new Date("2026-11-01T18:00:00Z")
    );
    expect(resumed.shot.messageId).toBe(outbox!.id);
    // A late failure from another request cannot erase this success.
    await shotgunStore.recordFailure(saved!);
    expect(
      (await shotgunStore.byRequest(tenantA, input.requestId))?.state
    ).toBe("saved");
  });

  it("does not inherit approval after an outbox edit, and never resurrects a cancelled schedule", async () => {
    const c = customer();
    const input = submission(c);
    const result = await fireCenturyParkShotgun(scope, input, realDeps, now);
    await sql.execute(
      "UPDATE scheduled_outreach_messages SET current_message_body='Changed elsewhere', revision_count=2, status='cancelled' WHERE id=?",
      [result.shot.messageId]
    );
    const resumed = await fireCenturyParkShotgun(scope, input, realDeps, now);
    expect(resumed).toMatchObject({
      execution: "cancelled",
      approvalMatches: false,
    });
    expect(resumed.shot.approval.messageBody).toBe(input.messageBody);
  });

  it.each(["free_pickup", "credit_10"] as const)(
    "durably records %s as blocked, creates no outbox, and cannot claim fulfillment",
    async shell => {
      const c = customer();
      const input = submission(c, { shell });
      const result = await fireCenturyParkShotgun(scope, input, realDeps, now);
      expect(result).toMatchObject({
        execution: "blocked_offer",
        offerFulfilled: false,
        shot: { offerState: "blocked_integration", messageId: null },
      });
      expect(await shotgunStore.outbox(result.shot)).toBeNull();
      expect(
        (await fireCenturyParkShotgun(scope, input, realDeps, now)).shot.id
      ).toBe(result.shot.id);
    }
  );

  it("rejects edited fulfillment promises, stale sources, wrong customers, expired times and forged input", async () => {
    const c = customer();
    await expect(
      fireCenturyParkShotgun(
        scope,
        submission(c, { messageBody: "There's a $10 credit on your account" }),
        realDeps,
        now
      )
    ).rejects.toThrow(/server-prepared text/);
    fixtures.stale = true;
    await expect(
      fireCenturyParkShotgun(scope, submission(c), realDeps, now)
    ).rejects.toThrow(/eligible/);
    fixtures.stale = false;
    await expect(
      fireCenturyParkShotgun(
        scope,
        submission(c, { customerId: "missing" }),
        realDeps,
        now
      )
    ).rejects.toThrow(/eligible/);
    await expect(
      fireCenturyParkShotgun(
        scope,
        submission(c, { scheduledFor: "2020-01-01T00:00:00Z" }),
        realDeps,
        now
      )
    ).rejects.toThrow(/future/);
    await expect(
      caller().fire({
        ...submission(c),
        tenantId: tenantB,
      } as ShotgunSubmission)
    ).rejects.toThrow();
    await expect(
      fireCenturyParkShotgun(
        scope,
        submission(c, { confirmation: "yes" as typeof CPE_SHOTGUN_APPROVAL }),
        realDeps,
        now
      )
    ).rejects.toThrow();
  });

  it("rechecks binding opt-outs at the existing business boundary on recovery", async () => {
    const c = customer();
    const input = submission(c);
    await expect(
      fireCenturyParkShotgun(
        scope,
        input,
        {
          ...realDeps,
          schedule: async () => {
            throw new Error("offline");
          },
        },
        now
      )
    ).rejects.toThrow();
    await recordCommunicationPermission({
      tenantId: tenantA,
      subjectType: "customer",
      subjectId: c.identityId,
      channel: "sms",
      status: "opted_out",
      reason: "fixture STOP",
      now,
    });
    await expect(
      fireCenturyParkShotgun(scope, input, realDeps, now)
    ).rejects.toThrow(/permission|opted out/);
    expect(
      await shotgunStore.outbox(
        (await shotgunStore.byRequest(tenantA, input.requestId))!
      )
    ).toBeNull();
  });

  it("isolates identical request ids and customer identities across two tenants", async () => {
    const c = customer();
    fixtures.contacts.set(tenantB, [c]);
    const input = submission(c);
    const a = await fireCenturyParkShotgun(scope, input, realDeps, now);
    const b = await fireCenturyParkShotgun(
      { ...scope, tenantId: tenantB },
      input,
      realDeps,
      now
    );
    expect(a.shot.id).not.toBe(b.shot.id);
    expect(a.shot.messageId).not.toBe(b.shot.messageId);
    const timelineB = await loadCenturyParkShotgunTimeline(
      tenantB,
      undefined,
      new Date("2026-11-01")
    );
    expect(timelineB.shots.map(s => s.id)).toContain(b.shot.id);
    expect(timelineB.shots.map(s => s.id)).not.toContain(a.shot.id);
  });

  it("enforces real membership, role, denial and origin guards at the API boundary", async () => {
    await expect(caller({ user: null }).timeline()).rejects.toThrow();
    await expect(
      caller({
        user: { openId: "stranger", role: "user" } as TrpcContext["user"],
      }).timeline()
    ).rejects.toThrow();
    await expect(
      caller({
        user: { openId: "cpe_field", role: "driver" } as TrpcContext["user"],
      }).timeline()
    ).rejects.toThrow();
    await expect(
      caller({ tenantDenial: "cross_tenant" }).timeline()
    ).rejects.toThrow();
    await expect(
      caller({ tenantId: "__unauthorized_tenant__" }).timeline()
    ).rejects.toThrow();
    const c = customer();
    await expect(
      caller({
        req: {
          method: "POST",
          headers: {
            origin: "https://attacker.example",
            cookie: "app_session_id=fixture",
            host: "admin.bldg.chat",
          },
        } as TrpcContext["req"],
      }).fire(submission(c))
    ).rejects.toThrow(/origin/);
    expect(
      (await caller().timeline()).shots.every(s => s.tenantId === tenantA)
    ).toBe(true);
  });

  it("joins only verified replies after send, and recorded orders and receipt-backed payments on the customer timeline", async () => {
    const c = customer();
    const input = submission(c);
    const result = await fireCenturyParkShotgun(scope, input, realDeps, now);
    const db = (await getDb())!;
    const sentAt = new Date("2026-10-28T18:01:00Z");
    await db
      .update(scheduledOutreachMessages)
      .set({
        status: "dispatched",
        dispatchedAt: sentAt,
        externalMessageId: "fixture_verified_outbound",
      })
      .where(
        and(
          eq(scheduledOutreachMessages.tenantId, tenantA),
          eq(scheduledOutreachMessages.id, result.shot.messageId!)
        )
      );
    for (const [tag, source, at, customerId, tenantId, messageId] of [
      [
        "good",
        "device_observed",
        "2026-10-28T18:02:00Z",
        c.identityId,
        tenantA,
        result.shot.messageId,
      ],
      [
        "reported",
        "operator_reported",
        "2026-10-28T18:03:00Z",
        c.identityId,
        tenantA,
        result.shot.messageId,
      ],
      [
        "old",
        "provider_webhook",
        "2026-10-24T18:03:00Z",
        c.identityId,
        tenantA,
        result.shot.messageId,
      ],
      [
        "wrong_customer",
        "provider_webhook",
        "2026-10-28T18:03:00Z",
        "other",
        tenantA,
        result.shot.messageId,
      ],
      [
        "wrong_tenant",
        "provider_webhook",
        "2026-10-28T18:03:00Z",
        c.identityId,
        tenantB,
        result.shot.messageId,
      ],
      [
        "wrong_shot",
        "provider_webhook",
        "2026-10-28T18:03:00Z",
        c.identityId,
        tenantA,
        "other_message",
      ],
    ]) {
      await db.insert(personalOutreachReplies).values({
        id: `fixture_${tag}_${randomUUID()}`,
        tenantId: tenantId!,
        operatorId: scope.operatorId,
        customerId,
        customerName: c.name,
        direction: "inbound",
        source,
        providerMessageId: `fixture_${tag}`,
        messageId,
        territoryId: "century-park-east",
        replyText: "fixture reply",
        classification: "question",
        nextStepKind: "answer_question",
        nextAction: "Review",
        provenance: source,
        reportedAt: new Date(at!),
      });
    }
    const createdAt = new Date("2026-10-28T19:00:00Z");
    const [inserted] = await db
      .insert(orders)
      .values({
        tenantId: tenantA,
        firstName: "Chloe",
        lastName: "Fixture",
        phone: c.phone!,
        address: "2160 Century Park East",
        serviceType: "wash_fold",
        pickupDate: "2026-10-29",
        pickupTimeWindow: "fixture",
        createdAt,
        paid: true,
        paidAt: createdAt,
        total: "999.00",
        stripePaymentIntentId: `pi_fixture_${randomUUID()}`,
      })
      .$returningId();
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, inserted.id));
    // Synthetic receipt fixture, through the canonical admission writer. No network/payment occurs.
    const receipt = await db.transaction(tx =>
      admitAuthorityClaimWith(tx, {
        tenantId: tenantA,
        claimType: "payment_verified",
        subjectType: "order",
        subjectId: String(order.id),
        sourceType: "stripe_payment_intent",
        sourceRef: order.stripePaymentIntentId!,
        actorType: "system",
        evidenceClass: "authoritative_external",
        verificationClass: "VERIFIED",
        admissionPolicy: "disposable_cpe_fixture",
        occurredAt: createdAt,
        metadata: {
          captureEvidence: "stripe_amount_received_v1",
          capturedCurrency: "usd",
          capturedAmountCents: 3500,
        },
      })
    );
    const timeline = await loadCenturyParkShotgunTimeline(
      tenantA,
      undefined,
      new Date("2026-11-01")
    );
    const shot = timeline.shots.find(s => s.id === result.shot.id)!;
    expect(
      shot.observations.filter(o => o.kind === "verified_reply")
    ).toHaveLength(1);
    expect(shot.observations).toContainEqual({
      kind: "order_recorded",
      sourceRef: `native_order:${order.id}`,
      orderStatus: "new",
      occurredAt: createdAt.toISOString(),
      relation: "customer_timeline",
    });
    expect(shot.observations).toContainEqual(
      expect.objectContaining({
        kind: "payment_observed",
        authorityReceiptId: receipt.id,
        payment: expect.objectContaining({ observedCents: 3500 }),
        relation: "customer_timeline",
      })
    );
    expect(shot.offerFulfilled).toBe(false);
    expect(timeline.resultRule).toContain(
      "does not verify the hypothesis or prove"
    );
    // Reported paid without an admitted receipt is still only an order.
    await sql.execute("DELETE FROM authority_receipts WHERE id=?", [
      receipt.id,
    ]);
    const after = (
      await loadCenturyParkShotgunTimeline(
        tenantA,
        undefined,
        new Date("2026-11-01")
      )
    ).shots.find(s => s.id === result.shot.id)!;
    expect(after.observations.some(o => o.kind === "payment_observed")).toBe(
      false
    );
  });

  it("recovers after the approval audit commits but the final linkage write fails", async () => {
    const c = customer();
    const input = submission(c);
    await expect(
      fireCenturyParkShotgun(
        scope,
        input,
        {
          ...realDeps,
          store: {
            ...shotgunStore,
            update: async () => {
              throw new Error("link acknowledgment lost");
            },
          },
        },
        now
      )
    ).rejects.toThrow(/link acknowledgment/);
    fixtures.contacts.set(tenantA, []);
    const result = await fireCenturyParkShotgun(
      scope,
      input,
      {
        ...realDeps,
        schedule: async () => {
          throw new Error("must not schedule again");
        },
        approve: async () => {
          throw new Error("must not reapprove");
        },
      },
      now
    );
    expect(result).toMatchObject({
      execution: "awaiting_sender_setup",
      shot: { state: "saved" },
    });
  });

  it("previews a safe message and blocks promotional shells through the authenticated router", async () => {
    const c = customer();
    const preview = await caller().preview({
      customerId: c.identityId,
      openingId: "regular",
      hypothesis: "moved",
    });
    expect(preview.availableShells).toEqual(["none"]);
    expect(preview.blockedShells).toEqual(["free_pickup", "credit_10"]);
    expect(preview.messageBody).toContain(
      "check whether we serve your new address"
    );
    await expect(
      caller({ tenantId: tenantB }).preview({
        customerId: c.identityId,
        openingId: "regular",
        hypothesis: "moved",
      })
    ).rejects.toThrow(/eligible/);
  });

  it("walks authenticated preview, approval, outbox save and cross-device timeline without browser storage", async () => {
    const c = customer();
    const preview = await caller().preview({
      customerId: c.identityId,
      openingId: "regular",
      hypothesis: "seasonal",
    });
    const input = submission(c, { messageBody: preview.messageBody });
    const fired = await caller().fire(input);
    expect(fired).toMatchObject({
      execution: "awaiting_sender_setup",
      offerFulfilled: false,
    });
    resetDbForTesting();
    const restored = await caller().timeline();
    expect(restored.shots.find(s => s.id === fired.shot.id)).toMatchObject({
      customerId: c.identityId,
      approval: input,
      execution: "awaiting_sender_setup",
    });
    expect((await caller().fire(input)).shot.messageId).toBe(
      fired.shot.messageId
    );
  });

  it("does not transfer the original approval to a changed recipient even if text and revision match", async () => {
    const c = customer();
    const input = submission(c);
    const fired = await fireCenturyParkShotgun(scope, input, realDeps, now);
    await sql.execute(
      "UPDATE scheduled_outreach_messages SET recipient_phone='+12135559999' WHERE id=?",
      [fired.shot.messageId]
    );
    const resumed = await fireCenturyParkShotgun(
      scope,
      input,
      {
        ...realDeps,
        approve: async () => {
          throw new Error("must not approve a different recipient");
        },
      },
      now
    );
    expect(resumed).toMatchObject({ approvalMatches: false });
    const timeline = await loadCenturyParkShotgunTimeline(
      tenantA,
      undefined,
      new Date("2026-11-01")
    );
    expect(timeline.shots.find(s => s.id === fired.shot.id)).toMatchObject({
      approvalMatches: false,
      recipientPhone: c.phone,
      currentMessage: { recipientPhone: "+12135559999" },
    });
  });

  it("reports unreadable evidence explicitly and never replaces it with success or exact zero", async () => {
    const timeline = await loadCenturyParkShotgunTimeline(
      tenantA,
      {
        store: shotgunStore,
        readers: {
          ...evidenceReaders,
          replies: async () => {
            throw new Error("offline");
          },
          orders: async () => {
            throw new Error("offline");
          },
          payments: async () => {
            throw new Error("offline");
          },
        },
      },
      new Date("2026-11-01")
    );
    expect(timeline.coverage).toEqual({
      replies: "unavailable",
      orders: "unavailable",
      payments: "unavailable",
    });
    expect(
      timeline.shots.every(
        s => s.observations.length === 0 && s.offerFulfilled === false
      )
    ).toBe(true);
  });
});
