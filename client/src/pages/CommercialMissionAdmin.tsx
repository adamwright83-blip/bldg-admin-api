import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Building2, Clock3, FileCheck2, Link2, Radar, Settings2, ShieldCheck, TrendingUp } from "lucide-react";
import { LoginForm } from "@/components/LoginForm";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

function money(cents: number | null): string {
  if (cents === null) return "Estimate unavailable — needs qualification";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default function CommercialMissionAdmin() {
  const { loading: authLoading, isAuthenticated } = useAuth();
  const list = trpc.system.commercialMission.list.useQuery(
    { limit: 100 },
    { enabled: isAuthenticated },
  );
  const salesJournals = trpc.system.commercialMission.salesJournalsAdmin.useQuery(
    { limit: 12 }, { enabled: isAuthenticated },
  );
  const salesMomentum = trpc.system.commercialMission.salesMomentumAdmin.useQuery(
    undefined, { enabled: isAuthenticated },
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [handoffMessage, setHandoffMessage] = useState<string | null>(null);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [proposalMessage, setProposalMessage] = useState<string | null>(null);
  const createHandoff = trpc.system.commercialMission.createPhoneHandoff.useMutation();
  const generateProposal = trpc.system.commercialProposal.generate.useMutation();
  const approveProposal = trpc.system.commercialProposal.approve.useMutation();
  const createIrlPlan = trpc.system.commercialMission.createLuxuryHotelIrlPlan.useMutation();
  const dispatchIrl = trpc.system.commercialMission.dispatchIrl.useMutation();
  const fieldAssignees = trpc.system.commercialMission.fieldAssignees.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );
  const activateForField =
    trpc.system.commercialMission.activateForField.useMutation();
  const [selectedAssignee, setSelectedAssignee] = useState("");
  const [activationMessage, setActivationMessage] = useState<string | null>(null);
  const [printShop, setPrintShop] = useState({ name: "", address: "" });
  const [mintStop, setMintStop] = useState({ name: "", address: "" });
  useEffect(() => {
    if (selectedId === null && list.data?.[0]) setSelectedId(list.data[0].id);
  }, [list.data, selectedId]);
  const selected = list.data?.find(mission => mission.id === selectedId) ?? null;
  useEffect(() => {
    if (selected?.assignedTo) {
      setSelectedAssignee(selected.assignedTo);
      return;
    }
    if (fieldAssignees.data?.[0]) setSelectedAssignee(fieldAssignees.data[0].openId);
  }, [fieldAssignees.data, selected?.assignedTo, selected?.id]);
  const timeline = trpc.system.commercialMission.timeline.useQuery(
    { missionId: selectedId ?? 0 },
    { enabled: isAuthenticated && selectedId !== null, retry: false },
  );
  const proposal = trpc.system.commercialProposal.forMission.useQuery(
    { missionId: selectedId ?? 1 },
    { enabled: isAuthenticated && selectedId !== null, retry: false },
  );
  const proofs = trpc.system.commercialMission.proofs.useQuery(
    { missionId: selectedId ?? 1 },
    { enabled: isAuthenticated && selectedId !== null, retry: false },
  );
  const reviewProof = trpc.system.commercialMission.reviewProof.useMutation();
  const campaigns = trpc.system.commercialCampaign.list.useQuery(
    { missionId: selectedId ?? 1 }, { enabled: isAuthenticated && selectedId !== null, retry: false },
  );
  const createCampaign = trpc.system.commercialCampaign.create.useMutation();
  const revokeCampaign = trpc.system.commercialCampaign.revoke.useMutation();
  const [campaignUrl, setCampaignUrl] = useState<string | null>(null);

  if (authLoading) {
    return <main className="min-h-screen bg-slate-950 text-white grid place-items-center">Loading DayForge missions…</main>;
  }
  if (!isAuthenticated) return <LoginForm role="admin" onSuccess={() => window.location.reload()} />;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-5 md:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <span className="text-xs font-bold tracking-[0.2em] text-orange-400">DAYFORGE RADAR</span>
            <h1 className="mt-2 text-3xl font-black">Commercial missions</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Canonical persisted missions and their ordered audit history. Territory, BORESLAY,
              Field, proposals, and outcomes will read this same record.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dayforge-today?walkIn=1" className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-3 py-2 text-sm font-black text-white">LOG A WALK-IN</Link>
            <Link href="/commercial-pipeline" className="inline-flex items-center gap-2 rounded-lg border border-sky-400/40 px-3 py-2 text-sm text-sky-200 hover:bg-sky-400/10">
              <TrendingUp className="h-4 w-4" /> Revenue Pipeline
            </Link>
            <Link href="/churn-radar" className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/40 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-400/10">
              <Radar className="h-4 w-4" /> Churn Radar
            </Link>
            <Link href="/commercial-proposal-settings" className="inline-flex items-center gap-2 rounded-lg border border-orange-400/40 px-3 py-2 text-sm text-orange-200 hover:bg-orange-400/10">
              <Settings2 className="h-4 w-4" /> Proposal profile
            </Link>
            <Link href="/" className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-300 hover:bg-white/5">
              <ArrowLeft className="h-4 w-4" /> Admin
            </Link>
          </div>
        </header>

        <section className="mb-6 rounded-2xl border border-fuchsia-300/20 bg-gradient-to-br from-violet-950/70 to-slate-900 p-5">
          <div className="flex items-center justify-between gap-4"><div><span className="text-xs font-black uppercase tracking-[.2em] text-fuchsia-300">Sales coaching memory</span><h2 className="mt-1 text-xl font-black">Driver journals</h2></div><span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black">{salesJournals.data?.length ?? 0}</span></div>
          {salesJournals.isLoading ? <p className="mt-4 text-sm text-white/45">Loading journals…</p> : null}
          {salesJournals.error ? <p className="mt-4 text-sm text-red-300">{salesJournals.error.message}</p> : null}
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {salesJournals.data?.slice(0, 6).map(journal => {
              const insights = journal.insightsJson as { objections?: Array<{ objection: string }>; wins?: string[] };
              return <article key={journal.id} className="rounded-xl border border-white/10 bg-black/20 p-4"><div className="flex justify-between gap-3 text-xs font-bold text-white/45"><span>{journal.driverId}</span><time>{journal.journalDate}</time></div>{journal.audioUrl ? <audio controls preload="none" className="mt-3 h-9 w-full" src={journal.audioUrl} /> : null}<p className="mt-3 line-clamp-3 text-sm leading-relaxed text-white/75">{journal.transcript}</p><div className="mt-3 flex gap-2"><span className="rounded-full bg-fuchsia-400/10 px-2 py-1 text-[10px] font-black text-fuchsia-200">{insights.objections?.length ?? 0} OBJECTIONS</span><span className="rounded-full bg-emerald-400/10 px-2 py-1 text-[10px] font-black text-emerald-200">{insights.wins?.length ?? 0} WINS</span></div></article>;
            })}
            {!salesJournals.isLoading && salesJournals.data?.length === 0 ? <p className="text-sm text-white/45">No driver has unloaded a sales day yet.</p> : null}
          </div>
          {salesMomentum.data?.length ? <div className="mt-5 border-t border-white/10 pt-4"><p className="text-xs font-black uppercase tracking-[.18em] text-white/45">30-day Sucker → Hustler progress</p><div className="mt-3 grid gap-3 md:grid-cols-2">{salesMomentum.data.map(driver => <div key={driver.driverId} className="rounded-xl bg-black/25 p-3"><div className="flex justify-between text-xs font-bold"><span>{driver.driverId}</span><span>{driver.points} momentum</span></div><div className="mt-2 h-3 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-400 to-amber-300" style={{ width: `${Math.round(driver.progress * 100)}%` }} /></div></div>)}</div></div> : null}
        </section>

        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <section className="rounded-2xl border border-white/10 bg-slate-900 p-3">
            <div className="mb-3 flex items-center justify-between px-2">
              <h2 className="font-bold">Mission queue</h2>
              <span className="rounded-full bg-white/10 px-2 py-1 text-xs">{list.data?.length ?? 0}</span>
            </div>
            {list.isLoading ? <p className="p-3 text-sm text-slate-400">Loading missions…</p> : null}
            {list.error ? <p className="p-3 text-sm text-red-300">{list.error.message}</p> : null}
            {!list.isLoading && list.data?.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/15 p-5 text-center text-sm text-slate-400">
                No commercial missions have been persisted yet.
              </div>
            ) : null}
            <div className="space-y-2">
              {list.data?.map(mission => (
                <button
                  type="button"
                  key={mission.id}
                  onClick={() => {
                    setSelectedId(mission.id);
                    setHandoffMessage(null);
                    setHandoffUrl(null);
                    setProposalMessage(null);
                  }}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    selectedId === mission.id
                      ? "border-orange-400/70 bg-orange-400/10"
                      : "border-white/10 bg-black/20 hover:border-white/25"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <b className="text-sm text-orange-300">{mission.code}</b>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{mission.status.replaceAll("_", " ")}</span>
                  </div>
                  <p className="mt-2 font-semibold">{mission.account.name}</p>
                  <p className="mt-1 text-xs text-slate-400">{money(mission.opportunity.estimatedAnnualValueCents)} estimated annual value</p>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-slate-900 p-5 md:p-6">
            {selected ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
                  <div>
                    <span className="text-xs font-bold tracking-wider text-orange-400">{selected.code}</span>
                    <h2 className="mt-1 text-2xl font-black">{selected.account.name}</h2>
                    <p className="mt-1 text-sm text-slate-400">Mission ID {selected.id} · Version {selected.version} · {selected.account.address}</p>
                  </div>
                  <div className="grid gap-2 text-right">
                    <div className="rounded-xl bg-emerald-400/10 px-4 py-3">
                      <small className="block text-[10px] font-bold uppercase tracking-wider text-emerald-300">Potential annual value</small>
                      <b className="text-xl text-emerald-200">{money(selected.opportunity.estimatedAnnualValueCents)}</b>
                    </div>
                    <div className="grid gap-2 rounded-xl border border-orange-400/25 bg-orange-400/5 p-3 text-left">
                      <small className="font-bold uppercase tracking-wider text-orange-300">Field assignment</small>
                      <select value={selectedAssignee} onChange={event => setSelectedAssignee(event.target.value)} className="rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-sm">
                        <option value="">Select active driver</option>
                        {fieldAssignees.data?.map(assignee => <option key={assignee.openId} value={assignee.openId}>{assignee.name} · {assignee.openId}</option>)}
                      </select>
                      {fieldAssignees.error ? <span className="text-xs text-red-300">{fieldAssignees.error.message}</span> : null}
                      {["candidate", "selected", "game_ready"].includes(selected.status) ? <button type="button" disabled={!selectedAssignee || activateForField.isPending} onClick={async () => {
                        setActivationMessage(null);
                        try {
                          const activated = await activateForField.mutateAsync({ missionId: selected.id, expectedVersion: selected.version, assignedTo: selectedAssignee, requestId: crypto.randomUUID() });
                          setActivationMessage(`${activated.code} assigned and ${activated.status.replaceAll("_", " ")}.`);
                          await list.refetch();
                        } catch (error) {
                          setActivationMessage(error instanceof Error ? error.message : "Could not activate mission");
                        }
                      }} className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-black text-white disabled:opacity-40">{activateForField.isPending ? "ACTIVATING…" : selected.status === "game_ready" ? "UPDATE ASSIGNEE" : "ASSIGN + UNLOCK GAME"}</button> : <span className="text-xs text-slate-400">Assigned to {selected.assignedTo ?? "nobody"}</span>}
                      {activationMessage ? <span role="status" className="text-xs text-slate-300">{activationMessage}</span> : null}
                    </div>
                    <div className="grid gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-left">
                      <small className="font-bold uppercase tracking-wider text-slate-500">Collateral</small>
                      {proposal.data ? (
                        <span className="text-xs text-slate-300">
                          Version {proposal.data.version} · {proposal.data.status}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">No proposal version yet</span>
                      )}
                      <button
                        type="button"
                        disabled={generateProposal.isPending}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs font-bold disabled:opacity-40"
                        onClick={async () => {
                          setProposalMessage(null);
                          try {
                            const created = await generateProposal.mutateAsync({
                              missionId: selected.id,
                              requestId: crypto.randomUUID(),
                            });
                            setProposalMessage(`Draft version ${created.version} generated`);
                            await proposal.refetch();
                          } catch (error) {
                            setProposalMessage(error instanceof Error ? error.message : "Could not generate proposal");
                          }
                        }}
                      >
                        <FileCheck2 className="h-4 w-4" /> {proposal.data ? "Generate new version" : "Generate proposal"}
                      </button>
                      {proposal.data?.status === "draft" ? (
                        <button
                          type="button"
                          disabled={approveProposal.isPending}
                          className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-black text-white disabled:opacity-40"
                          onClick={async () => {
                            setProposalMessage(null);
                            try {
                              const approved = await approveProposal.mutateAsync({
                                missionId: selected.id,
                                proposalId: proposal.data!.id,
                                requestId: crypto.randomUUID(),
                              });
                              setProposalMessage(`Version ${approved.version} approved for the field`);
                              await proposal.refetch();
                            } catch (error) {
                              setProposalMessage(error instanceof Error ? error.message : "Could not approve proposal");
                            }
                          }}
                        >
                          Approve version {proposal.data.version}
                        </button>
                      ) : null}
                      {proposal.data ? (
                        <a className="text-center text-xs font-bold text-orange-300 underline" href={`/commercial-proposal/${selected.id}`}>
                          {proposal.data.status === "approved" ? "Open approved leave-behind" : "Review internal draft"}
                        </a>
                      ) : null}
                      {proposalMessage ? <small role="status" className="text-slate-400">{proposalMessage}</small> : null}
                    </div>
                    <div className="grid gap-2 rounded-xl border border-orange-400/30 bg-orange-400/5 p-3 text-left">
                      <small className="font-bold uppercase tracking-wider text-orange-300">IRL mission plan</small>
                      <input value={printShop.name} onChange={event => setPrintShop(value => ({ ...value, name: event.target.value }))} placeholder="Print shop name" className="rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-xs" />
                      <input value={printShop.address} onChange={event => setPrintShop(value => ({ ...value, address: event.target.value }))} placeholder="Print shop address" className="rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-xs" />
                      <input value={mintStop.name} onChange={event => setMintStop(value => ({ ...value, name: event.target.value }))} placeholder="Convenience store name" className="rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-xs" />
                      <input value={mintStop.address} onChange={event => setMintStop(value => ({ ...value, address: event.target.value }))} placeholder="Convenience store address" className="rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-xs" />
                      <button type="button" disabled={createIrlPlan.isPending || !printShop.name || !printShop.address || !mintStop.name || !mintStop.address} onClick={async () => {
                        await createIrlPlan.mutateAsync({ missionId: selected.id, requestId: crypto.randomUUID(), printShopName: printShop.name, printShopAddress: printShop.address, convenienceStoreName: mintStop.name, convenienceStoreAddress: mintStop.address, hotelName: selected.account.name, hotelAddress: selected.account.address, printFulfillmentMode: "manual_fulfillment", printCreditDisplayCopy: "$100 complimentary print credit" });
                        await list.refetch();
                      }} className="rounded-lg border border-orange-400/40 px-3 py-2 text-xs font-black text-orange-200 disabled:opacity-40">CREATE LUXURY HOTEL RUN V1</button>
                      <button type="button" disabled={dispatchIrl.isPending || !selected.assignedTo || !selected.steps.some(step => step.type !== "generic")} onClick={async () => {
                        await dispatchIrl.mutateAsync({ missionId: selected.id, requestId: crypto.randomUUID(), dispatchPolicy: "manual", includeSms: false });
                      }} className="rounded-lg bg-orange-500 px-3 py-3 text-xs font-black text-white disabled:opacity-40">DISPATCH IRL MISSION</button>
                      <small className="text-slate-500">In-app delivery always works. SMS is not claimed unless a validated SMS handoff/provider exists.</small>
                    </div>
                    {proofs.data?.some(proof => proof.reviewStatus === "pending") ? <div className="grid gap-2 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-left">
                      <small className="font-black uppercase tracking-wider text-amber-300">Proof awaiting review</small>
                      {proofs.data.filter(proof => proof.reviewStatus === "pending").map(proof => <div key={proof.id} className="rounded-lg bg-black/20 p-3"><p className="text-xs">Step {proof.missionStepId} · attempt {proof.attemptNumber} · {Math.round(proof.sizeBytes / 1024)} KB</p><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={async () => { await reviewProof.mutateAsync({ proofId: proof.id, requestId: crypto.randomUUID(), decision: "approve", note: "Approved against the configured reference." }); await Promise.all([proofs.refetch(), list.refetch()]); }} className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-black">APPROVE</button><button type="button" onClick={async () => { const note = window.prompt("What must be corrected?"); if (!note) return; await reviewProof.mutateAsync({ proofId: proof.id, requestId: crypto.randomUUID(), decision: "reject", note }); await Promise.all([proofs.refetch(), list.refetch()]); }} className="rounded-lg bg-red-500 px-3 py-2 text-xs font-black">REJECT</button></div></div>)}
                    </div> : null}
                    <div className="grid gap-2 rounded-xl border border-sky-400/30 bg-sky-400/5 p-3 text-left">
                      <small className="font-black uppercase tracking-wider text-sky-300">Campaign + revenue attribution</small>
                      <button type="button" disabled={createCampaign.isPending || !selected.assignedTo} onClick={async () => {
                        const result = await createCampaign.mutateAsync({ accountId: selected.account.accountId, missionId: selected.id, campaignName: `${selected.account.name} field leave-behind`, placement: "hotel_leave_behind", collateralVersion: proposal.data ? `proposal-v${proposal.data.version}` : "field-v1", salespersonId: selected.assignedTo!, requestId: crypto.randomUUID() });
                        setCampaignUrl(result.publicUrl); await campaigns.refetch();
                      }} className="rounded-lg bg-sky-500 px-3 py-3 text-xs font-black text-white disabled:opacity-40">CREATE OPAQUE CAMPAIGN LINK</button>
                      {campaignUrl ? <div className="rounded-lg bg-black/25 p-2"><input readOnly value={campaignUrl} className="w-full bg-transparent text-xs" /><button type="button" onClick={() => navigator.clipboard.writeText(campaignUrl)} className="mt-2 text-xs font-black text-sky-300">COPY LINK</button></div> : null}
                      {campaigns.data?.map(link => <div key={link.id} className="flex items-center justify-between rounded-lg bg-black/20 p-2 text-xs"><span><b>{link.campaignName}</b><br />{link.status} · {link.orderCount} orders</span>{link.status === "active" ? <button type="button" onClick={async () => { await revokeCampaign.mutateAsync({ linkId: link.id }); await campaigns.refetch(); }} className="font-bold text-red-300">REVOKE</button> : null}</div>)}
                    </div>
                    {["phone_ready", "preparing", "en_route", "arrived"].includes(selected.status) ? (
                      <button
                        type="button"
                        disabled={createHandoff.isPending || !selected.assignedTo}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-orange-400/40 px-3 py-2 text-xs font-bold text-orange-200 disabled:opacity-40"
                        onClick={async () => {
                          setHandoffMessage(null);
                          setHandoffUrl(null);
                          try {
                            const handoff = await createHandoff.mutateAsync({
                              missionId: selected.id,
                              requestId: crypto.randomUUID(),
                            });
                            setHandoffUrl(handoff.secureUrl);
                            try {
                              await navigator.clipboard.writeText(handoff.secureUrl);
                              setHandoffMessage("Secure 24-hour field link copied");
                            } catch {
                              setHandoffMessage("Secure field link ready below");
                            }
                          } catch (error) {
                            setHandoffMessage(error instanceof Error ? error.message : "Could not create field link");
                          }
                        }}
                      >
                        <Link2 className="h-4 w-4" /> Copy secure phone link
                      </button>
                    ) : null}
                    {handoffUrl ? (
                      <a className="break-all text-left text-[11px] text-orange-300 underline" href={handoffUrl} target="_blank" rel="noreferrer">
                        Open generated field link
                      </a>
                    ) : null}
                    {handoffMessage ? <small role="status" className="text-slate-400">{handoffMessage}</small> : null}
                  </div>
                </div>

                <div className="my-5 grid gap-3 sm:grid-cols-3">
                  <article className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <Building2 className="mb-3 h-5 w-5 text-orange-400" />
                    <small className="text-slate-500">DECISION-MAKER</small>
                    <p className="mt-1 font-semibold">{selected.account.decisionMaker.name ?? "Not identified"}</p>
                    <p className="text-xs text-slate-400">{selected.account.decisionMaker.title ?? "Title unknown"}</p>
                  </article>
                  <article className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <ShieldCheck className="mb-3 h-5 w-5 text-orange-400" />
                    <small className="text-slate-500">RADAR SCORE</small>
                    <p className="mt-1 text-xl font-black">{selected.opportunity.score}/100</p>
                    <p className="text-xs text-slate-400">{selected.opportunity.estimateConfidence} confidence</p>
                  </article>
                  <article className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <Clock3 className="mb-3 h-5 w-5 text-orange-400" />
                    <small className="text-slate-500">ASSIGNEE</small>
                    <p className="mt-1 font-semibold">{selected.assignedTo ?? "Unassigned"}</p>
                    <p className="text-xs text-slate-400">Ops task {selected.opsTaskId ?? "not linked"}</p>
                  </article>
                </div>

                <div className="grid gap-5 xl:grid-cols-2">
                  <article>
                    <h3 className="mb-3 font-bold">Mission brief</h3>
                    <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-4 text-sm">
                      <p><b className="text-orange-300">Signal:</b> {selected.opportunity.primarySignal}</p>
                      <p><b className="text-orange-300">Angle:</b> {selected.brief.salesAngle}</p>
                      <p><b className="text-orange-300">Opening:</b> “{selected.brief.openingLine}”</p>
                    </div>
                  </article>
                  <article>
                    <h3 className="mb-3 font-bold">Unified journey history</h3>
                    <div className="space-y-2">
                      {timeline.isLoading ? <p className="text-sm text-slate-400">Loading territory, BORESLAY, Field, proposal, and revenue history…</p> : null}
                      {timeline.error ? <p className="text-sm text-red-300">{timeline.error.message}</p> : null}
                      {timeline.data?.items.map(event => (
                        <div key={event.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <b className="text-sm">{event.eventName.replaceAll("_", " ")}</b>
                            <time className="text-[10px] text-slate-500">{new Date(event.createdAt).toLocaleString()}</time>
                          </div>
                          <p className="mt-1 text-xs text-slate-400">
                            {event.source} · {event.entityType} · {event.actorType}
                          </p>
                          <p className="mt-1 truncate text-[10px] text-slate-600">Correlation: {event.correlationId}</p>
                        </div>
                      ))}
                      {!timeline.isLoading && timeline.data?.items.length === 0 ? (
                        <p className="text-sm text-slate-400">No projected journey events yet.</p>
                      ) : null}
                    </div>
                  </article>
                </div>
              </>
            ) : (
              <div className="grid min-h-[420px] place-items-center text-center text-slate-400">
                <div><Building2 className="mx-auto mb-3 h-8 w-8" /><p>Select a persisted mission to inspect its canonical snapshot.</p></div>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
