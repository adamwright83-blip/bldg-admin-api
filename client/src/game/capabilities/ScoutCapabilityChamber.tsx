import { LockKeyhole, Radar, Sparkles } from "lucide-react";
import type { CapabilityEvaluation } from "../../../../shared/expansionScout";

export function ScoutCapabilityChamber(props: {
  evaluation: CapabilityEvaluation | null;
  isEvaluating: boolean;
  onEvaluate: () => Promise<void>;
  onOpenScout: () => void;
}) {
  const evaluation = props.evaluation;
  return (
    <section
      className={`scout-capability-chamber${evaluation?.unlocked ? " is-unlocked" : ""}`}
    >
      <header>
        {evaluation?.unlocked ? <Radar /> : <LockKeyhole />}
        <span>
          <small>REAL BUSINESS CAPABILITY</small>
          <b>EXPANSION SCOUT</b>
        </span>
      </header>
      {!evaluation ? (
        <button
          disabled={props.isEvaluating}
          onClick={() => void props.onEvaluate()}
        >
          CHECK VERIFIED WIN EVIDENCE
        </button>
      ) : evaluation.unlocked ? (
        <>
          <p>
            <Sparkles /> Verified account evidence supports a sourced lookalike
            search.
          </p>
          <button onClick={props.onOpenScout}>ENTER SCOUT CHAMBER</button>
        </>
      ) : (
        <>
          <strong>SCOUT NOT READY</strong>
          <ul>
            {evaluation.reasons.map(reason => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <button
            disabled={props.isEvaluating}
            onClick={() => void props.onEvaluate()}
          >
            REEVALUATE BUSINESS EVIDENCE
          </button>
        </>
      )}
    </section>
  );
}
