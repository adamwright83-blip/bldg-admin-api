/**
 * Authoritative Silver Lake outreach status for Lantern City and the Day Line.
 *
 * Import this module. Do not keep a second ledger. Durable facts stay on
 * `scheduled_outreach_messages`, `scheduled_outreach_revisions`, and
 * `sms_compose_handoff_audits`. This file only projects them.
 *
 * Personal outreach is an operator opening Google Messages. A saved or
 * scheduled row is not a message that will arrive by itself. Opening Messages
 * is not a send. An operator report is not an independent send. A later order
 * is not revenue caused by the message.
 *
 * `draft_edited_unsaved` exists only when the caller passes the editor buffer.
 * The server does not store that buffer.
 */
export const PERSONAL_OUTREACH_SCHEDULE_APPROVAL =
  "I approve this exact message for this recipient and this send time" as const;

export const SILVER_LAKE_MESSAGE_STATES = [
  "draft_prepared",
  "draft_edited_unsaved",
  "saved_draft",
  "explicitly_approved",
  "scheduled",
  "awaiting_sender",
  "due_operator_action",
  "compose_handoff_opened",
  "operator_reported_sent",
  "independently_verified_sent",
  "failed",
  "cancelled",
  "unresolved",
] as const;

export type SilverLakeMessageState = (typeof SILVER_LAKE_MESSAGE_STATES)[number];

export const SILVER_LAKE_MESSAGE_LABELS: Record<SilverLakeMessageState, string> = {
  draft_prepared: "Draft prepared",
  draft_edited_unsaved: "Draft edited, not saved",
  saved_draft: "Saved draft",
  explicitly_approved: "Explicitly approved",
  scheduled: "Scheduled",
  awaiting_sender: "Awaiting sender",
  due_operator_action: "Due — operator must open Messages",
  compose_handoff_opened: "Compose handoff opened",
  operator_reported_sent: "Operator reported sent",
  independently_verified_sent: "Independently verified sent",
  failed: "Failed",
  cancelled: "Cancelled",
  unresolved: "Unresolved",
};

export type SilverLakeHandoffState = "approved" | "compose_opened" | "operator_reported_sent";

export type SilverLakeHandoffEvent = {
  messageId: string;
  revisionCount: number;
  bodyDigest: string;
  handoffState: SilverLakeHandoffState;
};

export type SilverLakeMessageRow = {
  id: string;
  tenantId: string;
  operatorId: string;
  customerId: string;
  currentMessageBody: string;
  status:
    | "pending"
    | "claimed"
    | "dispatched"
    | "cancelled"
    | "failed"
    | "awaiting_sender_setup";
  deliveryIntent: "immediate" | "scheduled";
  scheduledFor: string;
  timezone: string;
  revisionCount?: number;
  dispatchedAt?: string | null;
  externalMessageId?: string | null;
  failureReason?: string | null;
  dispatchAttemptedAt?: string | null;
  cancelledAt?: string | null;
};

export type SilverLakeTrustedSend = {
  messageId: string | null;
  body: string;
  source: "provider_webhook" | "device_observed";
};

export type SilverLakeOrderEvidence = {
  orderId: string;
  paidAt: string;
  cents?: number | null;
  authorityReceiptId?: string | null;
} | null;

export type SilverLakeOutreachSnapshot = {
  message: SilverLakeMessageState;
  label: string;
  explicitlyApproved: boolean;
  approvalCoversCurrentRevision: boolean;
  scheduledFor: string | null;
  timezone: string | null;
  revisionCount: number | null;
  messageId: string | null;
  automaticTransmission: false;
  openingComposeIsSend: false;
  operatorReportIsVerifiedSend: false;
  revenueAttributedToOutreach: false;
  reply: "none" | "customer_reply_observed";
  order: "none" | "new_completed_order";
  revenue: "unavailable" | "verified_paid_revenue";
  detail: string;
};

export type SilverLakeProjectionInput = {
  tenantId: string;
  operatorId: string;
  customerId: string;
  suggestedBody?: string | null;
  unsavedBody?: string | null;
  row?: SilverLakeMessageRow | null;
  handoffEvents?: readonly SilverLakeHandoffEvent[];
  trustedSend?: SilverLakeTrustedSend | null;
  replyObserved?: boolean;
  order?: SilverLakeOrderEvidence;
  now?: Date;
};

/** Same fingerprint the compose audit stores. A body change does not match. */
export function approvedBodyDigest(body: string): string {
  const parts = [0x811c9dc5, 0x811c9dc5 ^ body.length, 0x01000193, 0xa1b2c3d4];
  return parts
    .map((seed, index) => {
      let hash = seed >>> 0;
      const text = `${index}:${body}`;
      for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, "0");
    })
    .join("");
}

function normalizeBody(body: string | null | undefined): string {
  return (body ?? "").trim().replace(/\s+/g, " ");
}

function snapshot(input: {
  message: SilverLakeMessageState;
  explicitlyApproved: boolean;
  approvalCoversCurrentRevision: boolean;
  scheduledFor: string | null;
  timezone: string | null;
  revisionCount: number | null;
  messageId: string | null;
  reply: SilverLakeOutreachSnapshot["reply"];
  order: SilverLakeOutreachSnapshot["order"];
  revenue: SilverLakeOutreachSnapshot["revenue"];
  detail: string;
}): SilverLakeOutreachSnapshot {
  return {
    ...input,
    label: SILVER_LAKE_MESSAGE_LABELS[input.message],
    automaticTransmission: false,
    openingComposeIsSend: false,
    operatorReportIsVerifiedSend: false,
    revenueAttributedToOutreach: false,
  };
}

function commerceOf(order: SilverLakeOrderEvidence | undefined): {
  order: SilverLakeOutreachSnapshot["order"];
  revenue: SilverLakeOutreachSnapshot["revenue"];
} {
  if (!order?.orderId || !order.paidAt) return { order: "none", revenue: "unavailable" };
  const cents = order.cents;
  const receipt = order.authorityReceiptId?.trim() ?? "";
  const revenue =
    receipt && typeof cents === "number" && Number.isFinite(cents) && cents > 0
      ? "verified_paid_revenue"
      : "unavailable";
  return { order: "new_completed_order", revenue };
}

export function projectSilverLakeOutreachStatus(
  input: SilverLakeProjectionInput
): SilverLakeOutreachSnapshot {
  const now = input.now ?? new Date();
  const commerce = commerceOf(input.order);
  const reply: SilverLakeOutreachSnapshot["reply"] = input.replyObserved
    ? "customer_reply_observed"
    : "none";
  const row = input.row && input.row.tenantId === input.tenantId && input.row.operatorId === input.operatorId && input.row.customerId === input.customerId
    ? input.row
    : null;
  const revisionCount = row ? row.revisionCount ?? 1 : null;
  const durableBody = row?.currentMessageBody ?? input.suggestedBody ?? "";
  const unsaved = input.unsavedBody == null ? null : input.unsavedBody;
  const unsavedDiffers =
    unsaved != null && normalizeBody(unsaved) !== normalizeBody(durableBody) && normalizeBody(unsaved).length > 0;
  const digest = approvedBodyDigest(normalizeBody(row?.currentMessageBody ?? ""));
  const events = (input.handoffEvents ?? []).filter(
    event => row && event.messageId === row.id && event.revisionCount === revisionCount && event.bodyDigest === digest
  );
  const approved = events.some(event => event.handoffState === "approved");
  const composeOpened = events.some(event => event.handoffState === "compose_opened");
  const operatorReported = events.some(event => event.handoffState === "operator_reported_sent");
  const trusted =
    row &&
    input.trustedSend &&
    input.trustedSend.messageId === row.id &&
    normalizeBody(input.trustedSend.body) === normalizeBody(row.currentMessageBody) &&
    (input.trustedSend.source === "provider_webhook" || input.trustedSend.source === "device_observed");
  const due = Boolean(row && Date.parse(row.scheduledFor) <= now.getTime());
  const base = {
    explicitlyApproved: approved,
    approvalCoversCurrentRevision: approved,
    scheduledFor: row?.scheduledFor ?? null,
    timezone: row?.timezone ?? null,
    revisionCount,
    messageId: row?.id ?? null,
    reply,
    ...commerce,
  };

  if (unsavedDiffers) {
    return snapshot({
      ...base,
      message: "draft_edited_unsaved",
      explicitlyApproved: false,
      approvalCoversCurrentRevision: false,
      detail: "The editor text is not the saved message. Approval of the saved revision does not cover it. Nothing will be sent.",
    });
  }
  if (!row) {
    return snapshot({
      ...base,
      message: "draft_prepared",
      explicitlyApproved: false,
      approvalCoversCurrentRevision: false,
      detail: "A suggestion is prepared. It is not saved, approved, or sent.",
    });
  }
  if (row.status === "cancelled" || row.cancelledAt) {
    return snapshot({
      ...base,
      explicitlyApproved: false,
      approvalCoversCurrentRevision: false,
      message: "cancelled",
      detail: "This message was cancelled. It will not be sent.",
    });
  }
  if (row.status === "failed") {
    return snapshot({
      ...base,
      message: "failed",
      detail: row.failureReason?.trim()
        ? `Transmission failed: ${row.failureReason.trim()} This is not a send.`
        : "Transmission failed. This is not a send.",
    });
  }
  if (trusted) {
    return snapshot({
      ...base,
      message: "independently_verified_sent",
      detail: `A ${input.trustedSend!.source.split("_").join(" ")} observation matches this exact message. That is not proof the message caused a later order.`,
    });
  }
  if (row.dispatchAttemptedAt && row.status !== "dispatched") {
    return snapshot({
      ...base,
      message: "unresolved",
      detail: "A send was attempted and the result was not observed. It is not successful, and it must not be retried as a new message.",
    });
  }
  if (row.status === "dispatched" && !trusted) {
    return snapshot({
      ...base,
      message: "unresolved",
      detail: "The outbox records a dispatch reference. That reference is not an independent send observation.",
    });
  }
  if (operatorReported) {
    return snapshot({
      ...base,
      message: "operator_reported_sent",
      detail: "The operator reported this exact revision as sent. That report is not an independent verification.",
    });
  }
  if (composeOpened) {
    return snapshot({
      ...base,
      message: "compose_handoff_opened",
      detail: "Google Messages was opened for this exact revision. Opening it did not send the message.",
    });
  }
  if (approved && due) {
    return snapshot({
      ...base,
      message: "due_operator_action",
      detail: "This approved message is due. The operator still has to open Google Messages. It will not arrive on its own.",
    });
  }
  if (approved && row.deliveryIntent === "scheduled" && !due) {
    return snapshot({
      ...base,
      message: "scheduled",
      detail: "Approved and scheduled. At send time the operator opens Google Messages. The row is not an automatic text.",
    });
  }
  if (approved && row.deliveryIntent === "immediate") {
    return snapshot({
      ...base,
      message: "awaiting_sender",
      detail: "Approved for this recipient and this text. A sender still has to open Google Messages. Nothing has been sent.",
    });
  }
  if (approved) {
    return snapshot({
      ...base,
      message: "explicitly_approved",
      detail: "The operator approved this exact revision. It is not sent.",
    });
  }
  if (row.status === "claimed" || row.status === "awaiting_sender_setup" || row.status === "pending") {
    return snapshot({
      ...base,
      explicitlyApproved: false,
      approvalCoversCurrentRevision: false,
      message: "saved_draft",
      detail: "The message is saved. It is not approved for this revision, and it will not send itself.",
    });
  }
  return snapshot({
    ...base,
    explicitlyApproved: false,
    approvalCoversCurrentRevision: false,
    message: "unresolved",
    detail: "The saved message has no status this contract can verify.",
  });
}

export const SILVER_LAKE_STATUS_EXAMPLES: readonly {
  name: string;
  snapshot: SilverLakeOutreachSnapshot;
}[] = [
  {
    name: "draft_prepared",
    snapshot: projectSilverLakeOutreachStatus({
      tenantId: "laundry_farm",
      operatorId: "adam-admin",
      customerId: "phone:3105550141",
      suggestedBody: "Hey Mei! Reply STOP if you don't want these texts.",
      now: new Date("2026-10-20T06:00:00.000Z"),
    }),
  },
  {
    name: "saved_then_due_requires_operator",
    snapshot: projectSilverLakeOutreachStatus({
      tenantId: "laundry_farm",
      operatorId: "adam-admin",
      customerId: "phone:3105550141",
      now: new Date("2026-10-20T17:05:00.000Z"),
      row: {
        id: "som_example",
        tenantId: "laundry_farm",
        operatorId: "adam-admin",
        customerId: "phone:3105550141",
        currentMessageBody: "Hey Mei! Reply STOP if you don't want these texts.",
        status: "awaiting_sender_setup",
        deliveryIntent: "scheduled",
        scheduledFor: "2026-10-20T17:00:00.000Z",
        timezone: "America/Los_Angeles",
        revisionCount: 1,
      },
      handoffEvents: [
        {
          messageId: "som_example",
          revisionCount: 1,
          bodyDigest: approvedBodyDigest("Hey Mei! Reply STOP if you don't want these texts."),
          handoffState: "approved",
        },
      ],
    }),
  },
];
