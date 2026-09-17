import { describe, expect, it } from "vitest";
import { strategyCustomerSnapshotId } from "../strategy/snapshotDormantCustomers";
import type { AdminCustomerAggregateDbRow } from "../adminCustomerAggregate";
import { resolveDormantContactFromAggregates } from "./resolveDormantContact";
import { createFakeOutboundSendAdapter } from "./outboundSendAdapter";
import {
  approveAndSendRescue,
  cancelRescueMission,
  defaultTestRescueDeps,
  enterRescueMission,
  instantiateRescueMission,
  MemoryRescueMissionStore,
  prepareRescueDraft,
  recordRescueConsequence,
} from "./rescueMissionService";
import { canCompleteRescue, publicMissionHasNoPhone } from "../../shared/spiritHumanRescue";

const NOW = new Date("2026-09-17T15:00:00.000Z");

function dormantRow(phone = "3105550101"): AdminCustomerAggregateDbRow {
  return {
    phone,
    firstName: "Priya",
    lastName: "Test",
    email: null,
    unit: "12A",
    address: "3545 Wilshire Blvd",
    buildingSlug: "opusla",
    totalOrders: 4,
    lifetimeSpend: 240,
    paidOrderCount: 4,
    firstOrderAt: new Date("2025-01-01T12:00:00.000Z"),
    lastOrderAt: new Date("2026-07-01T12:00:00.000Z"),
    lastOrderId: 88,
    ordersLast30Days: 0,
    ordersLast90Days: 1,
  };
}

function snapshotId(tenantId = "tenant-a", phone = "3105550101"): string {
  return strategyCustomerSnapshotId(tenantId, dormantRow(phone));
}

function contactFor(tenantId = "tenant-a", phone = "3105550101") {
  const row = dormantRow(phone);
  return {
    snapshotCustomerId: snapshotId(tenantId, phone),
    firstName: row.firstName,
    lastName: row.lastName,
    buildingSlug: row.buildingSlug,
    lastOrderAt: row.lastOrderAt,
    paidOrderCount: row.paidOrderCount,
    historicalSpendCents: 24000,
    phone,
  };
}

describe("Spirit Human rescue send boundary", () => {
  it("resolves phone only from aggregates and keeps it off the snapshot id", () => {
    const row = dormantRow();
    const id = snapshotId();
    expect(id).not.toContain("310");
    const resolved = resolveDormantContactFromAggregates({
      tenantId: "tenant-a",
      snapshotCustomerId: id,
      rows: [row],
      now: NOW,
    });
    expect(resolved?.phone).toBe("3105550101");
    expect(resolved?.snapshotCustomerId).toBe(id);
  });

  it("freezes the same customer across re-instantiate and never swaps on send retry", async () => {
    const deps = defaultTestRescueDeps({
      now: () => NOW,
      resolveContact: async () => contactFor(),
    });
    const first = await instantiateRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", snapshotCustomerId: snapshotId() },
      deps
    );
    const second = await instantiateRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", snapshotCustomerId: snapshotId() },
      deps
    );
    expect(second.missionId).toBe(first.missionId);
    expect(second.spiritHuman.snapshotCustomerId).toBe(first.spiritHuman.snapshotCustomerId);
    await prepareRescueDraft({ tenantId: "tenant-a", operatorUserId: "op-a", missionId: first.missionId }, deps);
    const failDeps = {
      ...deps,
      sendAdapter: createFakeOutboundSendAdapter({ mode: "reject" }),
    };
    const failed = await approveAndSendRescue(
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        missionId: first.missionId,
        approvedByUserId: "op-a",
        operatorAuthorizedSend: true,
      },
      failDeps
    );
    expect(failed.lifecycle).toBe("problem");
    expect(failed.spiritHuman.snapshotCustomerId).toBe(first.spiritHuman.snapshotCustomerId);
    const retried = await approveAndSendRescue(
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        missionId: first.missionId,
        approvedByUserId: "op-a",
        operatorAuthorizedSend: true,
      },
      deps
    );
    expect(retried.spiritHuman.snapshotCustomerId).toBe(first.spiritHuman.snapshotCustomerId);
    expect(retried.lifecycle).toBe("completed");
  });

  it("does not complete from draft, enter, or approval-without-send", async () => {
    const deps = defaultTestRescueDeps({
      now: () => NOW,
      resolveContact: async () => contactFor(),
    });
    const created = await instantiateRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", snapshotCustomerId: snapshotId() },
      deps
    );
    const entered = await enterRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", missionId: created.missionId },
      deps
    );
    expect(canCompleteRescue(entered.send)).toBe(false);
    const drafted = await prepareRescueDraft(
      { tenantId: "tenant-a", operatorUserId: "op-a", missionId: created.missionId },
      deps
    );
    expect(drafted.send.status).toBe("draft_ready");
    expect(canCompleteRescue(drafted.send)).toBe(false);
    expect(deps.sendAdapter.attempts).toHaveLength(0);
    await expect(
      approveAndSendRescue(
        {
          tenantId: "tenant-a",
          operatorUserId: "op-a",
          missionId: created.missionId,
          approvedByUserId: "op-a",
          operatorAuthorizedSend: false as unknown as true,
        },
        deps
      )
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    await expect(
      approveAndSendRescue(
        {
          tenantId: "tenant-a",
          operatorUserId: "op-a",
          missionId: created.missionId,
          approvedByUserId: null,
          operatorAuthorizedSend: true,
        },
        deps
      )
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(deps.sendAdapter.attempts).toHaveLength(0);
  });

  it("sends once on double-tap and does not send after cancel", async () => {
    const deps = defaultTestRescueDeps({
      now: () => NOW,
      resolveContact: async () => contactFor(),
    });
    const created = await instantiateRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", snapshotCustomerId: snapshotId() },
      deps
    );
    await prepareRescueDraft(
      { tenantId: "tenant-a", operatorUserId: "op-a", missionId: created.missionId },
      deps
    );
    const payload = {
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      missionId: created.missionId,
      approvedByUserId: "op-a",
      operatorAuthorizedSend: true as const,
    };
    const [a, b] = await Promise.all([
      approveAndSendRescue(payload, deps),
      approveAndSendRescue(payload, deps),
    ]);
    expect(a.lifecycle).toBe("completed");
    expect(b.lifecycle).toBe("completed");
    expect(deps.sendAdapter.attempts).toHaveLength(1);
    expect(a.send.providerMessageId).toBe(b.send.providerMessageId);

    const other = defaultTestRescueDeps({
      now: () => NOW,
      resolveContact: async () => contactFor("tenant-a", "3105550199"),
    });
    const second = await instantiateRescueMission(
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        snapshotCustomerId: snapshotId("tenant-a", "3105550199"),
      },
      other
    );
    await cancelRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", missionId: second.missionId },
      other
    );
    await expect(
      approveAndSendRescue(
        {
          tenantId: "tenant-a",
          operatorUserId: "op-a",
          missionId: second.missionId,
          approvedByUserId: "op-a",
          operatorAuthorizedSend: true,
        },
        other
      )
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(other.sendAdapter.attempts).toHaveLength(0);
  });

  it("failed send does not rescue, and later reply/order do not rewrite send", async () => {
    const store = new MemoryRescueMissionStore();
    const reject = createFakeOutboundSendAdapter({ mode: "reject" });
    const deps = defaultTestRescueDeps({
      store,
      sendAdapter: reject,
      now: () => NOW,
      resolveContact: async () => contactFor(),
    });
    const created = await instantiateRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", snapshotCustomerId: snapshotId() },
      deps
    );
    const failed = await approveAndSendRescue(
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        missionId: created.missionId,
        approvedByUserId: "op-a",
        operatorAuthorizedSend: true,
      },
      deps
    );
    expect(failed.lifecycle).toBe("problem");
    expect(canCompleteRescue(failed.send)).toBe(false);

    const acceptDeps = { ...deps, sendAdapter: createFakeOutboundSendAdapter() };
    const sent = await approveAndSendRescue(
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        missionId: created.missionId,
        approvedByUserId: "op-a",
        operatorAuthorizedSend: true,
      },
      acceptDeps
    );
    expect(sent.lifecycle).toBe("completed");
    const sid = sent.send.providerMessageId;
    const withReply = await recordRescueConsequence(
      {
        tenantId: "tenant-a",
        missionId: created.missionId,
        kind: "customer_replied",
        evidenceId: "inbound-1",
      },
      acceptDeps
    );
    const withOrder = await recordRescueConsequence(
      {
        tenantId: "tenant-a",
        missionId: created.missionId,
        kind: "customer_ordered",
        evidenceId: "order-77",
      },
      acceptDeps
    );
    expect(withReply?.send.providerMessageId).toBe(sid);
    expect(withOrder?.send.status).toBe("sent");
    expect(withOrder?.consequences.map(item => item.kind)).toEqual([
      "customer_replied",
      "customer_ordered",
    ]);
  });

  it("isolates tenants and operators, and never puts a phone on the public mission", async () => {
    const store = new MemoryRescueMissionStore();
    const depsA = defaultTestRescueDeps({
      store,
      now: () => NOW,
      resolveContact: async () => contactFor("tenant-a"),
    });
    const created = await instantiateRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", snapshotCustomerId: snapshotId() },
      depsA
    );
    expect(publicMissionHasNoPhone(created)).toBe(true);
    await expect(
      prepareRescueDraft(
        { tenantId: "tenant-b", operatorUserId: "op-a", missionId: created.missionId },
        depsA
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      prepareRescueDraft(
        { tenantId: "tenant-a", operatorUserId: "op-b", missionId: created.missionId },
        depsA
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not invoke the adapter from tests that never send, and fake adapter never uses Twilio", async () => {
    const deps = defaultTestRescueDeps({
      now: () => NOW,
      resolveContact: async () => contactFor(),
    });
    const created = await instantiateRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", snapshotCustomerId: snapshotId() },
      deps
    );
    await prepareRescueDraft(
      { tenantId: "tenant-a", operatorUserId: "op-a", missionId: created.missionId },
      deps
    );
    expect(JSON.stringify(created)).not.toMatch(/twilio/i);
    expect(deps.sendAdapter.attempts).toHaveLength(0);
  });

  it("does not send when communication permission is refused", async () => {
    const deps = defaultTestRescueDeps({
      now: () => NOW,
      resolveContact: async () => contactFor(),
      permissionCheck: async () => ({
        allowed: false,
        permissionStatus: "opted_out",
        reason: "opted out",
      }),
    });
    const created = await instantiateRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", snapshotCustomerId: snapshotId() },
      deps
    );
    const failed = await approveAndSendRescue(
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        missionId: created.missionId,
        approvedByUserId: "op-a",
        operatorAuthorizedSend: true,
      },
      deps
    );
    expect(failed.lifecycle).toBe("problem");
    expect(canCompleteRescue(failed.send)).toBe(false);
    expect(deps.sendAdapter.attempts).toHaveLength(0);
  });
});
