import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { startBrowserSpeechTranscript, type BrowserSpeechSession } from "@/lib/browserSpeechRecognition";

type Phase = "idle" | "connecting" | "listening" | "processing" | "speaking" | "ended" | "error";
type Line = { who: "you" | "claire"; text: string };

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Comms closed",
  connecting: "Connecting to Claire…",
  listening: "Listening — speak, then pause",
  processing: "Claire is thinking…",
  speaking: "Claire is speaking — tap the mic to interrupt",
  ended: "Comms ended",
  error: "Comms problem",
};

const SILENCE_MS = 1800;

function newSessionId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `desk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * OPEN COMMS: an in-app voice conversation with the same Claire runtime as the
 * daily calls. Browser speech in, server Claire turn, browser speech out. Text
 * is always available. Nothing is "saved" unless the server says it persisted.
 */
export function OpenComms({ onChanged }: { onChanged: () => void }) {
  const comms = trpc.system.weeklyMission.deskComms.useMutation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [pendingApproval, setPendingApproval] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [voiceIn, setVoiceIn] = useState(true);
  const sessionId = useRef<string>(newSessionId());
  const recognition = useRef<BrowserSpeechSession | null>(null);
  const silenceTimer = useRef<number | null>(null);
  const transcript = useRef("");
  const active = phase !== "idle" && phase !== "ended";
  const voiceOut = typeof window !== "undefined" && "speechSynthesis" in window;

  const stopListening = useCallback(() => {
    if (silenceTimer.current) window.clearTimeout(silenceTimer.current);
    silenceTimer.current = null;
    recognition.current?.abort();
    recognition.current = null;
  }, []);

  const send = useCallback(
    async (utterance?: string) => {
      stopListening();
      const text = utterance?.trim();
      if (utterance !== undefined && !text) return;
      if (text) setLines(l => [...l, { who: "you", text }]);
      setLive("");
      setPhase(text ? "processing" : "connecting");
      setError(null);
      try {
        const r = await comms.mutateAsync({ sessionId: sessionId.current, ...(text ? { utterance: text } : {}) });
        setLines(l => [...l, { who: "claire", text: r.speak }]);
        if (r.saved.length) setSaved(s => [...s, ...r.saved]);
        setPendingApproval(r.awaitingApproval?.summary ?? null);
        onChanged();
        speak(r.speak, r.end);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Claire could not be reached.");
        setPhase("error");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comms, onChanged, stopListening]
  );

  const listen = useCallback(() => {
    if (!voiceIn) {
      setPhase("listening");
      return;
    }
    transcript.current = "";
    const session = startBrowserSpeechTranscript({
      onTranscript: text => {
        transcript.current = text;
        setLive(text);
        if (silenceTimer.current) window.clearTimeout(silenceTimer.current);
        silenceTimer.current = window.setTimeout(() => void send(transcript.current), SILENCE_MS);
      },
    });
    if (!session) {
      setVoiceIn(false);
      setError("Voice input isn't available in this browser or the microphone was blocked. Type to Claire below.");
    }
    recognition.current = session;
    setPhase("listening");
  }, [send, voiceIn]);

  const speak = useCallback(
    (text: string, end: boolean) => {
      const finish = () => (end ? setPhase("ended") : listen());
      if (!voiceOut) return finish();
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      u.onend = finish;
      u.onerror = finish;
      setPhase("speaking");
      window.speechSynthesis.speak(u);
    },
    [listen, voiceOut]
  );

  async function open() {
    sessionId.current = newSessionId();
    setLines([]);
    setSaved([]);
    setPendingApproval(null);
    setError(null);
    setPhase("connecting");
    // Ask for the microphone up front so the operator sees the browser prompt once.
    if (voiceIn && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
      } catch {
        setVoiceIn(false);
        setError("Microphone permission was not granted. You can type to Claire instead.");
      }
    }
    await send();
  }

  function interrupt() {
    if (voiceOut) window.speechSynthesis.cancel();
    listen();
  }

  function end() {
    stopListening();
    if (voiceOut) window.speechSynthesis.cancel();
    setPhase("ended");
  }

  function submitTyped(e: FormEvent) {
    e.preventDefault();
    const text = typed.trim();
    if (!text || phase === "processing") return;
    setTyped("");
    if (voiceOut) window.speechSynthesis.cancel();
    void send(text);
  }

  useEffect(() => () => end(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="cd-comms" aria-label="Open comms with Claire" data-testid="open-comms">
      {!active ? (
        <button type="button" className="cd-comms-button" onClick={() => void open()} data-testid="open-comms-button">
          <span className="cd-comms-icon" aria-hidden>◉</span>
          <span>
            <strong>OPEN COMMS</strong>
            <small>Talk to Claire — plan, change, report</small>
          </span>
        </button>
      ) : (
        <div className="cd-comms-live">
          <div className="cd-comms-status" role="status" aria-live="polite" data-testid="open-comms-phase" data-phase={phase}>
            <span className={`cd-dot cd-dot-${phase}`} aria-hidden />
            {PHASE_LABEL[phase]}
          </div>
          {live ? <p className="cd-comms-heard">Hearing: “{live}”</p> : null}
          <div className="cd-comms-controls">
            {phase === "speaking" ? (
              <button type="button" onClick={interrupt}>Interrupt</button>
            ) : phase === "listening" && voiceIn ? (
              <button type="button" onClick={() => void send(transcript.current)} disabled={!live}>Done talking</button>
            ) : null}
            <button type="button" className="cd-end" onClick={end} data-testid="open-comms-end">End comms</button>
          </div>
        </div>
      )}
      {error ? <p role="alert" className="cd-error">{error}</p> : null}
      {lines.length ? (
        <ol className="cd-comms-log" data-testid="open-comms-log">
          {lines.map((l, i) => (
            <li key={i} className={`cd-line cd-line-${l.who}`}>
              <strong>{l.who === "you" ? "Claire heard" : "Claire"}:</strong> {l.text}
            </li>
          ))}
        </ol>
      ) : null}
      {pendingApproval ? (
        <p className="cd-pending" data-testid="open-comms-pending">
          Waiting for your clear yes: {pendingApproval} Nothing has changed until you approve.
        </p>
      ) : null}
      {saved.length ? (
        <div className="cd-saved" data-testid="open-comms-saved">
          <strong>Verified saved</strong>
          <ul>{saved.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      ) : null}
      {active || phase === "ended" ? (
        <form onSubmit={submitTyped} className="cd-comms-type">
          <label htmlFor="cd-type" className="cd-sr">Type to Claire</label>
          <input
            id="cd-type"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            placeholder={phase === "ended" ? "Comms ended — open again to continue" : "Or type to Claire"}
            disabled={phase === "ended"}
            data-testid="open-comms-input"
          />
          <button type="submit" disabled={!typed.trim() || phase === "processing" || phase === "ended"}>Send</button>
        </form>
      ) : null}
    </section>
  );
}
