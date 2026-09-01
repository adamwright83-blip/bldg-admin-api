import React from "react";
import { X } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { CustomerLocationCluster, GeographicCustomer } from "./customerGeography";
import type { CityWorldEntity } from "../../../../../server/goldlineWorld/cityWorldService";

type CityEntity = CityWorldEntity;

function requestId() {
  return crypto.randomUUID();
}

function RecoveryPath({ customer }: { customer: GeographicCustomer }) {
  const utils = trpc.useUtils();
  const scan = trpc.system.churnRadar.latestScan.useQuery();
  const interventions = trpc.system.churnRadar.interventions.useQuery();
  const create = trpc.system.churnRadar.createIntervention.useMutation();
  const prepare = trpc.system.churnRadar.prepareManualContact.useMutation();
  const contacted = trpc.system.churnRadar.markContacted.useMutation();
  const snapshot = scan.data?.customers.find(item => item.customerKey === customer.identityKey) ?? null;
  const intervention = interventions.data?.find(item => item.customer.customerKey === customer.identityKey) ?? null;
  const busy = create.isPending || prepare.isPending || contacted.isPending;

  async function begin() {
    if (!snapshot) return;
    await create.mutateAsync({ snapshotId: snapshot.id, requestId: requestId() });
    await utils.system.churnRadar.interventions.invalidate();
    toast.success("Recovery Path prepared from real order history");
  }

  async function recordApprovedAction() {
    if (!intervention || intervention.status !== "approved") return;
    await prepare.mutateAsync({ interventionId: intervention.id, draftId: intervention.draft.id, contentHash: intervention.draft.contentHash, requestId: requestId() });
    await contacted.mutateAsync({
      interventionId: intervention.id, draftId: intervention.draft.id, contentHash: intervention.draft.contentHash,
      requestId: requestId(), confirmation: "I manually sent this exact approved message to this customer",
    });
    await utils.system.churnRadar.interventions.invalidate();
    toast.success("Signal sent. The lantern remains dormant until real customer activity returns.");
  }

  return <section className="owi-recovery" aria-label={`Recovery Path for ${customer.displayName}`}>
    <p className="owi-kicker">Recovery Path</p>
    <h3>{intervention?.status === "recovered" ? "Relationship relit by a real reorder" : "A legitimate next move—not a promised win"}</h3>
    <p>{snapshot ? `${snapshot.daysLate} days beyond expected cadence · ${snapshot.historyOrderCount} completed orders · last service ${new Date(snapshot.lastServiceAt).toLocaleDateString()}.` : `${customer.cadence.daysSinceLastOrder} days since the last authoritative order. Run Churn Radar to create an evidence snapshot before outreach.`}</p>
    {snapshot?.reasons.map(reason => <small key={reason}>{reason}</small>)}
    {intervention ? <div className="owi-recovery-card">
      <strong>{intervention.customer.recommendedAction}</strong>
      <p>{intervention.draft.message}</p>
      <small>Status: {intervention.status.replaceAll("_", " ")} · Permission: {intervention.permission.status.replaceAll("_", " ")}</small>
    </div> : null}
    {!intervention && snapshot ? <button disabled={busy} onClick={() => void begin()}>Prepare evidence-backed Recovery Path</button> : null}
    {intervention?.status === "approved" ? <button disabled={busy} onClick={() => void recordApprovedAction()}>Record that approved message was sent</button> : null}
    {intervention?.status === "contacted" ? <div className="owi-signal">SIGNAL SENT · action recorded · no relight yet</div> : null}
    {intervention?.status === "recovered" ? <div className="owi-relit">LANTERN RELIT · paid order {intervention.recoveredOrderId}</div> : null}
  </section>;
}

export function WorldEntityInspector({ entity, cluster, pursuit, onClose, onOpenCustomer }: {
  entity: CityEntity | null;
  cluster: CustomerLocationCluster | null;
  pursuit: { pipelineId: number; name: string; stage: string; address: string; location: { canonicalAddress: string | null } | null } | null;
  onClose: () => void;
  onOpenCustomer: (phone: string) => void;
}) {
  const [resident, setResident] = React.useState<GeographicCustomer | null>(null);
  const projection = entity?.projection;
  const address = entity?.aliases.find(alias => alias.aliasType === "normalized_address")?.aliasValue ?? cluster?.canonicalAddress ?? pursuit?.location?.canonicalAddress ?? pursuit?.address;
  const title = entity?.displayName ?? pursuit?.name ?? (cluster ? cluster.total === 1 ? cluster.customers[0]!.displayName : `${cluster.total} residents` : "Physical place");
  return <aside className={`owi ${projection ? `is-${projection.epistemicState}` : "is-unknown"}`} aria-label={`One World inspector for ${title}`} aria-live="polite">
    <button className="owi-close" onClick={onClose} aria-label="Return to the same city location"><X /></button>
    <header>
      <p className="owi-kicker">One physical place · one save file</p>
      <h2>{title}</h2>
      <p>{address ?? "Geographic identity awaiting evidence"}</p>
      {projection ? <div className="owi-state"><b>{projection.commercialState.replaceAll("_", " ")}</b><span>{projection.epistemicState.replaceAll("_", " ")}</span></div> : null}
    </header>
    {projection?.attentionReasons.length ? <section className="owi-attention"><p className="owi-kicker">Why Goldline is drawing your attention</p>{projection.attentionReasons.map(reason => <div key={reason.code}><strong>{reason.explanation}</strong><small>{reason.sourceEvidenceReference}</small></div>)}</section> : null}
    {cluster?.customers.length ? <section><p className="owi-kicker">Residents in this building context</p><div className="owi-residents">{cluster.customers.map(customer => <button key={customer.identityKey} onClick={() => setResident(customer)} className={resident?.identityKey === customer.identityKey ? "is-active" : ""}><strong>{customer.displayName}</strong><span>{customer.cadence.state} · {customer.cadence.daysSinceLastOrder} days</span></button>)}</div></section> : null}
    {resident?.cadence.state === "dark" ? <RecoveryPath customer={resident} /> : resident ? <section className="owi-resident"><h3>{resident.displayName}</h3><p>This resident is {resident.cadence.state}; latest order evidence remains authoritative.</p>{resident.phone ? <button onClick={() => onOpenCustomer(resident.phone!)}>Inspect customer evidence here</button> : null}</section> : null}
    {pursuit ? <section><p className="owi-kicker">Commercial relationship</p><h3>{pursuit.stage.replaceAll("_", " ")}</h3><p>This is a persisted opportunity at this same place. It does not imply a won account.</p><Link className="owi-evidence-link" href={`/commercial-pipeline?pipeline=${pursuit.pipelineId}`}>Open the full Growth evidence record</Link></section> : null}
    {entity?.canonicalAsset?.assetUrl ? <section><p className="owi-kicker">Published world representation</p><img className="owi-tower" src={entity.canonicalAsset.assetUrl} alt={`Published Goldline tower representation for ${title}`} /></section> : null}
    {entity?.evidence.length ? <section><p className="owi-kicker">Evidence</p><div className="owi-evidence">{entity.evidence.map(item => <div key={item.id}><strong>{item.factType.replaceAll("_", " ")}: {String((item.valueJson as {value?: unknown}).value ?? "")}</strong><small>{item.provenanceClass.replaceAll("_", " ")} · {item.sourceReference}</small></div>)}</div></section> : null}
    {projection?.historyMarks.length ? <section><p className="owi-kicker">Chronicle · permanent explainable marks</p><ol className="owi-chronicle">{[...projection.historyMarks].reverse().map(mark => <li key={mark.eventId}><i data-mark={mark.semantic} /><div><strong>{mark.explanation}</strong><small>{mark.sourceEvidenceReference}</small></div></li>)}</ol></section> : null}
    {entity && !projection?.historyMarks.length ? <section className="owi-empty">No history marks yet. Viewing this place does not manufacture one.</section> : null}
  </aside>;
}
