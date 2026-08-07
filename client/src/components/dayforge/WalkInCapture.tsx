import { useEffect, useRef, useState } from "react";
import { CalendarPlus, CheckCircle2, Loader2, MapPin, Mic, Pencil, Square, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const relationshipTypes = [
  "unknown",
  "concierge",
  "front_desk",
  "gatekeeper",
  "decision_maker",
  "champion",
] as const;

const businessTypes = ["hotel", "multifamily", "spa_salon", "office", "other"] as const;
const visitResults = ["follow_up", "won", "lost", "no_contact"] as const;

type RelationshipType = (typeof relationshipTypes)[number];
type BusinessType = (typeof businessTypes)[number];
type VisitResult = (typeof visitResults)[number];

type WalkInDraft = {
  transcript: string;
  businessName: string;
  businessType: BusinessType;
  address: string | null;
  locationHint: string | null;
  locationNeedsReview: boolean;
  googlePlaceId: string | null;
  googleMapsUrl?: string | null;
  contactName: string | null;
  contactTitle: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  relationshipType: RelationshipType;
  conversationNotes: string;
  visitResult: VisitResult;
  nextAction: string;
  followUpAt: string;
  collateralDelivered: boolean;
  quoteRequested: boolean;
  pilotRequested: boolean;
  timeZone: string;
};

function tomorrowMorning() {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  value.setHours(9, 0, 0, 0);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function localInputFromIso(value: string | null | undefined) {
  if (!value) return tomorrowMorning();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return tomorrowMorning();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function emptyDraft(): WalkInDraft {
  return {
    transcript: "Manual walk-in entry",
    businessName: "",
    businessType: "multifamily",
    address: null,
    locationHint: null,
    locationNeedsReview: true,
    googlePlaceId: null,
    contactName: null,
    contactTitle: null,
    contactEmail: null,
    contactPhone: null,
    relationshipType: "unknown",
    conversationNotes: "",
    visitResult: "follow_up",
    nextAction: "Follow up with details",
    followUpAt: tomorrowMorning(),
    collateralDelivered: false,
    quoteRequested: false,
    pilotRequested: false,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles",
  };
}

function blobDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function WalkInCapture(props: {
  open: boolean;
  onClose: () => void;
  onSaved?: (result: {
    missionId: number;
    missionCode: string;
    calendar?: { status: string; eventId: string | null; htmlLink: string | null };
    locationNeedsReview?: boolean;
  }) => void;
}) {
  const parse = trpc.system.voiceWalkIn.parse.useMutation();
  const save = trpc.system.voiceWalkIn.save.useMutation();
  const calendarStatus = trpc.system.voiceWalkIn.calendarStatus.useQuery(undefined, { enabled: props.open });
  const calendarConnect = trpc.system.voiceWalkIn.calendarConnectUrl.useMutation();
  const [draft, setDraft] = useState<WalkInDraft | null>(null);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  };

  useEffect(() => () => stopTracks(), []);
  useEffect(() => {
    if (!props.open) {
      setDraft(null);
      setRecording(false);
      recorderRef.current = null;
      chunksRef.current = [];
      stopTracks();
    }
  }, [props.open]);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = event => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
          const audioDataUrl = await blobDataUrl(blob);
          const parsed = await parse.mutateAsync({
            audioDataUrl,
            nowIso: new Date().toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles",
          });
          setDraft({
            ...parsed,
            businessType: parsed.businessType as BusinessType,
            relationshipType: parsed.relationshipType as RelationshipType,
            visitResult: parsed.visitResult as VisitResult,
            followUpAt: localInputFromIso(parsed.followUpAt),
          });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not understand this visit.");
        } finally {
          stopTracks();
        }
      };
      recorder.start(500);
      setRecording(true);
    } catch {
      toast.error("Microphone access is needed to log the visit by voice.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  async function connectCalendar() {
    try {
      const result = await calendarConnect.mutateAsync();
      window.location.assign(result.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start Google Calendar connection.");
    }
  }

  async function saveEverything() {
    if (!draft) return;
    if (!draft.businessName.trim()) return toast.error("Business name is required.");
    if (!draft.conversationNotes.trim()) return toast.error("Add what happened.");
    if (!draft.nextAction.trim()) return toast.error("Add the next action.");
    if (draft.visitResult === "follow_up" && !draft.followUpAt) return toast.error("Choose a follow-up time.");

    try {
      const result = await save.mutateAsync({
        requestId: crypto.randomUUID(),
        transcript: draft.transcript || draft.conversationNotes,
        businessName: draft.businessName.trim(),
        businessType: draft.businessType,
        address: draft.address?.trim() || null,
        locationHint: draft.locationHint?.trim() || null,
        locationNeedsReview: draft.locationNeedsReview || !draft.address?.trim(),
        googlePlaceId: draft.googlePlaceId,
        contactName: draft.contactName?.trim() || null,
        contactTitle: draft.contactTitle?.trim() || null,
        contactEmail: draft.contactEmail?.trim() || null,
        contactPhone: draft.contactPhone?.trim() || null,
        relationshipType: draft.relationshipType,
        conversationNotes: draft.conversationNotes.trim(),
        visitResult: draft.visitResult,
        nextAction: draft.nextAction.trim(),
        followUpAt: draft.followUpAt ? new Date(draft.followUpAt) : null,
        collateralDelivered: draft.collateralDelivered,
        quoteRequested: draft.quoteRequested,
        pilotRequested: draft.pilotRequested,
        timeZone: draft.timeZone,
      });
      if (result.calendar.status === "created" || result.calendar.status === "already_exists") {
        toast.success("Visit saved. Google Calendar follow-up added.");
      } else if (result.calendar.status === "not_connected") {
        toast.success("Visit saved. Internal follow-up scheduled; Google Calendar is not connected yet.");
      } else if (result.calendar.status === "failed") {
        toast.warning("Visit saved. Google Calendar could not be updated, but the lead and follow-up are safe.");
      } else {
        toast.success("Visit saved.");
      }
      props.onSaved?.(result);
      if (!props.onSaved) window.location.assign(`/commercial-missions?mission=${result.missionId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the visit.");
    }
  }

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-[#07111f] text-white sm:bg-black/75 sm:p-5">
      <section className="mx-auto min-h-full max-w-xl bg-[#07111f] p-4 sm:min-h-0 sm:rounded-3xl sm:border sm:border-white/15 sm:p-6">
        <header className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black tracking-[.2em] text-orange-400">VOICE-FIRST FIELD MEMORY</p>
            <h2 className="mt-1 text-2xl font-black">Log this visit</h2>
            <p className="mt-1 text-sm text-slate-400">Say what happened. DayForge fills the CRM, finds the address, and schedules the next move.</p>
          </div>
          <button type="button" aria-label="Close" disabled={recording || parse.isPending || save.isPending} onClick={props.onClose} className="rounded-xl border border-white/15 p-3 disabled:opacity-30"><X /></button>
        </header>

        {!draft ? (
          <div className="space-y-4">
            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              disabled={parse.isPending}
              className={`flex min-h-[180px] w-full flex-col items-center justify-center gap-4 rounded-[28px] border-2 text-xl font-black shadow-2xl transition ${recording ? "border-red-300 bg-red-500" : "border-orange-300 bg-orange-500"} disabled:opacity-50`}
            >
              {parse.isPending ? <><Loader2 className="h-12 w-12 animate-spin" /> Understanding visit…</> : recording ? <><Square className="h-12 w-12 fill-current" /> Tap when finished</> : <><Mic className="h-14 w-14" /> Talk</>}
            </button>
            <p className="px-2 text-center text-sm leading-relaxed text-slate-400">Example: “I visited The Louise on Edgemont near Kaiser. I spoke to Dana, the GM. He’ll post my flyer in the mail room. Email him the collateral in three or four hours.”</p>
            <button type="button" onClick={() => setDraft(emptyDraft())} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 font-bold text-slate-200"><Pencil className="h-4 w-4" /> Enter manually instead</button>
            {parse.error ? <p role="alert" className="rounded-xl bg-red-500/15 p-3 text-sm text-red-200">{parse.error.message}</p> : null}
          </div>
        ) : (
          <div className="space-y-4">
            <section className="rounded-2xl border border-orange-300/25 bg-orange-400/10 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-orange-300" />
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[.15em] text-orange-300">I heard</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-200">{draft.transcript}</p>
                </div>
              </div>
            </section>

            <label className="block text-sm font-bold">Business / building<input value={draft.businessName} onChange={event => setDraft({ ...draft, businessName: event.target.value })} autoFocus className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3 text-base" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-bold">Business type<select value={draft.businessType} onChange={event => setDraft({ ...draft, businessType: event.target.value as BusinessType })} className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-3"><option value="multifamily">Multifamily</option><option value="hotel">Hotel</option><option value="spa_salon">Spa / salon</option><option value="office">Office</option><option value="other">Other</option></select></label>
              <label className="block text-sm font-bold">Result<select value={draft.visitResult} onChange={event => setDraft({ ...draft, visitResult: event.target.value as VisitResult })} className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-3"><option value="follow_up">Follow up</option><option value="no_contact">No contact</option><option value="won">Won</option><option value="lost">Lost</option></select></label>
            </div>

            <label className="block text-sm font-bold">Address <span className="font-normal text-slate-500">— no longer required</span><div className={`mt-1 rounded-xl border px-4 py-3 ${draft.address && !draft.locationNeedsReview ? "border-emerald-400/30 bg-emerald-400/10" : "border-amber-400/30 bg-amber-400/10"}`}><div className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /><input value={draft.address ?? ""} onChange={event => setDraft({ ...draft, address: event.target.value || null, locationNeedsReview: !event.target.value })} placeholder={draft.locationHint || "Leave blank if you do not know it"} className="min-w-0 flex-1 bg-transparent outline-none" /></div><p className="mt-2 text-xs text-slate-400">{draft.address && !draft.locationNeedsReview ? "Google Places matched this location." : "The visit will still save. Admin will mark the location for review if unresolved."}</p></div></label>

            <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-bold">Contact<input value={draft.contactName ?? ""} onChange={event => setDraft({ ...draft, contactName: event.target.value || null })} placeholder="Dana" className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3" /></label><label className="block text-sm font-bold">Title<input value={draft.contactTitle ?? ""} onChange={event => setDraft({ ...draft, contactTitle: event.target.value || null })} placeholder="General Manager" className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3" /></label></div>
            <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-bold">Email<input value={draft.contactEmail ?? ""} onChange={event => setDraft({ ...draft, contactEmail: event.target.value || null })} type="email" inputMode="email" className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3" /></label><label className="block text-sm font-bold">Phone<input value={draft.contactPhone ?? ""} onChange={event => setDraft({ ...draft, contactPhone: event.target.value || null })} type="tel" inputMode="tel" className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3" /></label></div>
            <label className="block text-sm font-bold">Relationship<select value={draft.relationshipType} onChange={event => setDraft({ ...draft, relationshipType: event.target.value as RelationshipType })} className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-3"><option value="unknown">Unknown</option><option value="concierge">Concierge</option><option value="front_desk">Front desk</option><option value="gatekeeper">Gatekeeper</option><option value="decision_maker">Decision maker</option><option value="champion">Champion</option></select></label>
            <label className="block text-sm font-bold">What happened?<textarea value={draft.conversationNotes} onChange={event => setDraft({ ...draft, conversationNotes: event.target.value })} rows={3} className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3" /></label>
            <label className="block text-sm font-bold">Next action<input value={draft.nextAction} onChange={event => setDraft({ ...draft, nextAction: event.target.value })} className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3" /></label>
            <label className="block text-sm font-bold">Follow up<input value={draft.followUpAt} onChange={event => setDraft({ ...draft, followUpAt: event.target.value })} type="datetime-local" disabled={draft.visitResult === "won" || draft.visitResult === "lost"} className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3 disabled:opacity-40" /></label>
            <div className="flex flex-wrap gap-4 text-sm"><label><input checked={draft.collateralDelivered} onChange={event => setDraft({ ...draft, collateralDelivered: event.target.checked })} type="checkbox" className="mr-2" />Collateral delivered</label><label><input checked={draft.quoteRequested} onChange={event => setDraft({ ...draft, quoteRequested: event.target.checked })} type="checkbox" className="mr-2" />Quote requested</label><label><input checked={draft.pilotRequested} onChange={event => setDraft({ ...draft, pilotRequested: event.target.checked })} type="checkbox" className="mr-2" />Pilot requested</label></div>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3"><CalendarPlus className="h-5 w-5 text-sky-300" /><div><p className="font-black">Google Calendar</p><p className="text-xs text-slate-400">{calendarStatus.data?.connected ? `Connected${calendarStatus.data.connectedEmail ? ` · ${calendarStatus.data.connectedEmail}` : ""}` : calendarStatus.data?.configured === false ? "OAuth credentials need to be added on the server." : "Connect once and future visit follow-ups are added automatically."}</p></div></div>
                {!calendarStatus.data?.connected && calendarStatus.data?.configured !== false ? <button type="button" onClick={connectCalendar} disabled={calendarConnect.isPending} className="shrink-0 rounded-xl bg-sky-500 px-3 py-2 text-xs font-black text-white disabled:opacity-50">CONNECT</button> : null}
              </div>
            </section>

            {save.error ? <p role="alert" className="rounded-xl bg-red-500/15 p-3 text-red-200">{save.error.message}</p> : null}
            <div className="grid grid-cols-[1fr_2fr] gap-3">
              <button type="button" onClick={() => setDraft(null)} disabled={save.isPending} className="min-h-16 rounded-2xl border border-white/15 font-black text-slate-300 disabled:opacity-40">RE-RECORD</button>
              <button type="button" onClick={saveEverything} disabled={save.isPending} className="flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-orange-500 px-6 text-lg font-black disabled:opacity-50">{save.isPending ? <><Loader2 className="animate-spin" /> SAVING…</> : "SAVE EVERYTHING"}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
