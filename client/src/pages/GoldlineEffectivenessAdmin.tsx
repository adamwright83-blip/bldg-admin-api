import { useState } from "react";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  COMMUNICATIONS_UI_DISCLAIMER,
  type CommunicationsAnalyticsWindowDays,
  type CommunicationsChannelMetrics,
} from "@shared/communicationsAnalytics";
import "./sales-intel-admin.css";

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="effectiveness-stat-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function TextRow({ label, value }: { label: string; value: string }) {
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

function formatRate(value: number | null): string {
  if (value == null) return "Not tracked";
  return `${Math.round(value * 1000) / 10}%`;
}

function formatDurationSeconds(value: number | null): string {
  if (value == null) return "Not tracked";
  return `${Math.round(value * 10) / 10}`;
}

function formatDurationMinutes(value: number | null): string {
  if (value == null) return "Not tracked";
  return `${Math.round(value * 10) / 10}`;
}

function formatCents(value: number | null): string {
  if (value == null) return "Not tracked";
  return `$${(value / 100).toFixed(2)}`;
}

function VoiceRows({ metrics }: { metrics: CommunicationsChannelMetrics["voice"] }) {
  return (
    <>
      <Row label="Observed call sessions attempted" value={metrics.uniqueSessionsAttempted} />
      <Row label="Connected" value={metrics.uniqueSessionsConnected} />
      <Row label="Completed" value={metrics.uniqueSessionsCompleted} />
      <Row label="No-answer" value={metrics.uniqueSessionsNoAnswer} />
      <Row label="Busy" value={metrics.uniqueSessionsBusy} />
      <Row label="Failed" value={metrics.uniqueSessionsFailed} />
      <Row label="Voicemail detected" value={metrics.uniqueSessionsVoicemailDetected} />
      <TextRow
        label="Observed connected duration (seconds)"
        value={formatDurationSeconds(metrics.observedConnectedDurationSeconds)}
      />
      <TextRow
        label="Observed connected duration (minutes)"
        value={formatDurationMinutes(metrics.observedConnectedDurationMinutes)}
      />
      <TextRow
        label="Average connected duration (seconds)"
        value={formatDurationSeconds(metrics.averageConnectedDurationSeconds)}
      />
      <TextRow
        label="Median connected duration (seconds)"
        value={formatDurationSeconds(metrics.medianConnectedDurationSeconds)}
      />
      <TextRow label="Connection rate" value={formatRate(metrics.connectionRate)} />
      <TextRow label="Completion rate" value={formatRate(metrics.completionRate)} />
    </>
  );
}

function MessagingRows({
  metrics,
}: {
  metrics: CommunicationsChannelMetrics["messaging"];
}) {
  return (
    <>
      <Row label="Observed messages sent" value={metrics.uniqueMessagesSent} />
      <Row label="Delivered" value={metrics.uniqueMessagesDelivered} />
      <Row label="Failed" value={metrics.uniqueMessagesFailed} />
      <TextRow label="Delivery rate" value={formatRate(metrics.deliveryRate)} />
    </>
  );
}

export default function GoldlineEffectivenessAdmin() {
  const [windowDays, setWindowDays] =
    useState<CommunicationsAnalyticsWindowDays>(30);
  const q = trpc.system.goldlineEvents.effectivenessSummary.useQuery({
    windowDays,
  });
  const communicationsQuery =
    trpc.system.goldlineEvents.communicationsEffectiveness.useQuery({
      windowDays,
    });
  const d = q.data;
  const c = communicationsQuery.data;
  return (
    <main className="sales-intel-admin effectiveness-admin min-h-screen">
      <header>
        <div>
          <small>INTERNAL · GOLDLINE EFFECTIVENESS</small>
          <h1>Play and business behavior</h1>
          <p>
            Observed counts over the last {d?.windowDays ?? windowDays} days. Game
            behavior and trusted business outcomes are shown separately. These
            are associations, not a causal lift or ROI claim.
          </p>
          <div className="effectiveness-window-toggle" role="group" aria-label="Observation window">
            <button
              type="button"
              className={windowDays === 7 ? "is-active" : undefined}
              onClick={() => setWindowDays(7)}
            >
              7D
            </button>
            <button
              type="button"
              className={windowDays === 30 ? "is-active" : undefined}
              onClick={() => setWindowDays(30)}
            >
              30D
            </button>
            <button
              type="button"
              className={windowDays === 90 ? "is-active" : undefined}
              onClick={() => setWindowDays(90)}
            >
              90D
            </button>
          </div>
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

      <section className="communications-analytics" aria-labelledby="communications-heading">
        <h2 id="communications-heading">COMMUNICATIONS</h2>
        <p className="communications-disclaimer">{COMMUNICATIONS_UI_DISCLAIMER}</p>
        {communicationsQuery.isLoading ? (
          <p className="sales-intel-empty">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading communications…
          </p>
        ) : null}
        {c ? (
          <div className="sales-intel-sources">
            <Block title="ALL OBSERVED">
              <p className="si-hint">
                All unique call sessions and messages in the {c.observationWindow.windowDays}-day
                window. Event rows are not resources.
              </p>
              <VoiceRows metrics={c.communications.all.voice} />
              <MessagingRows metrics={c.communications.all.messaging} />
            </Block>
            <Block title="PARTY CLASS">
              <p className="si-hint">
                Direction alone is not party class. Unknown is valid. Investor
                totals distinguish Internal, External, and Unknown.
              </p>
              <Row
                label="Internal operator-Claire"
                value={c.dataQuality.internalOperatorCommunicationCount}
              />
              <Row
                label="External"
                value={c.dataQuality.externalCommunicationCount}
              />
              <Row label="Unknown" value={c.partyClassification.unknown} />
              <Row
                label="Operator to Claire"
                value={c.partyClassification.operator_to_claire}
              />
              <Row
                label="Claire to operator"
                value={c.partyClassification.claire_to_operator}
              />
              <Row
                label="System to operator"
                value={c.partyClassification.system_to_operator}
              />
              <Row
                label="Operator to external"
                value={c.partyClassification.operator_to_external}
              />
              <Row
                label="System to external"
                value={c.partyClassification.system_to_external}
              />
              <Row
                label="External to operator"
                value={c.partyClassification.external_to_operator}
              />
              <TextRow
                label="Internal connection rate"
                value={formatRate(
                  c.communications.internalOperatorClaire.voice.connectionRate
                )}
              />
              <TextRow
                label="External connection rate"
                value={formatRate(c.communications.provenExternal.voice.connectionRate)}
              />
              <TextRow
                label="Unknown connection rate"
                value={formatRate(c.communications.unknown.voice.connectionRate)}
              />
            </Block>
            <Block title="GOLDLINE LINKAGE">
              <Row label="Goldline-linked" value={c.linkage.goldlineLinkedCount} />
              <Row label="Unlinked" value={c.linkage.unlinkedCount} />
              <Row label="Session-linked" value={c.linkage.sessionLinkedCount} />
              <Row label="Mission-linked" value={c.linkage.missionLinkedCount} />
              <Row label="Action-linked" value={c.linkage.actionLinkedCount} />
              <Row
                label="Session-linked, mission unlinked"
                value={c.linkage.sessionLinkedButMissionUnlinkedCount}
              />
            </Block>
            <Block title="DOWNSTREAM ASSOCIATION">
              <Row
                label="Communication-only"
                value={c.downstreamAssociation.communicationOnlyCount}
              />
              <Row
                label="Goldline-linked"
                value={c.downstreamAssociation.goldlineLinkedCount}
              />
              <Row
                label="Associated"
                value={c.downstreamAssociation.downstreamOutcomeAssociatedCount}
              />
              <Row
                label="Associated paid orders"
                value={c.downstreamAssociation.associatedPaidOrderCount}
              />
              <TextRow
                label="Associated net paid revenue"
                value={formatCents(c.downstreamAssociation.associatedNetPaidCents)}
              />
            </Block>
            <Block title="DATA QUALITY">
              <Row
                label="Unknown party class"
                value={c.dataQuality.unknownPartyClassCount}
              />
              <Row
                label="Unlinked communications"
                value={c.dataQuality.unlinkedCommunicationCount}
              />
              <Row
                label="Call legs collapsed"
                value={c.dataQuality.callLegsCollapsedCount}
              />
              <Row
                label="Calls missing terminal state"
                value={c.dataQuality.callsMissingTerminalStateCount}
              />
              <Row
                label="Calls missing duration"
                value={c.dataQuality.callsMissingDurationCount}
              />
              <Row
                label="Messages awaiting terminal state"
                value={c.dataQuality.messagesAwaitingTerminalStateCount}
              />
              <Row
                label="Financial review orders excluded"
                value={c.dataQuality.financialReviewOrdersExcludedCount}
              />
              <Row
                label="Financial conflict"
                value={c.dataQuality.financialConflictCount}
              />
            </Block>
          </div>
        ) : null}
      </section>
    </main>
  );
}
