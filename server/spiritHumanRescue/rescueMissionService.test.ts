import { describe, expect, it } from "vitest";
import { strategyCustomerSnapshotId } from "../strategy/snapshotDormantCustomers";
import type { AdminCustomerAggregateDbRow } from "../adminCustomerAggregate";
import {
  resolveDormantContactFromAggregates,
  resolveSendContactFromAggregates,
} from "./resolveDormantContact";
import { createFakeOutboundSendAdapter } from "./outboundSendAdapter";
import {
  approveAndSendRescue,
  cancelRescueMission,
  defaultTestRescueDeps,
  deferRescueMission,
  enterRescueMission,
  instantiateRescueMission,
  listRescueMissions,
  MemoryRescueMissionStore,
  prepareRescueDraft,
  recordRescueConsequence,
} from "./rescueMissionService";
import { toPublicRescueCandidate } from "./listCandidates";
import { canCompleteRescue, publicMissionHasNoPhone } from "../../shared/spiritHumanRescue";
import { assertAuthoritativeRescueSendEnabled } from "./rescueRouter";

const NOW = new Date("2026-09-17T15:00:00.000Z");

function dormantRow(phone = "3105550101", lastOrderAt = new Date("2026-07-01T12:00:00.000Z")): AdminCustomerAggregateDbRow {
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
    lastOrderAt,
    lastOrderId: 88,
    ordersLast30Days: 0,
    ordersLast90Days: 1,
  };
}

function snapshotId(tenantId = "tenant-a", phone = "3105550101"): string {
  return strategyCustomerSnapshotId(tenantId, dormantRow(phone));
}

function candidateFor(tenantId = "tenant-a", phone = "3105550101") {
  return {
    id: snapshotId(tenantId, phone),
    firstName: "Priya",
    buildingName: "Opus LA",
    lastOrderAt: "2026-07-01T12:00:00.000Z",
    daysSinceLastOrder: 78,
  };
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

function depsFor(
  overrides: Parameters<typeof defaultTestRescueDeps>[0] = {},
  tenantId = "tenant-a",
  phone = "3105550101"
) {
  return defaultTestRescueDeps({
    now: () => NOW,
    loadCandidates: async () => [candidateFor(tenantId, phone)],
    resolveSendContact: async () => ({ kind: "ready", contact: contactFor(tenantId, phone) }),
    ...overrides,
  });
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

  it("treats a paid customer who is no longer dormant as ineligible at send", () => {
    const row = dormantRow("3105550101", new Date("2026-09-16T12:00:00.000Z"));
    const id = snapshotId();
    const resolved = resolveSendContactFromAggregates({
      tenantId: "tenant-a",
      snapshotCustomerId: id,
      rows: [row],
      now: NOW,
    });
    expect(resolved).toEqual({ kind: "no_longer_dormant" });
  });

  it("freezes the same customer across re-instantiate and never swaps on send retry", async () => {
    const deps = depsFor();
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
    expect(failed.send.evidenceName).toBe("provider_rejected");
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
    const deps = depsFor();
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

  it("sends once on double-tap and concurrent requests, and does not send after cancel", async () => {
    const deps = depsFor();
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

    const other = depsFor({}, "tenant-a", "3105550199");
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
    const deps = depsFor({ store, sendAdapter: reject });
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

  it("keeps raw contact PII off the public Objective and resolves it only at send", async () => {
    const store = new MemoryRescueMissionStore();
    let resolveCalls = 0;
    const deps = depsFor({
      store,
      resolveSendContact: async () => {
        resolveCalls += 1;
        return { kind: "ready" as const, contact: contactFor() };
      },
    });
    const created = await instantiateRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", snapshotCustomerId: snapshotId() },
      deps
    );
    const stored = (await store.get("tenant-a", created.missionId))!;
    await store.save({
      ...stored,
      spiritHuman: {
        ...stored.spiritHuman,
        phone: "3105550101",
        email: "priya@example.com",
        address: "3545 Wilshire Blvd",
        lastName: "Test",
      },
    } as typeof stored);
    const listed = await listRescueMissions(
      { tenantId: "tenant-a", operatorUserId: "op-a" },
      deps
    );
    expect(JSON.stringify(listed)).not.toMatch(/3105550101|priya@example.com|Wilshire|lastName/);
    expect(publicMissionHasNoPhone(listed[0]!)).toBe(true);
    expect(listed[0]?.spiritHuman.firstName).toBe("Priya");
    expect(listed[0]?.spiritHuman.snapshotCustomerId).toBe(created.spiritHuman.snapshotCustomerId);

    const otherTenant = await listRescueMissions(
      { tenantId: "tenant-b", operatorUserId: "op-a" },
      deps
    );
    expect(otherTenant).toEqual([]);
    await expect(
      approveAndSendRescue(
        {
          tenantId: "tenant-b",
          operatorUserId: "op-a",
          missionId: created.missionId,
          approvedByUserId: "op-a",
          operatorAuthorizedSend: true,
        },
        deps
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(resolveCalls).toBe(0);
    expect(deps.sendAdapter.attempts).toHaveLength(0);

    const sent = await approveAndSendRescue(
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        missionId: created.missionId,
        approvedByUserId: "op-a",
        operatorAuthorizedSend: true,
      },
      deps
    );
    expect(resolveCalls).toBe(1);
    expect(deps.sendAdapter.attempts).toEqual([
      expect.objectContaining({ to: "3105550101" }),
    ]);
    expect(sent.lifecycle).toBe("completed");
    expect(JSON.stringify(sent)).not.toMatch(/3105550101|priya@example.com|Wilshire/);
    expect(canCompleteRescue(sent.send)).toBe(true);
    const durable = await store.get("tenant-a", created.missionId);
    expect(JSON.stringify(durable)).not.toMatch(/3105550101|priya@example.com|Wilshire/);
  });

  it("still rejects a public payload that contains a phone number", async () => {
    const store = new MemoryRescueMissionStore();
    const deps = depsFor({ store });
    const created = await instantiateRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", snapshotCustomerId: snapshotId() },
      deps
    );
    await expect(
      prepareRescueDraft(
        {
          tenantId: "tenant-a",
          operatorUserId: "op-a",
          missionId: created.missionId,
          editedDraft: "Call me at 310-555-0199",
        },
        deps
      )
    ).rejects.toThrow("Spirit Human public mission leaked contact PII.");
    expect((await store.get("tenant-a", created.missionId))?.draft).toBeNull();
    expect(deps.sendAdapter.attempts).toHaveLength(0);
  });

  it("publishes rescue candidates without contact fields", () => {
    const published = toPublicRescueCandidate({
      id: "cust_safe",
      firstName: "Priya",
      buildingName: "Opus LA",
      lastOrderAt: "2026-07-01T12:00:00.000Z",
      daysSinceLastOrder: 78,
      phone: "3105550101",
      email: "priya@example.com",
      address: "3545 Wilshire Blvd",
    } as never);
    expect(published).toEqual({
      id: "cust_safe",
      firstName: "Priya",
      buildingName: "Opus LA",
      lastOrderAt: "2026-07-01T12:00:00.000Z",
      daysSinceLastOrder: 78,
    });
  });

  it("isolates tenants and operators, and never puts a phone on the public mission", async () => {
    const store = new MemoryRescueMissionStore();
    const depsA = depsFor({ store });
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
    let resolveCalls = 0;
    const deps = depsFor({
      resolveSendContact: async () => {
        resolveCalls += 1;
        return { kind: "ready" as const, contact: contactFor() };
      },
    });
    const created = await instantiateRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", snapshotCustomerId: snapshotId() },
      deps
    );
    expect(resolveCalls).toBe(0);
    await prepareRescueDraft(
      { tenantId: "tenant-a", operatorUserId: "op-a", missionId: created.missionId },
      deps
    );
    expect(JSON.stringify(created)).not.toMatch(/twilio/i);
    expect(JSON.stringify(created)).not.toMatch(/310555/);
    expect(deps.sendAdapter.attempts).toHaveLength(0);
  });

  it("does not send when communication permission is refused and does not call it a provider rejection", async () => {
    const deps = depsFor({
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
    expect(failed.send.evidenceName).toBe("permission_denied");
    expect(canCompleteRescue(failed.send)).toBe(false);
    expect(deps.sendAdapter.attempts).toHaveLength(0);
  });

  it("does not mislabel provider_unconfigured as provider_rejected", async () => {
    const deps = depsFor({
      sendAdapter: createFakeOutboundSendAdapter({ mode: "unconfigured" }),
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
    expect(failed.send.evidenceName).toBe("provider_unconfigured");
    expect(canCompleteRescue(failed.send)).toBe(false);
  });

  it("does not send when contact cannot be resolved", async () => {
    const deps = depsFor({
      resolveSendContact: async () => ({ kind: "not_found" }),
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
    expect(failed.send.evidenceName).toBe("contact_unresolved");
    expect(deps.sendAdapter.attempts).toHaveLength(0);
  });

  it("supersedes without sending when the frozen target is no longer dormant", async () => {
    const deps = depsFor({
      resolveSendContact: async () => ({ kind: "no_longer_dormant" }),
    });
    const created = await instantiateRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", snapshotCustomerId: snapshotId() },
      deps
    );
    const result = await approveAndSendRescue(
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        missionId: created.missionId,
        approvedByUserId: "op-a",
        operatorAuthorizedSend: true,
      },
      deps
    );
    expect(result.lifecycle).toBe("superseded");
    expect(result.send.evidenceName).toBe("no_longer_dormant");
    expect(canCompleteRescue(result.send)).toBe(false);
    expect(deps.sendAdapter.attempts).toHaveLength(0);
    expect(result.spiritHuman.snapshotCustomerId).toBe(created.spiritHuman.snapshotCustomerId);
  });

  it("survives store reconstruction with frozen target, villager, draft, and sent receipt", async () => {
    const storeA = new MemoryRescueMissionStore();
    const depsA = depsFor({ store: storeA });
    const created = await instantiateRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", snapshotCustomerId: snapshotId() },
      depsA
    );
    await prepareRescueDraft(
      { tenantId: "tenant-a", operatorUserId: "op-a", missionId: created.missionId },
      depsA
    );
    const sent = await approveAndSendRescue(
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        missionId: created.missionId,
        approvedByUserId: "op-a",
        operatorAuthorizedSend: true,
      },
      depsA
    );
    const later = await recordRescueConsequence(
      {
        tenantId: "tenant-a",
        missionId: created.missionId,
        kind: "customer_replied",
        evidenceId: "inbound-later",
      },
      depsA
    );
    const storeB = MemoryRescueMissionStore.fromSnapshot(storeA.dump());
    const reloaded = await storeB.get("tenant-a", created.missionId);
    expect(reloaded?.missionId).toBe(created.missionId);
    expect(reloaded?.spiritHuman.snapshotCustomerId).toBe(created.spiritHuman.snapshotCustomerId);
    expect(reloaded?.villager.id).toBe(created.villager.id);
    expect(reloaded?.draft).toBeTruthy();
    expect(reloaded?.send.providerMessageId).toBe(sent.send.providerMessageId);
    expect(canCompleteRescue(reloaded!.send)).toBe(true);
    expect(reloaded?.consequences).toEqual(later?.consequences);
    const retryAdapter = createFakeOutboundSendAdapter();
    const retried = await approveAndSendRescue(
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        missionId: created.missionId,
        approvedByUserId: "op-a",
        operatorAuthorizedSend: true,
      },
      { ...depsA, store: storeB, sendAdapter: retryAdapter }
    );
    expect(retried.send.providerMessageId).toBe(sent.send.providerMessageId);
    expect(retryAdapter.attempts).toHaveLength(0);
  });

  it("treats persisted sending after restart as unknown and does not call the provider", async () => {
    const storeA = new MemoryRescueMissionStore();
    const depsA = depsFor({ store: storeA });
    const created = await instantiateRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", snapshotCustomerId: snapshotId() },
      depsA
    );
    const sending = {
      ...created,
      send: { ...created.send, status: "sending" as const, attemptedAt: NOW.toISOString() },
      lifecycle: "active" as const,
    };
    await storeA.save(sending);
    const storeB = MemoryRescueMissionStore.fromSnapshot(storeA.dump());
    const adapter = createFakeOutboundSendAdapter();
    const result = await approveAndSendRescue(
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        missionId: created.missionId,
        approvedByUserId: "op-a",
        operatorAuthorizedSend: true,
      },
      { ...depsA, store: storeB, sendAdapter: adapter }
    );
    expect(result.send.status).toBe("send_outcome_unknown");
    expect(result.send.evidenceName).toBe("send_outcome_unknown");
    expect(canCompleteRescue(result.send)).toBe(false);
    expect(adapter.attempts).toHaveLength(0);
    const again = await approveAndSendRescue(
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        missionId: created.missionId,
        approvedByUserId: "op-a",
        operatorAuthorizedSend: true,
      },
      { ...depsA, store: storeB, sendAdapter: adapter }
    );
    expect(again.send.status).toBe("send_outcome_unknown");
    expect(adapter.attempts).toHaveLength(0);
  });

  it("returns authoritative success even if outreach bookkeeping throws", async () => {
    const deps = depsFor({
      recordOutreach: async () => {
        throw new Error("ledger down");
      },
    });
    const created = await instantiateRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", snapshotCustomerId: snapshotId() },
      deps
    );
    const sent = await approveAndSendRescue(
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        missionId: created.missionId,
        approvedByUserId: "op-a",
        operatorAuthorizedSend: true,
      },
      deps
    );
    expect(sent.lifecycle).toBe("completed");
    expect(canCompleteRescue(sent.send)).toBe(true);
  });

  it("keeps NOT NOW distinct from CANCEL", async () => {
    const deps = depsFor();
    const created = await instantiateRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", snapshotCustomerId: snapshotId() },
      deps
    );
    const deferred = await deferRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", missionId: created.missionId },
      deps
    );
    expect(deferred.deferredAt).toBeTruthy();
    expect(deferred.lifecycle).toBe("available");
    expect(deferred.send.status).not.toBe("cancelled");
    const reused = await instantiateRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", snapshotCustomerId: snapshotId() },
      deps
    );
    expect(reused.missionId).toBe(created.missionId);

    const other = depsFor({}, "tenant-a", "3105550199");
    const second = await instantiateRescueMission(
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        snapshotCustomerId: snapshotId("tenant-a", "3105550199"),
      },
      other
    );
    const cancelled = await cancelRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", missionId: second.missionId },
      other
    );
    expect(cancelled.lifecycle).toBe("skipped");
    expect(cancelled.send.status).toBe("cancelled");
    expect(cancelled.deferredAt).toBeNull();
  });

  it("treats an ambiguous adapter failure after the sending claim as unknown and never retries", async () => {
    const deps = depsFor({
      sendAdapter: createFakeOutboundSendAdapter({ mode: "ambiguous" }),
    });
    const created = await instantiateRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", snapshotCustomerId: snapshotId() },
      deps
    );
    const unknown = await approveAndSendRescue(
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        missionId: created.missionId,
        approvedByUserId: "op-a",
        operatorAuthorizedSend: true,
      },
      deps
    );
    expect(unknown.send.status).toBe("send_outcome_unknown");
    expect(unknown.send.evidenceName).toBe("send_outcome_unknown");
    expect(canCompleteRescue(unknown.send)).toBe(false);
    expect(deps.sendAdapter.attempts).toHaveLength(1);
    const retried = await approveAndSendRescue(
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        missionId: created.missionId,
        approvedByUserId: "op-a",
        operatorAuthorizedSend: true,
      },
      deps
    );
    expect(retried.send.status).toBe("send_outcome_unknown");
    expect(canCompleteRescue(retried.send)).toBe(false);
    expect(deps.sendAdapter.attempts).toHaveLength(1);
  });
});

describe("Spirit Human rescue mutation CAS", () => {
  async function seedThenStaleRead(
    liveStatus: "sending" | "send_outcome_unknown" | "sent",
    liveLifecycle: "active" | "problem" | "completed"
  ) {
    const store = new MemoryRescueMissionStore();
    const deps = depsFor({ store });
    const created = await instantiateRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", snapshotCustomerId: snapshotId() },
      deps
    );
    const preSend = (await store.get("tenant-a", created.missionId))!;
    const live = {
      ...preSend,
      send: {
        ...preSend.send,
        status: liveStatus,
        ...(liveStatus === "sent"
          ? {
              providerMessageId: "SM_locked",
              evidenceName: "provider_accepted" as const,
              acceptedAt: NOW.toISOString(),
            }
          : {}),
      },
      lifecycle: liveLifecycle,
    };
    await store.save(live);
    const origGet = store.get.bind(store);
    let reads = 0;
    store.get = async (tenantId, missionId) => {
      reads += 1;
      if (reads === 1) return preSend;
      return origGet(tenantId, missionId);
    };
    return { deps, created, origGet };
  }

  it("does not let stale prepare/defer/cancel overwrite a sending claim", async () => {
    const prepared = await seedThenStaleRead("sending", "active");
    const draft = await prepareRescueDraft(
      { tenantId: "tenant-a", operatorUserId: "op-a", missionId: prepared.created.missionId },
      prepared.deps
    );
    expect((await prepared.origGet("tenant-a", prepared.created.missionId))?.send.status).toBe("sending");
    expect(draft.send.status).toBe("sending");

    const deferredRun = await seedThenStaleRead("sending", "active");
    const deferred = await deferRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", missionId: deferredRun.created.missionId },
      deferredRun.deps
    );
    expect((await deferredRun.origGet("tenant-a", deferredRun.created.missionId))?.send.status).toBe(
      "sending"
    );
    expect(deferred.send.status).toBe("sending");

    const cancelledRun = await seedThenStaleRead("sending", "active");
    const cancelled = await cancelRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", missionId: cancelledRun.created.missionId },
      cancelledRun.deps
    );
    expect((await cancelledRun.origGet("tenant-a", cancelledRun.created.missionId))?.send.status).toBe(
      "sending"
    );
    expect(cancelled.send.status).toBe("sending");
  });

  it("does not let unknown or sent become claimable through another mutation", async () => {
    const unknownRun = await seedThenStaleRead("send_outcome_unknown", "problem");
    const drafted = await prepareRescueDraft(
      { tenantId: "tenant-a", operatorUserId: "op-a", missionId: unknownRun.created.missionId },
      unknownRun.deps
    );
    expect(drafted.send.status).toBe("send_outcome_unknown");
    expect(
      (await unknownRun.origGet("tenant-a", unknownRun.created.missionId))?.send.status
    ).toBe("send_outcome_unknown");

    const sentRun = await seedThenStaleRead("sent", "completed");
    const cancelled = await cancelRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", missionId: sentRun.created.missionId },
      sentRun.deps
    );
    expect(canCompleteRescue(cancelled.send)).toBe(true);
    expect((await sentRun.origGet("tenant-a", sentRun.created.missionId))?.send.providerMessageId).toBe(
      "SM_locked"
    );
  });

  it("does not let a superseded mission win a later send claim", async () => {
    const deps = depsFor({
      resolveSendContact: async () => ({ kind: "no_longer_dormant" }),
    });
    const created = await instantiateRescueMission(
      { tenantId: "tenant-a", operatorUserId: "op-a", snapshotCustomerId: snapshotId() },
      deps
    );
    const superseded = await approveAndSendRescue(
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        missionId: created.missionId,
        approvedByUserId: "op-a",
        operatorAuthorizedSend: true,
      },
      deps
    );
    expect(superseded.lifecycle).toBe("superseded");
    const retryAdapter = createFakeOutboundSendAdapter();
    const retried = await approveAndSendRescue(
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        missionId: created.missionId,
        approvedByUserId: "op-a",
        operatorAuthorizedSend: true,
      },
      { ...deps, sendAdapter: retryAdapter, resolveSendContact: async () => ({ kind: "ready", contact: contactFor() }) }
    );
    expect(retried.lifecycle).toBe("superseded");
    expect(retryAdapter.attempts).toHaveLength(0);
    expect(canCompleteRescue(retried.send)).toBe(false);
  });
});

describe("Spirit Human rescue proof-mode send guard", () => {
  it("refuses the production send path when GOLDLINE_PROOF_MODE is set", () => {
    const previous = process.env.GOLDLINE_PROOF_MODE;
    process.env.GOLDLINE_PROOF_MODE = "1";
    try {
      expect(() => assertAuthoritativeRescueSendEnabled()).toThrow(/proof mode/i);
    } finally {
      if (previous === undefined) delete process.env.GOLDLINE_PROOF_MODE;
      else process.env.GOLDLINE_PROOF_MODE = previous;
    }
  });
});
