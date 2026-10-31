import type { FindingPayload, FindingView } from "@shared/firstTenMinutesFindings";
import { sourceDate } from "./SourceNote";
import { Settle } from "./OpeningScenes";
import styles from "./firstTen.module.css";
import { FINDING_ORDER as ORDER, findingLine } from "@shared/firstTenMinutesFindingLines";

/** One plain line for a finding. Nothing here adds to what the finding and its sources already say. */
export { findingLine };

/** Everything the crew found, each with where it came from. */
export function FindingsSheet({ findings, onClose }: { findings: FindingView[]; onClose: () => void }) {
  const sorted = [...findings].sort((a, b) => ORDER.indexOf(a.payload.kind) - ORDER.indexOf(b.payload.kind));
  return (
    <div className={styles.scrim} role="dialog" aria-modal="true" aria-label="What your crew found" onClick={onClose}>
      <Settle tilt={0.3}>
        <article className={styles.includes} onClick={event => event.stopPropagation()} data-testid="first-ten-findings">
          <h2>What your crew found</h2>
          {sorted.length === 0 ? <p>Nothing they could stand behind yet.</p> : null}
          <ul className={styles.findingList}>
            {sorted.map(finding => (
              <li key={finding.id} data-kind={finding.payload.kind}>
                <p>{findingLine(finding.payload)}</p>
                {finding.sources.slice(0, 3).map(source => (
                  <small key={`${source.provider}:${source.ref}`}>
                    {source.label}
                    {source.at ? `, ${sourceDate(source.at)}` : ""}: “{source.excerpt}”
                  </small>
                ))}
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <button type="button" className={styles.inkLink} onClick={onClose} autoFocus>
              Close
            </button>
          </div>
        </article>
      </Settle>
    </div>
  );
}
