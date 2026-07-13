import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Building2, Clock3, FileCheck2, Link2, Radar, Settings2, ShieldCheck, TrendingUp } from "lucide-react";
import { LoginForm } from "@/components/LoginForm";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

function money(cents: number): string {
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
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [handoffMessage, setHandoffMessage] = useState<string | null>(null);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [proposalMessage, setProposalMessage] = useState<string | null>(null);
  const createHandoff = trpc.system.commercialMission.createPhoneHandoff.useMutation();
  const generateProposal = trpc.system.commercialProposal.generate.useMutation();
  const approveProposal = trpc.system.commercialProposal.approve.useMutation();
  useEffect(() => {
    if (selectedId === null && list.data?.[0]) setSelectedId(list.data[0].id);
  }, [list.data, selectedId]);
  const selected = list.data?.find(mission => mission.id === selectedId) ?? null;
  const timeline = trpc.system.commercialMission.timeline.useQuery(
    { missionId: selectedId ?? 0 },
    { enabled: isAuthenticated && selectedId !== null, retry: false },
  );
  const proposal = trpc.system.commercialProposal.forMission.useQuery(
    { missionId: selectedId ?? 1 },
    { enabled: isAuthenticated && selectedId !== null, retry: false },
  );

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
