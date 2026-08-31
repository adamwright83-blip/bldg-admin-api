/**
 * The six signals, rendered AROUND a situation.
 *
 * Never inside a person's card, never as their portrait, never as their label. A
 * signal is attached to a situation id and says what is unresolved about it — the
 * real contact stays a neutral human wherever they appear.
 *
 * Each creature carries its own reason and its own way out, because the point is to
 * make invisible friction legible rather than to decorate the interface. Notably,
 * no `clearedBy` anywhere says "check again": rumination is not a route out.
 */
import {
  SIGNAL_ART,
  SIGNAL_LABEL,
  type PsychSignal,
} from "./psychSignals";

export function PsychSignalLayer({
  signals,
  situationLabel,
  compact = false,
}: {
  signals: readonly PsychSignal[];
  /** What the signals are about — a building, an account, a thread. Not a person. */
  situationLabel: string;
  compact?: boolean;
}) {
  if (!signals.length) return null;
  return (
    <ul
      className={`ps-layer ${compact ? "is-compact" : ""}`}
      aria-label={`What is unresolved about ${situationLabel}`}
    >
      {signals.map(signal => (
        <li
          key={signal.kind}
          className={`ps-signal is-${signal.kind} is-${signal.intensity}`}
        >
          <img
            className="ps-art"
            src={SIGNAL_ART[signal.kind]}
            alt=""
            aria-hidden="true"
            loading="lazy"
          />
          <span className="ps-body">
            <strong className="ps-label">{SIGNAL_LABEL[signal.kind]}</strong>
            <span className="ps-because">{signal.because}</span>
            {compact ? null : (
              <span className="ps-cleared">Clears when: {signal.clearedBy}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
