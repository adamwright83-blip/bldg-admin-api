/**
 * LOG A SIGNAL — capture in one breath.
 *
 * Voice first, because the operator is walking between buildings with a bag in
 * one hand. Speak → see the proposed structure → SAVE. Three taps at worst, and
 * deliberately not a form: the moment this becomes CRM field-filling it stops
 * being used mid-day, and an unused capture surface is the same as not having
 * one.
 *
 * The structure IS editable, because a proposal that cannot be corrected is
 * just a guess that got written down. But every field is pre-filled, so the
 * common case is confirm-and-go.
 */
import { useEffect, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";
import {
  startBrowserSpeechTranscript,
  type BrowserSpeechSession,
} from "@/lib/browserSpeechRecognition";
import {
  IMPACT_CLASSES,
  impactClassLabel,
  type ImpactClass,
  type ImpactSignalProposal,
  type ProposedImpactSignal,
} from "../../../../shared/impactSignal";

export type LogSignalSheetProps = {
  open: boolean;
  onClose: () => void;
  /** Where the operator is, when the app happens to know. Never invented. */
  entityHint?: { entityType: string; entityLabel: string } | null;
  onPropose: (input: {
    speech: string;
    entityHint?: { entityType: string; entityLabel: string } | null;
  }) => Promise<ImpactSignalProposal>;
  onConfirm: (signals: ProposedImpactSignal[]) => Promise<unknown>;
};

export function LogSignalSheet(props: LogSignalSheetProps) {
  const [speech, setSpeech] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<ProposedImpactSignal[] | null>(null);
  const [unrecognized, setUnrecognized] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const speechRef = useRef<BrowserSpeechSession | null>(null);

  // One cleanup path for every way a capture can end. A live microphone
  // outliving this sheet is both a privacy problem and a battery one.
  useEffect(
    () => () => {
      speechRef.current?.abort();
      speechRef.current = null;
    },
    []
  );

  if (!props.open) return null;

  function reset() {
    speechRef.current?.abort();
    speechRef.current = null;
    setSpeech("");
    setListening(false);
    setRows(null);
    setUnrecognized(null);
    setError(null);
  }

  function close() {
    reset();
    props.onClose();
  }

  function startListening() {
    setError(null);
    const session = startBrowserSpeechTranscript({
      initialText: speech,
      onTranscript: text => setSpeech(text),
    });
    // Null means this browser has no speech recognition at all. Say so and
    // leave the textarea usable rather than showing a dead microphone.
    if (!session) {
      setError("Voice capture is unavailable here. Type it instead.");
      return;
    }
    speechRef.current = session;
    setListening(true);
  }

  function stopListening() {
    speechRef.current?.stop();
    speechRef.current = null;
    setListening(false);
  }

  async function propose() {
    const said = speech.trim();
    if (said.length < 2) return;
    stopListening();
    setBusy(true);
    setError(null);
    try {
      const proposal = await props.onPropose({
        speech: said,
        entityHint: props.entityHint ?? null,
      });
      setRows(proposal.signals);
      setUnrecognized(proposal.unrecognized);
    } catch {
      setError("Could not structure that. Save it as a note instead.");
    } finally {
      setBusy(false);
    }
  }

  const patch = (index: number, next: Partial<ProposedImpactSignal>) =>
    setRows(current =>
      (current ?? []).map((row, i) => (i === index ? { ...row, ...next } : row))
    );

  return (
    <div
      className="log-signal"
      role="dialog"
      aria-modal="true"
      aria-label="Log a field signal"
      data-testid="log-signal-sheet"
    >
      <header className="log-signal__header">
        <span>LOG A SIGNAL</span>
        <button type="button" onClick={close} aria-label="Close">
          <X />
        </button>
      </header>

      {props.entityHint ? (
        <p className="log-signal__where" data-testid="log-signal-where">
          {props.entityHint.entityLabel}
        </p>
      ) : null}

      {rows === null ? (
        <div className="log-signal__capture">
          <button
            type="button"
            className={`log-signal__mic${listening ? " is-listening" : ""}`}
            data-testid="log-signal-mic"
            onClick={listening ? stopListening : startListening}
          >
            {listening ? <Square /> : <Mic />}
            <span>{listening ? "STOP" : "SPEAK"}</span>
          </button>
          <textarea
            rows={4}
            data-testid="log-signal-speech"
            placeholder="I left 35 door hangers at this building."
            value={speech}
            onChange={e => setSpeech(e.target.value)}
          />
          <button
            type="button"
            className="log-signal__primary"
            data-testid="log-signal-structure"
            disabled={busy || speech.trim().length < 2}
            onClick={() => void propose()}
          >
            {busy ? "READING…" : "STRUCTURE IT"}
          </button>
        </div>
      ) : (
        <div className="log-signal__review">
          {/*
            Reported rather than hidden: speech that produced nothing needs to
            come back to the operator, or they will believe it was captured.
          */}
          {unrecognized ? (
            <p className="log-signal__warning" data-testid="log-signal-unrecognized">
              Nothing structured could be read from that. It is not saved.
            </p>
          ) : null}

          <ul className="log-signal__rows">
            {rows.map((row, index) => (
              <li key={index} data-testid="proposed-signal">
                <input
                  aria-label="Signal"
                  data-testid="proposed-signal-label"
                  value={row.label}
                  onChange={e => patch(index, { label: e.target.value })}
                />
                <input
                  aria-label="Value"
                  data-testid="proposed-signal-value"
                  value={row.value}
                  placeholder="Value"
                  onChange={e => patch(index, { value: e.target.value })}
                />
                {/*
                  Editable on purpose, and shown plainly. This is the field that
                  decides whether a day of walking reads as effort or as
                  pipeline, so the operator gets to see and correct it rather
                  than having a model quietly decide.
                */}
                <select
                  aria-label="Impact class"
                  data-testid="proposed-signal-class"
                  value={row.impactClass}
                  onChange={e =>
                    patch(index, { impactClass: e.target.value as ImpactClass })
                  }
                >
                  {IMPACT_CLASSES.map(cls => (
                    <option key={cls} value={cls}>
                      {impactClassLabel(cls)}
                    </option>
                  ))}
                </select>
                {row.startsTracking ? (
                  <em
                    className="log-signal__tracking"
                    data-testid="proposed-signal-tracking"
                  >
                    WILL BE TRACKED FROM NOW ON
                  </em>
                ) : null}
                <button
                  type="button"
                  data-testid="remove-proposed-signal"
                  aria-label={`Remove ${row.label}`}
                  onClick={() =>
                    setRows(current => (current ?? []).filter((_, i) => i !== index))
                  }
                >
                  REMOVE
                </button>
              </li>
            ))}
          </ul>

          <p className="log-signal__provenance" data-testid="log-signal-provenance">
            OPERATOR OBSERVATION
          </p>

          <div className="log-signal__actions">
            <button
              type="button"
              data-testid="log-signal-back"
              onClick={() => {
                setRows(null);
                setUnrecognized(null);
              }}
            >
              BACK
            </button>
            <button
              type="button"
              className="log-signal__primary"
              data-testid="log-signal-save"
              disabled={
                busy ||
                rows.length === 0 ||
                rows.some(r => !r.label.trim())
              }
              onClick={async () => {
                setBusy(true);
                try {
                  await props.onConfirm(rows);
                  close();
                } catch {
                  setError("Could not save that signal.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              SAVE
            </button>
          </div>
        </div>
      )}

      {error ? (
        <p className="log-signal__error" data-testid="log-signal-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
