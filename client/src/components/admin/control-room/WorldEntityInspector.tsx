/**
 * One physical place, inspected without leaving it.
 *
 * Every panel here describes the same building. Residents, commercial state,
 * evidence, history, knowledge and playable paths are sections of one place
 * rather than destinations you navigate away to, so the city → building →
 * resident → building → city loop never resets the user's context.
 *
 * Panels with nothing real to say do not render. An empty panel implies a
 * question was asked and answered; silence is more honest.
 */

import React from "react";
import { Link } from "wouter";
import { X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type {
  CustomerLocationCluster,
  GeographicCustomer,
} from "./customerGeography";
import type { CityWorldEntity } from "../../../../../server/goldlineWorld/cityWorldService";

type CityEntity = CityWorldEntity;
/**
 * A resident as this panel needs them. The server roster is richer than a map
 * cluster's, so the shared shape keeps only what both can honestly supply and
 * marks the rest optional rather than inventing zeroes.
 */
type Resident = {
  identityKey: string;
  displayName: string;
  phone: string | null;
  cadence: { state: "active" | "dimming" | "dark"; daysSinceLastOrder: number };
  totalOrders: number | null;
};

function requestId() {
  return crypto.randomUUID();
}

/**
 * The recovery loop, kept honest at both ends.
 *
 * Preparing and sending are *actions*: they earn a real celebration and a
 * Chronicle mark, and they leave the customer exactly as dormant as they were.
 * Only an authoritative paid order — reconciled server-side against real order
 * history, never asserted from this screen — relights the lantern. There is
 * deliberately no control here that marks a customer recovered.
 */
function RecoveryPath({ resident }: { resident: Resident }) {
  const utils = trpc.useUtils();
  const scan = trpc.system.churnRadar.latestScan.useQuery();
  const profile = trpc.system.churnRadar.profile.useQuery();
  const interventions = trpc.system.churnRadar.interventions.useQuery();
  const create = trpc.system.churnRadar.createIntervention.useMutation();
  const prepare = trpc.system.churnRadar.prepareManualContact.useMutation();
  const contacted = trpc.system.churnRadar.markContacted.useMutation();

  const snapshot =
    scan.data?.customers.find(
      item => item.customerKey === resident.identityKey
    ) ?? null;
  const intervention =
    interventions.data?.find(
      item => item.customer.customerKey === resident.identityKey
    ) ?? null;
  const busy = create.isPending || prepare.isPending || contacted.isPending;

  async function begin() {
    if (!snapshot) return;
    try {
      await create.mutateAsync({
        snapshotId: snapshot.id,
        requestId: requestId(),
      });
      await utils.system.churnRadar.interventions.invalidate();
      toast.success("Recovery Path prepared from real order history");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Recovery Path could not be prepared"
      );
    }
  }

  async function recordApprovedAction() {
    if (!intervention || intervention.status !== "approved") return;
    try {
      await prepare.mutateAsync({
        interventionId: intervention.id,
        draftId: intervention.draft.id,
        contentHash: intervention.draft.contentHash,
        requestId: requestId(),
      });
      await contacted.mutateAsync({
        interventionId: intervention.id,
        draftId: intervention.draft.id,
        contentHash: intervention.draft.contentHash,
        requestId: requestId(),
        confirmation:
          "I manually sent this exact approved message to this customer",
      });
      await Promise.all([
        utils.system.churnRadar.interventions.invalidate(),
        utils.system.goldlineWorld.cityEntities.invalidate(),
      ]);
      toast.success(
        "Signal sent. The lantern stays dormant until a real order returns."
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The action was not recorded"
      );
    }
  }

  return (
    <section
      className="owi-recovery"
      aria-label={`Recovery Path for ${resident.displayName}`}
    >
      <p className="owi-kicker">Recovery Path</p>
      <h3>
        {intervention?.status === "recovered"
          ? "Relit by a real reorder"
          : "A legitimate next move — not a promised win"}
      </h3>
      <p>
        {snapshot
          ? `${snapshot.daysLate} days beyond expected cadence · ${snapshot.historyOrderCount} completed orders · last service ${new Date(snapshot.lastServiceAt).toLocaleDateString()}.`
          : `${resident.cadence.daysSinceLastOrder} days since the last authoritative order. Run Churn Radar to create an evidence snapshot before any outreach.`}
      </p>
      {snapshot?.reasons.map(reason => (
        <small key={reason}>{reason}</small>
      ))}

      {intervention ? (
        <div className="owi-recovery-card">
          <strong>{intervention.customer.recommendedAction}</strong>
          <p>{intervention.draft.message}</p>
          <small>
            Status: {intervention.status.replaceAll("_", " ")} · Permission:{" "}
            {intervention.permission.status.replaceAll("_", " ")}
          </small>
        </div>
      ) : null}

      {/*
        Outreach needs a configured sender identity before any draft exists.
        Saying so is better than offering a button that fails on click.
      */}
      {!intervention && snapshot && !profile.isLoading && !profile.data ? (
        <div className="owi-blocked">
          Recovery outreach needs a configured sender identity first.{" "}
          <Link className="owi-evidence-link" href="/growth/churn-winback">
            Configure the recovery profile
          </Link>
        </div>
      ) : null}
      {!intervention && snapshot && profile.data ? (
        <button disabled={busy} onClick={() => void begin()}>
          Prepare evidence-backed Recovery Path
        </button>
      ) : null}
      {intervention?.status === "approved" ? (
        <button disabled={busy} onClick={() => void recordApprovedAction()}>
          Record that the approved message was sent
        </button>
      ) : null}
      {intervention?.status === "contacted" ? (
        <div className="owi-signal">
          SIGNAL SENT · the action is recorded and this customer is still
          dormant. Only their next real order relights this lantern.
        </div>
      ) : null}
      {intervention?.status === "recovered" ? (
        <div className="owi-relit">
          LANTERN RELIT · authoritative paid order{" "}
          {intervention.recoveredOrderId}
        </div>
      ) : null}
    </section>
  );
}

export function WorldEntityInspector({
  entity,
  cluster,
  pursuit,
  onClose,
  onOpenCustomer,
}: {
  entity: CityEntity | null;
  cluster: CustomerLocationCluster | null;
  pursuit: {
    pipelineId: number;
    name: string;
    stage: string;
    address: string;
    location: { canonicalAddress: string | null } | null;
  } | null;
  onClose: () => void;
  onOpenCustomer: (phone: string) => void;
}) {
  const [residentKey, setResidentKey] = React.useState<string | null>(null);
  const projection = entity?.projection;
  const presentation = entity?.presentation;

  /**
   * The server's roster is authoritative. A cluster is only used to describe a
   * place Goldline has not yet resolved to a physical entity, so the two never
   * disagree about who lives here.
   */
  const residents: Resident[] = entity?.residents.length
    ? entity.residents.map(item => ({
        identityKey: item.identityKey,
        displayName: item.displayName,
        phone: item.phone,
        cadence: item.cadence,
        totalOrders: item.totalOrders,
      }))
    : (cluster?.customers ?? []).map((customer: GeographicCustomer) => ({
        identityKey: customer.identityKey,
        displayName: customer.displayName,
        phone: customer.phone,
        cadence: customer.cadence,
        totalOrders: null,
      }));

  const resident =
    residents.find(item => item.identityKey === residentKey) ?? null;

  const address =
    entity?.aliases.find(alias => alias.aliasType === "normalized_address")
      ?.aliasValue ??
    cluster?.canonicalAddress ??
    pursuit?.location?.canonicalAddress ??
    pursuit?.address;

  const title =
    entity?.displayName ??
    pursuit?.name ??
    (cluster
      ? cluster.total === 1
        ? cluster.customers[0]!.displayName
        : `${cluster.total} residents`
      : "Physical place");

  const commercial = entity?.pursuit ?? pursuit;

  return (
    <aside
      className={`owi ${presentation ? `veil-${presentation.veil}` : "veil-haze"}`}
      aria-label={`One World inspector for ${title}`}
      aria-live="polite"
    >
      <button
        type="button"
        className="owi-close"
        onPointerDown={event => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerUp={event => event.stopPropagation()}
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
        aria-label="Return to the same city location"
      >
        <X />
      </button>

      <header>
        <p className="owi-kicker">One physical place · one save file</p>
        <h2>{title}</h2>
        <p>{address ?? "Geographic identity awaiting evidence"}</p>
        {projection ? (
          <div className="owi-state">
            <b>{projection.commercialState.replaceAll("_", " ")}</b>
            <span>{projection.epistemicState.replaceAll("_", " ")}</span>
          </div>
        ) : null}
      </header>

      {/* Knowledge, said in words, because the atmosphere alone is not accessible. */}
      {presentation ? (
        <section className="owi-knowledge">
          <p className="owi-kicker">What Goldline knows about this place</p>
          <p>{presentation.veilExplanation}</p>
        </section>
      ) : null}

      {presentation?.attentionSummary ? (
        <section className="owi-attention">
          <p className="owi-kicker">Why Goldline is drawing your attention</p>
          {projection!.attentionReasons.map(reason => (
            <div key={reason.code}>
              <strong>{reason.explanation}</strong>
              <small>{reason.sourceEvidenceReference}</small>
            </div>
          ))}
        </section>
      ) : null}

      {residents.length ? (
        <section>
          <p className="owi-kicker">
            Residents in this building · {residents.length} real customer
            {residents.length === 1 ? "" : "s"}
          </p>
          <div className="owi-residents">
            {residents.map(item => (
              <button
                key={item.identityKey}
                onClick={() =>
                  setResidentKey(current =>
                    current === item.identityKey ? null : item.identityKey
                  )
                }
                className={`state-${item.cadence.state}${residentKey === item.identityKey ? " is-active" : ""}`}
                aria-expanded={residentKey === item.identityKey}
              >
                <strong>{item.displayName}</strong>
                <span>
                  {item.cadence.state} · {item.cadence.daysSinceLastOrder} days
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {resident?.cadence.state === "dark" ? (
        <RecoveryPath resident={resident} />
      ) : resident ? (
        <section className="owi-resident">
          <h3>{resident.displayName}</h3>
          <p>
            This resident is {resident.cadence.state} on their own observed
            cadence
            {resident.totalOrders === null
              ? "."
              : `, across ${resident.totalOrders} authoritative orders.`}
          </p>
          {resident.phone ? (
            <button onClick={() => onOpenCustomer(resident.phone!)}>
              Inspect customer evidence here
            </button>
          ) : null}
        </section>
      ) : null}

      {commercial ? (
        <section>
          <p className="owi-kicker">Commercial relationship</p>
          <h3>{commercial.stage.replaceAll("_", " ")}</h3>
          <p>
            A persisted opportunity at this same place. It does not imply a won
            account or any management partnership.
          </p>
          <Link
            className="owi-evidence-link"
            href={`/commercial-pipeline?pipeline=${commercial.pipelineId}`}
          >
            Open the full Growth evidence record
          </Link>
        </section>
      ) : null}

      {entity?.canonicalAsset?.assetUrl ? (
        <section>
          <p className="owi-kicker">Published world representation</p>
          <img
            className="owi-tower"
            src={entity.canonicalAsset.assetUrl}
            alt={`Published Goldline tower representation for ${title}`}
          />
        </section>
      ) : null}

      {entity?.evidence.length ? (
        <section>
          <p className="owi-kicker">Evidence</p>
          <div className="owi-evidence">
            {entity.evidence.map(item => (
              <div key={item.id}>
                <strong>
                  {item.factType.replaceAll("_", " ")}:{" "}
                  {String((item.valueJson as { value?: unknown }).value ?? "")}
                </strong>
                <small>
                  {item.provenanceClass.replaceAll("_", " ")} ·{" "}
                  {item.sourceReference}
                </small>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {projection?.historyMarks.length ? (
        <section>
          <p className="owi-kicker">Chronicle · permanent explainable marks</p>
          <ol className="owi-chronicle">
            {[...projection.historyMarks].reverse().map(mark => (
              <li key={mark.eventId}>
                <i data-mark={mark.semantic} />
                <div>
                  <strong>{mark.explanation}</strong>
                  <small>{mark.sourceEvidenceReference}</small>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {entity && !projection?.historyMarks.length ? (
        <section className="owi-empty">
          No history marks yet. Viewing this place does not manufacture one.
        </section>
      ) : null}
    </aside>
  );
}
