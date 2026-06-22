import { useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { RequestJobCard } from "../../../server/procurement/requestJobCardPolicy";

const SOURCE_OPTIONS = [
  ["service_request", "Service requests"],
  ["resident_coordinated_request", "Coordinated requests"],
  ["resident_agent_plan", "Agent plans"],
] as const;

type SourceType = (typeof SOURCE_OPTIONS)[number][0];
type JobCard = RequestJobCard;

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

export function visibleRequestFacts(facts: JobCard["requestFacts"]): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  const add = (name: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) rows.push([name, value.trim()]);
  };
  add("Requested date", facts.requestedDate);
  add("Requested window", facts.requestedWindow);
  add("Deadline", facts.deadlineDate);
  add("Service details", facts.serviceDetails);
  add("Vehicle", facts.vehicleDetails);
  add("Origin", facts.origin);
  add("Destination", facts.destination);
  if (facts.dog) {
    add("Dog name", facts.dog.name);
    add("Dog breed", facts.dog.breed);
    add("Dog size", facts.dog.size);
    add("Dog age / life stage", facts.dog.ageOrLifeStage);
    add("Dog temperament", facts.dog.temperament);
    add("Dog handling notes", facts.dog.handlingNotes);
  }
  return rows;
}

function TruthFlags() {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Current truth flags">
      {["Not booked", "Not provider accepted", "Not paid", "Not dispatched", "Not completed"].map(item => (
        <span key={item} className="rounded-full border border-black/15 bg-black/[0.025] px-2.5 py-1 text-[11px] font-semibold text-black/55">
          {item}
        </span>
      ))}
    </div>
  );
}

function JobCardReview({ card, sourceStatus }: { card: JobCard; sourceStatus: string | null }) {
  const facts = visibleRequestFacts(card.requestFacts);
  const needsClarification = card.status === "job_card_needs_clarification";
  return (
    <article className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-black/40">{label(card.category)}</p>
          <h3 className="mt-1 text-base font-semibold text-black">{card.serviceLabel}</h3>
          {card.displaySummary ? <p className="mt-1 max-w-3xl text-sm text-black/65">{card.displaySummary}</p> : null}
        </div>
        <div className={`rounded-full px-3 py-1 text-xs font-bold ${needsClarification ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>
          {needsClarification ? "Clarification needed" : "Ready for admin review"}
        </div>
      </div>

      <div className="mt-4 grid gap-4 border-y border-black/8 py-4 md:grid-cols-3">
        <section>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-black/40">Resident</h4>
          <p className="mt-1 text-sm font-medium">{card.residentContext.residentName || "Resident name unavailable"}</p>
          <p className="text-xs text-black/55">
            {[card.residentContext.buildingSlug || card.residentContext.address, card.residentContext.unit && `Unit ${card.residentContext.unit}`].filter(Boolean).join(" · ") || "Building and unit unavailable"}
          </p>
        </section>
        <section>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-black/40">Requested timing</h4>
          <p className="mt-1 text-sm">{[card.requestFacts.requestedDate, card.requestFacts.requestedWindow].filter(Boolean).join(" · ") || "Not provided"}</p>
        </section>
        <section>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-black/40">Source status only</h4>
          <p className="mt-1 text-sm font-medium">{sourceStatus ? label(sourceStatus) : "Unavailable"}</p>
          <p className="text-[11px] text-black/45">This is not booking or provider truth.</p>
        </section>
      </div>

      {facts.length ? (
        <section className="mt-4">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-black/40">Extracted facts and constraints</h4>
          <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {facts.map(([name, value]) => <div key={name} className="text-sm"><dt className="inline font-semibold text-black/55">{name}: </dt><dd className="inline text-black/75">{value}</dd></div>)}
          </dl>
        </section>
      ) : null}

      {needsClarification ? (
        <section className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center gap-2 text-sm font-bold text-amber-950"><AlertTriangle className="h-4 w-4" />Clarification needed</div>
          <p className="mt-1 text-sm text-amber-900">{card.completeness.nextQuestion || "Required request facts are missing."}</p>
          <p className="mt-2 text-xs text-amber-800">Missing: {card.completeness.missingRequiredFacts.map(label).join(", ")}</p>
        </section>
      ) : null}

      <div className="mt-4"><TruthFlags /></div>
    </article>
  );
}

export default function RequestJobCardsPage() {
  const [sources, setSources] = useState<SourceType[]>(SOURCE_OPTIONS.map(([value]) => value));
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const query = trpc.admin.requestJobCards.list.useQuery(
    { limit, offset, sources: sources.length ? sources : undefined },
    { enabled: sources.length > 0 },
  );

  const toggleSource = (source: SourceType) => {
    setSources(current => current.includes(source) ? current.filter(item => item !== source) : [...current, source]);
    setOffset(0);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Job-card review</h1>
          <p className="mt-1 text-sm text-black/50">Derived administrative cards only. No sourcing, vendor contact, booking, payment, or dispatch occurs here.</p>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Filter by source">
          {SOURCE_OPTIONS.map(([value, text]) => {
            const selected = sources.includes(value);
            return <button key={value} type="button" aria-pressed={selected} onClick={() => toggleSource(value)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${selected ? "border-black bg-black text-white" : "border-black/15 text-black/55 hover:border-black/35"}`}>{text}</button>;
          })}
        </div>
      </div>

      {!sources.length ? <div className="mt-8 rounded-lg border border-black/10 p-6 text-sm text-black/50">Select at least one source to review job cards.</div> : query.isLoading ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-black/50"><Loader2 className="h-4 w-4 animate-spin" />Loading derived job cards…</div>
      ) : query.error ? (
        <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">Job cards could not be loaded. {query.error.message}</div>
      ) : !query.data?.items.length ? (
        <div className="mt-8 rounded-lg border border-black/10 p-6 text-sm text-black/50">No source records matched these filters.</div>
      ) : (
        <>
          <div className="mt-6 space-y-6">
            {query.data.items.map(item => (
              <section key={`${item.sourceRecordType}:${item.sourceRecordId}`}>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-black/45">
                  <span className="font-bold text-black/65">{label(item.sourceRecordType)}</span><span>#{item.sourceRecordId}</span>
                  {item.jobCards.length > 1 ? <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700">Multi-intent plan · {item.jobCards.length} cards</span> : null}
                </div>
                {item.jobCards.length ? <div className="space-y-3">{item.jobCards.map((card, index) => <JobCardReview key={`${card.source.sourceId}:${index}`} card={card} sourceStatus={item.sourceRecordStatus} />)}</div> : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">No job card was derived from this malformed or incomplete source record.</div>
                )}
              </section>
            ))}
          </div>
          <div className="mt-6 flex items-center justify-between border-t border-black/10 pt-4">
            <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} className="inline-flex items-center gap-1 rounded-md border border-black/15 px-3 py-1.5 text-xs font-semibold disabled:opacity-30"><ChevronLeft className="h-4 w-4" />Newer</button>
            <span className="text-xs text-black/45">Source records {offset + 1}–{offset + query.data.page.returnedSourceRecords}</span>
            <button type="button" disabled={!query.data.page.hasMore} onClick={() => setOffset(offset + limit)} className="inline-flex items-center gap-1 rounded-md border border-black/15 px-3 py-1.5 text-xs font-semibold disabled:opacity-30">Older<ChevronRight className="h-4 w-4" /></button>
          </div>
        </>
      )}
    </div>
  );
}
