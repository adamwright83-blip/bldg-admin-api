import type { SourceRef } from "@shared/firstTenMinutesFindings";
import styles from "./firstTen.module.css";

const PROVIDER_NAME: Record<SourceRef["provider"], string> = {
  gmail: "Gmail",
  calendar: "Google Calendar",
  drive: "Google Drive",
  slack: "Slack",
};

export function sourceDate(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

/** Where a finding came from, on tap: who, when, the exact words, and a way to open it there. */
export function SourceNote({ sources, onClose }: { sources: SourceRef[]; onClose?: () => void }) {
  return (
    <div className={styles.sourceNote} role="note" data-testid="first-ten-source">
      {sources.map(source => (
        <div key={`${source.provider}:${source.ref}`} className={styles.sourceItem}>
          <p className={styles.sourceLabel}>
            {source.label}
            {source.at ? <span> · {sourceDate(source.at)}</span> : null}
          </p>
          <blockquote>“{source.excerpt}”</blockquote>
          {source.url ? (
            <a href={source.url} target="_blank" rel="noreferrer noopener">
              Open in {PROVIDER_NAME[source.provider]}
            </a>
          ) : null}
        </div>
      ))}
      {onClose ? (
        <button type="button" className={styles.sourceClose} onClick={onClose}>
          Close
        </button>
      ) : null}
    </div>
  );
}
