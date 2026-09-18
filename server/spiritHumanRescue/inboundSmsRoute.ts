import type { Express, Request } from "express";
import { ENV } from "../_core/env";
import { listAdminCustomerAggregates } from "../db";
import { isValidTwilioWebhook } from "../claire/conversation/twilioSignature";
import { strategyCustomerSnapshotId } from "../strategy/snapshotDormantCustomers";
import { canCompleteRescue } from "../../shared/spiritHumanRescue";
import { recordRescueConsequence } from "./rescueMissionService";
import { requireDurableRescueStore } from "./rescueMissionStore";

export const SPIRIT_HUMAN_INBOUND_SMS_PATH = "/api/spirit-human/twilio/inbound-sms";

function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function publicUrlFor(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string)?.split(",")[0] || req.get("host");
  return `${proto}://${host}${req.originalUrl}`;
}

export function registerSpiritHumanInboundSmsRoutes(app: Express): void {
  app.post(SPIRIT_HUMAN_INBOUND_SMS_PATH, async (req, res) => {
    res.type("text/xml");
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
    const body = (req.body ?? {}) as Record<string, string>;
    const valid = isValidTwilioWebhook({
      authToken,
      signature: req.headers["x-twilio-signature"],
      urls: [publicUrlFor(req), `${ENV.adminBaseUrl.replace(/\/$/, "")}${req.originalUrl}`],
      body,
      nodeEnv: process.env.NODE_ENV ?? "development",
    });
    if (!valid) return res.status(403).send("<Response></Response>");

    const tenantId = process.env.SPIRIT_HUMAN_SMS_TENANT_ID?.trim() ?? "";
    const expectedTo =
      process.env.SPIRIT_HUMAN_SMS_FROM_NUMBER?.trim() ||
      process.env.CLAIRE_TWILIO_FROM_NUMBER?.trim() ||
      "";
    if (!tenantId || !expectedTo) {
      console.warn("[SpiritHumanRescue] inbound SMS ignored: explicit tenant/from-number binding is not configured");
      return res.status(503).send("<Response></Response>");
    }

    const from = digits(body.From);
    const to = digits(body.To);
    const messageSid = String(body.MessageSid ?? "").trim();
    if (!from || !to || !messageSid || to !== digits(expectedTo)) {
      return res.status(400).send("<Response></Response>");
    }

    try {
      const aggregates = await listAdminCustomerAggregates(tenantId);
      const matchingCustomers = aggregates.filter(row => digits(row.phone) === from);
      const snapshotIds = new Set(
        matchingCustomers.map(row => strategyCustomerSnapshotId(tenantId, row))
      );
      if (snapshotIds.size !== 1) {
        console.warn("[SpiritHumanRescue] inbound SMS identity was not uniquely resolvable");
        return res.status(204).send("");
      }
      const [snapshotCustomerId] = [...snapshotIds];
      const store = await requireDurableRescueStore();
      const candidates = (await store.listForTenant(tenantId))
        .filter(
          mission =>
            mission.spiritHuman.snapshotCustomerId === snapshotCustomerId &&
            canCompleteRescue(mission.send) &&
            Boolean(mission.send.acceptedAt)
        )
        .sort(
          (a, b) =>
            Date.parse(b.send.acceptedAt ?? "") - Date.parse(a.send.acceptedAt ?? "")
        );
      const mission = candidates[0];
      if (!mission) return res.status(204).send("");

      await recordRescueConsequence(
        {
          tenantId,
          missionId: mission.missionId,
          kind: "customer_replied",
          evidenceId: `twilio:${messageSid}`,
          observedAt: new Date(),
        },
        { store }
      );
      return res.status(200).send("<Response></Response>");
    } catch (error) {
      console.error("[SpiritHumanRescue] inbound SMS consequence recording failed", error);
      return res.status(500).send("<Response></Response>");
    }
  });
}
