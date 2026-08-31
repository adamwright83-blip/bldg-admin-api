import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Diamond, Loader2, Mic, Square, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { startBrowserSpeechTranscript, type BrowserSpeechSession } from "@/lib/browserSpeechRecognition";
import { useGoldlineCelebration } from "@/components/goldline/GoldlineCelebrationProvider";
import type { GoldlineLocationSnapshot } from "@/pages/driver/goldlineDriverModel";

export function SalesMomentumMeter() {
  const meter = trpc.system.adaptiveSalesMeter.myMeter.useQuery(undefined, { refetchInterval: 15_000 });
  const progress = Math.round((meter.data?.progress ?? 0) * 100);
  return (
    <section aria-label="30-day sales momentum" className="border-b border-violet-200 bg-gradient-to-r from-slate-950 via-violet-950 to-fuchsia-950 px-[clamp(16px,3vw,34px)] py-[clamp(14px,2.3vw,22px)] text-white">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-[14px] font-black uppercase tracking-[.18em] text-fuchsia-200">{meter.data?.levelLabel ?? "LEVEL 1 · BUILD THE MUSCLE"}</span>
        <span className="text-[14px] font-bold text-white/45">{meter.data?.points ?? 0}/{meter.data?.maxPoints ?? 120}</span>
      </div>
      <div className="mb-2 flex items-end justify-between gap-3">
        <strong className="text-[clamp(14px,1.9vw,19px)] font-black uppercase tracking-[.16em]">Sucker</strong>
        <span className="text-[clamp(14px,1.7vw,17px)] font-bold text-white/60">{progress}% · 30 days</span>
        <strong className="text-[clamp(14px,1.9vw,19px)] font-black uppercase tracking-[.16em] text-fuchsia-200">Hustler</strong>
      </div>
      <div className="relative h-5 rounded-full border border-white/20 bg-white/10 p-1 shadow-inner">
        <div className="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-400 to-amber-300 transition-[width] duration-700" style={{ width: `${Math.max(2, progress)}%` }} />
        {[0, 25, 50, 75, 100].map(stage => <span key={stage} aria-hidden="true" className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-slate-950" style={{ left: `${stage}%` }} />)}
        <motion.span aria-hidden="true" className="absolute top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-fuchsia-500 shadow-[0_0_22px_rgba(232,121,249,.85)]" animate={{ left: `${progress}%` }} transition={{ type: "spring", stiffness: 120, damping: 18 }}>
          <Diamond className="h-3.5 w-3.5 fill-white" />
        </motion.span>
      </div>
      {meter.data?.nextLevelHint ? <p className="mt-2 text-[14px] font-semibold leading-snug text-white/45">{meter.data.nextLevelHint}</p> : null}
    </section>
  );
}

function blobDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Maps a save failure to a truthful, recoverable-state message. Real user
 * input (recording/typed text) is never cleared on any of these paths — see
 * the catch block in `submit()`. Only distinguishes states the code can
 * actually detect; anything else falls back to the raw server message.
 */
export function describeSaveError(error: unknown): string {
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return "Could not reach the server. Your recording is still here — retry when you have signal.";
  }
  const message = error instanceof Error ? error.message : "";
  if (/must be between .* MB|too large/i.test(message)) {
    return "That recording is too large to upload. Try a shorter entry, or type it instead.";
  }
  if (/could not transcribe/i.test(message)) {
    return "Recording uploaded, but transcription is unavailable right now. You can type it instead.";
  }
  return message || "Could not save your journal. Your recording is still here — retry.";
}

function newClientRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `journal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function SalesJournalSheet({ open, onOpenChange, location }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location?: GoldlineLocationSnapshot;
}) {
  const utils = trpc.useUtils();
  const save = trpc.system.commercialMission.saveSalesJournal.useMutation();
  const { celebrate } = useGoldlineCelebration();
  const [recording, setRecording] = React.useState(false);
  const [transcript, setTranscript] = React.useState("");
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const speechRef = React.useRef<BrowserSpeechSession | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const [audioDataUrl, setAudioDataUrl] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [clientRequestId, setClientRequestId] = React.useState(newClientRequestId);
  const [attachLocation, setAttachLocation] = React.useState(true);

  const stopTracks = React.useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }, []);
  React.useEffect(() => () => { speechRef.current?.abort(); stopTracks(); }, [stopTracks]);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      speechRef.current?.abort();
      speechRef.current = startBrowserSpeechTranscript({ initialText: transcript, onTranscript: setTranscript });
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setAudioDataUrl(await blobDataUrl(blob));
        speechRef.current?.stop();
        speechRef.current = null;
        stopTracks();
      };
      recorder.start(500);
      setRecording(true);
    } catch {
      toast.error("Microphone access is needed to record your sales journal.");
    }
  }

  function stopRecording() {
    speechRef.current?.stop();
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  async function submit() {
    setSaveError(null);
    try {
      const date = new Date();
      const journalDate = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
      const availableLocation = location?.status === "available" ? location : null;
      const result = await save.mutateAsync({
        journalDate,
        clientRequestId,
        audioDataUrl: audioDataUrl ?? undefined,
        transcript: transcript.trim() || undefined,
        location: attachLocation && availableLocation ? {
          ...availableLocation.coordinates,
          accuracyMeters: availableLocation.accuracyMeters ?? 0,
          capturedAt: new Date().toISOString(),
          contemporaneous: true,
        } : undefined,
      });
      await Promise.all([
        utils.system.adaptiveSalesMeter.myMeter.invalidate(),
        utils.system.commercialMission.mySalesJournals.invalidate(),
      ]);
      celebrate(result.worldEvent);
      toast.success("Field Journal secured. Processing continues safely in the background.");
      // Only clear captured input on a confirmed, authoritative save — a
      // failed save must never discard the recording or typed transcript.
      setTranscript(""); setAudioDataUrl(null); setClientRequestId(newClientRequestId()); onOpenChange(false);
    } catch (error) {
      const message = describeSaveError(error);
      setSaveError(message);
      toast.error(message);
    }
  }

  return <AnimatePresence>{open ? (
    <motion.div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/70 p-3 backdrop-blur-sm sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !recording && onOpenChange(false)}>
      <motion.section role="dialog" aria-modal="true" aria-labelledby="sales-journal-title" className="w-full max-w-[760px] overflow-hidden rounded-[26px] border border-fuchsia-300/30 bg-[#101624] text-white shadow-2xl" initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }} onClick={event => event.stopPropagation()}>
        <header className="flex items-start justify-between border-b border-white/10 p-[clamp(22px,4vw,38px)]">
          <div><p className="text-sm font-black uppercase tracking-[.2em] text-fuchsia-300">Field Journal · durable evidence</p><h2 id="sales-journal-title" className="mt-2 text-[clamp(30px,4vw,42px)] font-black">Capture what happened</h2><p className="mt-2 max-w-xl text-[clamp(15px,2vw,20px)] text-white/60">Name every property or business you encountered, what was said, what you did, and what needs follow-up. One entry can hold several places.</p></div>
          <button type="button" aria-label="Close journal" disabled={recording} onClick={() => onOpenChange(false)} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 disabled:opacity-30"><X /></button>
        </header>
        <div className="grid gap-4 p-[clamp(18px,3.5vw,32px)]">
          <button type="button" data-testid="journal-record-toggle" onClick={recording ? stopRecording : startRecording} className={`flex min-h-[92px] items-center justify-center gap-4 rounded-[20px] text-xl font-black ${recording ? "bg-red-500" : audioDataUrl ? "bg-emerald-500 text-slate-950" : "bg-fuchsia-500 text-slate-950"}`}>
            {recording ? <><Square className="fill-current" /> Stop recording</> : audioDataUrl ? <><Mic /> Recorded · tap to replace</> : <><Mic /> Start talking</>}
          </button>
          <div className="flex items-center gap-3 text-[14px] font-black uppercase tracking-[.15em] text-white/35"><span className="h-px flex-1 bg-white/10" />or type/correct it<span className="h-px flex-1 bg-white/10" /></div>
          <textarea data-testid="journal-transcript" value={transcript} onChange={event => setTranscript(event.target.value)} rows={5} placeholder="They said they already have laundry machines. I froze and changed the subject…" className="min-h-[130px] resize-none rounded-[18px] border border-white/15 bg-white/[.06] p-4 text-[17px] leading-relaxed outline-none placeholder:text-white/30 focus:border-fuchsia-300" />
          {location ? <label className="flex min-h-12 items-center justify-between gap-4 rounded-[14px] border border-white/10 bg-white/[.04] px-4 text-sm">
            <span><strong className="block text-white/80">Attach current device location</strong><span className="text-white/45">{location.status === "available" ? `Available${location.accuracyMeters ? ` · ±${location.accuracyMeters}m` : ""}` : location.status === "requesting" ? "Still requesting location" : "Unavailable — entry can still be saved"}</span></span>
            <input type="checkbox" checked={attachLocation && location.status === "available"} disabled={location.status !== "available"} onChange={event => setAttachLocation(event.target.checked)} className="h-5 w-5 accent-fuchsia-400" />
          </label> : null}
          <p className="text-sm leading-relaxed text-white/45">The original recording and your exact words are retained before processing. Extracted identities and coaching are labeled as interpretation and can be corrected; they never become confirmed outcomes by themselves.</p>
          {saveError ? (
            <p data-testid="journal-save-error" role="alert" className="rounded-[14px] border border-amber-400/40 bg-amber-500/10 p-3 text-sm leading-relaxed text-amber-100">
              {saveError}
            </p>
          ) : null}
          <button type="button" data-testid="journal-save" onClick={() => void submit()} disabled={recording || save.isPending || (!audioDataUrl && transcript.trim().length < 20)} className="flex min-h-[66px] items-center justify-center gap-3 rounded-[17px] bg-white text-lg font-black text-slate-950 disabled:opacity-35">{save.isPending ? <><Loader2 className="animate-spin" /> Securing evidence…</> : saveError ? "Retry same entry" : "Secure Field Journal"}</button>
        </div>
      </motion.section>
    </motion.div>
  ) : null}</AnimatePresence>;
}
