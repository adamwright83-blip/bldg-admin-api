import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRightCircle, Copy, Loader2, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc";

const LANE_LABELS: Record<string, string> = {
  maps_producer: "Maps producer",
  directory_producer: "Directory producer",
  web_operator_producer: "Web operator producer",
};

const SOURCE_TYPE_OPTIONS = ["manual_operator_list", "public_business_directory", "permitted_public_fetch"] as const;
const ATTEMPT_CHANNELS = ["call", "voicemail", "website_form", "email", "sms_if_allowed", "second_call_if_urgent"] as const;
type AttemptChannel = (typeof ATTEMPT_CHANNELS)[number];

type VendorFactsForm = {
  businessName: string;
  phone: string;
  email: string;
  website: string;
  sourceType: (typeof SOURCE_TYPE_OPTIONS)[number];
  sourceReference: string;
  serviceArea: string;
  qualificationNotes: string;
  googleRating: string;
  googleReviewCount: string;
  yelpRating: string;
  yelpReviewCount: string;
  observedAt: string;
  negativeFlags: string;
  sourceConfidenceNotes: string;
};

const EMPTY_VENDOR_FACTS_FORM: VendorFactsForm = {
  businessName: "", phone: "", email: "", website: "",
  sourceType: "manual_operator_list", sourceReference: "", serviceArea: "", qualificationNotes: "",
  googleRating: "", googleReviewCount: "", yelpRating: "", yelpReviewCount: "",
  observedAt: "", negativeFlags: "", sourceConfidenceNotes: "",
};

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Mirrors server-side computeDraftAttemptStatus(); kept local so the client bundle never imports server policy modules. */
function computeAttemptStatus(state: { draftGenerated: boolean; copied: boolean; manuallySent: boolean }): string {
  if (!state.draftGenerated) return "blocked";
  if (state.manuallySent) return "response_pending";
  if (state.copied) return "copied";
  return "draft_ready";
}

export default function VendorCastingSprintPage() {
  const [sourceKey, setSourceKey] = useState("service_request:155");
  const [appliedSourceKey, setAppliedSourceKey] = useState("service_request:155");
  const [selectedLeadId, setSelectedLeadId] = useState<string | undefined>(undefined);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [vendorForm, setVendorForm] = useState<VendorFactsForm>(EMPTY_VENDOR_FACTS_FORM);
  const [attemptChannel, setAttemptChannel] = useState<AttemptChannel | "">("");
  const [copied, setCopied] = useState(false);
  const [manuallySent, setManuallySent] = useState(false);
  const [confirmCreateOpen, setConfirmCreateOpen] = useState(false);

  const result = trpc.admin.vendorCastingSprint.mission.useQuery({ sourceKey: appliedSourceKey });
  const handoff = trpc.admin.vendorCastingSprint.bootstrapHandoff.useQuery(
    { sourceKey: appliedSourceKey, leadId: selectedLeadId },
    { enabled: consoleOpen },
  );
  const generateDraft = trpc.admin.vendorCastingSprint.generateOutreachDraft.useMutation();
  const candidatePayload = trpc.admin.vendorCastingSprint.candidateCreationPayload.useMutation();
  const createCandidate = trpc.admin.firstRealProposalBootstrap.createCandidate.useMutation();

  const attemptStatus = useMemo(
    () => computeAttemptStatus({ draftGenerated: generateDraft.data?.allowed === true, copied, manuallySent }),
    [generateDraft.data, copied, manuallySent],
  );

  function openConsole(leadId: string | undefined) {
    setSelectedLeadId(leadId);
    setConsoleOpen(true);
    setVendorForm(EMPTY_VENDOR_FACTS_FORM);
    setAttemptChannel("");
    setCopied(false);
    setManuallySent(false);
    setConfirmCreateOpen(false);
    generateDraft.reset();
    candidatePayload.reset();
    createCandidate.reset();
  }

  function vendorFactsPayload() {
    return {
      businessName: vendorForm.businessName,
      phone: vendorForm.phone || null,
      email: vendorForm.email || null,
      website: vendorForm.website || null,
      sourceType: vendorForm.sourceType,
      sourceReference: vendorForm.sourceReference,
      serviceArea: vendorForm.serviceArea,
      qualificationNotes: vendorForm.qualificationNotes,
      googleRating: numberOrNull(vendorForm.googleRating),
      googleReviewCount: numberOrNull(vendorForm.googleReviewCount),
      yelpRating: numberOrNull(vendorForm.yelpRating),
      yelpReviewCount: numberOrNull(vendorForm.yelpReviewCount),
      observedAt: vendorForm.observedAt || null,
      negativeFlags: vendorForm.negativeFlags ? vendorForm.negativeFlags.split(",").map(value => value.trim()).filter(Boolean) : null,
      sourceConfidenceNotes: vendorForm.sourceConfidenceNotes || null,
    };
  }

  async function confirmCreateRealCandidate() {
    const leadId = handoff.data?.handoff?.leadId ?? selectedLeadId;
    if (!leadId) return;
    const payloadResult = await candidatePayload.mutateAsync({
      sourceKey: appliedSourceKey, leadId, vendorFacts: vendorFactsPayload(),
    });
    if (!payloadResult.allowed) return;
    await createCandidate.mutateAsync({
      tenantId: payloadResult.payload.tenantId,
      buildingSlug: payloadResult.payload.buildingSlug,
      sourceType: payloadResult.payload.sourceType,
      sourceReference: payloadResult.payload.sourceReference,
      category: payloadResult.payload.category,
      businessName: payloadResult.payload.businessName,
      phone: payloadResult.payload.phone,
      email: payloadResult.payload.email,
      website: payloadResult.payload.website,
      serviceArea: payloadResult.payload.serviceArea,
      qualificationNotes: payloadResult.payload.qualificationNotes,
    });
    setConfirmCreateOpen(false);
  }

  function submitDraftRequest() {
    const leadId = handoff.data?.handoff?.leadId ?? selectedLeadId;
    if (!leadId) return;
    setCopied(false);
    setManuallySent(false);
    setConfirmCreateOpen(false);
    candidatePayload.reset();
    createCandidate.reset();
    generateDraft.mutate({ sourceKey: appliedSourceKey, leadId, vendorFacts: vendorFactsPayload() });
  }

  async function copyDraftToClipboard() {
    const draft = generateDraft.data?.allowed ? generateDraft.data.draft : null;
    if (!draft) return;
    await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
    setCopied(true);
  }

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
              <button
                className="mt-3 flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-900"
                onClick={() => openConsole(undefined)}
                type="button"
              >
                <ArrowRightCircle className="h-3.5 w-3.5" />Open execution console
              </button>
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
                      <button
                        className="mt-2 text-xs font-semibold text-black/55 underline"
                        onClick={() => openConsole(lead.id)}
                        type="button"
                      >
                        Open execution console
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {consoleOpen ? (
            <section className="rounded-xl border border-black/15 bg-black/[0.02] p-4">
              <h2 className="text-sm font-bold">Casting sprint execution console</h2>
              {handoff.isLoading ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-black/50"><Loader2 className="h-4 w-4 animate-spin" />Loading lead&hellip;</div>
              ) : !handoff.data?.allowed || !handoff.data.handoff ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  {(handoff.data?.blockedReasons ?? []).map(label).join(" · ") || "No lead available."}
                </div>
              ) : (
                <div className="mt-3 space-y-4 text-sm">
                  <ul className="list-disc space-y-1 pl-5 text-emerald-900/90">
                    {handoff.data.handoff.truthDisclaimers.map(disclaimer => <li key={disclaimer}>{disclaimer}</li>)}
                  </ul>
                  <p><span className="font-semibold">Source job card:</span> {handoff.data.handoff.sourceJobCardKey}</p>
                  <p><span className="font-semibold">Selected lead / lane:</span> {handoff.data.handoff.businessNameForDisplayOnly} ({LANE_LABELS[handoff.data.handoff.lane]})</p>
                  <p><span className="font-semibold">Why eligible:</span> {handoff.data.handoff.eligibilityReason}</p>
                  <p><span className="font-semibold">Current contact ladder:</span> {handoff.data.handoff.contactLadderSummary}</p>
                  <div>
                    <p className="font-semibold">Blocked truth claims:</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-red-700/80">
                      {handoff.data.handoff.blockedTruthClaims.map(claim => <li key={claim}>{label(claim)}</li>)}
                    </ul>
                  </div>
                  <p><span className="font-semibold">Recommended next admin action:</span> {handoff.data.handoff.recommendedNextAdminAction}</p>
                  <div>
                    <p className="font-semibold">Missing real vendor facts before a draft can be generated:</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-black/65">
                      {handoff.data.handoff.missingRealWorldFacts.map(fact => <li key={fact}>{label(fact)}</li>)}
                    </ul>
                  </div>

                  <div className="rounded-lg border border-black/10 bg-white p-3">
                    <p className="text-xs font-bold uppercase tracking-[0.1em] text-black/45">
                      Enter real vendor facts (never copy the demo lead name above)
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <input className="rounded-lg border border-black/15 px-2 py-1.5 text-sm" placeholder="Business name *" value={vendorForm.businessName} onChange={event => setVendorForm({ ...vendorForm, businessName: event.target.value })} />
                      <input className="rounded-lg border border-black/15 px-2 py-1.5 text-sm" placeholder="Phone" value={vendorForm.phone} onChange={event => setVendorForm({ ...vendorForm, phone: event.target.value })} />
                      <input className="rounded-lg border border-black/15 px-2 py-1.5 text-sm" placeholder="Email" value={vendorForm.email} onChange={event => setVendorForm({ ...vendorForm, email: event.target.value })} />
                      <input className="rounded-lg border border-black/15 px-2 py-1.5 text-sm" placeholder="Website" value={vendorForm.website} onChange={event => setVendorForm({ ...vendorForm, website: event.target.value })} />
                      <select className="rounded-lg border border-black/15 px-2 py-1.5 text-sm" value={vendorForm.sourceType} onChange={event => setVendorForm({ ...vendorForm, sourceType: event.target.value as VendorFactsForm["sourceType"] })}>
                        {SOURCE_TYPE_OPTIONS.map(option => <option key={option} value={option}>{label(option)}</option>)}
                      </select>
                      <input className="rounded-lg border border-black/15 px-2 py-1.5 text-sm" placeholder="Source reference *" value={vendorForm.sourceReference} onChange={event => setVendorForm({ ...vendorForm, sourceReference: event.target.value })} />
                      <input className="rounded-lg border border-black/15 px-2 py-1.5 text-sm" placeholder="Service area *" value={vendorForm.serviceArea} onChange={event => setVendorForm({ ...vendorForm, serviceArea: event.target.value })} />
                      <input className="rounded-lg border border-black/15 px-2 py-1.5 text-sm" placeholder="Observed at (date, if known)" value={vendorForm.observedAt} onChange={event => setVendorForm({ ...vendorForm, observedAt: event.target.value })} />
                      <input className="rounded-lg border border-black/15 px-2 py-1.5 text-sm" placeholder="Google rating (if known)" value={vendorForm.googleRating} onChange={event => setVendorForm({ ...vendorForm, googleRating: event.target.value })} />
                      <input className="rounded-lg border border-black/15 px-2 py-1.5 text-sm" placeholder="Google review count (if known)" value={vendorForm.googleReviewCount} onChange={event => setVendorForm({ ...vendorForm, googleReviewCount: event.target.value })} />
                      <input className="rounded-lg border border-black/15 px-2 py-1.5 text-sm" placeholder="Yelp rating (if known)" value={vendorForm.yelpRating} onChange={event => setVendorForm({ ...vendorForm, yelpRating: event.target.value })} />
                      <input className="rounded-lg border border-black/15 px-2 py-1.5 text-sm" placeholder="Yelp review count (if known)" value={vendorForm.yelpReviewCount} onChange={event => setVendorForm({ ...vendorForm, yelpReviewCount: event.target.value })} />
                      <input className="rounded-lg border border-black/15 px-2 py-1.5 text-sm sm:col-span-2" placeholder="Negative flags, comma separated (if any)" value={vendorForm.negativeFlags} onChange={event => setVendorForm({ ...vendorForm, negativeFlags: event.target.value })} />
                      <textarea className="rounded-lg border border-black/15 px-2 py-1.5 text-sm sm:col-span-2" placeholder="Qualification notes *" value={vendorForm.qualificationNotes} onChange={event => setVendorForm({ ...vendorForm, qualificationNotes: event.target.value })} />
                      <textarea className="rounded-lg border border-black/15 px-2 py-1.5 text-sm sm:col-span-2" placeholder="Source confidence notes (if any)" value={vendorForm.sourceConfidenceNotes} onChange={event => setVendorForm({ ...vendorForm, sourceConfidenceNotes: event.target.value })} />
                    </div>
                    <button
                      className="mt-3 rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                      disabled={generateDraft.isPending}
                      onClick={submitDraftRequest}
                      type="button"
                    >
                      Generate outreach draft
                    </button>

                    {generateDraft.data && !generateDraft.data.allowed ? (
                      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                        {generateDraft.data.blockedReasons.map(label).join(" · ")}
                      </div>
                    ) : null}

                    {generateDraft.data?.allowed ? (
                      <div className="mt-4 space-y-3">
                        <div className="rounded-lg border border-black/10 bg-black/[0.02] p-3">
                          <p className="text-xs font-bold uppercase tracking-[0.1em] text-black/45">Draft (no-send, admin-only)</p>
                          <p className="mt-1 text-sm font-semibold">{generateDraft.data.draft.subject}</p>
                          <pre className="mt-1 whitespace-pre-wrap text-sm text-black/75">{generateDraft.data.draft.body}</pre>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button className="flex items-center gap-1.5 rounded-lg border border-black/15 px-3 py-1.5 text-xs font-semibold" onClick={copyDraftToClipboard} type="button">
                            <Copy className="h-3.5 w-3.5" />Copy draft
                          </button>
                          <select className="rounded-lg border border-black/15 px-2 py-1.5 text-xs" value={attemptChannel} onChange={event => setAttemptChannel(event.target.value as AttemptChannel)}>
                            <option value="">Channel used&hellip;</option>
                            {ATTEMPT_CHANNELS.map(channel => <option key={channel} value={channel}>{label(channel)}</option>)}
                          </select>
                          <button
                            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900 disabled:opacity-40"
                            disabled={!attemptChannel}
                            onClick={() => setManuallySent(true)}
                            type="button"
                          >
                            I sent this manually
                          </button>
                          <span className="rounded-full bg-black/[0.06] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-black/55">
                            Status: {label(attemptStatus)} (non-durable, this session only)
                          </span>
                        </div>
                        {manuallySent ? (
                          <p className="text-xs text-black/55">
                            Logged as a manual/mock attempt only. No outreach was sent by HELD, no vendor has responded, and no
                            provider has accepted. The lead is now treated as response-pending.
                          </p>
                        ) : null}

                        <div className="rounded-lg border border-black/15 bg-white p-3">
                          <p className="text-xs font-bold uppercase tracking-[0.1em] text-black/45">Real candidate creation</p>
                          {!createCandidate.data ? (
                            !confirmCreateOpen ? (
                              <button
                                className="mt-2 rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white"
                                onClick={() => setConfirmCreateOpen(true)}
                                type="button"
                              >
                                Create Real Candidate
                              </button>
                            ) : (
                              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                                <ul className="list-disc space-y-1 pl-5 text-xs text-amber-950">
                                  <li>This creates a sourcing candidate only.</li>
                                  <li>No outreach has been sent by HELD.</li>
                                  <li>No vendor has responded.</li>
                                  <li>No provider has accepted.</li>
                                  <li>No booking is confirmed.</li>
                                  <li>No proposal is resident-ready.</li>
                                </ul>
                                {candidatePayload.data && !candidatePayload.data.allowed ? (
                                  <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                                    {candidatePayload.data.blockedReasons.map(label).join(" · ")}
                                  </div>
                                ) : null}
                                <div className="mt-3 flex items-center gap-2">
                                  <button
                                    className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                                    disabled={candidatePayload.isPending || createCandidate.isPending}
                                    onClick={confirmCreateRealCandidate}
                                    type="button"
                                  >
                                    Confirm: Create Real Candidate
                                  </button>
                                  <button
                                    className="rounded-lg border border-black/15 px-3 py-1.5 text-xs font-semibold"
                                    onClick={() => setConfirmCreateOpen(false)}
                                    type="button"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )
                          ) : (
                            <div className="mt-2 space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950">
                              <p><span className="font-semibold">Candidate id:</span> {createCandidate.data.candidateId}</p>
                              <p><span className="font-semibold">Status:</span> sourcing candidate created, not scored, not promoted</p>
                              <p><span className="font-semibold">Source request:</span> {appliedSourceKey}</p>
                              <p><span className="font-semibold">Selected lead/lane:</span> {handoff.data.handoff.businessNameForDisplayOnly} ({LANE_LABELS[handoff.data.handoff.lane]})</p>
                              <p className="font-semibold">Still has not happened:</p>
                              <ul className="list-disc space-y-0.5 pl-5">
                                <li>No outreach sent</li>
                                <li>No vendor response</li>
                                <li>No provider acceptance</li>
                                <li>No booking</li>
                                <li>No resident proposal ready</li>
                              </ul>
                              <p className="mt-1">
                                <span className="font-semibold">Recommended next step:</span> manually send/call the vendor using
                                the copied draft above; once they reply, record the real response and terms in the First Real
                                Proposal Bootstrap tool (/proposal-bootstrap) rather than inventing a response here.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
