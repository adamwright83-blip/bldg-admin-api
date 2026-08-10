import { ChevronRight, MapPin, Radar, X } from "lucide-react";
import type { ScoutReport } from "../../../../../shared/expansionScout";

export function ScoutReportPanel(props: {
  report: ScoutReport | null;
  isRunning: boolean;
  onRun: () => Promise<void>;
  onClose: () => void;
  onEngageMission: (missionId: number) => void;
}) {
  return (
    <section className="scout-report-panel" aria-label="Expansion Scout">
      <button
        className="scout-close"
        onClick={props.onClose}
        aria-label="Close Scout"
      >
        <X />
      </button>
      <header>
        <Radar />
        <span>
          <small>VICTORY BEAT 2</small>
          <h1>EXPANSION SCOUT</h1>
        </span>
      </header>
      {!props.report ? (
        <div className="scout-awaiting">
          <p>
            Run a real sourced lookalike search from the verified account
            pattern.
          </p>
          <button disabled={props.isRunning} onClick={() => void props.onRun()}>
            {props.isRunning ? "SCOUT SEARCHING…" : "RUN SOURCED SCOUT"}
          </button>
        </div>
      ) : (
        <>
          <div className="scout-criteria">
            <b>{props.report.criteria.archetype.replaceAll("_", " ")}</b>
            <span>
              {props.report.criteria.radiusMiles} mi around{" "}
              {props.report.criteria.area}
            </span>
          </div>
          {props.report.discoveries.length ? (
            <div className="scout-discoveries">
              <h2>{props.report.discoveries.length} NEW MISSIONS DISCOVERED</h2>
              {props.report.discoveries.map(discovery => (
                <article key={discovery.missionId}>
                  <MapPin />
                  <span>
                    <b>{discovery.companyName}</b>
                    <small>{discovery.address}</small>
                    {discovery.matchScore != null ? (
                      <em>SOURCED FIT SCORE {discovery.matchScore}</em>
                    ) : null}
                    <small>{discovery.sourceReference}</small>
                  </span>
                  <button
                    onClick={() => props.onEngageMission(discovery.missionId)}
                    aria-label={`Engage ${discovery.companyName}`}
                  >
                    <ChevronRight />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="scout-zero">
              <h2>SCOUT FOUND 0 NEW OPPORTUNITIES</h2>
              <p>
                Criteria: {props.report.criteria.archetype.replaceAll("_", " ")}{" "}
                · {props.report.criteria.radiusMiles} mi ·{" "}
                {props.report.criteria.area}. No new provider matches remained
                after real-account deduplication.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
