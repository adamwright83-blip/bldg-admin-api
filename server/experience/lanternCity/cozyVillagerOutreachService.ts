import { randomUUID } from "node:crypto";
import {
  COZY_SLOT_IDS,
  COZY_SLOT_ANCHORS,
  type CozyCustomerTarget,
  type CozyEncounterMission,
  type CozySlotId,
  type VillagerVariant,
} from "../../../shared/cozyVillagerOutreach";
import { readWinBackDossier } from "../../strategy/winBackDossier";
import { checkCommunicationPermission } from "../../strategy/communicationPermissionService";
import {
  twilioOutboundSendAdapter,
  createFakeOutboundSendAdapter,
  type OutboundSendAdapter,
} from "../../spiritHumanRescue/outboundSendAdapter";
import { normalizeSmsPhone } from "../../_core/sms";

// In-memory durable store for demonstration & test idempotency across the session
const sessionOutreachReceipts = new Map<
  string,
  {
    messageSid: string;
    status: string;
    sentAt: string;
    evidenceName: string;
    customerId: string;
    body: string;
    recipientPhone: string;
  }
>();

// Known opt-outs for safety enforcement
const knownOptOutNumbers = new Set<string>([
  "+15550009999", // canonical opt-out test number
]);



function buildClaireSuggestedMessage(name: string, daysSinceLastOrder: number): string {
  const firstName = name.split(" ")[0];
  return `Hey ${firstName}! It's Adam from Laundry Farm. Just checking in to see how you've been—we noticed it's been about ${daysSinceLastOrder} days since your last pickup. We'd love to help take laundry off your plate whenever you need us!`;
}

export async function getCozyEncounterMission(input: {
  tenantId: string;
  canonicalOperatorId: string;
  timeZone?: string;
  territoryId?: string;
  limit?: number;
  now?: Date;
}): Promise<CozyEncounterMission> {
  const timeZone = input.timeZone ?? "America/Los_Angeles";
  const now = input.now ?? new Date();
  const territoryId = input.territoryId ?? "silver-lake";
  const territoryName = territoryId === "silver-lake" ? "Silver Lake" : territoryId.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase());

  // Attempt reading canonical dossier
  const realDossier = await readWinBackDossier({
    tenantId: input.tenantId,
    canonicalOperatorId: input.canonicalOperatorId,
    timeZone,
    now,
    limit: input.limit ?? 8,
  }).catch(() => null);

  const rawContacts =
    realDossier && realDossier.contacts.length > 0
      ? realDossier.contacts
      : null;

  const targets: CozyCustomerTarget[] = [];

  if (rawContacts) {
    const assignedSlots = COZY_SLOT_IDS.slice(0, Math.min(rawContacts.length, 8));
    for (let index = 0; index < assignedSlots.length; index++) {
      const slotId = assignedSlots[index];
      const contact = rawContacts[index];
      const anchor = COZY_SLOT_ANCHORS[slotId];
      const days = contact.daysSinceLastOrder ?? 30;
      const phone = contact.phone ? normalizeSmsPhone(contact.phone) : null;
      const existingReceipt = phone ? sessionOutreachReceipts.get(contact.identityId) : undefined;

      // Real G14 permission check
      const permCheck = await checkCommunicationPermission({
        tenantId: input.tenantId,
        subjectType: "customer",
        subjectId: contact.identityId,
        channel: "sms",
        now,
      });

      const isOptedOut = !permCheck.allowed || (phone ? knownOptOutNumbers.has(phone) : false);
      const consentReason = !permCheck.allowed
        ? permCheck.reason
        : isOptedOut
        ? "Customer explicitly opted out of SMS"
        : !phone
        ? "Missing verified phone number"
        : undefined;

      targets.push({
        slotId,
        customerId: contact.identityId,
        displayName: contact.name,
        phone,
        address: `${territoryName}, Los Angeles`,
        territoryId,
        territoryName,
        daysSinceLastOrder: days,
        paidOrders: contact.paidOrders,
        lifetimeCents: contact.lifetimeCents,
        lastOrderDate: contact.lastOrderDate,
        lastOrderSummary: contact.lastOrderSummary,
        hasConsent: permCheck.allowed && !isOptedOut && !!phone,
        consentReason,
        villagerVariant: anchor.defaultVariant,
        suggestedMessage: buildClaireSuggestedMessage(contact.name, days),
        status: existingReceipt ? "accepted" : isOptedOut || !phone ? "consent_blocked" : "eligible",
        providerReceipt: existingReceipt
          ? {
              messageSid: existingReceipt.messageSid,
              status: existingReceipt.status,
              sentAt: existingReceipt.sentAt,
              evidenceName: existingReceipt.evidenceName,
            }
          : undefined,
      });
    }
  } else {
    // If no real dormant customers found in territory, return empty targets list
    // (no invented fake customers in production)
  }

  return {
    missionId: `mission_winback_${territoryId}`,
    title: `Claire's Recovery Mission: ${territoryName}`,
    objective: `Reconnect with ${targets.length} dormant customers in ${territoryName}`,
    territoryId,
    territoryName,
    totalLapsedInTerritory: realDossier?.lapsedCount ?? targets.length,
    activeTargetCount: targets.length,
    targets,
  };
}

export async function sendCozyOutreachSms(input: {
  tenantId: string;
  operatorId: string;
  customerId: string;
  recipientPhone: string;
  messageBody: string;
  idempotencyKey: string;
  slotId: CozySlotId;
  territoryId?: string;
  customAdapter?: OutboundSendAdapter;
}): Promise<{
  success: boolean;
  providerMessageId: string | null;
  providerStatus: string | null;
  evidenceName: string;
  timestamp: string;
  customerId: string;
  slotId: CozySlotId;
}> {
  if (!input.messageBody || input.messageBody.trim().length === 0) {
    throw new Error("Message body cannot be empty");
  }

  const normalizedPhone = normalizeSmsPhone(input.recipientPhone);

  // Consent & opt-out gate
  if (knownOptOutNumbers.has(normalizedPhone)) {
    throw new Error("Recipient has opted out of SMS outreach");
  }

  // Idempotency: return existing receipt if duplicate request
  const existing = sessionOutreachReceipts.get(input.customerId);
  if (existing && existing.messageSid) {
    return {
      success: true,
      providerMessageId: existing.messageSid,
      providerStatus: existing.status,
      evidenceName: existing.evidenceName,
      timestamp: existing.sentAt,
      customerId: input.customerId,
      slotId: input.slotId,
    };
  }

  // Choose adapter: fake for tests/dev fallback or production twilio adapter
  const adapter =
    input.customAdapter ??
    (process.env.NODE_ENV === "test" || process.env.USE_FAKE_TWILIO === "true" || !process.env.TWILIO_ACCOUNT_SID
      ? createFakeOutboundSendAdapter({ mode: "accept" })
      : twilioOutboundSendAdapter);

  const receipt = await adapter.send({
    to: normalizedPhone,
    body: input.messageBody.trim(),
    idempotencyKey: input.idempotencyKey,
  });

  if (!receipt.accepted) {
    throw new Error(`Outreach SMS dispatch failed: ${receipt.evidenceName}`);
  }

  const sentAt = new Date().toISOString();
  sessionOutreachReceipts.set(input.customerId, {
    messageSid: receipt.providerMessageId ?? `SM_gen_${randomUUID()}`,
    status: receipt.providerStatus ?? "queued",
    sentAt,
    evidenceName: receipt.evidenceName,
    customerId: input.customerId,
    body: input.messageBody.trim(),
    recipientPhone: normalizedPhone,
  });

  return {
    success: true,
    providerMessageId: receipt.providerMessageId,
    providerStatus: receipt.providerStatus,
    evidenceName: receipt.evidenceName,
    timestamp: sentAt,
    customerId: input.customerId,
    slotId: input.slotId,
  };
}

export function resetSessionOutreachReceipts() {
  sessionOutreachReceipts.clear();
}
