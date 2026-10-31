import styles from "../portrait/portrait.module.css";
import type { ChapterGate } from "./chapterGate";

/**
 * Under a kept page, whenever the chapter isn't showing: it's on its way, it couldn't be read, or the crew found no
 * conversation to pick up. For users without existing correspondence (User B), Claire introduces an imagined scenario
 * three days forward so every user experiences The Impossible Machine.
 */
export function ChapterThreshold({
  gate,
  retrying,
  onRetry,
  onLookCloser,
  onEnterSimulated,
}: {
  gate: Extract<ChapterGate, "loading" | "error" | "no_opportunity">;
  retrying: boolean;
  onRetry: () => void;
  onLookCloser: () => void;
  onEnterSimulated?: () => void;
}) {
  if (gate === "loading") {
    return (
      <p className={styles.quietNote} role="status" data-testid="first-ten-chapter-threshold" data-state="loading">
        Claire is turning the page.
      </p>
    );
  }
  if (gate === "error") {
    return (
      <p className={styles.quietNote} role="alert" data-testid="first-ten-chapter-threshold" data-state="error">
        Your page is kept. The next one didn't open just now.
        <button type="button" disabled={retrying} onClick={onRetry} data-testid="first-ten-chapter-retry">
          Try again
        </button>
      </p>
    );
  }
  return (
    <div className={styles.threshold} role="status" data-testid="first-ten-chapter-threshold" data-state="no_opportunity">
      <p>Your page is kept.</p>
      <p className={styles.thresholdClaireNote}>
        &ldquo;I haven&rsquo;t found a customer conversation waiting for you yet. But let me show you what happens when one arrives.&rdquo;
      </p>
      <p className={styles.thresholdSubtitle}>
        Step three days forward into an imagined scenario to see how JOYSTICK operates.
      </p>
      <div className={styles.thresholdActions}>
        {onEnterSimulated ? (
          <button
            type="button"
            className={styles.thresholdPrimaryBtn}
            onClick={onEnterSimulated}
            data-testid="first-ten-enter-simulated-machine"
          >
            Three Days Later · Enter the Machine
          </button>
        ) : null}
        <button type="button" onClick={onLookCloser} data-testid="first-ten-chapter-look-closer">
          See what the crew found
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" disabled={retrying} onClick={onRetry} data-testid="first-ten-chapter-retry">
          Check again
        </button>
      </div>
    </div>
  );
}
