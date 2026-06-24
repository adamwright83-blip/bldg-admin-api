import { useState } from "react";
import { AlertTriangle, Loader2, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc";

const LANE_LABELS: Record<string, string> = {
  maps_producer: "Maps producer",
  directory_producer: "Directory producer",
  web_operator_producer: "Web operator producer",
};

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

export default function VendorCastingSprintPage() {
  const [sourceKey, setSourceKey] = useState("service_request:155");
  const [appliedSourceKey, setAppliedSourceKey] = useState("service_request:155");
  const result = trpc.admin.vendorCastingSprint.mission.useQuery({ sourceKey: appliedSourceKey });

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Vendor Casting Sprint</h1>
          <p className="mt-1 max-w-3xl text-sm text-black/55">
            Demand-driven casting view: three producer lanes race to qualify a vendor for one real ready
            job card. No outreach is sent, no vendor is called, texted, emailed, or booked here &mdash;
            every contact attempt below is mock/no-op only.
          </p>
        </div>
        <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">
          No-send · admin only
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          className="w-72 rounded-lg border border-black/15 px-3 py-2 text-sm"
          placeholder="source key, e.g. service_request:155"
          value={sourceKey}
          onChange={event => setSourceKey(event.target.value)}
        />
        <button
          className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
          onClick={() => setAppliedSourceKey(sourceKey.trim())}
          type="button"
        >
          Load casting mission
        </button>
      </div>

      {result.isLoading ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-black/50"><Loader2 className="h-4 w-4 animate-spin" />Loading casting mission&hellip;</div>
      ) : result.error ? (
        <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">Casting mission could not be loaded.</div>
      ) : result.data && !result.data.found ? (
        <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" />Not found</div>
          <p className="mt-2">{result.data.blockedReasons.map(label).join(" · ")}</p>
        </div>
      ) : result.data?.mission ? (
        <div className="mt-6 space-y-6">
          <section className="rounded-xl border border-black/10 p-4">
            <h2 className="text-sm font-bold">Source job card</h2>
            <p className="mt-1 text-sm text-black/60">
              {result.data.mission.sourceJobCard.serviceLabel} &middot; {result.data.mission.sourceJobCard.sourceKey}
            </p>
            <p className="mt-1 text-xs text-black/45">
              Requested {result.data.mission.sourceJobCard.requestedDate ?? "unknown date"}, {result.data.mission.sourceJobCard.requestedWindow ?? "unknown window"}
              {result.data.mission.sourceJobCard.budgetCeiling != null
                ? ` · budget ceiling $${result.data.mission.sourceJobCard.budgetCeiling}`
                : ""}
            </p>
          </section>

          {result.data.mission.winner ? (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 font-bold text-emerald-900"><Trophy className="h-4 w-4" />Fastest qualified responder</div>
              <p className="mt-1 text-sm text-emerald-900/80">
                {result.data.mission.winner.businessName} ({LANE_LABELS[result.data.mission.winner.lane]}) &mdash; eligible by availability and price; not booked or accepted.
              </p>
            </section>
          ) : (
            <section className="rounded-xl border border-black/10 bg-black/[0.02] p-4 text-sm text-black/55">
              No winner-eligible lead yet (none both available and within budget).
            </section>
          )}

          {result.data.mission.lateResponders.length > 0 ? (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <h2 className="text-sm font-bold text-amber-950">Late qualified responders &rarr; partner intake</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-950/80">
                {result.data.mission.lateResponders.map(entry => (
                  <li key={entry.leadId}>{entry.leadId} ({LANE_LABELS[entry.lane]}) routed to {label(entry.routedTo)}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-3">
            {result.data.mission.lanes.map(lane => (
              <section key={lane.lane} className="rounded-xl border border-black/10 p-4">
                <h2 className="text-sm font-bold">{LANE_LABELS[lane.lane]}</h2>
                <div className="mt-3 space-y-3">
                  {lane.leads.map(lead => (
                    <div key={lead.id} className="rounded-lg border border-black/10 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{lead.businessName}</p>
                        <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black/55">demo</span>
                      </div>
                      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.1em] text-black/40">{label(lead.qualificationStatus)}</p>
                      {lead.quote ? (
                        <p className="mt-1 text-xs text-black/55">
                          Quote ${lead.quote.amount} &middot; {lead.quote.withinBudget === null ? "budget unknown" : lead.quote.withinBudget ? "within budget" : "over budget"}
                        </p>
                      ) : null}
                      {lead.contactLadder.length > 0 ? (
                        <p className="mt-2 text-xs text-black/50">
                          Contact ladder: {lead.contactLadder.map(label).join(" → ")}
                        </p>
                      ) : null}
                      {lead.contactAttempts.length > 0 ? (
                        <p className="mt-1 text-xs text-black/40">
                          Attempts (mock/no-op): {lead.contactAttempts.map(attempt => label(attempt.step)).join(", ")}
                        </p>
                      ) : null}
                      {lead.blockedReasons.length > 0 ? (
                        <p className="mt-1 text-xs text-red-700/80">{lead.blockedReasons.map(label).join(" · ")}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
