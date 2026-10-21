import { useEffect, useMemo, useState } from "react";
import type { CozyProjectedTarget } from "@shared/cozyVillagerEvidence";
import styles from "./silver-lake-discovery.module.css";

/**
 * Claire's discovery is played ON TOP of the real, running Silver Lake courtyard.
 * No mock village, invented revenue number, SMS read, or customer dialogue.
 * The selected neighbour hands off to the real authored reunion quest.
 *
 * The synthetic-preview flag comes from the already isolated Silver Lake hook.
 * This component only reads approved projection fields and never makes writes.
 */
export type DiscoveryPreludeProps = {
  targets: readonly CozyProjectedTarget[];
  synthetic: boolean;
  loading: boolean;
  loadFailed: boolean;
  withheldReason?: string | null;
  focusMissing: boolean;
  onSelect: (target: CozyProjectedTarget) => void;
  onClose: () => void;
};

type Beat = "invitation" | "lanterns";

function readableNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function discoveryEvidence(targets: readonly CozyProjectedTarget[]) {
  // These are eligible, server-projected neighbours, NOT the complete customer base.
  const known = targets.filter(t =>
    t.customerId && Number.isFinite(t.daysSinceLastOrder) && t.daysSinceLastOrder >= 0
  );
  return {
    count: known.length,
    candidates: known.slice(0, 3),
    oldestDays: known.length ? Math.max(...known.map(t => t.daysSinceLastOrder)) : null,
  };
}

export default function SilverLakeDiscoveryPrelude({
  targets,
  synthetic,
  loading,
  loadFailed,
  withheldReason,
  focusMissing,
  onSelect,
  onClose,
}: DiscoveryPreludeProps) {
  const [beat, setBeat] = useState<Beat>("invitation");
  const evidence = useMemo(() => discoveryEvidence(targets), [targets]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const unreadable = loadFailed || Boolean(withheldReason);
  const empty = !loading && evidence.count === 0;

  return (
    <section
      className={styles.screen}
      aria-label="Claire's Silver Lake discovery"
      data-testid="silver-lake-discovery"
      data-beat={beat}
      data-evidence={synthetic ? "synthetic" : unreadable ? "unavailable" : "projected"}
    >
      <div className={styles.spotlight} aria-hidden="true" />
      <div className={styles.topLine}>
        <span className={styles.chapter}>LANTERN CITY <span aria-hidden="true">/</span> THE QUIET STREETS</span>
        <button type="button" onClick={onClose} className={styles.leave} data-testid="discovery-skip">
          Explore the village <span aria-hidden="true">↗</span>
        </button>
      </div>

      <div className={styles.letter} role="group" aria-label="A note from Claire">
        <div className={styles.fold} aria-hidden="true" />
        <span className={styles.author}>A NOTE FROM CLAIRE</span>
        {loading ? (
          <>
            <h2>There's something I want to check.</h2>
            <p>Looking for a reliable signal in the neighborhood records…</p>
            <span className={styles.wait} role="status">Reading the evidence</span>
          </>
        ) : unreadable ? (
          <>
            <h2>Not all the lights are visible.</h2>
            <p>{withheldReason ?? "The customer records are unavailable right now."}</p>
            <p>I won't invent who's gone quiet. We can explore until the records are ready.</p>
            <button className={styles.start} type="button" onClick={onClose}>Explore anyway <span aria-hidden="true">↗</span></button>
          </>
        ) : empty ? (
          <>
            <h2>It's a quiet morning.</h2>
            <p>{focusMissing
              ? "This business hasn't chosen Silver Lake as a recovery focus yet."
              : "I don't have a verified reunion list for this neighborhood today."}</p>
            <p>That's not the same as saying no one needs you. Shall we take a look around?</p>
            <button className={styles.start} type="button" onClick={onClose}>Take a walk <span aria-hidden="true">↗</span></button>
          </>
        ) : beat === "invitation" ? (
          <>
            <h2>There you are.</h2>
            <p>I've found <strong>{readableNumber(evidence.count)} {evidence.count === 1 ? "neighbor" : "neighbors"}</strong> in Silver Lake worth reconnecting with.</p>
            <p>One has been away {readableNumber(evidence.oldestDays ?? 0)} days. I can't promise why. But I have an idea.</p>
            <p className={styles.ink}>Let's make the neighborhood feel a little less quiet.</p>
            <button className={styles.start} type="button" onClick={() => setBeat("lanterns")} data-testid="discovery-follow-lights">
              Show me <span aria-hidden="true">→</span>
            </button>
          </>
        ) : (
          <>
            <h2>Follow a light.</h2>
            <p>Three doors, three different stories. Pick one; I'll introduce you to whoever's waiting there.</p>
            <div className={styles.lanterns} aria-label="Choose a house in the actual courtyard">
              {evidence.candidates.map((target, index) => (
                <button
                  className={styles.lantern}
                  type="button"
                  key={target.customerId}
                  onClick={() => onSelect(target)}
                  data-testid="discovery-house"
                  data-customer-id={target.customerId}
                >
                  <span className={styles.lamp} aria-hidden="true">{index + 1}</span>
                  <span>
                    <strong>{target.displayName}</strong>
                    <small>Last order {target.daysSinceLastOrder} days ago</small>
                  </span>
                  <span className={styles.next} aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
            <p className={styles.ink}>We'll find out what happens next together.</p>
          </>
        )}
        {synthetic ? (
          <p className={styles.demo} data-testid="discovery-illustration">Story preview · Illustrative neighbors · Nothing will be sent</p>
        ) : null}
      </div>
      <div className={styles.worldNote} aria-hidden="true">
        <span className={styles.littleStar}>✳</span>
        <span>The village is real gameplay.<br />The people behind each letter are real only when verified.</span>
      </div>
    </section>
  );
}
