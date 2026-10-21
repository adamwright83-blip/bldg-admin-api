import { useState, useEffect, useRef } from "react";
import type { CozyCustomerTarget, VillagerVariant } from "@shared/cozyVillagerOutreach";
import type { CozyProjectedTarget } from "@shared/cozyVillagerEvidence";
import {
  LETTER_APPROACHES,
  getVillagerPersonality,
  type LetterApproachId,
  type NeighborhoodMemoryState,
} from "@shared/playableVillagers";
import { trpc } from "@/lib/trpc";
import {
  GOOGLE_MESSAGES_PACKAGE,
  SMS_COMPOSE_APPROVAL_CONFIRMATION,
  SMS_COMPOSE_REPORTED_SENT_CONFIRMATION,
  clientKindFromUserAgent,
  type SmsComposeUriResult,
} from "../../../../../../server/experience/lanternCity/personalNumber/smsComposeHandoff";
import styles from "./playable-letter-desk.module.css";
import { describePacificWallTime, nextPacificSlot } from "./letterDeskSchedule";

interface PlayableLetterDeskProps {
  target: CozyProjectedTarget;
  targetIndex: number;
  totalTargets: number;
  objectiveId?: string | null;
  isSending: boolean;
  isSynthetic?: boolean;
  encounterCount?: number;
  memoryNote?: string | null;
  neighborhoodMemory?: NeighborhoodMemoryState | null;
  tenantId?: string;
  onSendNow: (target: CozyProjectedTarget, editedText: string, idempotencyKey: string) => void;
  onScheduleSend: (
    target: CozyProjectedTarget,
    editedText: string,
    scheduledForIso: string,
    idempotencyKey?: string
  ) => void | Promise<boolean | void>;
  onClose: () => void;
  onSelectIndex: (index: number) => void;
  onDraftCompleted?: (
    customerId: string,
    customerName: string,
    variant: VillagerVariant,
    action:
      | "draft_prepared"
      | "scheduled"
      | "compose_handoff_opened"
      | "operator_reported_sent"
      | "independently_verified_sent"
  ) => void;
  onSaveUnfinishedDraft?: (draft: {
    customerId: string;
    customerName: string;
    villagerVariant: VillagerVariant;
    letterApproach: LetterApproachId;
    draftBody: string;
  }) => void;
}

export function PlayableLetterDesk({
  target,
  targetIndex,
  totalTargets,
  objectiveId = null,
  isSending,
  isSynthetic = false,
  encounterCount = 1,
  memoryNote = null,
  neighborhoodMemory = null,
  tenantId = "laundry_farm",
  onSendNow,
  onScheduleSend,
  onClose,
  onSelectIndex,
  onDraftCompleted,
  onSaveUnfinishedDraft,
}: PlayableLetterDeskProps) {
  const personality = getVillagerPersonality(target.villagerVariant);

  const [selectedApproach, setSelectedApproach] = useState<LetterApproachId>("helpful_detailed");
  const [interactedApproach, setInteractedApproach] = useState<LetterApproachId | null>(null);
  const [message, setMessage] = useState(() =>
    LETTER_APPROACHES.helpful_detailed.generateText(target)
  );
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [approvedBody, setApprovedBody] = useState<string | null>(null);
  const [approvalRevision, setApprovalRevision] = useState(1);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [handoffReveal, setHandoffReveal] = useState<
    (SmsComposeUriResult & { state: string; verifiedSent: false; pose: "idle" | "wave" }) | null
  >(null);

  // Scheduling timing choice
  const [selectedScheduleSlot, setSelectedScheduleSlot] = useState<"morning" | "afternoon" | "custom">(
    "morning"
  );

  // Pacific Time schedule generators
  // the next Pacific 10 AM / 2 PM: after midnight, "10:00 AM" is this morning
  const getPacificScheduleIso = (hour: number, minute: number = 0) => nextPacificSlot(hour, minute).value;

  const [scheduleDateTime, setScheduleDateTime] = useState(() => getPacificScheduleIso(10, 0));
  /** set once the server has accepted a schedule from this desk: the green confirmation names the exact time */
  const [scheduledLabel, setScheduledLabel] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  const openHandoff = trpc.system.goldlineWorld.openSmsComposeHandoff.useMutation();
  const reportSent = trpc.system.goldlineWorld.reportSmsComposeOperatorSent.useMutation();
  const ensureDraft = trpc.system.goldlineWorld.scheduleCozyOutreach.useMutation();

  // Reset state when switching between customers or restoring unfinished draft
  const currentCustomerIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentCustomerIdRef.current === target.customerId) {
      return;
    }
    currentCustomerIdRef.current = target.customerId;

    const unfinished =
      neighborhoodMemory?.unfinishedActivity?.customerId === target.customerId
        ? neighborhoodMemory.unfinishedActivity
        : null;

    if (unfinished) {
      setSelectedApproach(unfinished.selectedApproach);
      setMessage(unfinished.draftBody);
      setRestoredDraft(true);
    } else {
      const defaultApproach: LetterApproachId = "helpful_detailed";
      setSelectedApproach(defaultApproach);
      setMessage(
        target.preparedMessage ||
          target.suggestedMessage ||
          LETTER_APPROACHES[defaultApproach].generateText(target, tenantId)
      );
      setRestoredDraft(false);
    }
    setInteractedApproach(null);
    setApprovedBody(null);
    setApprovalRevision(1);
    setHandoffError(null);
    setHandoffReveal(null);
    setSelectedScheduleSlot("morning");
    setScheduleDateTime(getPacificScheduleIso(10, 0));
    setScheduledLabel(null);
  }, [target.customerId, target.preparedMessage, target.suggestedMessage, tenantId]);

  // Dynamic dialogue & gesture calculation
  const reaction = interactedApproach
    ? personality.reactionToApproach(interactedApproach, message)
    : null;

  const villagerMemory = neighborhoodMemory?.villagerMemories?.[target.villagerVariant];
  const relationshipTier = villagerMemory?.relationshipTier ?? "new_acquaintance";
  const preferredApproach = villagerMemory?.preferredApproach ?? null;
  const isFirstVisit = (neighborhoodMemory?.visitCount ?? encounterCount) <= 1;
  const isReturnVisitTomorrowOrLater = neighborhoodMemory?.isReturnVisitTomorrowOrLater ?? false;
  // An unfinished note is this customer's; another neighbour's desk does not talk about it.
  const unfinishedDraftCustomer =
    neighborhoodMemory?.unfinishedActivity?.customerId === target.customerId ? target.displayName : null;
  const customerReplied =
    target.reply?.status !== "unavailable" && (target.reply as any)?.direction === "inbound";
  const paidReorderVerified = target.paidOrder?.status === "verified";

  const greetingDialogue = personality.contextualGreeting
    ? personality.contextualGreeting({
        customerName: target.displayName,
        isFirstVisit,
        isReturnVisitTomorrowOrLater,
        visitCount: neighborhoodMemory?.visitCount ?? encounterCount,
        unfinishedDraftCustomer,
        preferredApproach,
        relationshipTier,
        customerReplied,
        paidReorderVerified,
        memoryNote,
      })
    : isFirstVisit
    ? personality.firstEncounterGreeting(target.displayName)
    : personality.repeatEncounterGreeting(target.displayName, memoryNote);

  const activeDialogue = reaction?.dialogue ?? greetingDialogue;
  const activeGlyph = reaction?.glyph ?? (target.villagerVariant === "badger" ? "👓" : "✨");

  // Approach selection handler
  const handleSelectApproach = (approachId: LetterApproachId) => {
    setSelectedApproach(approachId);
    setInteractedApproach(approachId);
    let newMsg = message;
    if (approachId !== "custom") {
      newMsg = LETTER_APPROACHES[approachId].generateText(target, tenantId);
      setMessage(newMsg);
    }
    onSaveUnfinishedDraft?.({
      customerId: target.customerId,
      customerName: target.displayName,
      villagerVariant: target.villagerVariant,
      letterApproach: approachId,
      draftBody: newMsg,
    });
  };

  // Web speech recognition (Talk to Text)
  const handleTalkToText = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Speech-to-text is not supported in this browser. Please type into the letter directly.");
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
          setSelectedApproach("custom");
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  const recoveryKey = `day-line-recovery:${objectiveId ?? "personal"}:${target.customerId}`;

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

  // Immediate send action
  const handleSendNow = () => {
    if (!message.trim() || isSending || !target.hasConsent) return;
    onSendNow(target, message.trim(), recoveryKey);
    const action =
      target.silverLakeStatus?.message === "independently_verified_sent"
        ? "independently_verified_sent"
        : "operator_reported_sent";
    onDraftCompleted?.(
      target.customerId,
      target.displayName,
      target.villagerVariant,
      action
    );
  };

  // Schedule action: a time card (or the custom time's button) schedules for that exact Pacific time
  const handleCommitSchedule = async (when: string = scheduleDateTime) => {
    if (!message.trim() || isSending || !target.hasConsent) return;
    setScheduleDateTime(when);
    const accepted = await onScheduleSend(target, message.trim(), when, recoveryKey);
    if (accepted === false) return;
    setScheduledLabel(describePacificWallTime(when));
    onDraftCompleted?.(
      target.customerId,
      target.displayName,
      target.villagerVariant,
      "scheduled"
    );
  };

  // Open in SMS (personal number handoff)
  const handleOpenSms = async () => {
    if (!textApproved || !approvedBody || !target.phone || isSending || !target.hasConsent) return;
    setHandoffError(null);

    if (isSynthetic) {
      // Synthetic preview mode isolation: simulate handoff reveal without network mutation
      setHandoffReveal({
        kind: "prefilled",
        uri: `sms:${target.phone}?body=${encodeURIComponent(approvedBody)}`,
        fallbackUri: null,
        bodyPrefillClaimed: true,
        prefillClaim: "sms_uri_query",
        copyBody: approvedBody,
        copyLabel: null,
        continuationHref: null,
        continuationLabel: null,
        actionSendto: false,
        messagesPackage: GOOGLE_MESSAGES_PACKAGE,
        state: "compose_opened",
        verifiedSent: false,
        pose: "wave",
      });
      onDraftCompleted?.(
        target.customerId,
        target.displayName,
        target.villagerVariant,
        "compose_handoff_opened"
      );
      return;
    }

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
      onDraftCompleted?.(
        target.customerId,
        target.displayName,
        target.villagerVariant,
        "compose_handoff_opened"
      );
    } catch (err: unknown) {
      setHandoffError(err instanceof Error ? err.message : "The SMS app was not opened.");
    }
  };

  const handleReportSent = async () => {
    if (!textApproved || !approvedBody || handoffReveal?.state !== "compose_opened") return;
    if (isSynthetic) {
      setHandoffReveal((curr) =>
        curr
          ? {
              ...curr,
              state: "operator_reported_sent",
              verifiedSent: false,
              pose: "wave",
              uri: null,
              bodyPrefillClaimed: false,
              prefillClaim: "not_prefilled",
            }
          : curr
      );
      onDraftCompleted?.(
        target.customerId,
        target.displayName,
        target.villagerVariant,
        "operator_reported_sent"
      );
      return;
    }
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
      onDraftCompleted?.(
        target.customerId,
        target.displayName,
        target.villagerVariant,
        "operator_reported_sent"
      );
    } catch (err: unknown) {
      setHandoffError(err instanceof Error ? err.message : "The report was not recorded.");
    }
  };

  const state = target.status;
  const commState: string = target.communicationState ?? target.silverLakeStatus?.message ?? state;
  const isDispatched = state === "accepted" || commState === "send_observed";
  const isScheduled = state === "scheduled" || commState === "scheduled";
  const isAwaitingSender = state === "awaiting_sender_setup" || commState === "awaiting_sender";
  const isFailed = state === "failed" || commState === "failed";
  const isConsentBlocked = state === "consent_blocked" || commState === "consent_blocked" || !target.hasConsent;
  const isActionCommitted = isDispatched || isScheduled || isAwaitingSender;
  const canSend = !isConsentBlocked && message.trim().length > 0 && !isSending && !isActionCommitted;
  // the time this letter is scheduled for: just now from this desk, or a saved schedule that is still ahead
  // (a "send now" hand-off also records a time, which is now; that is not a schedule)
  const savedFor = target.scheduledDraft?.scheduledFor ?? null;
  const savedIsAhead = (() => {
    if (!savedFor) return false;
    const at = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(savedFor) ? savedFor : `${savedFor}:00-07:00`);
    return Number.isFinite(at) && at - Date.now() > 2 * 60_000;
  })();
  const scheduledWhen = scheduledLabel ?? (savedFor && savedIsAhead ? describePacificWallTime(savedFor) : null);

  return (
    <aside
      className={styles.deskOverlay}
      aria-label="Customer Outreach Composer"
      data-testid="playable-letter-desk"
      data-customer-id={target.customerId}
      data-villager-variant={target.villagerVariant}
      data-personality-style={personality.style}
      data-communication-state={commState}
    >
      {/* Top Header Bar */}
      <header className={styles.deskHeader}>
        <div className={styles.deskHeaderTitle}>
          <span>🏮</span>
          <span>Writing Desk · {target.territoryName}</span>
          <span
            className={`${styles.modeBadge} ${isSynthetic ? styles.modeBadgeSynthetic : ""}`}
            data-testid="desk-mode-badge"
          >
            {isSynthetic ? "Synthetic Preview" : "Real Mission"}
          </span>
        </div>
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close writing desk"
        >
          ✕
        </button>
      </header>

      {/* Villager Collaborative Staging Area */}
      <div className={styles.villagerStaging}>
        <div className={styles.characterPortraitWrapper}>
          <img
            src={personality.portraitSrc}
            alt={personality.canonicalName}
            className={styles.characterSprite}
            data-testid="desk-villager-portrait"
          />
          <div className={styles.villagerGlyph} aria-hidden="true">
            {activeGlyph}
          </div>
        </div>

        <div className={styles.dialogueBubble}>
          <div className={styles.speakerLabel}>
            <span>{personality.canonicalName}</span>
            <span className={styles.styleTag}>{personality.style}</span>
            <span
              className={styles.styleTag}
              style={{
                background:
                  relationshipTier === "cherished_partner"
                    ? "rgba(247, 183, 51, 0.25)"
                    : relationshipTier === "familiar_friend"
                    ? "rgba(100, 180, 246, 0.2)"
                    : "rgba(255, 255, 255, 0.08)",
                color:
                  relationshipTier === "cherished_partner"
                    ? "#f7b733"
                    : relationshipTier === "familiar_friend"
                    ? "#90caf9"
                    : "#d9be9e",
                border:
                  relationshipTier === "cherished_partner"
                    ? "1px solid rgba(247, 183, 51, 0.4)"
                    : "none",
              }}
              data-testid="villager-relationship-tier"
            >
              {relationshipTier === "cherished_partner"
                ? "🌟 Cherished Partner"
                : relationshipTier === "familiar_friend"
                ? "🤝 Familiar Friend"
                : "🌱 New Acquaintance"}
            </span>
          </div>
          <p className={styles.dialogueText} data-testid="villager-dialogue">
            {activeDialogue}
          </p>
        </div>
      </div>

      {/* Recipient Dossier Strip */}
      <div className={styles.dossierStrip}>
        <div className={styles.dossierItem}>
          <span>Recipient:</span>
          <span className={styles.dossierBold}>{target.displayName}</span>
        </div>
        <div className={styles.dossierItem}>
          <span>Cadence:</span>
          <span className={styles.dossierBold}>
            {target.daysSinceLastOrder} days since last order
          </span>
        </div>
        <div className={styles.dossierItem}>
          <span>History:</span>
          <span>
            {target.paidOrders} orders (${(target.lifetimeCents / 100).toFixed(0)} LTV)
          </span>
        </div>
      </div>

      {/* Restored In-Progress Draft Banner */}
      {restoredDraft && (
        <div
          style={{
            background: "rgba(247, 183, 51, 0.12)",
            border: "1px solid rgba(247, 183, 51, 0.4)",
            borderRadius: 8,
            padding: "6px 12px",
            fontSize: 11.5,
            color: "#fcecd7",
            margin: "0 16px 12px 16px",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
          data-testid="restored-draft-banner"
        >
          <span>✨</span>
          <span>Restored unfinished letter draft from your previous session.</span>
        </div>
      )}

      {/* Collaborative Approach Selector (How should we phrase this?) */}
      <section className={styles.approachSelectorSection}>
        <div className={styles.sectionHeader}>
          <span>✨</span>
          <span>Collaborative Approach: Choose Wording Style</span>
        </div>
        <div className={styles.approachGrid} role="radiogroup" aria-label="Outreach Tone Approaches">
          {(["warm_brief", "helpful_detailed", "cozy_care_perk", "custom"] as LetterApproachId[]).map(
            (approachId) => {
              const opt = LETTER_APPROACHES[approachId];
              const isSelected = selectedApproach === approachId;
              return (
                <button
                  key={approachId}
                  type="button"
                  className={`${styles.approachCard} ${
                    isSelected ? styles.approachCardSelected : ""
                  }`}
                  onClick={() => handleSelectApproach(approachId)}
                  disabled={isActionCommitted}
                  role="radio"
                  aria-checked={isSelected}
                  data-testid={`approach-${approachId}`}
                >
                  <div className={styles.approachTitle}>
                    <span>{opt.icon}</span>
                    <span>{opt.label}</span>
                  </div>
                  <div className={styles.approachDesc}>{opt.summary}</div>
                </button>
              );
            }
          )}
        </div>
      </section>

      {/* The Physical Stationery Letter Paper */}
      <section className={styles.letterPaperContainer}>
        <div className={styles.parchmentLetter}>
          {/* Parchment Letter Header */}
          <div className={styles.parchmentHeader}>
            <div className={styles.recipientAddressBlock}>
              <h3 className={styles.recipientName}>{target.displayName}</h3>
              <div className={styles.recipientSub}>
                {target.address || `${target.territoryName}, Los Angeles, CA`} ·{" "}
                {target.phone ?? "No phone on record"}
              </div>
            </div>

            <div className={styles.stampAndSeal}>
              <div className={styles.postalStamp}>
                <div>Silver Lake</div>
                <div>Postal Service</div>
              </div>
              <div className={styles.waxSeal} title="Sealed with Care">
                🏮
              </div>
            </div>
          </div>

          {/* Real-time Ink Handwritten Body */}
          <textarea
            className={styles.inkTextArea}
            value={message}
            onChange={(e) => {
              const val = e.target.value;
              setMessage(val);
              setSelectedApproach("custom");
              if (val !== approvedBody) {
                setApprovedBody(null);
              }
              onSaveUnfinishedDraft?.({
                customerId: target.customerId,
                customerName: target.displayName,
                villagerVariant: target.villagerVariant,
                letterApproach: "custom",
                draftBody: val,
              });
            }}
            placeholder="Write your outreach letter with your villager companion..."
            disabled={isActionCommitted}
            rows={4}
            data-testid="cozy-message-draft-textarea"
          />

          {/* Letter Metadata & Consent Bar */}
          <div className={styles.letterMetaRow}>
            <span>{message.length} / 500 characters</span>
            <span className={styles.consentBadge}>
              {target.consentStatus === "verified_opt_in" ? (
                <span style={{ color: "#2d8a4e" }}>✓ Verified Opt-In Consent</span>
              ) : target.consentStatus === "existing_customer_relationship" ? (
                <span style={{ color: "#2563eb" }}>ℹ Eligible Prior Customer</span>
              ) : target.consentStatus === "missing_phone" ? (
                <span style={{ color: "#c2410c" }}>⚠ Missing Phone Number</span>
              ) : (
                <span style={{ color: "#c2410c" }}>⚠ {target.consentReason ?? "Opted Out"}</span>
              )}
            </span>
          </div>
        </div>
      </section>

      {/* Physical Dispatch & Scheduling Shelf: each time card schedules the letter for that exact time */}
      <section className={styles.dispatchShelfSection}>
        <div className={styles.sectionHeader}>
          <span>⏰</span>
          <span>Schedule it — tap a time</span>
        </div>
        <div className={styles.dispatchCards}>
          {([
            { slot: "morning" as const, icon: "🌅", time: nextPacificSlot(10, 0) },
            { slot: "afternoon" as const, icon: "☀️", time: nextPacificSlot(14, 0) },
          ]).map(({ slot, icon, time }) => (
            <button
              key={slot}
              type="button"
              className={`${styles.dispatchCard} ${styles.dispatchCardCta} ${
                selectedScheduleSlot === slot ? styles.dispatchCardActive : ""
              }`}
              onClick={() => {
                setSelectedScheduleSlot(slot);
                void handleCommitSchedule(time.value);
              }}
              disabled={!canSend}
              aria-label={`Schedule for ${time.label}`}
              data-testid={`schedule-slot-${slot}`}
            >
              <div className={styles.dispatchCardTime}>
                {icon} {time.dayWord} {time.label.split(" · ")[1]}
              </div>
              <div className={styles.dispatchCardLabel}>{time.label.split(" · ")[0]} · tap to schedule</div>
            </button>
          ))}

          {/* Custom Window */}
          <button
            type="button"
            className={`${styles.dispatchCard} ${
              selectedScheduleSlot === "custom" ? styles.dispatchCardActive : ""
            }`}
            onClick={() => setSelectedScheduleSlot("custom")}
            disabled={isActionCommitted}
            data-testid="schedule-slot-custom"
          >
            <div className={styles.dispatchCardTime}>📅 Custom Time</div>
            <div className={styles.dispatchCardLabel}>Choose Exact Hour</div>
          </button>
        </div>

        {selectedScheduleSlot === "custom" && !isActionCommitted && (
          <div className={styles.customTimePicker}>
            <input
              type="datetime-local"
              className={styles.customDateTimeInput}
              value={scheduleDateTime}
              onChange={(e) => setScheduleDateTime(e.target.value)}
              data-testid="custom-datetime-input"
            />
            <button
              type="button"
              className={styles.scheduleCommitButton}
              onClick={() => void handleCommitSchedule(scheduleDateTime)}
              disabled={!canSend || !scheduleDateTime}
              data-testid="custom-schedule-button"
            >
              ✓ Schedule for {describePacificWallTime(scheduleDateTime)}
            </button>
          </div>
        )}
      </section>

      {/* Realistic Outreach State Feedback Banners */}
      {textApproved ? (
        <div
          className={styles.handoffNote}
          data-sms-approval="current"
          style={{ margin: "0 20px 8px 20px", fontSize: 12, color: "#15803d", fontWeight: 600 }}
        >
          Approved for this text, revision {approvalRevision}. Opening SMS does not send it.
        </div>
      ) : approvedBody ? (
        <div
          className={styles.handoffNote}
          data-sms-approval="stale"
          style={{ margin: "0 20px 8px 20px", fontSize: 12, color: "#b45309", fontWeight: 600 }}
        >
          This edit is not covered by the earlier approval. Approve the new text before opening SMS.
        </div>
      ) : null}

      {scheduledWhen && (isScheduled || isAwaitingSender) && (
        <div className={`${styles.stateBanner} ${styles.stateBannerConfirmed}`} data-testid="banner-scheduled" role="status">
          <span className={styles.confirmedCheck}>✓</span>
          <div>
            <strong>Scheduled for {scheduledWhen}</strong>
            <div>Scheduled — not sent. At that time it will be waiting for you to send from your own phone.</div>
          </div>
        </div>
      )}

      {isScheduled && !scheduledWhen && (
        <div className={`${styles.stateBanner} ${styles.stateBannerScheduled}`} data-testid="banner-scheduled">
          <span>⏰</span>
          <div>
            <strong>Scheduled — not sent</strong>
            <div>A scheduled letter is not a sent message.</div>
          </div>
        </div>
      )}

      {isAwaitingSender && !scheduledWhen && (
        <div className={`${styles.stateBanner} ${styles.stateBannerAwaiting}`} data-testid="banner-awaiting-sender">
          <span>📱</span>
          <div>
            <strong>Saved for your phone. Not sent.</strong>
            <div>Draft is waiting for you to send it from your own handset. Opening Messages is not a carrier delivery.</div>
          </div>
        </div>
      )}

      {isDispatched && (
        <div className={`${styles.stateBanner} ${styles.stateBannerObserved}`} data-testid="banner-dispatched">
          <span>✓</span>
          <div>
            <strong>Send Observed</strong>
            <div>Carrier reference recorded. Delivery, reply, and customer reorder are separate verified milestones.</div>
          </div>
        </div>
      )}

      {isFailed && (
        <div className={`${styles.stateBanner} ${styles.stateBannerFailed}`} data-testid="banner-failed">
          <span>⚠</span>
          <div>
            <strong>Failed — not sent</strong>
            <div>Outbox recorded a delivery failure. You can refine the wording and try again.</div>
          </div>
        </div>
      )}

      {isConsentBlocked && (
        <div className={`${styles.stateBanner} ${styles.stateBannerBlocked}`} data-testid="banner-consent-blocked">
          <span>🚫</span>
          <div>
            <strong>Outreach Consent Blocked</strong>
            <div>{target.consentReason ?? "Customer has not provided SMS outreach consent."} Communication rails are locked closed.</div>
          </div>
        </div>
      )}

      {/* SMS Handoff Reveal Panel */}
      {handoffReveal && (
        <div
          style={{
            margin: "0 20px 12px 20px",
            background: "#fffdf8",
            border: "1.5px solid #d29d4c",
            borderRadius: 10,
            padding: 12,
            fontSize: 12,
            color: "#3b2c1d",
          }}
          className={styles.handoffPanel}
          data-sms-handoff-state={handoffReveal.state}
          data-body-prefill-claimed={handoffReveal.bodyPrefillClaimed ? "true" : "false"}
          data-villager-pose={handoffReveal.pose}
          data-verified-sent="false"
          data-testid="handoff-panel"
        >
          <div style={{ fontWeight: 800, color: "#925816", marginBottom: 4 }}>
            📱 Google Messages Personal Handoff
          </div>
          <p style={{ margin: "0 0 8px 0" }}>
            The letter is prepared for your personal device. Tap below to launch your messaging app:
          </p>
          {handoffReveal.kind === "desktop_continuation" && handoffReveal.continuationHref ? (
            <>
              <p>{handoffReveal.continuationLabel}</p>
              <a href={handoffReveal.continuationHref}>{handoffReveal.continuationHref}</a>
            </>
          ) : null}
          {handoffReveal.kind === "copy_fallback" && handoffReveal.copyBody ? (
            <div style={{ marginBottom: 8 }}>
              <p style={{ margin: "0 0 4px 0", fontSize: 11, opacity: 0.9 }}>{handoffReveal.copyLabel}</p>
              <textarea
                readOnly
                value={handoffReveal.copyBody}
                rows={3}
                data-sms-copy-fallback=""
                style={{
                  width: "100%",
                  padding: 8,
                  fontSize: 12,
                  fontFamily: "inherit",
                  border: "1px solid #d29d4c",
                  borderRadius: 6,
                  background: "#fff",
                }}
              />
            </div>
          ) : null}
          {handoffReveal.kind === "missing_body" ? <p>{handoffReveal.copyLabel}</p> : null}
          {handoffReveal.uri && (
            <a
              href={handoffReveal.uri}
              data-sms-open={handoffReveal.messagesPackage ? "google-messages" : "sms"}
              data-messages-package={handoffReveal.messagesPackage ?? ""}
              style={{
                display: "inline-block",
                background: "#2563eb",
                color: "#fff",
                fontWeight: 700,
                padding: "6px 12px",
                borderRadius: 6,
                textDecoration: "none",
                marginBottom: 8,
              }}
              data-testid="open-sms-link"
            >
              {handoffReveal.bodyPrefillClaimed
                ? "Open SMS with this message"
                : "Open Google Messages on this phone"}
            </a>
          )}
          {handoffReveal.state === "compose_opened" && (
            <div>
              <button
                type="button"
                onClick={() => void handleReportSent()}
                style={{
                  background: "#e5e7eb",
                  border: "1px solid #9ca3af",
                  borderRadius: 6,
                  padding: "4px 10px",
                  fontSize: 11,
                  cursor: "pointer",
                }}
                data-testid="report-sent-button"
              >
                I sent this from my phone
              </button>
            </div>
          )}
        </div>
      )}

      {handoffError && (
        <div style={{ color: "#dc2626", fontSize: 12, marginTop: 4, padding: "4px 8px", background: "#fef2f2", borderRadius: 4 }}>
          {handoffError}
        </div>
      )}

      {/* Action Buttons */}
      <div className={styles.actionRow}>
        <button
          type="button"
          className={styles.talkButton}
          onClick={handleTalkToText}
          disabled={isActionCommitted || isSending}
          title="Dictate message using voice"
          data-testid="talk-to-text-button"
        >
          <span>🎤</span>
          <span>{isListening ? "Listening..." : "Talk to Text"}</span>
        </button>

        <button
          type="button"
          className={styles.scheduleCommitButton}
          onClick={handleApproveText}
          disabled={!message.trim() || isActionCommitted}
          data-testid="approve-text-button"
        >
          APPROVE
        </button>

        <button
          type="button"
          className={styles.scheduleCommitButton}
          onClick={() => void handleOpenSms()}
          disabled={!textApproved || !target.phone || !target.hasConsent || isSending}
          data-testid="open-in-sms-button"
        >
          OPEN IN SMS
        </button>

        <button
          type="button"
          className={styles.sendNowSecondary}
          onClick={handleSendNow}
          disabled={!canSend}
          data-testid="send-now-button"
        >
          {isSending ? (
            "Sending..."
          ) : isActionCommitted ? (
            "✓ COMMITTED"
          ) : (
            <>
              <span>✈</span> Send now instead
            </>
          )}
        </button>
      </div>

      {/* Footer Navigation */}
      <footer className={styles.footerPagination}>
        <button
          type="button"
          className={styles.pageButton}
          disabled={targetIndex <= 0}
          onClick={() => onSelectIndex(targetIndex - 1)}
          data-testid="prev-customer-button"
        >
          ◀ Prev
        </button>
        <span data-testid="customer-index-indicator">
          Customer {targetIndex + 1} of {totalTargets} ({target.displayName})
        </span>
        <button
          type="button"
          className={styles.pageButton}
          disabled={targetIndex >= totalTargets - 1}
          onClick={() => onSelectIndex(targetIndex + 1)}
          data-testid="next-customer-button"
        >
          Next ▶
        </button>
      </footer>
    </aside>
  );
}
