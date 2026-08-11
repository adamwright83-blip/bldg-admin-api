import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

/**
 * Compact Goldline effectiveness view.
 *
 * Answers one question: during a recent window, how much real business
 * behavior showed up alongside Goldline play? Every number here is a plain
 * count, phrased as observation — this page never claims a percentage lift,
 * a causal effect, or an ROI figure. There is no experimental control group
 * behind these counts, so no stronger claim is available.
 */
function StatRow(props: { label: string; value: number }) {
  return (
    <div className="effectiveness-stat-row">
      <span>{props.label}</span>
      <b>{props.value}</b>
    </div>
  );
}

export default function GoldlineEffectivenessAdmin() {
  const summary = trpc.system.goldlineEvents.effectivenessSummary.useQuery({});

  return (
    <main className="sales-intel-admin">
      <header>
        <div>
          <small>INTERNAL · GOLDLINE EFFECTIVENESS</small>
          <h1>Play and business behavior</h1>
          <p>
            Observed counts over the last {summary.data?.windowDays ?? 30} days.
            These are associations during the session window, not a measured
            causal effect — read them as a signal to investigate, not a proof.
          </p>
        </div>
      </header>

      {summary.isLoading ? (
        <p className="sales-intel-empty">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : null}

      {summary.data ? (
        <section className="sales-intel-sources">
          <article className="sales-intel-source">
            <div className="sales-intel-source-head">
              <span>
                <b>PLAY</b>
              </span>
            </div>
            <StatRow label="Sessions started" value={summary.data.play.sessionsStarted} />
            <StatRow label="Missions engaged" value={summary.data.play.missionsEngaged} />
            <StatRow label="Encounters resolved" value={summary.data.play.encountersResolved} />
          </article>

          <article className="sales-intel-source">
            <div className="sales-intel-source-head">
              <span>
                <b>BUSINESS ACTION</b>
              </span>
            </div>
            <StatRow label="Armory weapons selected" value={summary.data.businessAction.weaponsSelected} />
            <StatRow label="Cold call outcomes saved" value={summary.data.businessAction.coldCallOutcomesSaved} />
            <StatRow label="Follow-ups created" value={summary.data.businessAction.followUpsCreated} />
          </article>

          <article className="sales-intel-source">
            <div className="sales-intel-source-head">
              <span>
                <b>MISSION PROGRESSION</b>
              </span>
            </div>
            <StatRow label="World mutations created" value={summary.data.missionProgression.mutationsCreated} />
            <StatRow label="Verified captures" value={summary.data.missionProgression.verifiedCaptures} />
          </article>

          <article className="sales-intel-source">
            <div className="sales-intel-source-head">
              <span>
                <b>RECOVERY</b>
              </span>
            </div>
            <StatRow label="Recovery paths followed" value={summary.data.recovery.mutationsFollowed} />
          </article>

          <article className="sales-intel-source">
            <div className="sales-intel-source-head">
              <span>
                <b>SCOUT / EXPANSION</b>
              </span>
            </div>
            <StatRow label="Scout runs started" value={summary.data.scoutExpansion.runsStarted} />
            <StatRow label="Discoveries created" value={summary.data.scoutExpansion.discoveriesCreated} />
            <StatRow label="Missions created from Scout" value={summary.data.scoutExpansion.missionsCreated} />
          </article>
        </section>
      ) : null}
    </main>
  );
}
