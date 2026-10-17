import type { Express, Request } from "express";
import { ENV } from "../_core/env";
import { listAdminCustomerAggregates } from "../db";
import { isValidTwilioWebhook } from "../claire/conversation/twilioSignature";
import { strategyCustomerSnapshotId } from "../strategy/snapshotDormantCustomers";
import { canCompleteRescue } from "../../shared/spiritHumanRescue";
import { recordRescueConsequence } from "./rescueMissionService";
import { requireDurableRescueStore, type RescueMissionStore } from "./rescueMissionStore";
import type { AdminCustomerAggregateDbRow } from "../adminCustomerAggregate";
import {
  customerKeyHashForPhone,
  optOutKeywordFor,
  requireDurableBusinessLineInbox,
  type BusinessLineInboxStore,
} from "./businessLineInbox";

export const SPIRIT_HUMAN_INBOUND_SMS_PATH = "/api/spirit-human/twilio/inbound-sms";

function digits(value: unknown): string {
  let valueDigits = String(value ?? "").replace(/\D/g, "");
  if (valueDigits.length === 11 && valueDigits.startsWith("1")) valueDigits = valueDigits.slice(1);
  return valueDigits;
}

function publicUrlFor(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string)?.split(",")[0] || req.get("host");
  return `${proto}://${host}${req.originalUrl}`;
}

export type SpiritHumanInboundSmsDeps = {
  authToken?: string;
  tenantId?: string;
  expectedTo?: string;
  nodeEnv?: string;
  store?: RescueMissionStore;
  inbox?: BusinessLineInboxStore;
  loadAggregates?: (tenantId: string) => Promise<AdminCustomerAggregateDbRow[]>;
  now?: () => Date;
};

export async function handleSpiritHumanInboundSms(
  input: {
    signature: unknown;
    urls: string[];
    body: Record<string, string>;
  },
  deps: SpiritHumanInboundSmsDeps = {}
): Promise<{ status: number; recorded: boolean; optedOut: boolean }> {
  const authToken = (deps.authToken ?? process.env.TWILIO_AUTH_TOKEN ?? "").trim();
  const valid = isValidTwilioWebhook({
    authToken,
    signature: input.signature,
    urls: input.urls,
    body: input.body,
    nodeEnv: deps.nodeEnv ?? process.env.NODE_ENV ?? "development",
  });
  if (!valid) return { status: 403, recorded: false, optedOut: false };

  const tenantId = (deps.tenantId ?? process.env.SPIRIT_HUMAN_SMS_TENANT_ID ?? "").trim();
  const expectedTo = (
    deps.expectedTo ??
    process.env.SPIRIT_HUMAN_SMS_FROM_NUMBER ??
    process.env.CLAIRE_TWILIO_FROM_NUMBER ??
    ""
  ).trim();
  if (!tenantId || !expectedTo) {
    console.warn("[SpiritHumanRescue] inbound SMS ignored: explicit tenant/from-number binding is not configured");
    return { status: 503, recorded: false, optedOut: false };
  }

  const from = digits(input.body.From);
  const to = digits(input.body.To);
  const messageSid = String(input.body.MessageSid ?? "").trim();
  if (!from || !to || !messageSid || to !== digits(expectedTo)) {
    return { status: 400, recorded: false, optedOut: false };
  }

  const now = (deps.now ?? (() => new Date()))();
  const customerKeyHash = customerKeyHashForPhone(tenantId, from);
  if (!customerKeyHash) return { status: 400, recorded: false, optedOut: false };
  const keyword = optOutKeywordFor(String(input.body.Body ?? ""), input.body.OptOutType);
  // Save the reply before anything else can fail. A 500 shows in Twilio's debugger
  // and the text stays in Twilio's message log for backfill.
  const inbox = deps.inbox ?? (await requireDurableBusinessLineInbox());
  const recorded = await inbox.recordInbound({
    tenantId,
    providerMessageSid: messageSid,
    toDigits: to,
    fromDigits: from,
    customerKeyHash,
    body: String(input.body.Body ?? ""),
    numMedia: Number.parseInt(String(input.body.NumMedia ?? "0"), 10) || 0,
    optOutKeyword: keyword,
    receivedAt: now,
  });
  if (!recorded) return { status: 500, recorded: false, optedOut: false };

  const aggregates = await (deps.loadAggregates ?? listAdminCustomerAggregates)(tenantId);
  const matchingCustomers = aggregates.filter(row => digits(row.phone) === from);
  const snapshotIds = new Set(
    matchingCustomers.map(row => strategyCustomerSnapshotId(tenantId, row))
  );
  let optedOut = false;
  if (keyword === "stop") {
    optedOut = await inbox.recordOptOut({
      tenantId,
      customerKeyHash,
      snapshotCustomerIds: [...snapshotIds],
      providerMessageSid: messageSid,
      capturedAt: now,
    });
    if (!optedOut) return { status: 500, recorded: true, optedOut: false };
    return { status: 200, recorded: true, optedOut: true };
  }
  if (snapshotIds.size !== 1) {
    console.warn("[SpiritHumanRescue] inbound SMS identity was not uniquely resolvable");
    return { status: 204, recorded: true, optedOut };
  }
  const [snapshotCustomerId] = [...snapshotIds];
  const store = deps.store ?? (await requireDurableRescueStore());
  const candidates = (await store.listForTenant(tenantId))
    .filter(
      mission =>
        mission.spiritHuman.snapshotCustomerId === snapshotCustomerId &&
        canCompleteRescue(mission.send) &&
        Boolean(mission.send.acceptedAt)
    )
    .sort(
      (a, b) => Date.parse(b.send.acceptedAt ?? "") - Date.parse(a.send.acceptedAt ?? "")
    );
  const mission = candidates[0];
  if (!mission) return { status: 204, recorded: true, optedOut };

  await recordRescueConsequence(
    {
      tenantId,
      missionId: mission.missionId,
      kind: "customer_replied",
      evidenceId: `twilio:${messageSid}`,
      observedAt: now,
    },
    { store }
  );
  return { status: 200, recorded: true, optedOut };
}

export function registerSpiritHumanInboundSmsRoutes(app: Express): void {
  app.post(SPIRIT_HUMAN_INBOUND_SMS_PATH, async (req, res) => {
    res.type("text/xml");
    try {
      const result = await handleSpiritHumanInboundSms({
        signature: req.headers["x-twilio-signature"],
        urls: [publicUrlFor(req), `${ENV.adminBaseUrl.replace(/\/$/, "")}${req.originalUrl}`],
        body: (req.body ?? {}) as Record<string, string>,
      });
      const xml = result.status === 204 ? "" : "<Response></Response>";
      return res.status(result.status).send(xml);
    } catch (error) {
      console.error("[SpiritHumanRescue] inbound SMS consequence recording failed", error);
      return res.status(500).send("<Response></Response>");
    }
  });
}
