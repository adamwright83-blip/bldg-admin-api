import { useState } from "react";
import {
  approachesFor,
  type ChapterOpportunity,
  type DraftApproach,
  type DraftView,
} from "@shared/firstTenMinutesChapter";
import type { ActivationView } from "@shared/firstTenMinutesActivation";
import { EXAMPLE_LABEL } from "@shared/firstTenMinutesExample";
import { SourceNote, sourceDate } from "../SourceNote";
import { ActivationCard } from "../chapter/ActivationCard";
import { SendDesk, type SendOutcome } from "../chapter/SendDesk";
import type { CorrespondenceChoice, MachineDialState } from "./machineTypes";
import styles from "./impossibleMachine.module.css";

const APPROACH_LABELS: Record<DraftApproach, string> = {
  still_wanted: "Ask if it's still needed",
  offer_start: "Offer what is genuinely available",
  short: "Keep it brief",
};

interface MachineCorrespondenceProps {
  open: boolean;
  example: boolean;
  dial: MachineDialState;
  opportunity: ChapterOpportunity | null;
  draft: DraftView | null;
  activation: ActivationView | null;
  correspondenceChoice: CorrespondenceChoice;
  centerBridgeRestored: boolean;
  checkoutNotice?: "success" | "cancelled" | null;
  connectNotice?: string | null;
  onToggleDial: () => void;
  onChoose: (choice: "prepare_reply" | "keep_for_later" | "not_for_me") => Promise<void>;
  onChangeDraft: (change: { approach?: DraftApproach; body?: string }) => Promise<void>;
  onBeginActivation?: (identity: {
    businessName: string;
    contactName: string;
    ownerEmail: string;
    timeZone: string;
  }) => Promise<void>;
  onBringYourOwn?: () => void;
  onSendDraft?: (
    approved: { to: string; subject: string; body: string },
    options?: { resendUnconfirmed?: boolean }
  ) => Promise<SendOutcome>;
  onAllowSend?: () => Promise<void>;
  onVerifyDraft?: () => Promise<void>;
  onClose: () => void;
}

/**
 * The center apparatus correspondence inspection & real business action drawer.
 * Integrated directly into the machine without leaving the puzzle for a separate CRM screen.
 *
 * - Shows THEN (customer's genuine request + provenance) vs NOW (business's genuine current offering, if established).
 * - Offers three explicit choices: Prepare a reply, Keep for later, Not for me.
 * - When preparing a reply, provides the sourced approaches ("Ask if it's still needed",
 *   "Offer what is genuinely available" only if service exists, or "Write a personal note")
 *   and reuses the existing ActivationCard + SendDesk flow.
 * - If no qualifying opportunity exists, shows only the honest mechanical gap (never fabricates a customer).
 */
export function MachineCorrespondence({
  open,
  example,
  dial,
  opportunity,
  draft,
  activation,
  correspondenceChoice,
  centerBridgeRestored,
  checkoutNotice = null,
  connectNotice = null,
  onToggleDial,
  onChoose,
  onChangeDraft,
  onBeginActivation,
  onBringYourOwn,
  onSendDraft,
  onAllowSend,
  onVerifyDraft,
  onClose,
}: MachineCorrespondenceProps) {
  const [editing, setEditing] = useState(false);
  const [words, setWords] = useState(draft?.body ?? "");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function runAction(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  // Case: No real opportunity found — do not invent any customer, quote, or service
  if (!opportunity) {
    return (
      <div className={styles.correspondenceDrawer} role="dialog" aria-label="Central crossing apparatus" data-testid="machine-correspondence-empty">
        <div className={styles.correspondenceCardSheet}>
          <div className={styles.correspondenceHeader}>
            <span className={styles.apparatusTag}>CENTRAL COUPLING · UNRESOLVED GAP</span>
            <button
              type="button"
              className={styles.closeApparatusBtn}
              onClick={onClose}
              data-testid="machine-correspondence-close"
            >
              Return to railway
            </button>
          </div>
          <p className={styles.mechanicalGapNote}>
            The central brass bridge is uncoupled. No unfinished correspondence card is wedged in this socket, so the lower NOW railway turntable carries the return route.
          </p>
        </div>
      </div>
    );
  }

  const who = opportunity.firstName ?? opportunity.person.name ?? opportunity.person.address;
  const where = opportunity.place?.category ? ` at the ${opportunity.place.category}` : "";
  const availableApproaches = approachesFor(opportunity);
  const allSources = [
    ...opportunity.request.sources,
    ...(opportunity.reply?.sources ?? []),
    ...(opportunity.service?.sources ?? []),
  ].slice(0, 4);

  const showDraftComposer =
    correspondenceChoice === "prepare_reply" ||
    (draft && draft.status !== "declined");

  return (
    <div
      className={styles.correspondenceDrawer}
      role="dialog"
      aria-label="Central crossing correspondence"
      data-testid="machine-correspondence-panel"
      data-choice={correspondenceChoice ?? "none"}
      data-restored={centerBridgeRestored ? "yes" : "no"}
    >
      <div className={styles.correspondenceCardSheet} data-testid="first-ten-draft" data-status={draft?.status ?? "none"}>
        <div className={styles.correspondenceHeader}>
          <div>
            <p className={styles.boundaryLine} data-testid="first-ten-draft-boundary">
              Your business · {who}
              {where}
            </p>
            {example ? (
              <p className={styles.exampleBanner} data-testid="machine-correspondence-example-banner">
                {EXAMPLE_LABEL}
              </p>
            ) : null}
          </div>
          <div className={styles.headerControls}>
            <button
              type="button"
              className={styles.miniDialSwitch}
              onClick={onToggleDial}
              data-testid="machine-correspondence-dial"
            >
              Dial: <strong>{dial}</strong> (Switch to {dial === "THEN" ? "NOW" : "THEN"})
            </button>
            <button
              type="button"
              className={styles.closeApparatusBtn}
              onClick={onClose}
              data-testid="machine-correspondence-close"
            >
              Back to tracks
            </button>
          </div>
        </div>

        {/* THEN / NOW Comparison Cards */}
        <div className={styles.thenNowGrid}>
          <div
            className={`${styles.evidenceCard} ${dial === "THEN" ? styles.evidenceCardFocused : ""}`}
            data-testid="first-ten-then"
          >
            <span className={styles.evidenceEraBadge}>THEN · THE REQUEST</span>
            <p className={styles.evidenceQuote}>“{opportunity.request.quote}”</p>
            <p className={styles.evidenceMeta}>
              {opportunity.person.name ?? opportunity.person.address} · {sourceDate(opportunity.request.at)}
            </p>
            {opportunity.reply ? (
              <div className={styles.evidenceReplySub}>
                <p className={styles.evidenceQuote}>“{opportunity.reply.quote}”</p>
                <p className={styles.evidenceMeta}>You · {sourceDate(opportunity.reply.at)}</p>
              </div>
            ) : null}
          </div>

          <div
            className={`${styles.evidenceCard} ${dial === "NOW" ? styles.evidenceCardFocused : ""}`}
            data-testid="first-ten-now"
          >
            <span className={styles.evidenceEraBadge}>NOW · CURRENT CAPABILITY</span>
            {opportunity.service ? (
              <>
                <p className={styles.evidenceQuote}>“{opportunity.service.quote}”</p>
                <p className={styles.evidenceMeta}>
                  {opportunity.service.name} · You · {sourceDate(opportunity.service.at)}
                </p>
              </>
            ) : (
              <p className={styles.evidenceUnestablished}>
                No new service is established on record yet — you can simply ask whether this request is still needed.
              </p>
            )}
          </div>
        </div>

        <SourceNote sources={allSources} />

        {/* State F: The three real choices */}
        <div className={styles.choiceButtonRow} data-testid="machine-correspondence-choices">
          <button
            type="button"
            className={`${styles.choiceBtn} ${correspondenceChoice === "prepare_reply" ? styles.choiceBtnActive : ""}`}
            disabled={busy || centerBridgeRestored}
            onClick={() =>
              void runAction(async () => {
                await onChoose("prepare_reply");
              })
            }
            data-testid="machine-choice-prepare"
          >
            Prepare a reply
          </button>
          <button
            type="button"
            className={`${styles.choiceBtn} ${correspondenceChoice === "keep_for_later" ? styles.choiceBtnActive : ""}`}
            disabled={busy || centerBridgeRestored}
            onClick={() =>
              void runAction(async () => {
                await onChoose("keep_for_later");
              })
            }
            data-testid="machine-choice-later"
          >
            Keep for later
          </button>
          <button
            type="button"
            className={`${styles.choiceBtn} ${correspondenceChoice === "not_for_me" ? styles.choiceBtnActive : ""}`}
            disabled={busy || centerBridgeRestored}
            onClick={() =>
              void runAction(async () => {
                await onChoose("not_for_me");
              })
            }
            data-testid="machine-choice-decline"
          >
            Not for me
          </button>
        </div>

        {/* Status feedback for Keep for later or Not for me */}
        {correspondenceChoice === "keep_for_later" && !centerBridgeRestored ? (
          <div className={styles.choiceOutcomeBanner} data-testid="machine-choice-later-note">
            <p>
              Saved for later. Nothing was sent. You can return to the railway and align the <strong>lower NOW rotor</strong> to rescue Rook.
            </p>
          </div>
        ) : null}

        {correspondenceChoice === "not_for_me" && !centerBridgeRestored ? (
          <div className={styles.choiceOutcomeBanner} data-testid="machine-choice-decline-note">
            <p>
              Not now. It stays here, unsent, and the underlying record is preserved. Use the <strong>lower NOW route</strong> to bring the key back to Rook.
            </p>
            {draft ? (
              <button
                type="button"
                className={styles.secondaryActionBtn}
                disabled={busy}
                onClick={() =>
                  void runAction(async () => {
                    await onChangeDraft({});
                    await onChoose("prepare_reply");
                  })
                }
              >
                Bring it back
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Prepare a reply: Real Correspondence Composer & SendDesk */}
        {showDraftComposer && draft ? (
          <div className={styles.composerSection} data-testid="first-ten-message">
            <div className={styles.composerMetaRow}>
              <div>
                <span className={styles.metaLabel}>From</span>{" "}
                <strong data-testid="machine-draft-from">{activation?.sendFrom ?? "Your connected Gmail"}</strong>
              </div>
              <div>
                <span className={styles.metaLabel}>To</span>{" "}
                <strong>{draft.to.name ? `${draft.to.name} <${draft.to.address}>` : draft.to.address}</strong>
              </div>
              <div>
                <span className={styles.metaLabel}>Subject</span> <strong>{draft.subject}</strong>
              </div>
            </div>

            {/* Approach selector buttons */}
            {draft.status === "prepared" && !editing ? (
              <div className={styles.approachTabs} data-testid="machine-approach-tabs">
                {availableApproaches.map(app => (
                  <button
                    key={app}
                    type="button"
                    className={`${styles.approachTab} ${draft.approach === app && !draft.edited ? styles.approachTabActive : ""}`}
                    disabled={busy}
                    onClick={() => void runAction(() => onChangeDraft({ approach: app }))}
                    data-testid={`machine-approach-${app}`}
                  >
                    {APPROACH_LABELS[app]}
                  </button>
                ))}
                <button
                  type="button"
                  className={`${styles.approachTab} ${draft.edited ? styles.approachTabActive : ""}`}
                  disabled={busy}
                  onClick={() => {
                    setWords(draft.body);
                    setEditing(true);
                  }}
                  data-testid="machine-write-personal-note"
                >
                  Write a personal note
                </button>
              </div>
            ) : null}

            {editing ? (
              <div className={styles.personalNoteEditor}>
                <textarea
                  value={words}
                  maxLength={2000}
                  rows={4}
                  onChange={e => setWords(e.target.value)}
                  aria-label="Your message"
                  autoFocus
                />
                <div className={styles.editorBtnGroup}>
                  <button
                    type="button"
                    className={styles.primaryActionBtn}
                    disabled={busy || !words.trim()}
                    onClick={() =>
                      void runAction(async () => {
                        await onChangeDraft({ body: words });
                        setEditing(false);
                      })
                    }
                  >
                    Keep these words
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryActionBtn}
                    disabled={busy}
                    onClick={() => {
                      setWords(draft.body);
                      setEditing(false);
                    }}
                  >
                    Never mind
                  </button>
                </div>
              </div>
            ) : (
              <p className={styles.draftBodyPreview} data-testid="first-ten-message-body">
                {draft.body}
              </p>
            )}

            {/* Compatibility buttons for existing E2E tests ("Edit", "Try another way", "Not now") */}
            {!editing && draft.status === "prepared" ? (
              <div className={styles.composerQuickActions}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setWords(draft.body);
                    setEditing(true);
                  }}
                >
                  Edit
                </button>
                {availableApproaches.length > 1 ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const next =
                        availableApproaches[
                          (availableApproaches.indexOf(draft.approach) + 1) % availableApproaches.length
                        ];
                      void runAction(() => onChangeDraft({ approach: next }));
                    }}
                  >
                    Try another way
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runAction(() => onChoose("not_for_me"))}
                >
                  Not now
                </button>
              </div>
            ) : null}

            {/* Account Activation & In-app Gmail SendDesk */}
            {activation ? (
              <div className={styles.activationAndSendArea}>
                {checkoutNotice === "cancelled" && activation.status !== "active" ? (
                  <p className={styles.checkoutNote} data-testid="first-ten-checkout-cancelled">
                    Checkout closed. Nothing was charged; everything here is saved.
                  </p>
                ) : null}

                {activation.example ||
                (activation.required && activation.status !== "active") ||
                (!activation.required && draft.status === "prepared") ? (
                  activation.status === "checkout_pending" && checkoutNotice === "success" ? (
                    <p className={styles.checkoutNote} data-testid="first-ten-checkout-pending">
                      Your crew is being kept. This takes a moment.
                    </p>
                  ) : onBeginActivation && onBringYourOwn ? (
                    <ActivationCard
                      activation={activation}
                      onBringYourOwn={onBringYourOwn}
                      onContinue={onBeginActivation}
                    />
                  ) : null
                ) : null}

                {!activation.example &&
                !(activation.required && activation.status !== "active") &&
                onSendDraft &&
                onAllowSend &&
                onVerifyDraft ? (
                  <SendDesk
                    draft={draft}
                    activation={activation}
                    onSend={onSendDraft}
                    onAllow={onAllowSend}
                    onVerify={onVerifyDraft}
                    notice={connectNotice}
                  />
                ) : null}
              </div>
            ) : null}

            {centerBridgeRestored ? (
              <div className={styles.bridgeRestoredBanner} data-testid="machine-bridge-restored-banner">
                <strong>Central brass coupling restored!</strong> Set West and East junctions to{" "}
                <strong>CENTER</strong> and wind the crank to bring the key straight back across the middle.
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
