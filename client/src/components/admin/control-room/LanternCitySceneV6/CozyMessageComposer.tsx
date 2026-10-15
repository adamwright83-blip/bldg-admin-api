import { useState, useEffect, useRef } from "react";
import type { CozyProjectedTarget } from "@shared/cozyVillagerEvidence";
import { trpc } from "@/lib/trpc";
import {
  SMS_COMPOSE_APPROVAL_CONFIRMATION,
  SMS_COMPOSE_REPORTED_SENT_CONFIRMATION,
  clientKindFromUserAgent,
  type SmsComposeUriResult,
} from "../../../../../../server/experience/lanternCity/personalNumber/smsComposeHandoff";
import styles from "./cozy-neighborhood.module.css";

interface CozyMessageComposerProps {
  target: CozyProjectedTarget;
  targetIndex: number;
  totalTargets: number;
  isSending: boolean;
  onSendNow: (target: CozyProjectedTarget, editedText: string, idempotencyKey: string) => void;
  onScheduleSend: (
    target: CozyProjectedTarget,
    editedText: string,
    scheduledForIso: string,
    idempotencyKey?: string
  ) => void;
  onClose: () => void;
  onSelectIndex: (index: number) => void;
}

export function CozyMessageComposer({
  target,
  targetIndex,
  totalTargets,
  isSending,
  onSendNow,
  onScheduleSend,
  onClose,
  onSelectIndex,
}: CozyMessageComposerProps) {
  const [message, setMessage] = useState(target.preparedMessage || target.suggestedMessage);
  const [isListening, setIsListening] = useState(false);
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [approvedBody, setApprovedBody] = useState<string | null>(null);
  const [approvalRevision, setApprovalRevision] = useState(1);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [handoffReveal, setHandoffReveal] = useState<SmsComposeUriResult & {
    state: string;
    verifiedSent: false;
    pose: "idle" | "wave";
  } | null>(null);
  const openHandoff = trpc.system.goldlineWorld.openSmsComposeHandoff.useMutation();
  const reportSent = trpc.system.goldlineWorld.reportSmsComposeOperatorSent.useMutation();

  // Default schedule: tomorrow at 10:00 AM Pacific (America/Los_Angeles)
  const getDefaultScheduleIso = () => {
    const now = new Date();
    const laDateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const [year, month, day] = laDateStr.split("-").map(Number);
    const tomorrowUtc = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
    const tomorrowStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(tomorrowUtc);
    return `${tomorrowStr}T10:00`;
  };

  const [scheduleDateTime, setScheduleDateTime] = useState(getDefaultScheduleIso());
  const recognitionRef = useRef<any>(null);

  // Sync draft message when switching between villagers
  useEffect(() => {
    setMessage(target.preparedMessage || target.suggestedMessage);
    setShowSchedulePicker(false);
    setApprovedBody(null);
    setApprovalRevision(1);
    setHandoffError(null);
    setHandoffReveal(null);
  }, [target.customerId, target.preparedMessage, target.suggestedMessage]);

  const handleTalkToText = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Speech-to-text is not supported in this browser. Please type directly.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onerror = () => setIsListening(false);

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          setMessage((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  const handleSendNow = () => {
    if (!message.trim() || isSending || !target.hasConsent) return;
    const idempotencyKey = crypto.randomUUID();
    onSendNow(target, message.trim(), idempotencyKey);
  };

  const textApproved = approvedBody !== null && approvedBody === message.trim();

  const handleApproveText = () => {
    const next = message.trim();
    if (!next) return;
    if (next !== approvedBody) {
      setApprovalRevision((current) => (approvedBody === null ? 1 : current + 1));
      setHandoffReveal(null);
    }
    setApprovedBody(next);
    setHandoffError(null);
  };

  const handleOpenSms = async () => {
    if (!textApproved || !approvedBody || !target.phone || isSending || !target.hasConsent) return;
    setHandoffError(null);
    try {
      const clientKind = clientKindFromUserAgent(navigator.userAgent || "");
      const result = await openHandoff.mutateAsync({
        messageId: target.messageId ?? `cozy:${target.customerId}`,
        revisionCount: approvalRevision,
        approvedBody,
        recipientPhone: target.phone,
        confirmation: SMS_COMPOSE_APPROVAL_CONFIRMATION,
        clientKind,
        surface: "cozy_composer",
        pageUrl: `${window.location.origin}${window.location.pathname}`,
        origin: window.location.origin,
      });
      setHandoffReveal(result);
    } catch (err: unknown) {
      setHandoffError(err instanceof Error ? err.message : "The SMS app was not opened.");
    }
  };

  const handleReportSent = async () => {
    if (!textApproved || !approvedBody || handoffReveal?.state !== "compose_opened") return;
    setHandoffError(null);
    try {
      const result = await reportSent.mutateAsync({
        messageId: target.messageId ?? `cozy:${target.customerId}`,
        revisionCount: approvalRevision,
        approvedBody,
        confirmation: SMS_COMPOSE_REPORTED_SENT_CONFIRMATION,
        surface: "cozy_composer",
      });
      setHandoffReveal((current) =>
        current
          ? {
              ...current,
              state: result.state,
              verifiedSent: false,
              pose: result.pose,
              uri: null,
              bodyPrefillClaimed: false,
              prefillClaim: "not_prefilled",
            }
          : current
      );
    } catch (err: unknown) {
      setHandoffError(err instanceof Error ? err.message : "The report was not recorded.");
    }
  };

  const handleCommitSchedule = () => {
    if (!message.trim() || isSending || !target.hasConsent) return;
    if (!scheduleDateTime) {
      alert("Please select a date and time.");
      return;
    }
    const idempotencyKey = crypto.randomUUID();
    // Pass wall-clock date and time string directly to server for authoritative Pacific conversion
    onScheduleSend(target, message.trim(), scheduleDateTime, idempotencyKey);
    setShowSchedulePicker(false);
  };

  const state = target.communicationState;
  const isDispatched = state === "send_observed";
  const isScheduled = state === "scheduled" || state === "claimed";
  const isAwaitingSender = state === "awaiting_sender" || state === "send_not_observed";
  const isFailed = state === "failed";
  const isActionCommitted = isDispatched || isScheduled || isAwaitingSender;
  const canSend = target.hasConsent && message.trim().length > 0 && !isSending && !isActionCommitted;

  return (
    <aside
      className={styles.composerDrawer}
      aria-label="Customer Outreach Composer"
      data-customer-id={target.customerId}
      data-communication-state={state ?? "draft_prepared"}
      data-message-id={target.messageId ?? ""}
    >
      <div className={styles.composerHeader}>
        <div>
          <h3 className={styles.recipientTitle}>{target.displayName}</h3>
          <div className={styles.recipientMeta}>
            {target.territoryName} · {target.phone ?? "No phone"}
          </div>
        </div>
        <button className={styles.closeButton} onClick={onClose} aria-label="Close drawer">
          ✕
        </button>
      </div>

      {/* Cadence & History Card */}
      <div className={styles.historySummaryCard}>
        <div className={styles.historyRow}>
          <span className={styles.historyLabel}>Lapsed Cadence:</span>
          <span className={styles.historyValue}>
            {target.daysSinceLastOrder} days since last order
          </span>
        </div>
        <div className={styles.historyRow}>
          <span className={styles.historyLabel}>Order History:</span>
          <span className={styles.historyValue}>
            {target.paidOrders} orders (${(target.lifetimeCents / 100).toFixed(0)} LTV)
          </span>
        </div>
        {target.lastOrderSummary && (
          <div className={styles.historyRow}>
            <span className={styles.historyLabel}>Last Service:</span>
            <span className={styles.historyValue}>{target.lastOrderSummary}</span>
          </div>
        )}
      </div>

      {/* Claire Draft Badge */}
      <div className={styles.claireBadge}>
        <span>✨</span> {target.communicationLabel ?? "Draft Prepared"}
      </div>
      <div className={styles.recipientMeta}>
        Reply: unavailable · Paid order after this message:{" "}
        {target.paidOrder?.status === "verified" ? target.paidOrder.orderId : "not verified"}
      </div>

      {/* Message Editing */}
      <div className={styles.textAreaContainer}>
        <textarea
          className={styles.messageTextArea}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Personalize Claire's outreach message..."
          disabled={isActionCommitted}
          rows={4}
        />
      </div>

      {/* Controls & Feedback */}
      <div className={styles.composerFooter}>
        <div className={styles.composerMetaRow}>
          <span>{message.length} / 500 characters</span>
          <span>
            {target.consentStatus === "verified_opt_in" ? (
              <span style={{ color: "#2d8a4e" }}>✓ Verified Opt-In Consent</span>
            ) : target.consentStatus === "existing_customer_relationship" ? (
              <span style={{ color: "#2563eb" }}>ℹ Eligible Prior Customer (Unspecified Consent)</span>
            ) : target.consentStatus === "missing_phone" ? (
              <span style={{ color: "#c2410c" }}>⚠ Missing Verified Phone</span>
            ) : (
              <span style={{ color: "#c2410c" }}>⚠ {target.consentReason ?? "Recipient Opted Out"}</span>
            )}
          </span>
        </div>

        {/* Scheduled Confirmation Banner */}
        {isScheduled && (
          <div className={styles.scheduledBanner}>
            <span>⏰</span>
            <div>
              <strong>{state === "claimed" ? "Claimed — send not observed" : "Scheduled — not sent"}</strong>
              <div style={{ fontSize: "10.5px", opacity: 0.9 }}>
                {target.scheduledDraft
                  ? `Pacific window ${new Date(target.scheduledDraft.scheduledFor).toLocaleString("en-US", { timeZone: target.scheduledDraft.timezone || "America/Los_Angeles" })}. Editable in Admin → Claire → Scheduled Outreach.`
                  : "Editable in Admin → Claire → Scheduled Outreach."}
              </div>
            </div>
          </div>
        )}

        {/* Awaiting Sender Setup Banner */}
        {isAwaitingSender && (
          <div className={styles.scheduledBanner} style={{ borderColor: "#fcd34d", background: "#fefce8", color: "#854d0e" }}>
            <span>📱</span>
            <div>
              <strong>Committed to Outbox (Awaiting Phone Connection)</strong>
              <div style={{ fontSize: "10.5px", opacity: 0.9 }}>
                Saved in Admin → Claire → Scheduled Outreach. Message will send once your personal Android phone is connected in Phase 2.
              </div>
            </div>
          </div>
        )}

        {/* Dispatched Confirmation Banner */}
        {isFailed && (
          <div className={styles.scheduledBanner} style={{ borderColor: "#fecaca", background: "#fef2f2", color: "#991b1b" }}>
            <span>!</span>
            <div>
              <strong>Failed — not sent</strong>
              <div style={{ fontSize: "10.5px", opacity: 0.9 }}>
                The outbox recorded a failure. You can edit and send again. This is not a send observation.
              </div>
            </div>
          </div>
        )}

        {isDispatched && (
          <div className={styles.receiptBanner}>
            <span>✓</span>
            <div>
              <strong>{target.transport === "simulated" ? "Simulated send observed" : "Send observed"}</strong>
              <div style={{ fontSize: "10.5px", opacity: 0.85 }}>
                {target.transport === "simulated"
                  ? "Transport is simulated. Delivery, reply, and payment are not verified."
                  : "A provider reference was recorded. Delivery, reply, and payment are not verified."}
              </div>
            </div>
          </div>
        )}

        {/* Schedule Time Picker Expansion */}
        {showSchedulePicker && !isActionCommitted && (
          <div className={styles.schedulePickerBox}>
            <div style={{ fontSize: "12px", fontWeight: 600, color: "#7a4e1d" }}>
              Select Future Dispatch Date & Time (Pacific Time)
            </div>
            <div className={styles.scheduleInputRow}>
              <input
                type="datetime-local"
                className={styles.scheduleInput}
                value={scheduleDateTime}
                onChange={(e) => setScheduleDateTime(e.target.value)}
              />
              <button
                type="button"
                className={styles.sendButton}
                style={{ flex: "none", padding: "6px 14px", fontSize: "12px" }}
                onClick={handleCommitSchedule}
                disabled={!canSend}
              >
                COMMIT
              </button>
            </div>
          </div>
        )}

        {textApproved ? (
          <div className={styles.handoffNote} data-sms-approval="current">
            Approved for this text, revision {approvalRevision}. Opening SMS does not send it.
          </div>
        ) : approvedBody ? (
          <div className={styles.handoffNote} data-sms-approval="stale">
            This edit is not covered by the earlier approval. Approve the new text before opening SMS.
          </div>
        ) : null}

        {handoffReveal && (
          <div
            className={styles.handoffPanel}
            data-sms-handoff-state={handoffReveal.state}
            data-body-prefill-claimed={handoffReveal.bodyPrefillClaimed ? "true" : "false"}
            data-villager-pose={handoffReveal.pose}
            data-verified-sent="false"
          >
            <strong>
              {handoffReveal.state === "operator_reported_sent"
                ? "Operator reported sent"
                : "Compose opened"}
            </strong>
            <p>
              {handoffReveal.state === "operator_reported_sent"
                ? "You reported that you sent this from your phone. That report is not an independent verification and the outbox was not marked dispatched."
                : "The handoff is recorded. This is not a carrier receipt and the villager is not marked sent."}
            </p>
            {handoffReveal.kind === "desktop_continuation" && handoffReveal.continuationHref ? (
              <>
                <p>{handoffReveal.continuationLabel}</p>
                <a href={handoffReveal.continuationHref}>{handoffReveal.continuationHref}</a>
              </>
            ) : null}
            {handoffReveal.kind === "copy_fallback" && handoffReveal.copyBody ? (
              <>
                <p>{handoffReveal.copyLabel}</p>
                <textarea readOnly value={handoffReveal.copyBody} rows={3} />
              </>
            ) : null}
            {handoffReveal.kind === "missing_body" ? <p>{handoffReveal.copyLabel}</p> : null}
            {handoffReveal.uri ? (
              <a href={handoffReveal.uri}>
                {handoffReveal.bodyPrefillClaimed ? "Open SMS with this message" : "Open the number in your SMS app"}
              </a>
            ) : null}
            {handoffReveal.state === "compose_opened" ? (
              <button type="button" onClick={() => void handleReportSent()} disabled={reportSent.isPending}>
                I sent this from my phone
              </button>
            ) : null}
          </div>
        )}
        {handoffError ? <div className={styles.handoffNote}>{handoffError}</div> : null}

        {/* Two Canonical Actions: SEND NOW & CLOCK ICON -> SCHEDULE SEND */}
        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.talkToTextButton}
            onClick={handleTalkToText}
            disabled={isActionCommitted || isSending}
          >
            🎤 {isListening ? "Listening..." : "TALK TO TEXT"}
          </button>

          <button
            type="button"
            className={styles.scheduleButton}
            onClick={() => setShowSchedulePicker(!showSchedulePicker)}
            disabled={!canSend}
            title="Schedule Send"
          >
            ⏰ SCHEDULE
          </button>

          <button
            type="button"
            className={styles.scheduleButton}
            onClick={handleApproveText}
            disabled={!message.trim() || isActionCommitted}
          >
            APPROVE
          </button>

          <button
            type="button"
            className={styles.sendButton}
            onClick={() => void handleOpenSms()}
            disabled={!textApproved || !target.phone || !target.hasConsent || isSending || openHandoff.isPending}
          >
            {openHandoff.isPending ? "OPENING..." : "OPEN IN SMS"}
          </button>

          <button
            type="button"
            className={styles.sendButton}
            onClick={handleSendNow}
            disabled={!canSend}
          >
            {isSending ? (
              "SENDING..."
            ) : isActionCommitted ? (
              "✓ COMMITTED"
            ) : (
              <>
                <span>✈</span> SEND NOW
              </>
            )}
          </button>
        </div>

        {/* Paginator */}
        <div className={styles.navChevrons}>
          <button
            type="button"
            className={styles.chevronBtn}
            disabled={targetIndex <= 0}
            onClick={() => onSelectIndex(targetIndex - 1)}
          >
            ◀ Prev
          </button>
          <span>
            {targetIndex + 1} of {totalTargets} Customers
          </span>
          <button
            type="button"
            className={styles.chevronBtn}
            disabled={targetIndex >= totalTargets - 1}
            onClick={() => onSelectIndex(targetIndex + 1)}
          >
            Next ▶
          </button>
        </div>
      </div>
    </aside>
  );
}
