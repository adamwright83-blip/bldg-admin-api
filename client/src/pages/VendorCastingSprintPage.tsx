import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRightCircle, Bot, Copy, Loader2, Trophy } from "lucide-react";
import { Link } from "wouter";
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
  const [heldChannel, setHeldChannel] = useState<AttemptChannel | "">("");
  const [replyText, setReplyText] = useState("");
  const [replyChannel, setReplyChannel] = useState<AttemptChannel | "">("");
  const [replyFromAddress, setReplyFromAddress] = useState("");
  const [canaryRecipientEmail, setCanaryRecipientEmail] = useState("");
  const [canaryConfirmationText, setCanaryConfirmationText] = useState("");
  const [canaryConfirmOpen, setCanaryConfirmOpen] = useState(false);

  const result = trpc.admin.vendorCastingSprint.mission.useQuery({ sourceKey: appliedSourceKey });
  const handoff = trpc.admin.vendorCastingSprint.bootstrapHandoff.useQuery(
    { sourceKey: appliedSourceKey, leadId: selectedLeadId },
    { enabled: consoleOpen },
  );
  const generateDraft = trpc.admin.vendorCastingSprint.generateOutreachDraft.useMutation();
  const candidatePayload = trpc.admin.vendorCastingSprint.candidateCreationPayload.useMutation();
  const createCandidate = trpc.admin.firstRealProposalBootstrap.createCandidate.useMutation();
  const runContactAttempt = trpc.admin.vendorCastingSprint.runContactAttempt.useMutation();
  const simulateReply = trpc.admin.vendorCastingSprint.simulateVendorReply.useMutation();
  const auditFeed = trpc.admin.vendorCastingSprint.contactAttemptsBySourceKey.useQuery(
    { sourceKey: appliedSourceKey },
    { enabled: consoleOpen },
  );
  const providerReadiness = trpc.admin.vendorCastingSprint.providerReadiness.useQuery(undefined, { enabled: consoleOpen });
  const runGatedFutureAttempt = trpc.admin.vendorCastingSprint.runContactAttempt.useMutation();
  const runAgentMailCanary = trpc.admin.vendorCastingSprint.runSupervisedAgentMailCanary.useMutation();

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
    setHeldChannel("");
    setReplyText("");
    setReplyChannel("");
    setReplyFromAddress("");
    generateDraft.reset();
    candidatePayload.reset();
    createCandidate.reset();
    runContactAttempt.reset();
    simulateReply.reset();
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
    runContactAttempt.reset();
    simulateReply.reset();
    generateDraft.mutate({ sourceKey: appliedSourceKey, leadId, vendorFacts: vendorFactsPayload() });
  }

  function runHeldContactAttempt() {
    const leadId = handoff.data?.handoff?.leadId ?? selectedLeadId;
    if (!leadId || !heldChannel) return;
    simulateReply.reset();
    runContactAttempt.mutate({
      sourceKey: appliedSourceKey,
      leadId,
      candidateId: createCandidate.data?.candidateId ?? null,
      durableDraftId: generateDraft.data?.allowed ? generateDraft.data.durableDraftId : null,
      channel: heldChannel,
      vendorFacts: vendorFactsPayload(),
    }, { onSuccess: () => auditFeed.refetch() });
  }

  /** Always returns blocked in this slice; demonstrates the gate without ever sending. */
  function runGatedLiveEmailAttempt() {
    const leadId = handoff.data?.handoff?.leadId ?? selectedLeadId;
    if (!leadId) return;
    runGatedFutureAttempt.mutate({
      sourceKey: appliedSourceKey,
      leadId,
      candidateId: createCandidate.data?.candidateId ?? null,
      durableDraftId: generateDraft.data?.allowed ? generateDraft.data.durableDraftId : null,
      channel: "email",
      automationMode: "gated_provider_future",
      vendorFacts: vendorFactsPayload(),
    }, { onSuccess: () => auditFeed.refetch() });
  }

  function runSupervisedAgentMailCanary() {
    const durableDraftId = generateDraft.data?.allowed ? generateDraft.data.durableDraftId : null;
    if (!durableDraftId || !canaryRecipientEmail.trim() || !canaryConfirmationText.trim()) return;
    runAgentMailCanary.mutate({
      sourceKey: appliedSourceKey,
      durableDraftId,
      durableAttemptId: runContactAttempt.data?.allowed ? runContactAttempt.data.durableAttemptId : null,
      candidateId: createCandidate.data?.candidateId ?? null,
      leadId: handoff.data?.handoff?.leadId ?? selectedLeadId ?? null,
      channel: "email",
      recipientEmail: canaryRecipientEmail,
      adminConfirmationText: canaryConfirmationText,
    }, { onSuccess: () => { auditFeed.refetch(); setCanaryConfirmOpen(false); } });
  }

  function ingestSimulatedReply() {
    const attempt = runContactAttempt.data?.allowed ? runContactAttempt.data.attempt : null;
    const durableAttemptId = runContactAttempt.data?.allowed ? runContactAttempt.data.durableAttemptId : null;
    if (!attempt || !replyText.trim() || !replyChannel) return;
    simulateReply.mutate({
      sourceKey: appliedSourceKey,
      attemptId: attempt.attemptId,
      durableAttemptId,
      candidateId: attempt.candidateId,
      channel: replyChannel,
      rawReplyText: replyText,
      fromAddressOrPhone: replyFromAddress || null,
    }, { onSuccess: () => auditFeed.refetch() });
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
            HELD runs the casting sprint, prepares the contact attempt, passes it through a safety gate, and
            executes a no-op provider path while waiting on a real vendor reply &mdash; automation is the
            product, manual copy below is fallback/test harness only. No real email, SMS, call, or form
            submission happens in this slice.
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

                  <details className="rounded-lg border border-black/10 bg-white p-3">
                    <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.1em] text-black/45">
                      Fallback: manually import/correct a vendor
                    </summary>
                    <p className="mt-1 text-xs text-black/50">
                      Use only when HELD cannot source or parse a vendor automatically.
                    </p>
                    <p className="mt-2 text-xs font-bold uppercase tracking-[0.1em] text-black/45">
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
                          <p className="mt-2 text-xs text-black/50">
                            {generateDraft.data.persisted
                              ? <>HELD persisted the draft. Durable draft id: <span className="font-mono">{generateDraft.data.durableDraftId}</span></>
                              : "HELD could not persist this draft durably; continuing with the in-memory draft only."}
                          </p>
                        </div>

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
                            </div>
                          )}
                        </div>

                        <div className="rounded-lg border border-black/15 bg-white p-3">
                          <p className="text-xs font-bold uppercase tracking-[0.1em] text-black/45">Provider readiness</p>
                          {providerReadiness.isLoading ? (
                            <p className="mt-2 text-xs text-black/50">Loading provider readiness&hellip;</p>
                          ) : providerReadiness.data ? (
                            <div className="mt-2 space-y-2 text-xs">
                              <p className="font-semibold text-emerald-800">
                                ✓ No-op provider: active (mode {label(providerReadiness.data.noop.mode)})
                              </p>
                              <p className="text-amber-800">
                                ⏳ Email provider: gated/future &mdash; {providerReadiness.data.email.configured ? "configured, but " : "not configured, and "}
                                live provider is gated. {providerReadiness.data.email.blockedReasons.map(label).join(" · ")}
                              </p>
                              <p className="text-amber-800">
                                ⏳ Website form provider: gated/future &mdash; {providerReadiness.data.websiteForm.blockedReasons.map(label).join(" · ")}
                              </p>
                              <div className={providerReadiness.data.agentMail.canaryEnabled && providerReadiness.data.agentMail.configured ? "rounded-lg border border-amber-200 bg-amber-50 p-2" : "rounded-lg border border-black/10 bg-black/[0.02] p-2"}>
                                <p className="font-semibold">
                                  {providerReadiness.data.agentMail.configured ? "⏳" : "✕"} AgentMail: {providerReadiness.data.agentMail.configured ? "configured" : "missing config"}
                                  {providerReadiness.data.agentMail.canaryEnabled ? ", canary enabled" : ", canary disabled"}
                                </p>
                                {providerReadiness.data.agentMail.missingEnvVars.length > 0 ? (
                                  <p className="mt-1 text-black/55">Missing env vars: {providerReadiness.data.agentMail.missingEnvVars.join(", ")}</p>
                                ) : null}
                                <p className="mt-1 text-black/55">
                                  Source allowlist: {providerReadiness.data.agentMail.sourceAllowlist.join(", ") || "none"} &middot;
                                  {" "}Category allowlist: {providerReadiness.data.agentMail.categoryAllowlist.join(", ") || "none"}
                                </p>
                                <p className="mt-1 text-black/55">
                                  Inbox id present: {providerReadiness.data.agentMail.inboxIdPresent ? "yes" : "no"} &middot;
                                  {" "}Inbox email present: {providerReadiness.data.agentMail.inboxEmailPresent ? "yes" : "no"}
                                </p>
                                <p className="mt-1 font-semibold">Live provider is gated. Live send allowed: {String(providerReadiness.data.agentMail.liveSendAllowed)}.</p>
                                <p className="mt-1 text-black/55">{providerReadiness.data.agentMail.nextAction}</p>
                                <p className="mt-1 text-black/45">Webhooks (inbound reply ingestion) are deferred to Slice 74f.</p>
                              </div>
                              <p className="font-semibold text-black/70">No real vendor contact will be sent automatically in this slice.</p>
                              <p className="text-black/55">Next canary slice can enable supervised email: {providerReadiness.data.nextRequiredActionForCanary}</p>
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  className="rounded-lg border border-black/15 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                                  disabled={runGatedFutureAttempt.isPending}
                                  onClick={runGatedLiveEmailAttempt}
                                  type="button"
                                >
                                  Run gated live email (always blocked)
                                </button>
                                {runGatedFutureAttempt.data && !runGatedFutureAttempt.data.allowed ? (
                                  <span className="text-xs text-red-700">Blocked: {runGatedFutureAttempt.data.blockedReasons.map(label).join(" · ")}</span>
                                ) : null}
                              </div>

                              {generateDraft.data?.allowed && generateDraft.data.durableDraftId ? (
                                <div className="mt-3 rounded-lg border-2 border-amber-300 bg-amber-50 p-3">
                                  <p className="text-xs font-bold uppercase tracking-[0.1em] text-amber-900">AgentMail supervised email canary</p>
                                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-950">
                                    <li>This does not book anything.</li>
                                    <li>This does not mean the provider accepted.</li>
                                    <li>This does not authorize payment.</li>
                                    <li>This does not dispatch.</li>
                                  </ul>
                                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                    <input
                                      className="rounded-lg border border-black/15 px-2 py-1.5 text-xs"
                                      placeholder="Recipient email"
                                      value={canaryRecipientEmail}
                                      onChange={event => setCanaryRecipientEmail(event.target.value)}
                                    />
                                    <p className="text-xs text-amber-900/80">AgentMail inbox: held@agentmail.to</p>
                                  </div>
                                  {!canaryConfirmOpen ? (
                                    <button
                                      className="mt-2 rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                                      disabled={!canaryRecipientEmail.trim()}
                                      onClick={() => setCanaryConfirmOpen(true)}
                                      type="button"
                                    >
                                      Send supervised email canary&hellip;
                                    </button>
                                  ) : (
                                    <div className="mt-2 space-y-2">
                                      <p className="text-xs text-amber-900">
                                        Type exactly <span className="font-mono font-semibold">SEND SUPERVISED EMAIL CANARY</span> to confirm:
                                      </p>
                                      <input
                                        className="w-full rounded-lg border border-black/15 px-2 py-1.5 text-xs font-mono"
                                        placeholder="SEND SUPERVISED EMAIL CANARY"
                                        value={canaryConfirmationText}
                                        onChange={event => setCanaryConfirmationText(event.target.value)}
                                      />
                                      <div className="flex items-center gap-2">
                                        <button
                                          className="rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                                          disabled={runAgentMailCanary.isPending || canaryConfirmationText !== "SEND SUPERVISED EMAIL CANARY"}
                                          onClick={runSupervisedAgentMailCanary}
                                          type="button"
                                        >
                                          Confirm send
                                        </button>
                                        <button
                                          className="rounded-lg border border-black/15 px-3 py-1.5 text-xs font-semibold"
                                          onClick={() => { setCanaryConfirmOpen(false); setCanaryConfirmationText(""); }}
                                          type="button"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  )}

                                  {runAgentMailCanary.data && !runAgentMailCanary.data.allowed ? (
                                    <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                                      Blocked: {runAgentMailCanary.data.blockedReasons.map(label).join(" · ")}
                                    </div>
                                  ) : null}

                                  {runAgentMailCanary.data?.allowed ? (
                                    <div className="mt-2 space-y-1 rounded-lg border border-emerald-200 bg-white p-2 text-xs text-emerald-950">
                                      <p>AgentMail inbox: held@agentmail.to &middot; Recipient: {canaryRecipientEmail}</p>
                                      <p>Durable attempt id: <span className="font-mono">{runAgentMailCanary.data.durableAttemptId}</span></p>
                                      {runAgentMailCanary.data.sendResult?.providerAttemptId ? (
                                        <p>Provider message id: <span className="font-mono">{runAgentMailCanary.data.sendResult.providerAttemptId}</span></p>
                                      ) : null}
                                      <p className="font-semibold">Status: response pending &mdash; HELD is waiting for vendor reply.</p>
                                      <p className="text-black/55">HELD labels stored on the AgentMail message (or in the durable attempt if unsupported).</p>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>

                        <div className="rounded-lg border-2 border-indigo-200 bg-indigo-50/50 p-3">
                          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.1em] text-indigo-900">
                            <Bot className="h-3.5 w-3.5" />HELD execution loop (automation-first)
                          </div>
                          <p className="mt-1 text-xs text-indigo-900/70">
                            HELD prepares the contact attempt, passes it through a safety gate, then runs a no-op provider
                            adapter. No real email, SMS, call, or form submission happens in this slice.
                          </p>

                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <select className="rounded-lg border border-black/15 px-2 py-1.5 text-xs" value={heldChannel} onChange={event => setHeldChannel(event.target.value as AttemptChannel)}>
                              <option value="">Channel for HELD to use&hellip;</option>
                              {ATTEMPT_CHANNELS.map(channel => <option key={channel} value={channel}>{label(channel)}</option>)}
                            </select>
                            <button
                              className="rounded-lg bg-indigo-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                              disabled={!heldChannel || runContactAttempt.isPending}
                              onClick={runHeldContactAttempt}
                              type="button"
                            >
                              Run HELD contact attempt
                            </button>
                          </div>

                          {runContactAttempt.data && !runContactAttempt.data.allowed ? (
                            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                              HELD blocked this attempt: {runContactAttempt.data.blockedReasons.map(label).join(" · ")}
                            </div>
                          ) : null}

                          {runContactAttempt.data?.allowed ? (
                            <div className="mt-3 space-y-1 rounded-lg border border-indigo-200 bg-white p-3 text-xs text-indigo-950">
                              <p>✓ HELD prepared contact attempt ({runContactAttempt.data.attempt.attemptId})</p>
                              <p>✓ HELD recorded the send-gate snapshot (founder escalation present, no forbidden claims)</p>
                              <p>
                                ✓ HELD executed the no-op provider path ({label(runContactAttempt.data.providerResult.status)},
                                liveProviderInvoked: false)
                              </p>
                              <p className="font-semibold">⏳ HELD is waiting for vendor reply (status: {label(runContactAttempt.data.attempt.status)})</p>
                              <p className="text-indigo-900/70">
                                {runContactAttempt.data.persisted
                                  ? <>Durable attempt id: <span className="font-mono">{runContactAttempt.data.durableAttemptId}</span> &middot; persisted: audited</>
                                  : "Could not persist this attempt durably; continuing in session-local mode only."}
                              </p>
                              {runContactAttempt.data.statusHistory.length > 0 ? (
                                <div className="mt-2">
                                  <p className="font-semibold">Status timeline</p>
                                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                                    {runContactAttempt.data.statusHistory.map((entry, index) => (
                                      <li key={`${entry.status}-${index}`}>{label(entry.status)} &mdash; {entry.actor} &middot; {new Date(entry.at).toLocaleTimeString()}</li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {runContactAttempt.data?.allowed ? (
                            <div className="mt-3 rounded-lg border border-black/10 bg-white p-3">
                              <p className="text-xs font-bold uppercase tracking-[0.1em] text-black/45">
                                Reply intake (local test/simulated webhook)
                              </p>
                              <p className="mt-1 text-xs text-black/55">
                                Simulates a future inbound email/SMS/voice/form reply so the loop can be demoed without a live
                                provider. inboundProvider stays noop_test.
                              </p>
                              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                <select className="rounded-lg border border-black/15 px-2 py-1.5 text-xs" value={replyChannel} onChange={event => setReplyChannel(event.target.value as AttemptChannel)}>
                                  <option value="">Reply channel&hellip;</option>
                                  {ATTEMPT_CHANNELS.map(channel => <option key={channel} value={channel}>{label(channel)}</option>)}
                                </select>
                                <input className="rounded-lg border border-black/15 px-2 py-1.5 text-xs" placeholder="From address/phone (if known)" value={replyFromAddress} onChange={event => setReplyFromAddress(event.target.value)} />
                                <textarea className="rounded-lg border border-black/15 px-2 py-1.5 text-xs sm:col-span-2" placeholder="Raw vendor reply text" value={replyText} onChange={event => setReplyText(event.target.value)} />
                              </div>
                              <button
                                className="mt-2 rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                                disabled={!replyText.trim() || !replyChannel || simulateReply.isPending}
                                onClick={ingestSimulatedReply}
                                type="button"
                              >
                                Ingest vendor reply (test)
                              </button>

                              {simulateReply.data?.interpretedReply ? (
                                <div className="mt-3 space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 text-xs">
                                  <p className="font-semibold text-indigo-950">HELD recorded the reply and response terms</p>
                                  <p>Classification: <span className="font-semibold">{label(simulateReply.data.interpretedReply.classification)}</span></p>
                                  <p className="text-black/60">Available does not mean accepted — availableNotAccepted is always true.</p>
                                  {simulateReply.data.interpretedReply.extractedQuote ? (
                                    <p>Extracted quote: ${simulateReply.data.interpretedReply.extractedQuote.amount} {simulateReply.data.interpretedReply.extractedQuote.currency}</p>
                                  ) : null}
                                  {simulateReply.data.interpretedReply.extractedAvailabilityWindow ? (
                                    <p>Extracted window: {simulateReply.data.interpretedReply.extractedAvailabilityWindow}</p>
                                  ) : null}
                                  {simulateReply.data.interpretedReply.upfrontPaymentRequired ? <p>Upfront payment mentioned by vendor.</p> : null}

                                  {simulateReply.data.persisted ? (
                                    <div className="rounded-lg border border-black/10 bg-white p-2">
                                      <p>Durable attempt updated &middot; status now: <span className="font-semibold">{label(simulateReply.data.updatedStatus ?? "")}</span></p>
                                      <ul className="mt-1 list-disc space-y-0.5 pl-5">
                                        {simulateReply.data.statusHistory.map((entry, index) => (
                                          <li key={`${entry.status}-${index}`}>{label(entry.status)} &mdash; {entry.actor} &middot; {new Date(entry.at).toLocaleTimeString()}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : (
                                    <p className="text-black/50">Could not persist the reply durably; this reply remains session-local only.</p>
                                  )}

                                  {simulateReply.data.termsPacket ? (
                                    <div className="mt-2 rounded-lg border border-emerald-200 bg-white p-2">
                                      <p className="font-semibold text-emerald-950">Response terms packet (review only)</p>
                                      <p>Availability status: {label(simulateReply.data.termsPacket.availabilityStatus)} &middot; Rate status: {label(simulateReply.data.termsPacket.rateStatus)}</p>
                                      {simulateReply.data.termsPacket.quotedAmount != null ? (
                                        <p>Quoted: ${simulateReply.data.termsPacket.quotedAmount} {simulateReply.data.termsPacket.quotedCurrency}</p>
                                      ) : null}
                                      <p className="text-black/60">inquiryOnlyNotBooking: true &middot; residentProposalReady: false</p>
                                      <p className="mt-1 font-semibold">Admin review required before proposal.</p>
                                      <p className="mt-1">{simulateReply.data.termsPacket.recommendedNextStep}</p>
                                      <Link className="mt-2 inline-block rounded-lg border border-black/15 px-2 py-1 text-xs font-semibold" href="/proposal-bootstrap">
                                        Open Proposal Bootstrap
                                      </Link>
                                    </div>
                                  ) : (
                                    <p className="text-red-700">No response terms packet: the reply contained a blocked/forbidden claim and was not treated as truth.</p>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>

                        <div className="rounded-lg border border-black/15 bg-white p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-bold uppercase tracking-[0.1em] text-black/45">Audit feed for this source</p>
                            <button
                              className="rounded-lg border border-black/15 px-2 py-1 text-xs font-semibold disabled:opacity-40"
                              disabled={auditFeed.isFetching}
                              onClick={() => auditFeed.refetch()}
                              type="button"
                            >
                              {auditFeed.isFetching ? "Refreshing…" : "Refresh audit feed"}
                            </button>
                          </div>
                          {auditFeed.data && auditFeed.data.length > 0 ? (
                            <div className="mt-2 space-y-2">
                              {auditFeed.data.map(entry => {
                                const reply = entry.latestReplySummary as { agentMailEventId?: unknown; classification?: unknown } | null;
                                const receivedViaWebhook = Boolean(reply?.agentMailEventId);
                                return (
                                  <div key={entry.attemptId} className="rounded-lg border border-black/10 p-2 text-xs">
                                    <p className="font-mono text-black/50">{entry.attemptId}</p>
                                    <p>
                                      <span className="font-semibold">{label(entry.status)}</span> &middot; {LANE_LABELS[entry.lane ?? ""] ?? entry.lane ?? "no lane"} &middot; {label(entry.channel)} &middot; {label(entry.automationMode)}
                                    </p>
                                    {receivedViaWebhook ? (
                                      <div className="mt-1 rounded-lg border border-indigo-200 bg-indigo-50/40 p-1.5 text-indigo-950">
                                        <p>HELD received the vendor reply.</p>
                                        <p>HELD matched the reply to the durable attempt.</p>
                                        <p>HELD recorded the response terms.</p>
                                        {typeof reply?.classification === "string" ? <p>Interpreted reply: {label(reply.classification)}</p> : null}
                                        <p>provider_responded: true &middot; provider_accepted: false &middot; booking/payment/dispatch: false</p>
                                      </div>
                                    ) : null}
                                    {entry.latestTermsPacketSummary ? (
                                      <p className="text-black/55">Latest terms recorded &middot; admin review required before proposal.</p>
                                    ) : null}
                                    <p className="text-black/40">Updated {new Date(entry.updatedAt).toLocaleString()}</p>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="mt-2 text-xs text-black/50">No durable contact attempts recorded yet for this source.</p>
                          )}
                        </div>

                        <details className="rounded-lg border border-black/10 bg-black/[0.02] p-3">
                          <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.1em] text-black/45">
                            Manual fallback / test harness (not the product path)
                          </summary>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
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
                            <p className="mt-2 text-xs text-black/55">
                              Logged as a manual/mock attempt only. No outreach was sent by HELD, no vendor has responded, and no
                              provider has accepted. The lead is now treated as response-pending.
                            </p>
                          ) : null}
                        </details>
                      </div>
                    ) : null}
                  </details>
                </div>
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
