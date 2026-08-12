import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="effectiveness-stat-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className="sales-intel-source">
      <div className="sales-intel-source-head">
        <span>
          <b>{title}</b>
        </span>
      </div>
      {children}
    </article>
  );
}
export default function GoldlineEffectivenessAdmin() {
  const q = trpc.system.goldlineEvents.effectivenessSummary.useQuery({});
  const d = q.data;
  return (
    <main className="sales-intel-admin">
      <header>
        <div>
          <small>INTERNAL · GOLDLINE EFFECTIVENESS</small>
          <h1>Play and business behavior</h1>
          <p>
            Observed counts over the last {d?.windowDays ?? 30} days. Game
            behavior and trusted business outcomes are shown separately. These
            are associations, not a causal lift or ROI claim.
          </p>
        </div>
      </header>
      {q.isLoading ? (
        <p className="sales-intel-empty">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : null}
      {d ? (
        <section className="sales-intel-sources">
          <Block title="PLAY">
            <Row label="Sessions started" value={d.play.sessionsStarted} />
            <Row
              label="Missions approached"
              value={d.play.missionsApproached}
            />
            <Row label="Missions engaged" value={d.play.missionsEngaged} />
            <Row
              label="Encounters resolved"
              value={d.play.encountersResolved}
            />
          </Block>
          <Block title="BUSINESS ACTION">
            <Row
              label="Armory weapons selected"
              value={d.businessAction.weaponsSelected}
            />
            <Row
              label="Armory usage persisted"
              value={d.businessAction.weaponsUsed}
            />
            <Row
              label="Cold-call targets started"
              value={d.businessAction.coldCallTargetsStarted}
            />
            <Row
              label="Cold-call outcomes persisted"
              value={d.businessAction.coldCallOutcomesSaved}
            />
          </Block>
          <Block title="TRUSTED BUSINESS OUTCOME">
            <Row
              label="Visits completed"
              value={d.trustedBusinessOutcome.visitsCompleted}
            />
            <Row
              label="Follow-ups created"
              value={d.trustedBusinessOutcome.followUpsCreated}
            />
            <Row
              label="Accounts won"
              value={d.trustedBusinessOutcome.accountsWon}
            />
            <Row
              label="Accounts lost"
              value={d.trustedBusinessOutcome.accountsLost}
            />
          </Block>
          <Block title="MISSION PROGRESSION">
            <Row
              label="World mutations created"
              value={d.missionProgression.mutationsCreated}
            />
            <Row
              label="Verified captures"
              value={d.missionProgression.verifiedCaptures}
            />
          </Block>
          <Block title="RECOVERY">
            <Row
              label="Recovery paths followed"
              value={d.recovery.mutationsFollowed}
            />
          </Block>
          <Block title="SCOUT / EXPANSION">
            <Row
              label="Scout runs started"
              value={d.scoutExpansion.runsStarted}
            />
            <Row
              label="Discoveries created"
              value={d.scoutExpansion.discoveriesCreated}
            />
            <Row
              label="Missions created from Scout"
              value={d.scoutExpansion.missionsCreated}
            />
          </Block>
        </section>
      ) : null}
    </main>
  );
}
