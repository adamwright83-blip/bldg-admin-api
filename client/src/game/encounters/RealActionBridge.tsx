import { useState } from "react";
import { Loader2, Phone, X } from "lucide-react";

export type RealCallOutcome =
  | "no_answer"
  | "left_voicemail"
  | "spoke"
  | "visit_booked"
  | "not_a_fit"
  | "contact_unavailable";

export type RealActionRequest = {
  missionId: number;
  requestId: string;
  kind: "CALL_ATTEMPT";
  outcome: RealCallOutcome;
  notes: string;
};

export function RealActionBridge(props: {
  missionName: string;
  missionId: number;
  phoneUrl: string | null;
  onPersist: (request: RealActionRequest) => Promise<void>;
  onPersisted: (requestId: string) => void;
  onClose: () => void;
}) {
  const [outcome, setOutcome] = useState<RealCallOutcome>("no_answer");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function persist() {
    if (!notes.trim() || saving) return;
    const requestId = crypto.randomUUID();
    setSaving(true);
    setError(null);
    try {
      await props.onPersist({
        missionId: props.missionId,
        requestId,
        kind: "CALL_ATTEMPT",
        outcome,
        notes: notes.trim(),
      });
      props.onPersisted(requestId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The real action could not be saved."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="real-action-bridge" aria-label="Real business action">
      <header>
        <span>
          <small>REAL ACTION · AUTHORITATIVE</small>
          <b>{props.missionName}</b>
        </span>
        <button onClick={props.onClose} aria-label="Close real action">
          <X />
        </button>
      </header>
      <div className="real-action-bridge__body">
        {props.phoneUrl ? (
          <a className="real-action-bridge__call" href={props.phoneUrl}>
            <Phone /> START PHONE CALL
          </a>
        ) : (
          <p className="real-action-bridge__unavailable">
            No callable contact is present in authoritative mission data.
          </p>
        )}
        <label>
          WHAT ACTUALLY HAPPENED
          <select
            value={outcome}
            onChange={event =>
              setOutcome(event.target.value as RealCallOutcome)
            }
          >
            <option value="no_answer">No answer</option>
            <option value="left_voicemail">Left voicemail</option>
            <option value="spoke">Spoke</option>
            <option value="visit_booked">Visit booked</option>
            <option value="not_a_fit">Not a fit</option>
            <option value="contact_unavailable">Contact unavailable</option>
          </select>
        </label>
        <label>
          NOTES
          <textarea
            value={notes}
            onChange={event => setNotes(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Record reality; gameplay never supplies this outcome."
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button
          className="real-action-bridge__save"
          disabled={saving || !notes.trim()}
          onClick={() => void persist()}
        >
          {saving ? (
            <>
              <Loader2 /> SAVING AUTHORITATIVE ACTION…
            </>
          ) : (
            "SAVE REAL OUTCOME"
          )}
        </button>
      </div>
    </section>
  );
}
