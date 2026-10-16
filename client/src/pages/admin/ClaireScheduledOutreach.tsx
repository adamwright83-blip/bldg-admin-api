import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { transportLabelFromExternalId } from "@shared/cozyVillagerEvidence";
import {
  SMS_COMPOSE_APPROVAL_CONFIRMATION,
  SMS_COMPOSE_HANDOFF_STATE_LABELS,
  SMS_COMPOSE_HANDOFF_STATES,
  SMS_COMPOSE_REPORTED_SENT_CONFIRMATION,
  clientKindFromUserAgent,
  type SmsComposeUriResult,
} from "../../../../server/experience/lanternCity/personalNumber/smsComposeHandoff";
import { ArrowLeft, Clock, Edit2, Play, Trash2, Calendar, RefreshCw } from "lucide-react";

function formatToWallClockIso(date: Date | string, timezone: string = "America/Los_Angeles"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }
  const hour = map.hour === "24" ? "00" : map.hour;
  return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}`;
}

export default function ClaireScheduledOutreach() {
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [reschedulingMessageId, setReschedulingMessageId] = useState<string | null>(null);
  const [newScheduleIso, setNewScheduleIso] = useState("");
  const [cancellingMessageId, setCancellingMessageId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [activeHistoryMessageId, setActiveHistoryMessageId] = useState<string | null>(null);

  const senderStatusQuery = trpc.system.goldlineWorld.personalSenderStatus.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const senderStatus = senderStatusQuery.data;

  const outboxQuery = trpc.system.goldlineWorld.listScheduledOutreach.useQuery(
    { status: statusFilter, limit: 100 },
    { refetchInterval: 15000 }
  );

  const editMutation = trpc.system.goldlineWorld.editScheduledOutreach.useMutation({
    onSuccess: () => {
      setEditingMessageId(null);
      void utils.system.goldlineWorld.listScheduledOutreach.invalidate();
    },
  });

  const rescheduleMutation = trpc.system.goldlineWorld.rescheduleOutreach.useMutation({
    onSuccess: () => {
      setReschedulingMessageId(null);
      void utils.system.goldlineWorld.listScheduledOutreach.invalidate();
    },
  });

  const cancelMutation = trpc.system.goldlineWorld.cancelScheduledOutreach.useMutation({
    onSuccess: () => {
      setCancellingMessageId(null);
      void utils.system.goldlineWorld.listScheduledOutreach.invalidate();
    },
  });

  const sendEarlyMutation = trpc.system.goldlineWorld.sendEarlyOutreach.useMutation({
    onSuccess: (res) => {
      if (res.status !== "dispatched") {
        alert(res.blockReason || "Personal Android sender is not authorized. The draft was not sent.");
      } else if (
        res.evidenceName.includes("simulated") ||
        (res.message.externalMessageId ?? "").startsWith("simulated:")
      ) {
        alert("Simulated transport only. No personal-number message was sent.");
      } else {
        alert("A personal-number send was observed locally. This is not a carrier delivery receipt.");
      }
      void utils.system.goldlineWorld.listScheduledOutreach.invalidate();
    },
    onError: (err) => {
      alert(`Send early failed: ${err.message}`);
    },
  });

  const historyQuery = trpc.system.goldlineWorld.getScheduledOutreachRevisions.useQuery(
    { messageId: activeHistoryMessageId! },
    { enabled: Boolean(activeHistoryMessageId) }
  );

  const messages = outboxQuery.data ?? [];
  const handoffItems = useMemo(
    () =>
      (outboxQuery.data ?? []).map((msg) => ({
        messageId: msg.id,
        revisionCount: msg.revisionCount,
        approvedBody: msg.currentMessageBody,
      })),
    [outboxQuery.data]
  );
  const handoffQuery = trpc.system.goldlineWorld.smsComposeHandoffSnapshot.useQuery(
    { items: handoffItems },
    { enabled: handoffItems.length > 0 }
  );
  const [composeNotice, setComposeNotice] = useState<
    Record<string, SmsComposeUriResult & { state: string; verifiedSent: false; pose: "idle" | "wave" }>
  >({});
  const openSmsMutation = trpc.system.goldlineWorld.openSmsComposeHandoff.useMutation();
  const reportSmsMutation = trpc.system.goldlineWorld.reportSmsComposeOperatorSent.useMutation();

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px 16px", fontFamily: "inherit" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <div>
          <a
            href="/claire"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
              color: "#6b7280",
              textDecoration: "none",
              marginBottom: "8px",
            }}
          >
            <ArrowLeft size={16} /> Back to Claire Desk
          </a>
          <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#111827", margin: 0 }}>
            Claire · Scheduled Outreach Outbox
          </h1>
          <p style={{ fontSize: "14px", color: "#4b5563", margin: "4px 0 0 0" }}>
            Durable Android personal-number customer communications queue. View, edit, reschedule, or send early without opening Lantern City.
          </p>
        </div>
        <button
          onClick={() => void utils.system.goldlineWorld.listScheduledOutreach.invalidate()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "8px 14px",
            background: "#f3f4f6",
            border: "1px solid #d1d5db",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: "500",
          }}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <SenderStatusCard status={senderStatus} loading={senderStatusQuery.isLoading} />

      {/* Filter Tabs */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", borderBottom: "1px solid #e5e7eb", paddingBottom: "10px" }}>
        {([
          { label: "All Messages", value: undefined },
          { label: "Pending", value: "pending" },
          { label: "Claimed", value: "claimed" },
          { label: "Awaiting Sender", value: "awaiting_sender_setup" },
          { label: "Dispatched", value: "dispatched" },
          { label: "Cancelled", value: "cancelled" },
        ] as const).map((tab) => (
          <button
            key={tab.label}
            onClick={() => setStatusFilter(tab.value)}
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: statusFilter === tab.value ? "600" : "400",
              background: statusFilter === tab.value ? "#e0e7ff" : "transparent",
              color: statusFilter === tab.value ? "#3730a3" : "#4b5563",
              border: "none",
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Outbox List */}
      {outboxQuery.isLoading ? (
        <div style={{ padding: "40px", textAlign: "center", color: "#6b7280" }}>Loading scheduled outreach outbox...</div>
      ) : messages.length === 0 ? (
        <div style={{ padding: "40px", textAlign: "center", background: "#f9fafb", borderRadius: "12px", border: "1px dashed #d1d5db" }}>
          <Clock size={32} style={{ color: "#9ca3af", margin: "0 auto 12px auto" }} />
          <h3 style={{ fontSize: "16px", fontWeight: "600", color: "#374151", margin: "0 0 6px 0" }}>No scheduled messages found</h3>
          <p style={{ fontSize: "13px", color: "#6b7280", margin: 0 }}>
            {statusFilter ? `No outreach messages currently match filter "${statusFilter}".` : "Commit customer outreach drafts from Lantern City or Claire Desk."}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {messages.map((msg) => {
            const isEditing = editingMessageId === msg.id;
            const isRescheduling = reschedulingMessageId === msg.id;
            const isCancelling = cancellingMessageId === msg.id;
            const scheduledTime = new Date(msg.scheduledFor);

            return (
              <div
                key={msg.id}
                data-customer-id={msg.customerId}
                data-message-id={msg.id}
                data-outreach-status={msg.status}
                data-transport={transportLabelFromExternalId(msg.externalMessageId) ?? ""}
                style={{
                  background: "#ffffff",
                  border: "1px solid #e5e7eb",
                  borderRadius: "10px",
                  padding: "16px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                }}
              >
                {/* Message Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                  <div>
                    <span style={{ fontSize: "16px", fontWeight: "700", color: "#111827", marginRight: "8px" }}>
                      {msg.customerName}
                    </span>
                    <span style={{ fontSize: "13px", color: "#4b5563" }}>
                      ({msg.recipientPhone})
                    </span>
                    {msg.territoryId && (
                      <span style={{ marginLeft: "8px", fontSize: "12px", background: "#f3f4f6", padding: "2px 6px", borderRadius: "4px" }}>
                        {msg.territoryId}
                      </span>
                    )}
                  </div>

                  {/* Status Badge */}
                  <div>
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: "9999px",
                        fontSize: "12px",
                        fontWeight: "600",
                        background:
                          msg.status === "pending"
                            ? "#fef3c7"
                            : msg.status === "dispatched"
                            ? "#d1fae5"
                            : msg.status === "claimed"
                            ? "#e0e7ff"
                            : msg.status === "awaiting_sender_setup"
                            ? "#fef9c3"
                            : "#fee2e2",
                        color:
                          msg.status === "pending"
                            ? "#92400e"
                            : msg.status === "dispatched"
                            ? "#065f46"
                            : msg.status === "claimed"
                            ? "#3730a3"
                            : msg.status === "awaiting_sender_setup"
                            ? "#854d0e"
                            : "#991b1b",
                      }}
                    >
                      {msg.status.toUpperCase().replace(/_/g, " ")}
                      {transportLabelFromExternalId(msg.externalMessageId) === "simulated" ? " · SIMULATED" : ""}
                    </span>
                  </div>
                </div>

                {/* Schedule & Revision Info */}
                <div style={{ display: "flex", gap: "16px", fontSize: "12px", color: "#6b7280", marginBottom: "12px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <Calendar size={13} />
                    Scheduled: {scheduledTime.toLocaleString(undefined, { timeZone: msg.timezone })} ({msg.timezone})
                  </span>
                  <span>Revision: #{msg.revisionCount}</span>
                  <button
                    onClick={() => setActiveHistoryMessageId(activeHistoryMessageId === msg.id ? null : msg.id)}
                    style={{ background: "none", border: "none", color: "#4f46e5", cursor: "pointer", padding: 0, fontSize: "12px" }}
                  >
                    {activeHistoryMessageId === msg.id ? "Hide Revisions" : "View Revision History"}
                  </button>
                </div>

                {/* Message Body Content */}
                {isEditing ? (
                  <div style={{ marginTop: "8px", marginBottom: "12px" }}>
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                      style={{
                        width: "100%",
                        padding: "8px",
                        borderRadius: "6px",
                        border: "1px solid #d1d5db",
                        fontFamily: "inherit",
                        fontSize: "13px",
                        boxSizing: "border-box",
                      }}
                    />
                    <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                      <button
                        onClick={() =>
                          editMutation.mutate({
                            messageId: msg.id,
                            newMessageBody: editText,
                            expectedRevisionCount: msg.revisionCount,
                            reason: "Admin outbox manual update",
                          })
                        }
                        disabled={editMutation.isPending || !editText.trim()}
                        style={{
                          padding: "5px 12px",
                          background: "#2563eb",
                          color: "#fff",
                          border: "none",
                          borderRadius: "5px",
                          fontSize: "12px",
                          fontWeight: "600",
                          cursor: "pointer",
                        }}
                      >
                        {editMutation.isPending ? "Saving..." : "Save Revision"}
                      </button>
                      <button
                        onClick={() => setEditingMessageId(null)}
                        style={{
                          padding: "5px 12px",
                          background: "#f3f4f6",
                          border: "1px solid #d1d5db",
                          borderRadius: "5px",
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      background: "#f9fafb",
                      border: "1px solid #f3f4f6",
                      borderRadius: "6px",
                      padding: "10px 12px",
                      fontSize: "13.5px",
                      color: "#1f2937",
                      lineHeight: "1.4",
                      marginBottom: "12px",
                    }}
                  >
                    {msg.currentMessageBody}
                  </div>
                )}

                {(() => {
                  const handoff = handoffQuery.data?.find(
                    (item) => item.messageId === msg.id && item.revisionCount === msg.revisionCount
                  );
                  const notice = composeNotice[msg.id];
                  return (
                    <div
                      data-sms-handoff-state={handoff?.state ?? "draft"}
                      data-sms-handoff-covers={handoff?.covers ? "true" : "false"}
                      data-villager-pose={handoff?.pose ?? "idle"}
                      data-verified-sent="false"
                      style={{ fontSize: "12px", color: "#4b5563", marginBottom: "10px" }}
                    >
                      {handoff?.covers
                        ? `${handoff.label}. Not an independent verification and not a carrier receipt.`
                        : "No compose handoff covers this revision."}
                      {notice?.kind === "desktop_continuation" && notice.continuationHref ? (
                        <div style={{ marginTop: "6px" }}>
                          <div>{notice.continuationLabel}</div>
                          <a href={notice.continuationHref}>{notice.continuationHref}</a>
                        </div>
                      ) : null}
                      {notice?.kind === "copy_fallback" && notice.copyBody ? (
                        <div style={{ marginTop: "6px" }}>
                          <div>{notice.copyLabel}</div>
                          <textarea readOnly value={notice.copyBody} rows={3} style={{ width: "100%", marginTop: "4px" }} />
                        </div>
                      ) : null}
                      {notice?.uri ? (
                        <div style={{ marginTop: "6px" }}>
                          <a href={notice.uri}>
                            {notice.bodyPrefillClaimed ? "Open SMS with this message" : "Open SMS. Prefill is not guaranteed."}
                          </a>
                          {notice.fallbackUri && notice.fallbackUri !== notice.uri ? (
                            <a href={notice.fallbackUri} style={{ marginLeft: "8px" }}>Open the number only</a>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })()}

                {/* Original Claire Draft Comparison if edited */}
                {msg.revisionCount > 1 && msg.originalSuggestedDraft !== msg.currentMessageBody && (
                  <div style={{ fontSize: "11.5px", color: "#6b7280", marginBottom: "10px", paddingLeft: "4px" }}>
                    <strong>Original Claire Draft:</strong> <em>"{msg.originalSuggestedDraft}"</em>
                  </div>
                )}

                {/* Reschedule Picker Inline */}
                {isRescheduling && (
                  <div style={{ background: "#fef3c7", padding: "10px", borderRadius: "6px", marginBottom: "10px" }}>
                    <div style={{ fontSize: "12px", fontWeight: "600", color: "#92400e", marginBottom: "6px" }}>
                      Select New Scheduled Date and Time ({msg.timezone.includes("Los_Angeles") ? "Pacific Time" : msg.timezone})
                    </div>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <input
                        type="datetime-local"
                        value={newScheduleIso}
                        onChange={(e) => setNewScheduleIso(e.target.value)}
                        style={{ padding: "4px 8px", borderRadius: "4px", border: "1px solid #d97706", fontSize: "12px" }}
                      />
                      <button
                        onClick={() =>
                          rescheduleMutation.mutate({
                            messageId: msg.id,
                            newScheduledFor: newScheduleIso,
                            timezone: msg.timezone,
                          })
                        }
                        disabled={rescheduleMutation.isPending || !newScheduleIso}
                        style={{
                          padding: "5px 12px",
                          background: "#b45309",
                          color: "#fff",
                          border: "none",
                          borderRadius: "4px",
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                      >
                        Confirm Reschedule
                      </button>
                      <button
                        onClick={() => setReschedulingMessageId(null)}
                        style={{ padding: "5px 10px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: "4px", fontSize: "12px", cursor: "pointer" }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}

                {/* Cancel Prompt Inline */}
                {isCancelling && (
                  <div style={{ background: "#fee2e2", padding: "10px", borderRadius: "6px", marginBottom: "10px" }}>
                    <div style={{ fontSize: "12px", fontWeight: "600", color: "#991b1b", marginBottom: "6px" }}>
                      Cancellation Reason (Required for audit log)
                    </div>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <input
                        type="text"
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        placeholder="e.g. Customer ordered today, operator called directly..."
                        style={{ flex: 1, padding: "4px 8px", borderRadius: "4px", border: "1px solid #dc2626", fontSize: "12px" }}
                      />
                      <button
                        onClick={() =>
                          cancelMutation.mutate({
                            messageId: msg.id,
                            reason: cancelReason,
                          })
                        }
                        disabled={cancelMutation.isPending || !cancelReason.trim()}
                        style={{
                          padding: "5px 12px",
                          background: "#b91c1c",
                          color: "#fff",
                          border: "none",
                          borderRadius: "4px",
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                      >
                        Confirm Cancellation
                      </button>
                      <button
                        onClick={() => setCancellingMessageId(null)}
                        style={{ padding: "5px 10px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: "4px", fontSize: "12px", cursor: "pointer" }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}

                {/* Revision History Viewer */}
                {activeHistoryMessageId === msg.id && historyQuery.data && (
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "10px", marginBottom: "12px" }}>
                    <div style={{ fontSize: "12px", fontWeight: "700", color: "#334155", marginBottom: "6px" }}>
                      Durable Revision History
                    </div>
                    {historyQuery.data.map((rev) => (
                      <div key={rev.id} style={{ fontSize: "11.5px", padding: "4px 0", borderBottom: "1px dashed #cbd5e1" }}>
                        <span style={{ fontWeight: "600", color: "#475569" }}>Rev #{rev.revisionNumber}:</span> "{rev.messageBody}"
                        <span style={{ color: "#94a3b8", marginLeft: "8px" }}>
                          ({new Date(rev.createdAt).toLocaleTimeString()} by {rev.editedBy})
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Action Buttons for Pending or Awaiting Sender Setup Messages */}
                {(msg.status === "pending" || msg.status === "awaiting_sender_setup") && !isEditing && !isRescheduling && !isCancelling && (
                  <div style={{ display: "flex", gap: "8px", borderTop: "1px solid #f3f4f6", paddingTop: "10px" }}>
                    <button
                      onClick={() => {
                        setEditingMessageId(msg.id);
                        setEditText(msg.currentMessageBody);
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "5px 10px",
                        background: "#f9fafb",
                        border: "1px solid #d1d5db",
                        borderRadius: "5px",
                        fontSize: "12px",
                        fontWeight: "500",
                        cursor: "pointer",
                      }}
                    >
                      <Edit2 size={13} /> Edit
                    </button>

                    <button
                      onClick={() => {
                        setReschedulingMessageId(msg.id);
                        setNewScheduleIso(
                          formatToWallClockIso(msg.scheduledFor, msg.timezone || "America/Los_Angeles")
                        );
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "5px 10px",
                        background: "#f9fafb",
                        border: "1px solid #d1d5db",
                        borderRadius: "5px",
                        fontSize: "12px",
                        fontWeight: "500",
                        cursor: "pointer",
                      }}
                    >
                      <Calendar size={13} /> Reschedule
                    </button>

                    <button
                      onClick={() => {
                        setCancellingMessageId(msg.id);
                        setCancelReason("");
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "5px 10px",
                        background: "#fff1f2",
                        border: "1px solid #fecdd3",
                        color: "#be123c",
                        borderRadius: "5px",
                        fontSize: "12px",
                        fontWeight: "500",
                        cursor: "pointer",
                      }}
                    >
                      <Trash2 size={13} /> Cancel
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        void (async () => {
                          try {
                            const result = await openSmsMutation.mutateAsync({
                              messageId: msg.id,
                              revisionCount: msg.revisionCount,
                              approvedBody: msg.currentMessageBody,
                              recipientPhone: msg.recipientPhone,
                              confirmation: SMS_COMPOSE_APPROVAL_CONFIRMATION,
                              clientKind: clientKindFromUserAgent(navigator.userAgent || ""),
                              surface: "scheduled_outreach",
                              pageUrl: `${window.location.origin}${window.location.pathname}`,
                              origin: window.location.origin,
                            });
                            setComposeNotice((current) => ({ ...current, [msg.id]: result }));
                            void utils.system.goldlineWorld.smsComposeHandoffSnapshot.invalidate();
                          } catch (err: unknown) {
                            alert(err instanceof Error ? err.message : "The SMS app was not opened.");
                          }
                        })();
                      }}
                      disabled={openSmsMutation.isPending}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "5px 12px",
                        background: "#ffffff",
                        color: "#1f2937",
                        border: "1px solid #d1d5db",
                        borderRadius: "5px",
                        fontSize: "12px",
                        fontWeight: "700",
                        cursor: "pointer",
                      }}
                    >
                      OPEN IN SMS
                    </button>
                    {handoffQuery.data?.find(
                      (item) => item.messageId === msg.id && item.revisionCount === msg.revisionCount
                    )?.state === "compose_opened" && (
                      <button
                        type="button"
                        onClick={() => {
                          void (async () => {
                            try {
                              const result = await reportSmsMutation.mutateAsync({
                                messageId: msg.id,
                                revisionCount: msg.revisionCount,
                                approvedBody: msg.currentMessageBody,
                                confirmation: SMS_COMPOSE_REPORTED_SENT_CONFIRMATION,
                                surface: "scheduled_outreach",
                              });
                              setComposeNotice((current) => ({
                                ...current,
                                [msg.id]: {
                                  ...(current[msg.id] ?? {
                                    kind: "operator_report",
                                    uri: null,
                                    fallbackUri: null,
                                    bodyPrefillClaimed: false,
                                    prefillClaim: "not_prefilled",
                                    copyBody: null,
                                    copyLabel: null,
                                    continuationHref: null,
                                    continuationLabel: null,
                                    actionSendto: false,
                                  }),
                                  state: result.state,
                                  verifiedSent: false,
                                  pose: result.pose,
                                  uri: null,
                                  bodyPrefillClaimed: false,
                                  prefillClaim: "not_prefilled",
                                },
                              }));
                              void utils.system.goldlineWorld.smsComposeHandoffSnapshot.invalidate();
                            } catch (err: unknown) {
                              alert(err instanceof Error ? err.message : "The report was not recorded.");
                            }
                          })();
                        }}
                        disabled={reportSmsMutation.isPending}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          padding: "5px 12px",
                          background: "#ffffff",
                          color: "#1f2937",
                          border: "1px solid #d1d5db",
                          borderRadius: "5px",
                          fontSize: "12px",
                          fontWeight: "600",
                          cursor: "pointer",
                        }}
                      >
                        I sent this from my phone
                      </button>
                    )}

                    {msg.status === "pending" && (
                      <button
                        onClick={() => sendEarlyMutation.mutate({ messageId: msg.id })}
                        disabled={sendEarlyMutation.isPending}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          marginLeft: "auto",
                          padding: "5px 12px",
                          background: "#10b981",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "5px",
                          fontSize: "12px",
                          fontWeight: "700",
                          cursor: "pointer",
                        }}
                      >
                        <Play size={13} /> SEND EARLY
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SenderStatusCard(props: {
  loading: boolean;
  status?: {
    stateLabel: string;
    authorizedToTransmit: boolean;
    originatingPhone: string | null;
    blockReason: string;
    browserTransport: { status: string };
    deviceTransport: { status: string };
    humanGates: {
      livePairing: { status: string };
      controlledSelfSend: { status: string };
    };
  };
}) {
  const tone =
    props.status?.stateLabel === "Connected"
      ? { bg: "#ecfdf5", border: "#a7f3d0", text: "#065f46" }
      : props.status?.stateLabel === "Identity Unverified"
        ? { bg: "#fef2f2", border: "#fecaca", text: "#991b1b" }
        : props.status?.stateLabel === "Unhealthy"
          ? { bg: "#fffbeb", border: "#fde68a", text: "#92400e" }
          : { bg: "#f8fafc", border: "#e2e8f0", text: "#334155" };

  return (
    <section
      style={{
        background: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: "12px",
        padding: "14px 16px",
        marginBottom: "16px",
      }}
    >
      <div style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "0.04em", color: "#6b7280" }}>
        PERSONAL SENDER
      </div>
      {props.loading || !props.status ? (
        <p style={{ margin: "8px 0 0", color: "#6b7280", fontSize: "14px" }}>Checking sender connection…</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px", flexWrap: "wrap" }}>
            <span
              style={{
                background: tone.bg,
                border: `1px solid ${tone.border}`,
                color: tone.text,
                borderRadius: "999px",
                padding: "4px 10px",
                fontSize: "13px",
                fontWeight: 700,
              }}
            >
              {props.status.stateLabel}
            </span>
            <span style={{ fontSize: "13px", color: "#374151" }}>
              Transmit {props.status.authorizedToTransmit ? "authorized" : "blocked"}
            </span>
            <span style={{ fontSize: "13px", color: "#374151" }}>
              {props.status.originatingPhone
                ? `Originating number ${props.status.originatingPhone}`
                : "Originating number not verified"}
            </span>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: "13px", color: "#4b5563", lineHeight: 1.45 }}>
            {props.status.blockReason}
          </p>
          <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#6b7280" }}>
            Google Messages browser: {props.status.browserTransport.status}. Android handset:{" "}
            {props.status.deviceTransport.status}. Live pairing: {props.status.humanGates.livePairing.status}.
            Controlled self-send: {props.status.humanGates.controlledSelfSend.status}. A connected session is not
            permission to text a customer.
          </p>
          <div data-android-unattended={props.status.deviceTransport.status} style={{ marginTop: "10px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>SMS compose handoff</div>
            <ul style={{ margin: "6px 0 0", paddingLeft: "18px", fontSize: "12px", color: "#4b5563" }}>
              {SMS_COMPOSE_HANDOFF_STATES.map((state) => (
                <li key={state}>{SMS_COMPOSE_HANDOFF_STATE_LABELS[state]}</li>
              ))}
            </ul>
            <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#4b5563", lineHeight: 1.45 }}>
              Compose opened and operator reported sent stay on those states. Neither one is independently verified
              sent, and neither one marks the outbox dispatched. Opening the SMS app is not a carrier receipt.
              Unattended Android transmit stays {props.status.deviceTransport.status}.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
