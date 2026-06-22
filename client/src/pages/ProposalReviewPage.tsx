import { useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { AdminProposalVersionPreview } from "../../../server/procurement/vendorProposalReviewStore";

const RESIDENT_TRUTH_LANGUAGE = {
  availability: "Available, not booked",
  authority: "Approve HELD to try to book",
  disclaimer: "Nothing is confirmed until provider acceptance is verified",
} as const;

function formatDate(value: Date | string): string {
  return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function formatPrice(cents: number | null, currency: string | null): string {
  if (cents === null) return "Price not confirmed";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(cents / 100);
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

function ReadinessWarning({ preview }: { preview: AdminProposalVersionPreview }) {
  if (preview.readiness === "ready_for_admin_review") return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      <div className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" />Not ready for presentation</div>
      <p className="mt-1">{preview.warnings.length ? preview.warnings.map(label).join(" · ") : label(preview.readiness)}</p>
    </div>
  );
}

function TruthPanel({ preview }: { preview: AdminProposalVersionPreview }) {
  return (
    <section className="rounded-xl border border-black/10 bg-black/[0.025] p-4">
      <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-black/45">Resident truth contract</h3>
      <p className="mt-3 text-lg font-semibold">{RESIDENT_TRUTH_LANGUAGE.availability}</p>
      <p className="mt-1 text-sm font-semibold text-black/75">{RESIDENT_TRUTH_LANGUAGE.authority}</p>
      <p className="mt-1 text-xs text-black/55">{RESIDENT_TRUTH_LANGUAGE.disclaimer}</p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {["Provider not accepted", "Not paid", "Not dispatched", "Not completed"].map(item => (
          <span key={item} className="rounded-full border border-black/15 bg-white px-2.5 py-1 text-[11px] font-semibold text-black/55">{item}</span>
        ))}
      </div>
    </section>
  );
}

function PreviewDetail({ preview }: { preview: AdminProposalVersionPreview }) {
  const showAvailability = preview.terms.availabilityStatus === "available"
    && preview.truth.availability === "available_not_booked";
  const showPrice = preview.terms.rateStatus === "provided" && preview.terms.quotedAmountCents !== null;
  return (
    <div className="space-y-5">
      <ReadinessWarning preview={preview} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-black/40">Proposal {preview.proposalId}</p>
          <h2 className="mt-1 text-xl font-semibold">{preview.candidate.businessName}</h2>
          <p className="text-sm text-black/55">{preview.jobCard.serviceLabel || label(preview.candidate.category)} · Version {preview.version}</p>
        </div>
        <div className="text-right text-xs text-black/50">
          <p className="font-semibold text-black/70">{label(preview.reviewState)}</p>
          <p>Expires {formatDate(preview.expiresAt)}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-black/10 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-black/45">Factual option</h3>
          <p className="mt-3 text-lg font-semibold">{showAvailability ? "Available, not booked" : "Availability not confirmed"}</p>
          <p className="mt-1 text-base">{showPrice ? formatPrice(preview.terms.quotedAmountCents, preview.terms.quotedCurrency) : "Price not confirmed"}</p>
          <p className="mt-2 text-xs text-black/45">Terms {preview.terms.id} · {label(preview.terms.confidence)} confidence</p>
        </section>
        <TruthPanel preview={preview} />
      </div>

      <section className="rounded-xl border border-black/10 p-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-black/45">Request</h3>
        <p className="mt-2 text-sm font-medium">{preview.jobCard.displaySummary || "Summary unavailable"}</p>
        <p className="mt-1 text-xs text-black/50">{label(preview.jobCardReference.sourceType)} #{preview.jobCardReference.sourceId}</p>
        <p className="mt-1 font-mono text-[10px] text-black/35">Snapshot {preview.jobCardReference.snapshotHash}</p>
      </section>

      <section className="rounded-xl border border-black/10 p-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-black/45">Request-specific fit</h3>
        {preview.fit.safeToDisplay && preview.fit.displaySentence ? (
          <p className="mt-2 text-sm text-black/75">{preview.fit.displaySentence}</p>
        ) : <p className="mt-2 text-sm font-semibold text-amber-800">Fit sentence withheld: evidence is not safe to display.</p>}
        <p className="mt-2 text-xs text-black/45">{label(preview.fit.status)} · {label(preview.fit.confidence)} confidence</p>
      </section>

      <section className="rounded-xl border border-black/10 p-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-black/45">Selected evidence</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {(["eligibility", "reputation", "request_fit"] as const).map(role => {
            const references = preview.evidenceReferences.filter(item => item.evidenceRole === role);
            return <div key={role} className="rounded-lg bg-black/[0.025] p-3"><p className="text-[11px] font-bold uppercase text-black/45">{label(role)}</p>
              {references.length ? references.map(item => <p key={item.evidenceSnapshotId} className="mt-1 break-all font-mono text-xs">{item.evidenceSnapshotId}</p>)
                : <p className="mt-1 text-xs text-amber-700">No reference</p>}</div>;
          })}
        </div>
      </section>

      <p className="text-xs text-black/40">Eligibility: {label(preview.eligibility.status)} · Candidate {preview.candidate.id}</p>
    </div>
  );
}

export default function ProposalReviewPage() {
  const [offset, setOffset] = useState(0);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const limit = 20;
  const list = trpc.admin.proposalReview.list.useQuery({ limit, offset });
  const selectedId = selectedVersionId ?? list.data?.items[0]?.versionId ?? null;
  const detail = trpc.admin.proposalReview.get.useQuery({ versionId: selectedId ?? "" }, { enabled: !!selectedId });

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold">Proposal review</h1>
        <p className="mt-1 text-sm text-black/50">Internal factual preview only. No resident presentation, booking, payment, or dispatch action occurs here.</p>
      </div>
      {list.isLoading ? <div className="mt-8 flex items-center gap-2 text-sm text-black/50"><Loader2 className="h-4 w-4 animate-spin" />Loading proposal versions…</div>
        : list.error ? <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">Proposal versions could not be loaded. Migration 0015 may not be applied locally.</div>
        : !list.data?.items.length ? <div className="mt-8 rounded-lg border border-black/10 p-6 text-sm text-black/50">No stored proposal versions.</div>
        : <div className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-2">
            {list.data.items.map(item => <button type="button" key={item.versionId} onClick={() => setSelectedVersionId(item.versionId)}
              className={`w-full rounded-lg border p-3 text-left ${selectedId === item.versionId ? "border-black bg-black text-white" : "border-black/10 hover:border-black/30"}`}>
              <p className="text-sm font-semibold">{item.candidate.businessName}</p>
              <p className={`mt-1 text-xs ${selectedId === item.versionId ? "text-white/65" : "text-black/45"}`}>Version {item.version} · {label(item.readiness)}</p>
            </button>)}
            <div className="flex justify-between pt-3">
              <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} className="rounded border border-black/15 p-1.5 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" disabled={!list.data.page.hasMore} onClick={() => setOffset(offset + limit)} className="rounded border border-black/15 p-1.5 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </aside>
          <main>{detail.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-black/30" />
            : detail.error ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">Preview could not be loaded.</div>
            : detail.data ? <PreviewDetail preview={detail.data} /> : null}</main>
        </div>}
    </div>
  );
}
