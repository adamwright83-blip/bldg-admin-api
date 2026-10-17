import { readFileSync } from "node:fs";
import twilio from "twilio";
import { describe, expect, it } from "vitest";
import { emptySendRecord, SPIRIT_HUMAN_VILLAGERS, type SpiritHumanRescueMission } from "../../shared/spiritHumanRescue";
import type { AdminCustomerAggregateDbRow } from "../adminCustomerAggregate";
import { strategyCustomerSnapshotId } from "../strategy/snapshotDormantCustomers";
import {
  handleSpiritHumanInboundSms,
  registerSpiritHumanInboundSmsRoutes,
  SPIRIT_HUMAN_INBOUND_SMS_PATH,
} from "./inboundSmsRoute";
import { MemoryRescueMissionStore } from "./rescueMissionStore";
import { customerKeyHashForPhone, MemoryBusinessLineInbox, optOutKeywordFor } from "./businessLineInbox";

const AUTH = "test-twilio-token";
const URL = "https://api.example.test/api/spirit-human/twilio/inbound-sms";
const TO = "+13105550999";
const FROM = "+13105550101";

function aggregate(): AdminCustomerAggregateDbRow {
  return {
    phone: FROM,
    firstName: "Priya",
    lastName: "Rao",
    email: null,
    unit: "2A",
    address: "100 Main St",
    buildingSlug: null,
    totalOrders: 3,
    lifetimeSpend: 120,
    paidOrderCount: 3,
    firstOrderAt: new Date("2026-01-01T00:00:00.000Z"),
    lastOrderAt: new Date("2026-07-01T00:00:00.000Z"),
    lastOrderId: 3,
    ordersLast30Days: 0,
    ordersLast90Days: 0,
  };
}

function sentMission(snapshotCustomerId: string): SpiritHumanRescueMission {
  const missionId = "shr_sms";
  return {
    missionId,
    tenantId: "default",
    operatorUserId: "op",
    kind: "spirit_human_rescue",
    lifecycle: "completed",
    villager: SPIRIT_HUMAN_VILLAGERS[0]!,
    spiritHuman: {
      snapshotCustomerId,
      firstName: "Priya",
      lastOrderAt: "2026-07-01T00:00:00.000Z",
      daysSinceLastOrder: 79,
    },
    draft: "Priya, it's Laundry Butler.",
    send: {
      ...emptySendRecord(missionId),
      status: "sent",
      acceptedAt: "2026-09-18T00:00:00.000Z",
      providerMessageId: "SM_out",
      evidenceName: "provider_accepted",
    },
    consequences: [],
    opsTaskId: null,
    deferredAt: null,
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
  };
}

function signedBody(body: Record<string, string>) {
  return {
    body,
    signature: twilio.getExpectedTwilioSignature(AUTH, URL, body),
  };
}

describe("Spirit Human inbound SMS webhook", () => {
  it("mounts the inbound path and production also keeps Claire routes", () => {
    const paths: string[] = [];
    registerSpiritHumanInboundSmsRoutes({ post: (path: string) => paths.push(path) } as never);
    expect(paths).toEqual([SPIRIT_HUMAN_INBOUND_SMS_PATH]);
    const src = readFileSync("server/_core/index.ts", "utf8");
    expect(src).toContain("registerClaireRoutes(app)");
    expect(src).toContain("registerSpiritHumanInboundSmsRoutes(app)");
  });

  it("rejects an invalid Twilio signature", async () => {
    const result = await handleSpiritHumanInboundSms(
      {
        signature: "not-valid",
        urls: [URL],
        body: { MessageSid: "SM1", From: FROM, To: TO, Body: "hi" },
      },
      { authToken: AUTH, tenantId: "default", expectedTo: TO, nodeEnv: "production" }
    );
    expect(result.status).toBe(403);
  });

  it("fails closed without an explicit tenant binding", async () => {
    const { body, signature } = signedBody({ MessageSid: "SM1", From: FROM, To: TO, Body: "hi" });
    const result = await handleSpiritHumanInboundSms(
      { signature, urls: [URL], body },
      { authToken: AUTH, tenantId: "", expectedTo: TO, nodeEnv: "production" }
    );
    expect(result.status).toBe(503);
  });

  it("rejects the wrong destination number", async () => {
    const { body, signature } = signedBody({ MessageSid: "SM1", From: FROM, To: "+13105550000", Body: "hi" });
    const result = await handleSpiritHumanInboundSms(
      { signature, urls: [URL], body },
      { authToken: AUTH, tenantId: "default", expectedTo: TO, nodeEnv: "production" }
    );
    expect(result.status).toBe(400);
  });

  it("rejects an ambiguous current customer identity", async () => {
    const shortFrom = "+155512";
    const rowA: AdminCustomerAggregateDbRow = {
      ...aggregate(),
      phone: "155512",
      firstName: "Priya",
      unit: "2A",
    };
    const rowB: AdminCustomerAggregateDbRow = {
      ...aggregate(),
      phone: "155512",
      firstName: "Other",
      unit: "9B",
      address: "200 Other St",
    };
    expect(strategyCustomerSnapshotId("default", rowA)).not.toBe(
      strategyCustomerSnapshotId("default", rowB)
    );
    const store = new MemoryRescueMissionStore();
    const { body, signature } = signedBody({ MessageSid: "SM1", From: shortFrom, To: TO, Body: "secret text" });
    const result = await handleSpiritHumanInboundSms(
      { signature, urls: [URL], body },
      {
        authToken: AUTH,
        tenantId: "default",
        expectedTo: TO,
        nodeEnv: "production",
        store,
        inbox: new MemoryBusinessLineInbox(),
        loadAggregates: async () => [rowA, rowB],
      }
    );
    expect(result.status).toBe(204);
    expect(await store.listForTenant("default")).toEqual([]);
  });

  it("does not attach a reply to an unsent mission", async () => {
    const row = aggregate();
    const snapshot = strategyCustomerSnapshotId("default", row);
    const store = new MemoryRescueMissionStore();
    const unsent = sentMission(snapshot);
    unsent.send.status = "awaiting_approval";
    unsent.send.acceptedAt = null;
    unsent.send.providerMessageId = null;
    unsent.send.evidenceName = null;
    unsent.lifecycle = "available";
    await store.save(unsent);
    const { body, signature } = signedBody({ MessageSid: "SM1", From: FROM, To: TO, Body: "secret text" });
    const result = await handleSpiritHumanInboundSms(
      { signature, urls: [URL], body },
      {
        authToken: AUTH,
        tenantId: "default",
        expectedTo: TO,
        nodeEnv: "production",
        store,
        inbox: new MemoryBusinessLineInbox(),
        loadAggregates: async () => [row],
      }
    );
    expect(result.status).toBe(204);
    expect((await store.get("default", unsent.missionId))?.consequences).toEqual([]);
  });

  it("records customer_replied from a signed inbound event without persisting the SMS body", async () => {
    const row = aggregate();
    const snapshot = strategyCustomerSnapshotId("default", row);
    const store = new MemoryRescueMissionStore();
    await store.save(sentMission(snapshot));
    const { body, signature } = signedBody({
      MessageSid: "SMinbound1",
      From: FROM,
      To: TO,
      Body: "YES please pick up tomorrow",
    });
    const result = await handleSpiritHumanInboundSms(
      { signature, urls: [URL], body },
      {
        authToken: AUTH,
        tenantId: "default",
        expectedTo: TO,
        nodeEnv: "production",
        store,
        inbox: new MemoryBusinessLineInbox(),
        loadAggregates: async () => [row],
        now: () => new Date("2026-09-18T12:00:00.000Z"),
      }
    );
    expect(result.status).toBe(200);
    expect(result.recorded).toBe(true);
    const saved = await store.get("default", "shr_sms");
    expect(saved?.consequences).toEqual([
      {
        kind: "customer_replied",
        evidenceId: "twilio:SMinbound1",
        observedAt: "2026-09-18T12:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(saved)).not.toContain("YES please pick up tomorrow");
    expect(JSON.stringify(saved)).not.toContain("no_response");
  });

  it("saves every signed reply first, even from a number that is not a customer", async () => {
    const inbox = new MemoryBusinessLineInbox();
    const store = new MemoryRescueMissionStore();
    const { body, signature } = signedBody({ MessageSid: "SMnew", From: "+13105550177", To: TO, Body: "Do you pick up in Echo Park?", NumMedia: "0" });
    const result = await handleSpiritHumanInboundSms(
      { signature, urls: [URL], body },
      { authToken: AUTH, tenantId: "default", expectedTo: TO, nodeEnv: "production", store, inbox, loadAggregates: async () => [aggregate()], now: () => new Date("2026-10-17T21:00:00.000Z") }
    );
    expect(result).toEqual({ status: 204, recorded: true, optedOut: false });
    expect([...inbox.messages.values()]).toEqual([
      {
        tenantId: "default",
        providerMessageSid: "SMnew",
        toDigits: "3105550999",
        fromDigits: "3105550177",
        customerKeyHash: customerKeyHashForPhone("default", "+13105550177"),
        body: "Do you pick up in Echo Park?",
        numMedia: 0,
        optOutKeyword: null,
        receivedAt: new Date("2026-10-17T21:00:00.000Z"),
      },
    ]);
  });

  it("a retried webhook with the same MessageSid is saved once", async () => {
    const inbox = new MemoryBusinessLineInbox();
    const { body, signature } = signedBody({ MessageSid: "SMdup", From: FROM, To: TO, Body: "hi" });
    const deps = { authToken: AUTH, tenantId: "default", expectedTo: TO, nodeEnv: "production", store: new MemoryRescueMissionStore(), inbox, loadAggregates: async () => [aggregate()] };
    await handleSpiritHumanInboundSms({ signature, urls: [URL], body }, deps);
    await handleSpiritHumanInboundSms({ signature, urls: [URL], body }, deps);
    expect(inbox.messages.size).toBe(1);
  });

  it("returns 500 and records nothing else when the reply cannot be saved", async () => {
    const row = aggregate();
    const store = new MemoryRescueMissionStore();
    await store.save(sentMission(strategyCustomerSnapshotId("default", row)));
    const inbox = new MemoryBusinessLineInbox();
    inbox.failInbound = true;
    const { body, signature } = signedBody({ MessageSid: "SMfail", From: FROM, To: TO, Body: "yes" });
    const result = await handleSpiritHumanInboundSms(
      { signature, urls: [URL], body },
      { authToken: AUTH, tenantId: "default", expectedTo: TO, nodeEnv: "production", store, inbox, loadAggregates: async () => [row] }
    );
    expect(result).toEqual({ status: 500, recorded: false, optedOut: false });
    expect((await store.get("default", "shr_sms"))?.consequences).toEqual([]);
  });

  it("STOP opts the sender out in both consent stores and is not counted as a reply", async () => {
    const row = aggregate();
    const snapshot = strategyCustomerSnapshotId("default", row);
    const store = new MemoryRescueMissionStore();
    await store.save(sentMission(snapshot));
    const inbox = new MemoryBusinessLineInbox();
    const { body, signature } = signedBody({ MessageSid: "SMstop", From: FROM, To: TO, Body: "Stop" });
    const result = await handleSpiritHumanInboundSms(
      { signature, urls: [URL], body },
      { authToken: AUTH, tenantId: "default", expectedTo: TO, nodeEnv: "production", store, inbox, loadAggregates: async () => [row], now: () => new Date("2026-10-17T21:00:00.000Z") }
    );
    expect(result).toEqual({ status: 200, recorded: true, optedOut: true });
    expect([...inbox.optOuts.values()]).toEqual([
      {
        tenantId: "default",
        customerKeyHash: customerKeyHashForPhone("default", FROM),
        snapshotCustomerIds: [snapshot],
        providerMessageSid: "SMstop",
        capturedAt: new Date("2026-10-17T21:00:00.000Z"),
      },
    ]);
    expect([...inbox.messages.values()][0]?.optOutKeyword).toBe("stop");
    expect((await store.get("default", "shr_sms"))?.consequences).toEqual([]);
  });

  it("returns 500 when the STOP cannot be saved, so it is never silently dropped", async () => {
    const inbox = new MemoryBusinessLineInbox();
    inbox.failOptOut = true;
    const { body, signature } = signedBody({ MessageSid: "SMstop2", From: FROM, To: TO, Body: "UNSUBSCRIBE" });
    const result = await handleSpiritHumanInboundSms(
      { signature, urls: [URL], body },
      { authToken: AUTH, tenantId: "default", expectedTo: TO, nodeEnv: "production", store: new MemoryRescueMissionStore(), inbox, loadAggregates: async () => [aggregate()] }
    );
    expect(result).toEqual({ status: 500, recorded: true, optedOut: false });
  });

  it("recognizes Twilio's opt-out keywords exactly, not words inside a sentence", () => {
    expect(optOutKeywordFor("stop")).toBe("stop");
    expect(optOutKeywordFor(" STOP. ")).toBe("stop");
    expect(optOutKeywordFor("Stop all")).toBe("stop");
    expect(optOutKeywordFor("quit")).toBe("stop");
    expect(optOutKeywordFor("anything", "STOP")).toBe("stop");
    expect(optOutKeywordFor("start")).toBe("start");
    expect(optOutKeywordFor("help")).toBe("help");
    expect(optOutKeywordFor("Can you stop by tomorrow?")).toBeNull();
    expect(optOutKeywordFor("yes please pick up")).toBeNull();
  });
});
