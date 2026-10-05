import { useState } from "react";
import { trpc } from "@/lib/trpc";
import type { PresidentFounderDecision } from "@shared/presidentOperatingSystem";
import "./PresidentPage.css";
import PresidentAutonomousReview from "@/components/president/PresidentAutonomousReview";

function Decision({
  decision,
  refresh,
}: {
  decision: PresidentFounderDecision;
  refresh: () => void;
}) {
  const [answer, setAnswer] = useState(
    decision.recommendedOption ?? decision.options[0]
  );
  const [budget, setBudget] = useState(1);
  const objective = trpc.president.answerObjectiveSelection.useMutation({
    onSuccess: refresh,
  });
  const preflight = trpc.president.approvePreflight.useMutation({
    onSuccess: refresh,
  });
  const plan = trpc.president.answerPlanQuestion.useMutation({
    onSuccess: refresh,
  });
  const supported =
    decision.questionKey.startsWith("objective:") ||
    decision.questionKey.endsWith(":preflight") ||
    decision.questionKey.includes(":plan:");
  const error = objective.error ?? preflight.error ?? plan.error;
  const busy = objective.isPending || preflight.isPending || plan.isPending;
  return (
    <article className="president-decision">
      <h3>{decision.question}</h3>
      <p>{decision.reason}</p>
      {supported ? (
        <form
          onSubmit={e => {
            e.preventDefault();
            if (decision.questionKey.startsWith("objective:"))
              objective.mutate({
                decisionId: decision.id,
                answer: answer as
                  | "Authorize this program"
                  | "Not now"
                  | "Stop objective",
                maxProgramUsd: budget,
              });
            else if (decision.questionKey.endsWith(":preflight"))
              preflight.mutate({
                decisionId: decision.id,
                answer: answer as
                  | "Approve bounded program"
                  | "Revise plan"
                  | "Stop program",
              });
            else plan.mutate({ decisionId: decision.id, answer });
          }}
        >
          <label>
            Decision
            <select value={answer} onChange={e => setAnswer(e.target.value)}>
              {decision.options.map(option => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          {decision.questionKey.startsWith("objective:") && (
            <label>
              Program budget ceiling (USD)
              <input
                type="number"
                min="0"
                max="10000"
                step="0.1"
                value={budget}
                onChange={e => setBudget(Number(e.target.value))}
              />
            </label>
          )}
          <button disabled={busy}>
            {busy ? "Saving…" : "Confirm decision"}
          </button>
        </form>
      ) : (
        <p>
          This decision requires a human follow-through; President keeps the
          program blocked until supported evidence is supplied.
        </p>
      )}
      {error && <p role="alert">{error.message}</p>}
    </article>
  );
}

export default function PresidentPage() {
  const [companyFocus, setCompanyFocus] = useState("");
  const state = trpc.president.founderSurface.useQuery(undefined, {
    refetchInterval: 15000,
    retry: false,
  });
  const request = trpc.president.requestObjectiveSelection.useMutation({
    onSuccess: () => void state.refetch(),
  });
  const dispatch = trpc.president.dispatchNext.useMutation({
    onSuccess: () => void state.refetch(),
  });
  const plan = trpc.president.planProgram.useMutation({
    onSuccess: () => void state.refetch(),
  });
  const reasoning = trpc.president.reason.useMutation({
    onSuccess: () => {
      setCompanyFocus("");
      void state.refetch();
    },
  });
  if (state.isLoading)
    return (
      <main className="president-page">
        <p>Reading the durable company state…</p>
      </main>
    );
  if (state.error)
    return (
      <main className="president-page">
        <p className="president-eyebrow">JOYSTICK · Founder office</p>
        <h1>President</h1>
        <p role="alert">{state.error.message}</p>
        <button onClick={() => void state.refetch()}>Try again</button>
      </main>
    );
  if (!state.data) return null;
  const { brief, objectives, thesis, programs, evidence, events, runtime } =
    state.data;
  const mutationError =
    request.error ?? dispatch.error ?? plan.error ?? reasoning.error;
  return (
    <main className="president-page">
      <header>
        <div>
          <p className="president-eyebrow">JOYSTICK · Founder office</p>
          <h1>President</h1>
          <p className="president-lead">{brief.summary}</p>
        </div>
        <button
          className="president-refresh"
          onClick={() => void state.refetch()}
        >
          Refresh brief
        </button>
      </header>
      <div className="president-status">
        <span
          className={
            runtime.executionState === "CONFIGURED"
              ? "president-dot live"
              : "president-dot"
          }
        />
        {runtime.executionState === "CONFIGURED"
          ? "Execution configured"
          : "Execution needs configuration"}
        <span>Updated {new Date(brief.generatedAt).toLocaleString()}</span>
      </div>
      {mutationError && <p role="alert">{mutationError.message}</p>}
      <PresidentAutonomousReview />
      {evidence.length > 0 && (
        <form
          className="president-focus"
          onSubmit={event => {
            event.preventDefault();
            reasoning.mutate({
              question: companyFocus,
              evidenceIds: evidence.map(e => e.id),
              requestKey: crypto.randomUUID(),
              maxUsd: 1,
              consequential: false,
              admittedCandidateIds: [],
            });
          }}
        >
          <label htmlFor="president-company-focus">Company focus</label>
          <textarea
            id="president-company-focus"
            value={companyFocus}
            onChange={event => setCompanyFocus(event.target.value)}
            placeholder="What company decision should President examine against the available evidence?"
            required
            maxLength={4000}
          />
          <button disabled={reasoning.isPending}>
            {reasoning.isPending
              ? "Examining evidence…"
              : "Ask President to reason"}
          </button>
        </form>
      )}
      <section className="president-section">
        <div className="president-section-heading">
          <p>01 · Your decisions</p>
          <h2>What needs Adam now</h2>
        </div>
        {brief.questions.length ? (
          brief.questions.map(decision => (
            <Decision
              key={decision.id}
              decision={decision}
              refresh={() => void state.refetch()}
            />
          ))
        ) : (
          <p className="president-empty">
            No open founder decision. Work can progress within its existing
            authority.
          </p>
        )}
      </section>
      <section className="president-section">
        <div className="president-section-heading">
          <p>02 · Company direction</p>
          <h2>What we are trying to accomplish</h2>
        </div>
        <div className="president-grid">
          {objectives.map(objective => (
            <article key={objective.id}>
              <span className="president-tag">
                {String(objective.payload.status)}
              </span>
              <h3>{String(objective.payload.outcome)}</h3>
              <p>{String(objective.payload.reason)}</p>
              <small>
                {objective.evidenceIds.length} evidence source(s) · revision{" "}
                {objective.version}
              </small>
              {objective.payload.status === "PROPOSED" && (
                <button
                  disabled={request.isPending}
                  onClick={() =>
                    request.mutate({ objectiveRecordId: objective.id })
                  }
                >
                  Review authorization
                </button>
              )}
            </article>
          ))}
        </div>
        {!objectives.length && (
          <p className="president-empty">
            No objective has been proposed from grounded evidence yet.
          </p>
        )}
        {thesis.map(item => (
          <p className="president-thesis" key={item.id}>
            <strong>{String(item.payload.kind)} · </strong>
            {String(item.payload.claim)}
          </p>
        ))}
      </section>
      <section className="president-section">
        <div className="president-section-heading">
          <p>03 · Operating loop</p>
          <h2>What happened & what changed</h2>
        </div>
        <div className="president-grid">
          {programs.map(program => (
            <article key={program.id}>
              <span className="president-tag">
                {program.state.replaceAll("_", " ")}
              </span>
              <h3>{program.title}</h3>
              <p>{program.outcome}</p>
              {program.blockReason && (
                <p className="president-block">{program.blockReason}</p>
              )}
              {program.stopReason && (
                <p className="president-block">{program.stopReason}</p>
              )}
              {program.verifiedArtifactId && (
                <small>Reviewed artifact: {program.verifiedArtifactId}</small>
              )}
              {program.state === "SELECTED" && (
                <button
                  disabled={plan.isPending}
                  onClick={() =>
                    plan.mutate({ programId: program.id, maxReasoningUsd: 1 })
                  }
                >
                  Prepare bounded plan
                </button>
              )}
              <small>
                Spent ${program.spentUsd} of ${program.maxProgramUsd}
              </small>
            </article>
          ))}
        </div>
        {!programs.length && (
          <p className="president-empty">No work has been delegated yet.</p>
        )}
        {events.length > 0 && (
          <details>
            <summary>Recent execution and recovery evidence</summary>
            <ul>
              {events.map(event => (
                <li key={event.id}>
                  {event.eventType.replaceAll("_", " ")} · {event.actorId}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <section className="president-section">
        <div className="president-section-heading">
          <p>04 · Grounded view</p>
          <h2>Evidence</h2>
        </div>
        {evidence.map(item => (
          <details key={item.id}>
            <summary>
              {item.kind} ·{" "}
              {item.origin === "TEST_FIXTURE" ? "TEST FIXTURE · " : ""}
              {item.source}
            </summary>
            <p>{item.statement}</p>
            <small>
              Captured {new Date(item.capturedAt).toLocaleString()} ·{" "}
              {item.availability}
            </small>
          </details>
        ))}
        {!evidence.length && (
          <p className="president-empty">
            Evidence is unavailable. Unknown remains unknown.
          </p>
        )}
      </section>
      <section className="president-section">
        <div className="president-section-heading">
          <p>05 · Next move</p>
          <h2>What President recommends</h2>
        </div>
        {brief.tomorrow.length ? (
          <ul>
            {brief.tomorrow.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p>No further active work is queued.</p>
        )}
        {runtime.executionState === "CONFIGURED" && (
          <button
            disabled={dispatch.isPending}
            onClick={() => dispatch.mutate()}
          >
            Advance eligible work
          </button>
        )}
        <p className="president-footnote">
          An executor return remains unverified until independent review.
          Company operating records do not grant payment, customer-win, message,
          or field-observation authority.
        </p>
      </section>
    </main>
  );
}
