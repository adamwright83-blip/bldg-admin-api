import { useEffect, useMemo, useState } from "react";
import "./PresidentAutonomousReview.css";

type Candidate = {
  candidateId: string;
  rank: number;
  title: string;
  problem: string;
  proposedChange: string;
  expectedUpside: string;
  risk: string;
  effort: string;
  whyNow: string;
  successLooksLike: string;
  executionDomain: string;
};

type CycleView = {
  cycleId: string;
  status: string;
  proposed: Array<Candidate | null>;
  presidentRationale: string;
  approval: {
    approvedCandidateIds: string[];
    approvedAt: string;
  } | null;
  blockedReason: string | null;
  missions: Array<{
    missionId: string;
    candidateId: string;
    title: string;
    status: string;
    blocker: string | null;
    prUrl: string | null;
    reviewVerdict: string | null;
  }>;
};

type Others = {
  others: Candidate[];
  critique: unknown;
};

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      typeof body?.error === "string" ? body.error : `Request failed (${response.status})`
    );
  return body as T;
}

function CandidateCard({
  candidate,
  checked,
  disabled,
  onToggle,
}: {
  candidate: Candidate;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <article className={`president-cycle-card ${checked ? "selected" : ""}`}>
      <div className="president-cycle-rank">#{candidate.rank}</div>
      <div className="president-cycle-card-body">
        <div className="president-cycle-card-head">
          <h3>{candidate.title}</h3>
          <span>{candidate.executionDomain.replaceAll("_", " ")}</span>
        </div>
        <p>{candidate.problem}</p>
        <details>
          <summary>What President would change</summary>
          <p>{candidate.proposedChange}</p>
          <p><strong>Expected upside:</strong> {candidate.expectedUpside}</p>
          <p><strong>Risk:</strong> {candidate.risk}</p>
          <p><strong>Effort:</strong> {candidate.effort}</p>
          <p><strong>Why now:</strong> {candidate.whyNow}</p>
          <p><strong>Success:</strong> {candidate.successLooksLike}</p>
        </details>
      </div>
      <label className="president-cycle-select">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled && !checked}
          onChange={onToggle}
        />
        {checked ? "Selected" : "Choose"}
      </label>
    </article>
  );
}

export default function PresidentAutonomousReview() {
  const cycleId = useMemo(
    () => new URLSearchParams(window.location.search).get("cycle"),
    []
  );
  const [cycle, setCycle] = useState<CycleView | null>(null);
  const [others, setOthers] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!cycleId) return;
    const data = await jsonFetch<CycleView>(
      `/api/president/autonomous/cycles/${encodeURIComponent(cycleId)}`
    );
    setCycle(data);
    if (!data.approval)
      setSelected(
        data.proposed
          .filter((x): x is Candidate => Boolean(x))
          .map(x => x.candidateId)
      );
    else setSelected(data.approval.approvedCandidateIds);
  };

  useEffect(() => {
    if (!cycleId) return;
    setError(null);
    void load().catch(e => setError(e instanceof Error ? e.message : String(e)));
    const timer = window.setInterval(() => {
      void load().catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [cycleId]);

  if (!cycleId) return null;

  const proposed = cycle?.proposed.filter((x): x is Candidate => Boolean(x)) ?? [];
  const candidates = others ? [...proposed, ...others] : proposed;
  const unique = [...new Map(candidates.map(c => [c.candidateId, c])).values()];
  const awaiting = cycle?.status === "AWAITING_ADAM_REVIEW";

  const toggle = (id: string) => {
    setSelected(current =>
      current.includes(id)
        ? current.filter(x => x !== id)
        : current.length < 3
          ? [...current, id]
          : current
    );
  };

  const loadOthers = async () => {
    if (!cycleId) return;
    setBusy(true);
    setError(null);
    try {
      const data = await jsonFetch<Others>(
        `/api/president/autonomous/cycles/${encodeURIComponent(cycleId)}/others`
      );
      setOthers(data.others);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!cycleId || selected.length < 1 || selected.length > 3) return;
    setBusy(true);
    setError(null);
    try {
      await jsonFetch(
        `/api/president/autonomous/cycles/${encodeURIComponent(cycleId)}/approve`,
        {
          method: "POST",
          body: JSON.stringify({ approvedCandidateIds: selected }),
        }
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="president-cycle-review" aria-labelledby="president-cycle-title">
      <div className="president-cycle-heading">
        <div>
          <p className="president-eyebrow">PRESIDENT · OVERNIGHT CYCLE</p>
          <h2 id="president-cycle-title">
            {awaiting ? "Three recommendations are ready for you" : "Overnight cycle"}
          </h2>
        </div>
        {cycle && <span className="president-cycle-status">{cycle.status.replaceAll("_", " ")}</span>}
      </div>

      {error && <p role="alert" className="president-cycle-error">{error}</p>}
      {!cycle && !error && <p>Loading President’s recommendations…</p>}

      {cycle && (
        <>
          {awaiting && (
            <p className="president-cycle-intro">
              President recommends these three. Select one to three. If you want a different
              set, open the other seven and replace any recommendation before approval.
              Nothing executes until you approve the final set.
            </p>
          )}

          <div className="president-cycle-list">
            {unique.map(candidate => (
              <CandidateCard
                key={candidate.candidateId}
                candidate={candidate}
                checked={selected.includes(candidate.candidateId)}
                disabled={!awaiting || selected.length >= 3}
                onToggle={() => awaiting && toggle(candidate.candidateId)}
              />
            ))}
          </div>

          {awaiting && !others && (
            <button className="president-cycle-secondary" disabled={busy} onClick={() => void loadOthers()}>
              {busy ? "Loading…" : "Show the other seven"}
            </button>
          )}

          {awaiting && (
            <div className="president-cycle-approval">
              <span>{selected.length} selected</span>
              <button disabled={busy || selected.length < 1 || selected.length > 3} onClick={() => void approve()}>
                {busy ? "Saving approval…" : "Approve final set"}
              </button>
            </div>
          )}

          {!awaiting && cycle.approval && (
            <p className="president-cycle-approved">
              Adam approved {cycle.approval.approvedCandidateIds.length} mission(s) at{" "}
              {new Date(cycle.approval.approvedAt).toLocaleString()}.
            </p>
          )}

          {cycle.missions.length > 0 && (
            <div className="president-cycle-missions">
              {cycle.missions.map(mission => (
                <article key={mission.missionId}>
                  <strong>{mission.title}</strong>
                  <span>{mission.status.replaceAll("_", " ")}</span>
                  {mission.reviewVerdict && <small>Review: {mission.reviewVerdict}</small>}
                  {mission.blocker && <small>{mission.blocker}</small>}
                  {mission.prUrl && (
                    <a href={mission.prUrl} target="_blank" rel="noreferrer">
                      Open PR
                    </a>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
