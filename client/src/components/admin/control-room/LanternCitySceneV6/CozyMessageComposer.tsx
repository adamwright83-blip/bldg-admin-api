import { useState, useEffect, useRef } from "react";
import type { CozyCustomerTarget } from "@shared/cozyVillagerOutreach";
import styles from "./cozy-neighborhood.module.css";

interface CozyMessageComposerProps {
  target: CozyCustomerTarget;
  targetIndex: number;
  totalTargets: number;
  isSending: boolean;
  onSend: (target: CozyCustomerTarget, editedText: string, idempotencyKey: string) => void;
  onClose: () => void;
  onSelectIndex: (index: number) => void;
}

export function CozyMessageComposer({
  target,
  targetIndex,
  totalTargets,
  isSending,
  onSend,
  onClose,
  onSelectIndex,
}: CozyMessageComposerProps) {
  const [message, setMessage] = useState(target.suggestedMessage);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Sync draft message when switching between villagers
  useEffect(() => {
    setMessage(target.suggestedMessage);
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

  const handleSend = () => {
    if (!message.trim() || isSending || !target.hasConsent) return;
    const idempotencyKey = crypto.randomUUID();
    onSend(target, message.trim(), idempotencyKey);
  };

  const isAccepted = target.status === "accepted" || !!target.providerReceipt;
  const canSend = target.hasConsent && message.trim().length > 0 && !isSending && !isAccepted;

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
          disabled={isAccepted}
          rows={4}
        />
      </div>

      {/* Controls & Feedback */}
      <div className={styles.composerFooter}>
        <div className={styles.composerMetaRow}>
          <span>{message.length} / 160 characters</span>
          <span>
            {target.hasConsent ? (
              <span style={{ color: "#2d8a4e" }}>✓ SMS Consent Verified</span>
            ) : (
              <span style={{ color: "#c2410c" }}>⚠ {target.consentReason ?? "Consent Required"}</span>
            )}
          </span>
        </div>

        {isAccepted && target.providerReceipt && (
          <div className={styles.receiptBanner}>
            <span>✓</span>
            <div>
              <strong>Twilio Accepted</strong> (SID: {target.providerReceipt.messageSid.slice(0, 16)}...)
              <div style={{ fontSize: "10.5px", opacity: 0.85 }}>
                Provider accepted request. Carrier delivery in flight.
              </div>
            </div>
          </div>
        )}

        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.talkToTextButton}
            onClick={handleTalkToText}
            disabled={isAccepted || isSending}
          >
            🎤 {isListening ? "Listening..." : "TALK TO TEXT"}
          </button>

          <button
            type="button"
            className={styles.sendButton}
            onClick={handleSend}
            disabled={!canSend}
          >
            {isSending ? (
              "SENDING..."
            ) : isAccepted ? (
              "✓ SENT"
            ) : (
              <>
                <span>✈</span> SEND TEXT
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
