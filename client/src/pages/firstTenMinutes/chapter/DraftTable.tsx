import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { DRAFT_APPROACHES, DRAFT_APPROACH_NAMES, type ChapterOpportunity, type DraftApproach, type DraftView } from "@shared/firstTenMinutesChapter";
import { CREW_ART } from "../crew";
import { sourceDate } from "../SourceNote";
import styles from "./chapter.module.css";

/**
 * The same writing table, now for the person's own business. The boundary is plain, the old request sits beside
 * what they offer now, and the real recipient and the exact message are on view before anything is authorised.
 * No manufactured bad first draft; nothing is sent from here.
 */
export function DraftTable({
  opportunity,
  draft,
  onChange,
  onDecline,
  children,
}: {
  opportunity: ChapterOpportunity;
  draft: DraftView;
  onChange: (change: { approach?: DraftApproach; body?: string }) => Promise<void>;
  onDecline: () => Promise<void>;
  /** what comes after the table: activation and sending, in the next slice */
  children?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const [editing, setEditing] = useState(false);
  const [words, setWords] = useState(draft.body);
  const [busy, setBusy] = useState(false);
  const declined = draft.status === "declined";
  const who = opportunity.firstName ?? opportunity.person.name ?? opportunity.person.address;
  const where = opportunity.place?.category ? ` at the ${opportunity.place.category}` : "";
  const nextApproach = DRAFT_APPROACHES[(DRAFT_APPROACHES.indexOf(draft.approach) + 1) % DRAFT_APPROACHES.length];

  async function act(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.section
      className={styles.table}
      data-testid="first-ten-draft"
      data-status={draft.status}
      initial={reduce ? false : { opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 80, damping: 16 }}
    >
      <p className={styles.boundary} data-testid="first-ten-draft-boundary">
        Your business · {who}
        {where}
      </p>

      <div className={styles.thenNow}>
        <div className={styles.thenCard} data-testid="first-ten-then">
          <p className={styles.thenLabel}>Then</p>
          <p className={styles.noteWords}>“{opportunity.request.quote}”</p>
          <p className={styles.noteWho}>
            {opportunity.person.name ?? opportunity.person.address} · {sourceDate(opportunity.request.at)}
          </p>
          {opportunity.reply ? (
            <>
              <p className={styles.noteWords}>“{opportunity.reply.quote}”</p>
              <p className={styles.noteWho}>You · {sourceDate(opportunity.reply.at)}</p>
            </>
          ) : null}
        </div>
        {opportunity.service ? (
          <div className={styles.nowCard} data-testid="first-ten-now">
            <p className={styles.thenLabel}>Now</p>
            <p className={styles.noteWords}>“{opportunity.service.quote}”</p>
            <p className={styles.noteWho}>You · {sourceDate(opportunity.service.at)}</p>
          </div>
        ) : null}
      </div>

      <div className={`${styles.message} ${declined ? styles.messageDeclined : ""}`} data-testid="first-ten-message">
        <p className={styles.messageHead}>
          <span>To</span> {draft.to.name ? `${draft.to.name} <${draft.to.address}>` : draft.to.address}
        </p>
        <p className={styles.messageHead}>
          <span>Subject</span> {draft.subject}
        </p>
        {editing ? (
          <div className={styles.messageEdit}>
            <textarea value={words} maxLength={2000} rows={4} onChange={event => setWords(event.target.value)} aria-label="Your message" autoFocus />
            <div className={styles.tableActions}>
              <button
                type="button"
                className={styles.tableMain}
                disabled={busy || !words.trim()}
                onClick={() =>
                  void act(async () => {
                    await onChange({ body: words });
                    setEditing(false);
                  })
                }
              >
                Keep these words
              </button>
              <button
                type="button"
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
          <p className={styles.messageBody} data-testid="first-ten-message-body">
            {draft.body}
          </p>
        )}
      </div>

      {!editing && (draft.status === "prepared" || declined) ? (
        <div className={styles.tableActions}>
          {declined ? (
            <>
              <p className={styles.declined}>Not now. It stays here, unsent.</p>
              <button type="button" disabled={busy} onClick={() => void act(() => onChange({}))}>
                Bring it back
              </button>
            </>
          ) : (
            <>
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
              <button type="button" disabled={busy} title={DRAFT_APPROACH_NAMES[nextApproach]} onClick={() => void act(() => onChange({ approach: nextApproach }))}>
                Try another way
              </button>
              <button type="button" disabled={busy} onClick={() => void act(onDecline)}>
                Not now
              </button>
            </>
          )}
        </div>
      ) : null}

      {!declined ? children : null}

      <div className={styles.tableRook} data-crew="rook">
        <p className={styles.say} data-testid="first-ten-table-line">
          <span className={styles.sayName}>Rook</span>
          Short enough to answer.
        </p>
        {CREW_ART.rook ? <img src={CREW_ART.rook.src} alt={CREW_ART.rook.alt} className={styles.rookArt} draggable={false} /> : null}
      </div>
    </motion.section>
  );
}
