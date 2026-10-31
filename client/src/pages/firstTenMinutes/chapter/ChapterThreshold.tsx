import type { ReactNode } from "react";
import styles from "../portrait/portrait.module.css";
import type { ChapterGate } from "./chapterGate";

/**
 * Under a kept page, whenever the chapter isn't showing: it's on its way, it couldn't be read, or the crew found no
 * conversation to pick up. Each says what's true and offers something to do. Nothing here names a customer or an
 * opportunity the records don't hold. Signup, when passed, is the existing JOYSTICK offer: a letter is not required.
 * PR #800 adds an optional "Three Days Later" entry on this same screen. Keep that button and this signup together.
 */
export function ChapterThreshold({
  gate,
  retrying,
  onRetry,
  onLookCloser,
  signup,
}: {
  gate: Extract<ChapterGate, "loading" | "error" | "no_opportunity">;
  retrying: boolean;
  onRetry: () => void;
  onLookCloser: () => void;
  /** The existing JOYSTICK offer, once it's known there's no letter to write. */
  signup?: ReactNode;
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
      <p>
        The crew read through what you shared and didn't find a conversation still waiting on you, so there's no letter
        to write today. Claire won't make one up.
      </p>
      <p>You can still keep your crew and open JOYSTICK. Nothing has to be sent.</p>
      <div className={styles.thresholdActions}>
        <button type="button" onClick={onLookCloser} data-testid="first-ten-chapter-look-closer">
          See what the crew found
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" disabled={retrying} onClick={onRetry} data-testid="first-ten-chapter-retry">
          Check again
        </button>
      </div>
      {signup ? <div className={styles.thresholdSignup}>{signup}</div> : null}
    </div>
  );
}
