import { useState } from "react";
import type { FindingView } from "@shared/firstTenMinutesFindings";
import { findingLine } from "../FindingsSheet";
import { SourceNote } from "../SourceNote";
import styles from "./crew.module.css";

/**
 * Where something came from, and the person's say over it: "It changed" keeps their words with it; "That's not right"
 * takes it off the desk. Either way it is never shown as true again.
 */
export function FindingNote({
  findings,
  onClose,
  onCorrect,
}: {
  findings: FindingView[];
  onClose: () => void;
  onCorrect: (finding: FindingView, answer: "change" | "dismiss", correction?: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(finding: FindingView, answer: "change" | "dismiss") {
    setBusy(true);
    try {
      await onCorrect(finding, answer, text.trim() || undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.noteScrim} role="dialog" aria-modal="true" aria-label="Where this came from" onClick={onClose}>
      <div className={styles.noteStack} onClick={event => event.stopPropagation()} data-testid="first-ten-finding-note">
        {findings.map(finding => (
          <div key={finding.id} className={styles.noteBlock} data-finding={finding.payload.kind}>
            {findings.length > 1 ? <p className={styles.noteTitle}>{findingLine(finding.payload)}</p> : null}
            <SourceNote sources={finding.sources} />
            {finding.status === "changed" || finding.status === "dismissed" ? (
              <p className={styles.noteDone}>{finding.correction ? `You said: “${finding.correction}”` : "You said this isn't right."}</p>
            ) : editing === finding.id ? (
              <div className={styles.noteEdit}>
                <label>
                  What's off? <small>(optional)</small>
                  <textarea value={text} maxLength={500} onChange={event => setText(event.target.value)} autoFocus />
                </label>
                <div className={styles.noteActions}>
                  <button type="button" disabled={busy} onClick={() => void send(finding, "change")}>
                    It changed
                  </button>
                  <button type="button" disabled={busy} onClick={() => void send(finding, "dismiss")}>
                    That's not right
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className={styles.noteCorrect}
                onClick={() => {
                  setEditing(finding.id);
                  setText("");
                }}
              >
                Not quite right?
              </button>
            )}
          </div>
        ))}
        <button type="button" className={styles.noteClose} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
