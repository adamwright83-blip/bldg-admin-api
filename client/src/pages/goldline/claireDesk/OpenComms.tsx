import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

type Phase = "idle" | "connecting" | "listening" | "hearing" | "processing" | "speaking" | "ended" | "error";
type Line = { who: "you" | "claire"; text: string };
type Turn = {
  speak: string;
  heard: string | null;
  saved: string[];
  awaitingApproval: { summary: string } | null;
  end: boolean;
  transcriptionFailed: boolean;
  speechUrl: string | null;
};

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Comms closed",
  connecting: "Connecting to Claire…",
  listening: "Listening — go ahead",
  hearing: "Hearing you…",
  processing: "Claire is thinking…",
  speaking: "Claire is speaking — just talk to interrupt",
  ended: "Comms ended",
  error: "Comms problem",
};

// Voice-activity thresholds on RMS of the mic signal (0..1).
const SPEECH_LEVEL = 0.035;
const BARGE_IN_LEVEL = 0.07;
const END_SILENCE_MS = 1300;
const MAX_TURN_MS = 30_000;

function newSessionId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `desk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * OPEN COMMS: an in-app voice conversation with the same Claire runtime as the
 * daily calls. Microphone audio is transcribed on the server, Claire answers
 * from her real business context, and she speaks in her own call voice. Text is
 * always available. Nothing is "saved" unless the server says it persisted.
 */
export function OpenComms({ onChanged }: { onChanged: () => void }) {
  const comms = trpc.system.weeklyMission.deskComms.useMutation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [pendingApproval, setPendingApproval] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [micNote, setMicNote] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const sessionId = useRef(newSessionId());
  const stream = useRef<MediaStream | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const loop = useRef<number | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const micOn = useRef(false);
  /**
   * Comms session generation. Opening and ending both advance it; every async continuation
   * (server reply, microphone start, recorder stop, Claire's voice ending) checks it first,
   * so a late result can never revive an ended session or leak into a newer one.
   */
  const epoch = useRef(0);
  const setP = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const active = phase !== "idle" && phase !== "ended";

  const rms = () => {
    const a = analyser.current;
    if (!a) return 0;
    const buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.sqrt(sum / buf.length);
  };

  const stopLoop = () => {
    if (loop.current) cancelAnimationFrame(loop.current);
    loop.current = null;
  };

  const stopAudio = () => {
    player.current?.pause();
    player.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  };

  const teardown = useCallback(() => {
    stopLoop();
    stopAudio();
    if (recorder.current?.state === "recording") recorder.current.stop();
    recorder.current = null;
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null;
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
    analyser.current = null;
    micOn.current = false;
  }, []);

  const send = useCallback(
    async (input: { utterance?: string; audioDataUrl?: string }) => {
      const mine = epoch.current;
      stopLoop();
      const text = input.utterance?.trim();
      if (text) setLines(l => [...l, { who: "you", text }]);
      setP(input.utterance || input.audioDataUrl ? "processing" : "connecting");
      setError(null);
      try {
        const r = (await comms.mutateAsync({ sessionId: sessionId.current, ...input })) as Turn;
        if (epoch.current !== mine) {
          // Comms ended or reopened while Claire was answering. The server may still have
          // persisted work, so the desk re-reads its truth, but this session stays closed.
          onChanged();
          return;
        }
        if (input.audioDataUrl && r.heard) setLines(l => [...l, { who: "you", text: r.heard! }]);
        setLines(l => [...l, { who: "claire", text: r.speak }]);
        if (r.saved.length) setSaved(s => [...s, ...r.saved]);
        setPendingApproval(r.awaitingApproval?.summary ?? null);
        onChanged();
        speak(r);
      } catch (e) {
        if (epoch.current !== mine) return;
        setError(`${e instanceof Error ? e.message : "Claire could not be reached."} Nothing from that turn was saved.`);
        setP("error");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comms, onChanged]
  );

  /** Records one operator turn: waits for speech, stops after a pause, sends the audio. */
  const listen = useCallback(() => {
    const mine = epoch.current;
    if (!micOn.current || !stream.current) {
      setP("listening");
      return;
    }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(t => MediaRecorder.isTypeSupported(t)) ?? "";
    const rec = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    let spoke = false;
    let lastVoice = 0;
    const started = performance.now();
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stopLoop();
      if (!spoke || epoch.current !== mine || phaseRef.current === "ended" || phaseRef.current === "idle") return;
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      void blobToDataUrl(blob).then(audioDataUrl => {
        if (epoch.current === mine) void send({ audioDataUrl });
      });
    };
    recorder.current = rec;
    rec.start(250);
    setP("listening");
    const tick = () => {
      if (epoch.current !== mine) return;
      const v = rms();
      setLevel(v);
      const now = performance.now();
      if (v > SPEECH_LEVEL) {
        if (!spoke) setP("hearing");
        spoke = true;
        lastVoice = now;
      }
      if ((spoke && now - lastVoice > END_SILENCE_MS) || now - started > MAX_TURN_MS) {
        if (rec.state === "recording") rec.stop();
        if (!spoke) listen(); // nothing said yet: keep the line open
        return;
      }
      loop.current = requestAnimationFrame(tick);
    };
    loop.current = requestAnimationFrame(tick);
  }, [send]);

  /** Plays Claire's reply; speaking over her interrupts (barge-in). */
  const speak = useCallback(
    (r: Turn) => {
      const mine = epoch.current;
      const after = () => {
        // Ending comms cancels Claire's voice, which fires onend/onerror; the line stays closed.
        if (epoch.current !== mine) return;
        stopLoop();
        if (phaseRef.current === "ended" || phaseRef.current === "idle") return;
        if (r.end) setP("ended");
        else listen();
      };
      const watchBargeIn = () => {
        if (!micOn.current) return;
        let loud = 0;
        const tick = () => {
          if (epoch.current !== mine || phaseRef.current !== "speaking") return;
          if (rms() > BARGE_IN_LEVEL) loud += 1;
          else loud = 0;
          if (loud > 8) {
            stopAudio();
            listen();
            return;
          }
          loop.current = requestAnimationFrame(tick);
        };
        loop.current = requestAnimationFrame(tick);
      };
      const browserVoice = (why: string) => {
        if (epoch.current !== mine) return;
        if (!("speechSynthesis" in window)) {
          setVoiceNote(`${why} Read Claire's reply below.`);
          return after();
        }
        setVoiceNote(`${why} Using the browser voice instead.`);
        const u = new SpeechSynthesisUtterance(r.speak);
        u.onend = after;
        u.onerror = after;
        setP("speaking");
        window.speechSynthesis.speak(u);
        watchBargeIn();
      };
      if (!r.speechUrl) return browserVoice("Claire's voice isn't configured here.");
      const audio = new Audio(r.speechUrl);
      player.current = audio;
      audio.onended = after;
      audio.onerror = () => browserVoice("Claire's voice couldn't load.");
      setP("speaking");
      setVoiceNote(null);
      audio.play().then(watchBargeIn, (e: unknown) =>
        browserVoice(`The browser didn't play Claire's audio (${e instanceof DOMException ? e.name : "playback error"}).`)
      );
    },
    [listen]
  );

  async function open() {
    const mine = ++epoch.current;
    teardown();
    sessionId.current = newSessionId();
    setLines([]);
    setSaved([]);
    setPendingApproval(null);
    setError(null);
    setVoiceNote(null);
    setMicNote(null);
    setP("connecting");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (epoch.current !== mine) {
        // Comms ended while the microphone was starting: release it, open nothing.
        s.getTracks().forEach(t => t.stop());
        return;
      }
      stream.current = s;
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      const a = ctx.createAnalyser();
      a.fftSize = 1024;
      ctx.createMediaStreamSource(s).connect(a);
      analyser.current = a;
      micOn.current = true;
    } catch (e) {
      if (epoch.current !== mine) return;
      micOn.current = false;
      setMicNote(
        `Claire can't hear you: the microphone ${e instanceof DOMException && e.name === "NotAllowedError" ? "permission wasn't granted" : "isn't available"}. Type to her below, or allow the microphone and reopen comms.`
      );
    }
    await send({});
  }

  function interrupt() {
    stopLoop();
    stopAudio();
    listen();
  }

  function end() {
    epoch.current += 1;
    setP("ended");
    teardown();
  }

  function submitTyped(e: FormEvent) {
    e.preventDefault();
    const text = typed.trim();
    if (!text || phase === "processing") return;
    setTyped("");
    stopLoop();
    stopAudio();
    if (recorder.current?.state === "recording") {
      recorder.current.onstop = null;
      recorder.current.stop();
    }
    void send({ utterance: text });
  }

  useEffect(() => () => teardown(), [teardown]);

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
            {micOn.current && (phase === "listening" || phase === "hearing") ? (
              <span className="cd-meter" aria-hidden>
                <span style={{ width: `${Math.min(100, level * 600)}%` }} />
              </span>
            ) : null}
          </div>
          <div className="cd-comms-controls">
            {phase === "speaking" ? (
              <button type="button" onClick={interrupt} data-testid="open-comms-interrupt">Interrupt</button>
            ) : phase === "hearing" ? (
              <button type="button" onClick={() => recorder.current?.state === "recording" && recorder.current.stop()}>Done talking</button>
            ) : phase === "error" ? (
              <button type="button" onClick={() => listen()}>Try again</button>
            ) : null}
            <button type="button" className="cd-end" onClick={end} data-testid="open-comms-end">End comms</button>
          </div>
        </div>
      )}
      {micNote ? <p role="alert" className="cd-error" data-testid="open-comms-mic-note">{micNote}</p> : null}
      {voiceNote ? <p className="cd-small" data-testid="open-comms-voice-note">{voiceNote}</p> : null}
      {error ? <p role="alert" className="cd-error" data-testid="open-comms-error">{error}</p> : null}
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
