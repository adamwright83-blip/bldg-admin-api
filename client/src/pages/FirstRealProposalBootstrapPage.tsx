import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

export default function FirstRealProposalBootstrapPage() {
  const runbook = trpc.admin.firstRealProposalBootstrap.runbook.useQuery();
  const [candidateId, setCandidateId] = useState("");
  const [responseTermsId, setResponseTermsId] = useState("");
  const [evidenceIds, setEvidenceIds] = useState("");
  const [jobCardSourceType, setJobCardSourceType] = useState<"service_request" | "resident_coordinated_request" | "resident_agent_plan" | "">("");
  const [jobCardSourceId, setJobCardSourceId] = useState("");
  const checklist = trpc.admin.firstRealProposalBootstrap.assemblyChecklist.useQuery({
    candidateId: candidateId || undefined,
    responseTermsId: responseTermsId || undefined,
    evidenceSnapshotIds: evidenceIds.split(",").map(item => item.trim()).filter(Boolean),
    jobCardSourceType: jobCardSourceType || undefined,
    jobCardSourceId: jobCardSourceId || undefined,
  });

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">First Real Proposal Bootstrap</h1>
          <p className="mt-1 max-w-3xl text-sm text-black/55">
            Internal operator path for creating one factual proposal from real operator-provided facts.
            This page does not send outreach, book, charge, dispatch, accept providers, create consents, or run LLMs.
          </p>
        </div>
        <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">
          Dry-run first · admin only
        </div>
      </div>

      {runbook.isLoading ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-black/50"><Loader2 className="h-4 w-4 animate-spin" />Loading bootstrap runbook…</div>
      ) : runbook.error ? (
        <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">Bootstrap runbook could not be loaded.</div>
      ) : runbook.data ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="space-y-3">
            {runbook.data.steps.map(step => (
              <div key={step.key} className="rounded-xl border border-black/10 p-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 text-black/40" />
                  <div>
                    <h2 className="text-sm font-bold">{step.label}</h2>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-black/35">Allowed writes</p>
                    <p className="mt-1 text-sm text-black/60">{step.writes.join(", ")}</p>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-black/35">Forbidden</p>
                    <p className="mt-1 text-sm text-black/60">{step.forbidden.join(", ")}</p>
                  </div>
                </div>
              </div>
            ))}
          </section>

          <aside className="space-y-4">
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-2 font-bold text-amber-950"><AlertTriangle className="h-4 w-4" />Hard blockers</div>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-amber-950/80">
                {runbook.data.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}
              </ul>
            </section>

            <section className="rounded-xl border border-black/10 p-4">
              <h2 className="text-sm font-bold">Assembly dry-run checklist</h2>
              <p className="mt-1 text-xs text-black/50">Checks whether the real proposal assembly inputs exist as IDs. It does not write.</p>
              <div className="mt-4 space-y-3">
                <input className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm" placeholder="candidate id" value={candidateId} onChange={event => setCandidateId(event.target.value)} />
                <input className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm" placeholder="response terms id" value={responseTermsId} onChange={event => setResponseTermsId(event.target.value)} />
                <input className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm" placeholder="evidence ids, comma separated" value={evidenceIds} onChange={event => setEvidenceIds(event.target.value)} />
                <select className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm" value={jobCardSourceType} onChange={event => setJobCardSourceType(event.target.value as typeof jobCardSourceType)}>
                  <option value="">job card source type</option>
                  <option value="service_request">service_request</option>
                  <option value="resident_coordinated_request">resident_coordinated_request</option>
                  <option value="resident_agent_plan">resident_agent_plan</option>
                </select>
                <input className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm" placeholder="job card source id" value={jobCardSourceId} onChange={event => setJobCardSourceId(event.target.value)} />
              </div>
              <div className="mt-4 rounded-lg bg-black/[0.025] p-3 text-sm">
                {checklist.data?.allowedToAssemble ? (
                  <div className="flex items-start gap-2 text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4" />Real IDs are present. Use existing assembler/store path only after approval.</div>
                ) : (
                  <div>
                    <p className="font-semibold text-black/65">Not ready to assemble</p>
                    <p className="mt-1 text-black/50">{(checklist.data?.missing ?? []).map(label).join(" · ") || "Enter real IDs above."}</p>
                  </div>
                )}
              </div>
            </section>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
