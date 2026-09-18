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
        loadAggregates: async () => [row],
        now: () => new Date("2026-09-18T12:00:00.000Z"),
      }
    );
    expect(result.status).toBe(200);
    expect(result.persistBody).toBe(false);
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
});
