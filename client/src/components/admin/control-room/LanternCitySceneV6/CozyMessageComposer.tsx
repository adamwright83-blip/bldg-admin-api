import { useState, useEffect, useRef } from "react";
import {
  COZY_REPLY_CLASSIFICATION_LABELS,
  type CozyProjectedTarget,
  type CozyReplyClassification,
} from "@shared/cozyVillagerEvidence";
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
  objectiveId?: string | null;
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
  objectiveId = null,
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
  const [showReplyRecorder, setShowReplyRecorder] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyClassification, setReplyClassification] = useState<CozyReplyClassification | "auto">(
    "auto"
  );
  const [replyError, setReplyError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const openHandoff = trpc.system.goldlineWorld.openSmsComposeHandoff.useMutation();
  const reportSent = trpc.system.goldlineWorld.reportSmsComposeOperatorSent.useMutation();
  const ensureDraft = trpc.system.goldlineWorld.scheduleCozyOutreach.useMutation();
  const recordReply = trpc.system.goldlineWorld.recordPersonalOutreachReply.useMutation();

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
    setShowReplyRecorder(false);
    setReplyText("");
    setReplyClassification("auto");
    setReplyError(null);
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
    onSendNow(target, message.trim(), recoveryKey);
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

  const recoveryKey = `day-line-recovery:${objectiveId ?? "personal"}:${target.customerId}`;

  const handleOpenSms = async () => {
    if (!textApproved || !approvedBody || !target.phone || isSending || !target.hasConsent) return;
    setHandoffError(null);
    try {
      const draft = await ensureDraft.mutateAsync({
        customerId: target.customerId,
        messageBody: approvedBody,
        scheduledFor: scheduleDateTime,
        timezone: "America/Los_Angeles",
        expectedPhone: target.phone,
        slotId: target.slotId,
        territoryId: target.territoryId,
        idempotencyKey: recoveryKey,
      });
      const clientKind = clientKindFromUserAgent(navigator.userAgent || "");
      const result = await openHandoff.mutateAsync({
        messageId: draft.id,
        revisionCount: draft.revisionCount,
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
    onScheduleSend(target, message.trim(), scheduleDateTime, recoveryKey);
    setShowSchedulePicker(false);
  };

  const handleRecordReply = async () => {
    const trimmed = replyText.trim();
    if (!trimmed || recordReply.isPending) return;
    setReplyError(null);
    try {
      const saved = await recordReply.mutateAsync({
        customerId: target.customerId,
        customerName: target.displayName,
        replyText: trimmed,
        classification: replyClassification === "auto" ? undefined : replyClassification,
        messageId: target.messageId ?? null,
        territoryId: target.territoryId,
        surface: "cozy_composer",
      });
      if (saved.preparedFollowUpDraft) {
        setMessage(saved.preparedFollowUpDraft);
        setApprovedBody(null);
      }
      setReplyText("");
      setShowReplyRecorder(false);
      await Promise.all([
        utils.system.goldlineWorld.cozyVillagerMission.invalidate(),
        utils.system.goldlineWorld.cozyRecoveryDayLineCard.invalidate(),
        utils.system.goldlineWorld.listPersonalOutreachReplies.invalidate(),
      ]);
    } catch (err: unknown) {
      setReplyError(err instanceof Error ? err.message : "Could not record customer reply.");
    }
  };

  const state = target.communicationState;
  const hasOpenReplyFollowUp =
    target.reply?.status === "operator_reported" &&
    Boolean(target.reply.preparedFollowUpDraft);
  const isDispatched = state === "send_observed";
  const isScheduled = state === "scheduled" || state === "claimed";
  const isAwaitingSender = state === "awaiting_sender" || state === "send_not_observed";
  const isFailed = state === "failed";
  const isActionCommitted =
    (isDispatched || isScheduled || isAwaitingSender) && !hasOpenReplyFollowUp;
  const canSend = target.hasConsent && message.trim().length > 0 && !isSending && !isActionCommitted;

  return (
    <aside
      className={styles.composerDrawer}
      aria-label="Customer Outreach Composer"
      data-customer-id={target.customerId}
      data-communication-state={state ?? "draft_prepared"}
      data-message-id={target.messageId ?? ""}
      data-reply-status={target.reply?.status ?? "unavailable"}
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
        <span>✨</span>{" "}
        {target.reply?.status === "operator_reported"
          ? `${target.communicationLabel ?? "Draft Prepared"} · ${target.reply.classificationLabel}`
          : (target.communicationLabel ?? "Draft Prepared")}
      </div>
      <div className={styles.recipientMeta}>
        Reply:{" "}
        {target.reply?.status === "operator_reported"
          ? `operator-reported (${target.reply.classificationLabel})`
          : "unavailable"}{" "}
        · Paid order after this message:{" "}
        {target.paidOrder?.status === "verified" ? target.paidOrder.orderId : "not verified"}
      </div>

      {target.reply?.status === "operator_reported" && (
        <div
          className={styles.scheduledBanner}
          style={{
            marginTop: "8px",
            borderColor:
              target.reply.classification === "opt_out" ||
              target.reply.classification === "complaint"
                ? "#fca5a5"
                : "#93c5fd",
            background:
              target.reply.classification === "opt_out" ||
              target.reply.classification === "complaint"
                ? "#fef2f2"
                : "#eff6ff",
            color:
              target.reply.classification === "opt_out" ||
              target.reply.classification === "complaint"
                ? "#991b1b"
                : "#1e3a8a",
          }}
          data-testid="operator-reported-reply-banner"
          data-reply-classification={target.reply.classification}
          data-reply-provenance={target.reply.provenance}
        >
          <span>💬</span>
          <div>
            <strong>
              Operator-reported reply · {target.reply.classificationLabel}
            </strong>
            <div style={{ fontSize: "11px", marginTop: "2px" }}>
              “{target.reply.replyText}”
            </div>
            <div style={{ fontSize: "10.5px", opacity: 0.9, marginTop: "3px" }}>
              {target.reply.nextAction}
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: "8px" }}>
        <button
          type="button"
          className={styles.scheduleButton}
          style={{ width: "100%", fontSize: "11.5px", padding: "6px 10px" }}
          onClick={() => setShowReplyRecorder((current) => !current)}
          data-testid="toggle-reply-recorder"
        >
          💬 {target.reply?.status === "operator_reported" ? "Update Customer Reply (Google Messages)" : "Log Customer Reply (Google Messages)"}
        </button>
      </div>

      {showReplyRecorder && (
        <div
          className={styles.schedulePickerBox}
          style={{ marginTop: "8px" }}
          data-testid="personal-reply-recorder"
        >
          <div style={{ fontSize: "11.5px", fontWeight: 600, color: "#7a4e1d" }}>
            Record reply from your personal SMS thread (operator-reported)
          </div>
          <textarea
            className={styles.messageTextArea}
            style={{ marginTop: "6px", minHeight: "56px" }}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Paste or type what the customer texted back (e.g. 'Can you pick up 2 bags Thursday morning?' or 'STOP')..."
            rows={2}
            data-testid="personal-reply-input"
          />
          <div className={styles.scheduleInputRow} style={{ marginTop: "6px", gap: "6px" }}>
            <select
              className={styles.scheduleInput}
              value={replyClassification}
              onChange={(e) =>
                setReplyClassification(e.target.value as CozyReplyClassification | "auto")
              }
              data-testid="personal-reply-classification"
            >
              <option value="auto">Auto-classify reply</option>
              {(
                Object.entries(COZY_REPLY_CLASSIFICATION_LABELS) as [
                  CozyReplyClassification,
                  string,
                ][]
              ).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={styles.sendButton}
              style={{ flex: "none", padding: "6px 12px", fontSize: "11.5px" }}
              onClick={() => void handleRecordReply()}
              disabled={!replyText.trim() || recordReply.isPending}
              data-testid="submit-personal-reply"
            >
              {recordReply.isPending ? "SAVING..." : "SAVE REPLY"}
            </button>
          </div>
          <div style={{ fontSize: "10px", opacity: 0.8, marginTop: "4px" }}>
            Saved as operator-reported. Opt-outs immediately block future outreach. Does not mark a paid order.
          </div>
          {replyError && (
            <div className={styles.handoffNote} style={{ color: "#991b1b" }}>
              {replyError}
            </div>
          )}
        </div>
      )}

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
              <strong>Saved for your phone. Not sent.</strong>
              <div style={{ fontSize: "10.5px", opacity: 0.9 }}>
                This draft is waiting for you to send it from your own phone. Opening Messages is not a send.
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
                <textarea readOnly value={handoffReveal.copyBody} rows={3} data-sms-copy-fallback="" />
              </>
            ) : null}
            {handoffReveal.kind === "missing_body" ? <p>{handoffReveal.copyLabel}</p> : null}
            {handoffReveal.uri ? (
              <a
                href={handoffReveal.uri}
                data-sms-open={handoffReveal.messagesPackage ? "google-messages" : "sms"}
                data-messages-package={handoffReveal.messagesPackage ?? ""}
              >
                {handoffReveal.bodyPrefillClaimed
                  ? "Open SMS with this message"
                  : "Open the Google Messages thread. The message is not prefilled."}
              </a>
            ) : null}
            {handoffReveal.fallbackUri && handoffReveal.fallbackUri !== handoffReveal.uri ? (
              <a href={handoffReveal.fallbackUri}>Open the number only</a>
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
