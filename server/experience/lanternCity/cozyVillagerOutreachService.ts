import { randomUUID } from "node:crypto";
import {
  COZY_SLOT_IDS,
  COZY_SLOT_ANCHORS,
  type CozyConsentStatus,
  type CozyConsentBasis,
  type CozyCustomerTarget,
  type CozyEncounterMission,
  type CozySlotId,
  type VillagerVariant,
} from "../../../shared/cozyVillagerOutreach";
import { readWinBackDossier, type WinBackContact } from "../../strategy/winBackDossier";
import { checkCommunicationPermission } from "../../strategy/communicationPermissionService";
import { normalizeSmsPhone } from "../../_core/sms";
import {
  createScheduledOutreachDraft,
  sendEarlyOutreachDraft,
  listScheduledOutreachMessages,
  type OutboundTestSenderAdapter,
} from "./scheduledOutreachService";

// Known opt-outs for safety enforcement
const knownOptOutNumbers = new Set<string>([
  "+15550009999", // canonical opt-out test number
]);

function buildClaireSuggestedMessage(name: string, daysSinceLastOrder: number): string {
  const firstName = name.split(" ")[0];
  return `Hey ${firstName}! It's Adam from Laundry Farm. Just checking in to see how you've been—we noticed it's been about ${daysSinceLastOrder} days since your last pickup. We'd love to help take laundry off your plate whenever you need us!`;
}

/**
 * Server-authoritative recipient and territory resolver.
 * Ensures the target customer exists in the tenant's dormant customer pool,
 * resolves their verified canonical phone number, validates territory binding,
 * and enforces G14 communication permissions.
 */
export async function resolveCanonicalCustomerContact(input: {
  tenantId: string;
  canonicalOperatorId: string;
  customerId: string;
  territoryId?: string;
  expectedPhone?: string;
  now?: Date;
  timeZone?: string;
}): Promise<{
  customerId: string;
  customerName: string;
  phone: string;
  territoryId: string;
  territoryName: string;
  daysSinceLastOrder: number;
  hasConsent: boolean;
  consentStatus: CozyConsentStatus;
  consentBasis: CozyConsentBasis;
  consentReason?: string;
  suggestedMessage: string;
}> {
  const timeZone = input.timeZone ?? "America/Los_Angeles";
  const now = input.now ?? new Date();

  const realDossier = await readWinBackDossier({
    tenantId: input.tenantId,
    canonicalOperatorId: input.canonicalOperatorId,
    timeZone,
    now,
    limit: 50,
  });

  if (!realDossier || !realDossier.contacts || realDossier.contacts.length === 0) {
    throw new Error(`Dormant customer win-back records unavailable for tenant "${input.tenantId}"`);
  }

  // Strict territory matching
  const requestedTerritory = input.territoryId ?? "silver-lake";
  const normDossier = realDossier.area.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normRequested = requestedTerritory.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (normDossier && normRequested && !normDossier.includes(normRequested) && !normRequested.includes(normDossier)) {
    throw new Error(
      `Territory mismatch: customer win-back pool is for "${realDossier.area}", not requested territory "${requestedTerritory}"`
    );
  }

  const contact = realDossier.contacts.find((c) => c.identityId === input.customerId);
  if (!contact) {
    throw new Error(`Customer "${input.customerId}" not found in tenant win-back pool`);
  }

  if (!contact.phone) {
    throw new Error(`Customer "${input.customerId}" has no verified phone number on record`);
  }

  const canonicalPhone = normalizeSmsPhone(contact.phone);

  if (input.expectedPhone) {
    const expectedNormalized = normalizeSmsPhone(input.expectedPhone);
    if (canonicalPhone !== expectedNormalized) {
      throw new Error(
        `Security violation: requested phone "${input.expectedPhone}" does not match verified canonical phone for customer "${input.customerId}"`
      );
    }
  }

  // G14 Permission Check
  const permCheck = await checkCommunicationPermission({
    tenantId: input.tenantId,
    subjectType: "customer",
    subjectId: contact.identityId,
    channel: "sms",
    now,
  });

  const isOptedOut = !permCheck.allowed || knownOptOutNumbers.has(canonicalPhone);

  let consentStatus: CozyConsentStatus;
  let consentBasis: CozyConsentBasis;
  if (!canonicalPhone) {
    consentStatus = "missing_phone";
    consentBasis = "missing_contact_info";
  } else if (isOptedOut || permCheck.permissionStatus === "opted_out" || permCheck.permissionStatus === "refused") {
    consentStatus = "blocked_opt_out";
    consentBasis = "opted_out_blocked";
  } else if (permCheck.permissionStatus === "opted_in") {
    consentStatus = "verified_opt_in";
    consentBasis = "explicit_consent_record";
  } else {
    consentStatus = "existing_customer_relationship";
    consentBasis = "transactional_dormant_recovery";
  }

  if (isOptedOut || !permCheck.allowed) {
    throw new Error(
      `Recipient has opted out or lacks communication permission: ${permCheck.reason ?? "Opted out under G14"}`
    );
  }

  const days = contact.daysSinceLastOrder ?? 30;

  return {
    customerId: contact.identityId,
    customerName: contact.name,
    phone: canonicalPhone,
    territoryId: requestedTerritory,
    territoryName: realDossier.area,
    daysSinceLastOrder: days,
    hasConsent: true,
    consentStatus,
    consentBasis,
    suggestedMessage: buildClaireSuggestedMessage(contact.name, days),
  };
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
  }).catch((err) => {
    console.error("[cozyVillagerOutreach] Failed to read win-back dossier:", err);
    return null;
  });

  // Verify territory match: if requested territory does not match the dossier area, do not show wrong customers
  let rawContacts: WinBackContact[] | null = null;
  if (realDossier && realDossier.contacts && realDossier.contacts.length > 0) {
    const normDossier = realDossier.area.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normRequested = territoryId.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!normDossier || !normRequested || normDossier.includes(normRequested) || normRequested.includes(normDossier)) {
      rawContacts = realDossier.contacts;
    }
  }

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

      let consentStatus: CozyConsentStatus;
      let consentBasis: CozyConsentBasis;
      if (!phone) {
        consentStatus = "missing_phone";
        consentBasis = "missing_contact_info";
      } else if (isOptedOut || permCheck.permissionStatus === "opted_out" || permCheck.permissionStatus === "refused") {
        consentStatus = "blocked_opt_out";
        consentBasis = "opted_out_blocked";
      } else if (permCheck.permissionStatus === "opted_in") {
        consentStatus = "verified_opt_in";
        consentBasis = "explicit_consent_record";
      } else {
        consentStatus = "existing_customer_relationship";
        consentBasis = "transactional_dormant_recovery";
      }

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
        consentStatus,
        consentBasis,
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

/**
 * Dispatches or queues outreach from Lantern City directly into JOYSTICK's personal outbox.
 * Resolves customer identity and contact information server-authoritatively.
 */
export async function sendCozyOutreachNow(input: {
  tenantId: string;
  operatorId: string;
  customerId: string;
  messageBody: string;
  slotId?: CozySlotId;
  territoryId?: string;
  expectedPhone?: string;
  now?: Date;
  testSenderAdapter?: OutboundTestSenderAdapter;
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

  const now = input.now ?? new Date();

  // 1. Server-authoritative customer identity, phone, and territory resolution
  const resolved = await resolveCanonicalCustomerContact({
    tenantId: input.tenantId,
    canonicalOperatorId: input.operatorId,
    customerId: input.customerId,
    territoryId: input.territoryId,
    expectedPhone: input.expectedPhone,
    now,
  });

  // 2. Commit draft to the scheduled outbox
  const draft = await createScheduledOutreachDraft({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    customerId: resolved.customerId,
    customerName: resolved.customerName,
    recipientPhone: resolved.phone,
    originalSuggestedDraft: resolved.suggestedMessage,
    messageBody: input.messageBody.trim(),
    scheduledFor: now,
    timezone: "America/Los_Angeles",
    slotId: input.slotId,
    territoryId: resolved.territoryId,
    allowImmediate: true,
    now,
  });

  // 3. Dispatch through verified personal Android connection (or return awaiting_sender_setup in Phase 1)
  const sendResult = await sendEarlyOutreachDraft({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    messageId: draft.id,
    leaseHolder: `operator_${input.operatorId}`,
    testSenderAdapter: input.testSenderAdapter,
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
