import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { FictionMissionInstance } from "./fictionDirector";
import { shouldAdvanceTimer, shouldPauseTimer } from "./timerSafety";
import { tuneChallenge, type ChallengeDepth } from "./challengeDirector";

/**
 * The fiction mission bottom rail — same `.encounter` visual language as
 * Gatekeeper/Ghost/Staller (client/src/game/goldline-game.css), never a
 * full-screen SaaS panel. The world stays visible behind it (this panel is
 * absolutely positioned over the bottom of the viewport, not a route
 * change), matching Slice 59's physical encounter staging.
 *
 * This component renders FICTION and drives a FICTIONAL timer only. It has
 * no prop through which it could report a business outcome — resolution is
 * always driven by the caller's own authoritative evidence, passed in as
 * `authoritativeCount`, never written from here.
 */
export type FictionMissionPanelProps = {
  instance: FictionMissionInstance;
  challengeDepth: ChallengeDepth;
  /** True only from a real "currently driving" signal — see timerSafety.ts. */
  isDriving: boolean;
  /** Real, currently-evidenced count from the authoritative action services — never inferred here. */
  authoritativeCount: number;
  onClose: () => void;
};

export default function FictionMissionPanel(props: FictionMissionPanelProps) {
  const { template } = props.instance;
  const grammar = props.instance.grammar;
  const tuning = tuneChallenge({ depth: props.challengeDepth });
  const [remainingSeconds, setRemainingSeconds] = useState(tuning.timerSeconds);
  const [fictionalOutcome, setFictionalOutcome] = useState<
    "in_progress" | "success" | "failure"
  >("in_progress");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const complete = props.authoritativeCount >= grammar.count && grammar.count > 0;

  useEffect(() => {
    if (complete && fictionalOutcome === "in_progress") {
      setFictionalOutcome("success");
    }
  }, [complete, fictionalOutcome]);

  useEffect(() => {
    if (fictionalOutcome !== "in_progress") return;
    if (!shouldAdvanceTimer(template, { isDriving: props.isDriving })) return;
    intervalRef.current = setInterval(() => {
      setRemainingSeconds(current => {
        if (current <= 1) {
          setFictionalOutcome(prevOutcome =>
            prevOutcome === "in_progress" ? "failure" : prevOutcome
          );
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, props.isDriving, fictionalOutcome]);

  const paused = shouldPauseTimer(template, { isDriving: props.isDriving });
  const timerActive = template.timerEligible && fictionalOutcome === "in_progress";

  return (
    <section
      className="encounter fiction-mission-panel"
      aria-label={`Fiction mission: ${template.title}`}
      data-fiction-template-id={template.id}
      data-fiction-outcome={fictionalOutcome}
      data-authoritative-count={props.authoritativeCount}
      data-required-count={grammar.count}
    >
      <button className="encounter-close" onClick={props.onClose} aria-label="Close">
        <X />
      </button>
      <header>
        <small>FICTION MISSION</small>
        <b>{template.title}</b>
        <em>{template.briefing(grammar)}</em>
      </header>

      <p className="fiction-physical-instruction">{template.physicalInstruction(grammar)}</p>
      <p className="fiction-stakes">{template.stakes}</p>

      {timerActive ? (
        <div
          className="fiction-timer"
          data-timer-paused={paused}
          aria-label="Containment clock"
        >
          {paused
            ? "PAUSED — SAFETY"
            : `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")}`}
        </div>
      ) : null}

      <div className="fiction-progress" aria-label="Real coverage progress">
        {props.authoritativeCount} / {grammar.count} COVERED
      </div>

      {fictionalOutcome === "success" ? (
        <div className="encounter-feedback fiction-success">
          <b>{template.successTreatment.headline}</b>
          <span>{template.successTreatment.detail}</span>
        </div>
      ) : null}
      {fictionalOutcome === "failure" ? (
        <div className="encounter-feedback fiction-failure">
          <b>{template.failureTreatment.headline}</b>
          <span>{template.failureTreatment.detail}</span>
        </div>
      ) : null}
    </section>
  );
}
