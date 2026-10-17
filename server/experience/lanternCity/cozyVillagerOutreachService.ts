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
import { readWinBackDossier } from "../../strategy/winBackDossier";
import { checkCommunicationPermission } from "../../strategy/communicationPermissionService";
import {
  assertPersonalOutreachHandoff,
  buildPersonalSuggestedMessage,
  readPersonalOutreachRoster,
  type PersonalOutreachContact,
} from "../../strategy/personalOutreachWrite";
import { normalizeSmsPhone } from "../../_core/sms";
import {
  createScheduledOutreachDraft,
  editScheduledOutreachDraft,
  listScheduledOutreachMessages,
  type OutboundTestSenderAdapter,
} from "./scheduledOutreachService";
import { evaluateGoogleMessagesBrowserTransport } from "./personalNumber/googleMessagesBrowserTransport";

// Known opt-outs for safety enforcement
const knownOptOutNumbers = new Set<string>([
  "+15550009999", // canonical opt-out test number
]);

function buildClaireSuggestedMessage(name: string, daysSinceLastOrder: number): string {
  return buildPersonalSuggestedMessage(name, daysSinceLastOrder);
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
  requestedCustomerId?: string;
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

  const targetLimit = Math.min(Math.max(input.limit ?? 8, 1), 8);
  const roster = await readPersonalOutreachRoster({
    tenantId: input.tenantId,
    canonicalOperatorId: input.canonicalOperatorId,
    timeZone,
    now,
    territoryId,
    limit: input.requestedCustomerId ? Math.max(targetLimit, 50) : targetLimit,
  }).catch((err) => {
    console.error("[cozyVillagerOutreach] Failed to read personal outreach roster:", err);
    return null;
  });

  const withheldReason =
    roster?.withheldReason ??
    (roster
      ? null
      : "Dormant customers could not be read. Missing customers are not proof that nobody is inactive.");

  let rawContacts: PersonalOutreachContact[] | null = null;
  if (roster && !withheldReason && roster.contacts.length > 0) {
    if (input.requestedCustomerId) {
      const requested = roster.contacts.find(
        c => c.identityId === input.requestedCustomerId
      );
      const rest = roster.contacts.filter(
        c => c.identityId !== input.requestedCustomerId
      );
      rawContacts = requested
        ? [requested, ...rest].slice(0, targetLimit)
        : roster.contacts.slice(0, targetLimit);
    } else {
      rawContacts = roster.contacts.slice(0, targetLimit);
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

      const recordedOptOut =
        contact.smsConsent === "opted_out" ||
        !permCheck.allowed ||
        permCheck.permissionStatus === "opted_out" ||
        permCheck.permissionStatus === "refused" ||
        (phone ? knownOptOutNumbers.has(phone) : false);
      const hasPaidRelationship = contact.paidOrders > 0 && contact.lifetimeCents > 0;

      let consentStatus: CozyConsentStatus;
      let consentBasis: CozyConsentBasis;
      if (!phone) {
        consentStatus = "missing_phone";
        consentBasis = "missing_contact_info";
      } else if (recordedOptOut) {
        consentStatus = "blocked_opt_out";
        consentBasis = "opted_out_blocked";
      } else if (contact.smsConsent === "opted_in" || permCheck.permissionStatus === "opted_in") {
        consentStatus = "verified_opt_in";
        consentBasis = "explicit_consent_record";
      } else {
        consentStatus = "existing_customer_relationship";
        consentBasis = "transactional_dormant_recovery";
      }

      const consentReason = recordedOptOut
        ? permCheck.reason ?? "A recorded opt-out blocks this handoff."
        : !phone
        ? "Missing verified phone number"
        : !hasPaidRelationship
        ? "A phone number alone is not an existing relationship."
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
        } else if (existingMsg.status === "awaiting_sender_setup") {
          status = existingMsg.deliveryIntent === "scheduled" ? "scheduled" : "awaiting_sender_setup";
          scheduledDraft = {
            messageId: existingMsg.id,
            scheduledFor: existingMsg.scheduledFor.toISOString(),
            timezone: existingMsg.timezone,
            currentMessageBody: existingMsg.currentMessageBody,
          };
        }
      } else if (recordedOptOut || !phone || !hasPaidRelationship) {
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
        hasConsent: hasPaidRelationship && !recordedOptOut && !!phone,
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
    totalLapsedInTerritory: roster?.emptyMeansNoLapsedCustomers ? 0 : (roster?.lapsedCount ?? targets.length),
    activeTargetCount: targets.length,
    targets,
    withheldReason,
    emptyMeansNoLapsedCustomers: roster?.emptyMeansNoLapsedCustomers ?? false,
  };
}

/**
 * Writes one personal outreach draft after the personal-handoff rule.
 * The row is awaiting_sender_setup, so the due-lease worker does not transmit it.
 * Marketing SMS opt-in is not this gate. A test sender adapter is ignored:
 * this channel does not dispatch.
 */
export async function commitPersonalOutreachDraft(input: {
  tenantId: string;
  operatorId: string;
  customerId: string;
  messageBody: string;
  scheduledFor: Date | string;
  timezone?: string;
  expectedPhone?: string;
  slotId?: string;
  territoryId?: string;
  idempotencyKey?: string;
  allowImmediate?: boolean;
  deliveryIntent?: "immediate" | "scheduled";
  dstAmbiguityChoice?: "first" | "second";
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const timezone = input.timezone ?? "America/Los_Angeles";
  const messageBody = input.messageBody.trim();
  if (!messageBody) throw new Error("Message body cannot be empty");
  const permCheck = await checkCommunicationPermission({
    tenantId: input.tenantId,
    subjectType: "customer",
    subjectId: input.customerId,
    channel: "sms",
    now,
  });
  if (
    !permCheck.allowed ||
    permCheck.permissionStatus === "opted_out" ||
    permCheck.permissionStatus === "refused"
  ) {
    throw new Error(
      `Recipient has opted out or lacks communication permission: ${permCheck.reason ?? "Opted out under G14"}`
    );
  }
  const allowed = await assertPersonalOutreachHandoff({
    tenantId: input.tenantId,
    canonicalOperatorId: input.operatorId,
    customerId: input.customerId,
    messageBody,
    territoryId: input.territoryId,
    now,
    timeZone: timezone,
  });
  if (input.expectedPhone) {
    const expected = normalizeSmsPhone(input.expectedPhone);
    const actual = normalizeSmsPhone(allowed.phone);
    if (!expected || expected !== actual) {
      throw new Error(
        `Security violation: requested phone "${input.expectedPhone}" does not match verified canonical phone for customer "${allowed.customerId}"`
      );
    }
  }
  const deliveryIntent = input.deliveryIntent ?? "scheduled";
  const draft = await createScheduledOutreachDraft({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    customerId: allowed.customerId,
    customerName: allowed.customerName,
    recipientPhone: normalizeSmsPhone(allowed.phone) ?? allowed.phone,
    originalSuggestedDraft: allowed.suggestedMessage,
    messageBody,
    scheduledFor: input.scheduledFor,
    timezone,
    dstAmbiguityChoice: input.dstAmbiguityChoice,
    slotId: input.slotId,
    territoryId: allowed.territoryId,
    allowImmediate: input.allowImmediate,
    status: "awaiting_sender_setup",
    deliveryIntent,
    idempotencyKey: input.idempotencyKey,
    now,
  });
  if (
    draft.currentMessageBody.trim() !== messageBody &&
    (draft.status === "pending" || draft.status === "awaiting_sender_setup")
  ) {
    return editScheduledOutreachDraft({
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      messageId: draft.id,
      newMessageBody: messageBody,
      expectedRevisionCount: draft.revisionCount,
      reason: "The approved text changed. The earlier handoff does not cover this message.",
      now,
    });
  }
  return draft;
}

/**
 * Saves the operator's manual draft. It does not transmit, even when a test
 * adapter is passed. Opening Google Messages is a separate handoff.
 */
export async function sendCozyOutreachNow(input: {
  tenantId: string;
  operatorId: string;
  customerId: string;
  messageBody: string;
  slotId?: CozySlotId;
  territoryId?: string;
  expectedPhone?: string;
  idempotencyKey?: string;
  now?: Date;
  testSenderAdapter?: OutboundTestSenderAdapter;
}): Promise<{
  success: boolean;
  status: "dispatched" | "awaiting_sender_setup";
  messageId: string;
  evidenceName: string;
  dispatchedAt: string | null;
  externalMessageId: string | null;
  blockReason?: string;
  carrierDeliveryObserved: false;
}> {
  if (!input.messageBody || input.messageBody.trim().length === 0) {
    throw new Error("Message body cannot be empty");
  }
  const now = input.now ?? new Date();
  const draft = await commitPersonalOutreachDraft({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    customerId: input.customerId,
    messageBody: input.messageBody,
    expectedPhone: input.expectedPhone,
    slotId: input.slotId,
    territoryId: input.territoryId,
    scheduledFor: now,
    allowImmediate: true,
    deliveryIntent: "immediate",
    idempotencyKey: input.idempotencyKey,
    now,
  });
  const browser = evaluateGoogleMessagesBrowserTransport();
  return {
    success: false,
    status: "awaiting_sender_setup",
    messageId: draft.id,
    evidenceName: "awaiting_sender_setup",
    dispatchedAt: null,
    externalMessageId: null,
    blockReason: input.testSenderAdapter
      ? "This personal handoff does not dispatch through a sender adapter. The operator sends from their own phone."
      : browser.reason,
    carrierDeliveryObserved: false,
  };
}
