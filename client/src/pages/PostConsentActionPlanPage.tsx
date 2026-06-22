import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

function formatDate(value: Date | string): string {
  return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

type PlanListItem = {
  id: string; consentId: string; proposalVersionId: string; status: string; reasons: string[];
  eligibleForAutoSendPilot: boolean; createdAt: Date | string;
};

function PlanDetail({ consentId }: { consentId: string }) {
  const detail = trpc.admin.postConsentActionPlan.get.useQuery({ consentId });

  if (detail.isLoading) return <Loader2 className="h-5 w-5 animate-spin text-black/30" />;
  if (detail.error) {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">Plan could not be loaded.</div>;
  }
  if (!detail.data?.plan) {
    return <div className="rounded-lg border border-black/10 p-6 text-sm text-black/50">No plan recorded for this consent.</div>;
  }

  const { plan, draft } = detail.data;
  const isBlocked = plan.status.startsWith("blocked_");
  const isReview = plan.status === "needs_operator_review" || plan.status === "needs_resident_clarification";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-black/40">Plan {plan.id}</p>
          <h2 className="mt-1 text-xl font-semibold">{label(plan.status)}</h2>
          <p className="text-sm text-black/55">Consent {plan.consentId} · Proposal version {plan.proposalVersionId}</p>
        </div>
        <div className="text-right text-xs text-black/50">
          <p>Created {formatDate(plan.createdAt)}</p>
          <p>Auto-send pilot eligible: {plan.eligibleForAutoSendPilot ? "Yes" : "No"}</p>
        </div>
      </div>

      <section className={`rounded-xl border p-4 ${isBlocked ? "border-red-200 bg-red-50" : isReview ? "border-amber-200 bg-amber-50" : "border-black/10"}`}>
        <h3 className="text-xs font-bold uppercase tracking-wider text-black/45">Reasons</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {plan.reasons.length ? plan.reasons.map((reason: string) => (
            <span key={reason} className="rounded-full border border-black/15 bg-white px-2.5 py-1 text-[11px] font-semibold text-black/65">{reason}</span>
          )) : <span className="text-sm text-black/50">No reasons recorded.</span>}
        </div>
      </section>

      <section className="rounded-xl border border-black/10 p-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-black/45">Outreach draft</h3>
        {draft ? (
          <div className="mt-3 space-y-2">
            <p className="text-sm font-semibold">{draft.subjectRendered ?? "(no subject)"}</p>
            <p className="whitespace-pre-wrap rounded-lg bg-black/[0.025] p-3 text-sm text-black/80">{draft.draftBody}</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${draft.founderEscalationPresent ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>
                {draft.founderEscalationPresent ? "Founder escalation line present" : "Founder escalation line missing"}
              </span>
              <span className="rounded-full border border-black/15 bg-white px-2.5 py-1 text-[11px] font-semibold text-black/55">{label(draft.status)}</span>
            </div>
            <p className="text-xs text-black/40">Vendor candidate {draft.vendorCandidateId} · Template {draft.templateKey}@{draft.templateVersion}</p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-black/50">No draft was created for this plan.</p>
        )}
      </section>

      <p className="text-xs text-black/40">Read-only view. No send, edit, or reject action exists here.</p>
    </div>
  );
}

export default function PostConsentActionPlanPage() {
  const [offset, setOffset] = useState(0);
  const [selectedConsentId, setSelectedConsentId] = useState<string | null>(null);
  const limit = 20;
  const list = trpc.admin.postConsentActionPlan.list.useQuery({ limit, offset });
  const selectedId = selectedConsentId ?? (list.data?.items[0] as PlanListItem | undefined)?.consentId ?? null;

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold">Post-consent action plans</h1>
        <p className="mt-1 text-sm text-black/50">Read-only view of what HELD decided after resident consent. No send, booking, payment, or dispatch action occurs here.</p>
      </div>
      {list.isLoading ? <div className="mt-8 flex items-center gap-2 text-sm text-black/50"><Loader2 className="h-4 w-4 animate-spin" />Loading plans…</div>
        : list.error ? <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">Plans could not be loaded.</div>
        : !list.data?.items.length ? <div className="mt-8 rounded-lg border border-black/10 p-6 text-sm text-black/50">No post-consent plans recorded yet.</div>
        : <div className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-2">
            {(list.data.items as PlanListItem[]).map(item => (
              <button type="button" key={item.id} onClick={() => setSelectedConsentId(item.consentId)}
                className={`w-full rounded-lg border p-3 text-left ${selectedId === item.consentId ? "border-black bg-black text-white" : "border-black/10 hover:border-black/30"}`}>
                <p className="text-sm font-semibold">{label(item.status)}</p>
                <p className={`mt-1 text-xs ${selectedId === item.consentId ? "text-white/65" : "text-black/45"}`}>Consent {item.consentId}</p>
              </button>
            ))}
            <div className="flex justify-between pt-3">
              <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} className="rounded border border-black/15 p-1.5 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" disabled={!list.data.page.hasMore} onClick={() => setOffset(offset + limit)} className="rounded border border-black/15 p-1.5 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </aside>
          <main>{selectedId ? <PlanDetail consentId={selectedId} /> : null}</main>
        </div>}
    </div>
  );
}
