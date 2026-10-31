import { createHash, randomUUID } from "node:crypto";
import {
  CPE_SHOTGUN_POLICY,
  CPE_SHOTGUN_TERRITORY,
  shotgunSubmission,
  type ShotgunSubmission,
} from "../../../shared/centuryParkShotgun";
import { readPersonalOutreachRoster } from "../../strategy/personalOutreachWrite";
import { normalizeSmsPhone } from "../../_core/sms";
import {
  commitPersonalOutreachDraft,
  approveDurablePersonalOutreach,
} from "../lanternCity/cozyVillagerOutreachService";
import { PERSONAL_OUTREACH_SCHEDULE_APPROVAL } from "../lanternCity/personalNumber/smsComposeHandoff";
import { smsComposeHandoffSnapshot } from "../lanternCity/personalNumber/smsComposeHandoffAudit";
import { shotgunDraft } from "../../../shared/centuryParkShotgunDraft";
import { TENANT_CONFIG, type TenantId } from "../../../shared/tenantConfig";
import { shotgunStore, outboxKey } from "./store";
import { matchesShotApproval } from "./projection";
import type { ShotRow } from "./schema";

export type ShotgunScope = {
  tenantId: string;
  operatorId: string;
  canonicalOperatorId: string;
};
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function submissionFingerprint(input: ShotgunSubmission) {
  // Canonical field order, independent of JSON property order and request identity.
  const {
    customerId,
    openingId,
    hypothesis,
    shell,
    messageBody,
    scheduledFor,
    confirmation,
  } = input;
  return digest({
    customerId,
    openingId,
    hypothesis,
    shell,
    messageBody,
    scheduledFor: new Date(scheduledFor).toISOString(),
    confirmation,
  });
}
const dependencies = {
  store: shotgunStore,
  roster: readPersonalOutreachRoster,
  schedule: commitPersonalOutreachDraft,
  approve: approveDurablePersonalOutreach,
  approvalSnapshot: smsComposeHandoffSnapshot,
};
export type ShotgunDependencies = typeof dependencies;

function assertScope(scope: ShotgunScope) {
  for (const value of Object.values(scope))
    if (!value?.trim())
      throw new Error("An established tenant and operator are required.");
}
export function assertSameApproval(
  row: ShotRow,
  scope: ShotgunScope,
  fingerprint: string
) {
  if (row.operatorId !== scope.operatorId)
    throw new Error(
      "This customer opportunity already has an approval by another operator. Read its timeline instead."
    );
  if (row.fingerprint !== fingerprint)
    throw new Error(
      "This customer opportunity already has a different approved action. A retry cannot change the approval."
    );
}

async function eligibleContact(
  scope: ShotgunScope,
  customerId: string,
  deps: ShotgunDependencies,
  now: Date
) {
  const roster = await deps.roster({
    ...scope,
    territoryId: CPE_SHOTGUN_TERRITORY,
    timeZone: "America/Los_Angeles",
    now,
    limit: 200,
  });
  const contact = roster?.contacts.find(c => c.identityId === customerId);
  if (
    !roster ||
    roster.freshness !== "current" ||
    roster.withheldReason ||
    !contact?.phone ||
    !contact.lastOrderDate ||
    !Number.isFinite(Date.parse(contact.lastOrderDate)) ||
    contact.blocks.length
  ) {
    throw new Error(
      "Choose a verified, eligible Century Park East customer from the selected business. No action was scheduled."
    );
  }
  return {
    ...contact,
    phone: contact.phone,
    lastOrderDate: contact.lastOrderDate,
  };
}

export async function previewCenturyParkShotgun(
  scope: ShotgunScope,
  input: Pick<ShotgunSubmission, "customerId" | "openingId" | "hypothesis">,
  deps = dependencies,
  now = new Date()
) {
  assertScope(scope);
  const contact = await eligibleContact(scope, input.customerId, deps, now);
  return {
    customerId: contact.identityId,
    messageBody: shotgunDraft(
      contact,
      input,
      TENANT_CONFIG[scope.tenantId as TenantId]?.brandName ??
        "your laundry service"
    ),
    availableShells: ["none"] as const,
    blockedShells: ["free_pickup", "credit_10"] as const,
    reason:
      "Offers require a verified fulfillment integration. The send time is not a pickup reservation.",
  };
}

/** Durable reservation precedes the existing outbox boundary. A crash between the two is recoverable by the same outbox key. */
export async function fireCenturyParkShotgun(
  scope: ShotgunScope,
  raw: ShotgunSubmission,
  deps = dependencies,
  now = new Date()
) {
  assertScope(scope);
  const input = shotgunSubmission.parse(raw);
  const fingerprint = submissionFingerprint(input);
  let row = await deps.store.byRequest(scope.tenantId, input.requestId);
  if (!row) {
    if (new Date(input.scheduledFor).getTime() <= now.getTime())
      throw new Error("Choose a future send time.");
    const contact = await eligibleContact(scope, input.customerId, deps, now);
    // Free-form wording could claim a credit or appointment despite selecting “no offer”.
    // Until the offer owner supplies a fulfillment port, only the exact safe server draft may be approved.
    if (
      input.shell === "none" &&
      input.messageBody !==
        shotgunDraft(
          contact,
          input,
          TENANT_CONFIG[scope.tenantId as TenantId]?.brandName ??
            "your laundry service"
        )
    ) {
      throw new Error(
        "Approve the current server-prepared text. Edited promises require a verified business fulfillment integration."
      );
    }
    const phone = normalizeSmsPhone(contact.phone);
    if (!phone) throw new Error("The verified customer phone is unavailable.");
    row = await deps.store.reserve({
      id: `cps_${randomUUID()}`,
      tenantId: scope.tenantId,
      operatorId: scope.operatorId,
      requestId: input.requestId,
      customerId: contact.identityId,
      customerName: contact.name,
      recipientPhone: phone,
      lastOrderDate: contact.lastOrderDate,
      // One action per server-observed lapse, across request ids, operators, refreshes and devices.
      opportunityKey: digest([
        contact.identityId,
        new Date(contact.lastOrderDate).toISOString(),
      ]),
      fingerprint,
      approval: input,
      policyVersion: CPE_SHOTGUN_POLICY,
      approvedAt: now,
      scheduledFor: new Date(input.scheduledFor),
      state: input.shell === "none" ? "reserved" : "blocked_offer",
      offerState:
        input.shell === "none" ? "not_applicable" : "blocked_integration",
      messageId: null,
      failureReason: null,
      updatedAt: now,
    });
  }
  assertSameApproval(row, scope, fingerprint);
  if (row.offerState === "blocked_integration") {
    return {
      shot: row,
      execution: "blocked_offer" as const,
      offerFulfilled: false as const,
      reason:
        "This offer has no verified business fulfillment integration. No outreach was scheduled.",
    };
  }
  try {
    // Find an outbox row even if the previous process died before linking it to the shot.
    let message = await deps.store.outbox(row);
    if (!message) {
      message = await deps.schedule({
        ...scope,
        customerId: row.customerId,
        expectedPhone: row.recipientPhone,
        messageBody: row.approval.messageBody,
        scheduledFor: row.scheduledFor,
        timezone: "America/Los_Angeles",
        territoryId: CPE_SHOTGUN_TERRITORY,
        idempotencyKey: outboxKey(row),
        deliveryIntent: "scheduled",
        now,
      });
    }
    // The outbox may have been edited/cancelled on another surface. Never silently re-approve it.
    const approvalMatches = matchesShotApproval(row, message);
    if (
      approvalMatches &&
      (message.status === "pending" ||
        message.status === "awaiting_sender_setup")
    ) {
      const [approval] = await deps.approvalSnapshot({
        ...scope,
        items: [
          {
            messageId: message.id,
            revisionCount: 1,
            approvedBody: row.approval.messageBody,
          },
        ],
      });
      // Also recover a crash after the approval audit committed but before our final linkage saved.
      if (!approval || approval.state === "draft") {
        await deps.approve({
          ...scope,
          messageId: message.id,
          expectedRevisionCount: 1,
          territoryId: CPE_SHOTGUN_TERRITORY,
          confirmation: PERSONAL_OUTREACH_SCHEDULE_APPROVAL,
          now,
        });
      }
    }
    await deps.store.update(row, {
      state: "saved",
      messageId: message.id,
      failureReason: null,
    });
    return {
      shot: {
        ...row,
        state: "saved" as const,
        messageId: message.id,
        failureReason: null,
      },
      execution: message.status,
      approvalMatches,
      offerFulfilled: false as const,
    };
  } catch (error) {
    // A failed acknowledgment is never proof that the outbox write failed. Retry reads it before scheduling.
    await deps.store.recordFailure(row);
    throw error;
  }
}
