import { useState, useEffect, useRef } from "react";
import type { CozyCustomerTarget } from "@shared/cozyVillagerOutreach";
import styles from "./cozy-neighborhood.module.css";

interface CozyMessageComposerProps {
  target: CozyCustomerTarget;
  targetIndex: number;
  totalTargets: number;
  isSending: boolean;
  onSendNow: (target: CozyCustomerTarget, editedText: string, idempotencyKey: string) => void;
  onScheduleSend: (target: CozyCustomerTarget, editedText: string, scheduledForIso: string) => void;
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
  const [message, setMessage] = useState(target.suggestedMessage);
  const [isListening, setIsListening] = useState(false);
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);

  // Default schedule: tomorrow at 10:00 AM Pacific
  const getDefaultScheduleIso = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    // Format for datetime-local: YYYY-MM-DDTHH:mm
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  };

  const [scheduleDateTime, setScheduleDateTime] = useState(getDefaultScheduleIso());
  const recognitionRef = useRef<any>(null);

  // Sync draft message when switching between villagers
  useEffect(() => {
    setMessage(target.suggestedMessage);
    setShowSchedulePicker(false);
  }, [target.customerId, target.suggestedMessage]);

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

  const handleCommitSchedule = () => {
    if (!message.trim() || isSending || !target.hasConsent) return;
    if (!scheduleDateTime) {
      alert("Please select a date and time.");
      return;
    }
    // Pass wall-clock date and time string directly to server for authoritative Pacific conversion
    onScheduleSend(target, message.trim(), scheduleDateTime);
    setShowSchedulePicker(false);
  };

  const isDispatched = target.status === "accepted" || !!target.providerReceipt;
  const isScheduled = target.status === "scheduled" || !!target.scheduledDraft;
  const isAwaitingSender = target.status === "awaiting_sender_setup";
  const isActionCommitted = isDispatched || isScheduled || isAwaitingSender;
  const canSend = target.hasConsent && message.trim().length > 0 && !isSending && !isActionCommitted;

  return (
    <aside className={styles.composerDrawer} aria-label="Customer Outreach Composer">
      <div className={styles.composerHeader}>
        <div>
          <h3 className={styles.recipientTitle}>{target.displayName}</h3>
          <div className={styles.recipientMeta}>
            {target.address} · {target.phone ?? "No phone"}
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
        <span>✨</span> Claire's Suggested Reactivation Draft
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
              <strong>Committed to Scheduled Outbox</strong>
              <div style={{ fontSize: "10.5px", opacity: 0.9 }}>
                Scheduled for {target.scheduledDraft ? new Date(target.scheduledDraft.scheduledFor).toLocaleString() : "future delivery"}. Editable anytime in Admin → Claire → Scheduled Outreach.
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
        {isDispatched && (
          <div className={styles.receiptBanner}>
            <span>✓</span>
            <div>
              <strong>Personal Dispatch Initiated</strong>
              <div style={{ fontSize: "10.5px", opacity: 0.85 }}>
                Originates from verified cellular number in Google Messages.
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
