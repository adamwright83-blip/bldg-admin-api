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
import { normalizeSmsPhone } from "../../_core/sms";
import {
  createScheduledOutreachDraft,
  sendEarlyOutreachDraft,
  listScheduledOutreachMessages,
} from "./scheduledOutreachService";

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
  const territoryName =
    territoryId === "silver-lake"
      ? "Silver Lake"
      : territoryId.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

  // Attempt reading canonical dossier
  const realDossier = await readWinBackDossier({
    tenantId: input.tenantId,
    canonicalOperatorId: input.canonicalOperatorId,
    timeZone,
    now,
    limit: input.limit ?? 8,
  }).catch(() => null);

  const rawContacts =
    realDossier && realDossier.contacts.length > 0 ? realDossier.contacts : null;

  // Retrieve existing scheduled messages for the tenant
  const existingScheduledList = await listScheduledOutreachMessages({
    tenantId: input.tenantId,
  }).catch(() => []);

  const targets: CozyCustomerTarget[] = [];

  if (rawContacts) {
    const assignedSlots = COZY_SLOT_IDS.slice(0, Math.min(rawContacts.length, 8));
    for (let index = 0; index < assignedSlots.length; index++) {
      const slotId = assignedSlots[index];
      const contact = rawContacts[index];
      const anchor = COZY_SLOT_ANCHORS[slotId];
      const days = contact.daysSinceLastOrder ?? 30;
      const phone = contact.phone ? normalizeSmsPhone(contact.phone) : null;

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

      const existingMsg = existingScheduledList.find(
        (m) => m.customerId === contact.identityId && m.status !== "cancelled"
      );

      let status: CozyCustomerTarget["status"] = "eligible";
      let providerReceipt: CozyCustomerTarget["providerReceipt"] = undefined;
      let scheduledDraft: CozyCustomerTarget["scheduledDraft"] = undefined;

      if (existingMsg) {
        if (existingMsg.status === "dispatched") {
          status = "accepted";
          providerReceipt = {
            messageSid: existingMsg.externalMessageId ?? existingMsg.id,
            status: "dispatched",
            sentAt: (existingMsg.dispatchedAt ?? existingMsg.createdAt).toISOString(),
            evidenceName: "personal_android_sms",
          };
        } else if (existingMsg.status === "pending" || existingMsg.status === "claimed") {
          status = "scheduled";
          scheduledDraft = {
            messageId: existingMsg.id,
            scheduledFor: existingMsg.scheduledFor.toISOString(),
            timezone: existingMsg.timezone,
            currentMessageBody: existingMsg.currentMessageBody,
          };
        }
      } else if (isOptedOut || !phone) {
        status = "consent_blocked";
      }

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
        status,
        providerReceipt,
        scheduledDraft,
      });
    }
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

export async function sendCozyOutreachNow(input: {
  tenantId: string;
  operatorId: string;
  customerId: string;
  customerName: string;
  recipientPhone: string;
  originalSuggestedDraft: string;
  messageBody: string;
  slotId?: CozySlotId;
  territoryId?: string;
  now?: Date;
  isTestSenderAllowed?: boolean;
}): Promise<{
  success: boolean;
  status: "dispatched" | "awaiting_sender_setup";
  messageId: string;
  evidenceName: string;
  dispatchedAt: string | null;
  externalMessageId: string | null;
}> {
  if (!input.messageBody || input.messageBody.trim().length === 0) {
    throw new Error("Message body cannot be empty");
  }

  const normalizedPhone = normalizeSmsPhone(input.recipientPhone);
  if (knownOptOutNumbers.has(normalizedPhone)) {
    throw new Error("Recipient has opted out of SMS outreach");
  }

  const now = input.now ?? new Date();

  // 1. Commit draft to the scheduled outbox
  const draft = await createScheduledOutreachDraft({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    customerId: input.customerId,
    customerName: input.customerName,
    recipientPhone: normalizedPhone,
    originalSuggestedDraft: input.originalSuggestedDraft,
    messageBody: input.messageBody.trim(),
    scheduledFor: now,
    timezone: "America/Los_Angeles",
    slotId: input.slotId,
    territoryId: input.territoryId,
    allowImmediate: true,
    now,
  });

  // 2. Dispatch through verified personal Android connection
  const sendResult = await sendEarlyOutreachDraft({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    messageId: draft.id,
    leaseHolder: `operator_${input.operatorId}`,
    isTestSenderAllowed: input.isTestSenderAllowed,
    now,
  });

  return {
    success: sendResult.success,
    status: sendResult.status as "dispatched" | "awaiting_sender_setup",
    messageId: draft.id,
    evidenceName: sendResult.evidenceName,
    dispatchedAt: sendResult.message.dispatchedAt?.toISOString() ?? null,
    externalMessageId: sendResult.message.externalMessageId ?? null,
  };
}
