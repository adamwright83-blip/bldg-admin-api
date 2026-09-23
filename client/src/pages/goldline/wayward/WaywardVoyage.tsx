import { useCallback, useEffect, useRef, useState } from "react";
import { getAudioManager } from "@/game/audio/AudioManager";
import { WaywardRuntime, type Caption, type WaywardBeat } from "./WaywardRuntime";
import "./wayward-voyage.css";

export type WaywardProgressPatch = {
  visited?: boolean;
  spanCrossed?: boolean;
  cacheCollected?: boolean;
  tetherAwake?: boolean;
  relic?: "tether-memory";
};

/**
 * The Wayward voyage: the first Road Encounter after the Colosseum.
 * The runtime owns the frame loop; React only hears about beats, captions and
 * hints (never per-frame state), and forwards touch as plain numbers.
 */
export default function WaywardVoyage({
  rookAboard,
  start,
  cacheCollected,
  exposeTestApi = false,
  onProgress,
  onReturn,
}: {
  rookAboard: boolean;
  start: "deck" | "span" | "sail";
  cacheCollected: boolean;
  exposeTestApi?: boolean;
  onProgress: (patch: WaywardProgressPatch) => void;
  onReturn: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<WaywardRuntime | null>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [caption, setCaption] = useState<Caption | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [beat, setBeat] = useState<WaywardBeat | null>(null);
  const [sailing, setSailing] = useState(false);
  const [endCard, setEndCard] = useState(false);
  const progressRef = useRef(onProgress);
  progressRef.current = onProgress;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    setReady(false);
    setFailed(false);
    getAudioManager().primeOnGesture();
    void WaywardRuntime.create({
      host,
      rookAboard,
      start,
      cacheCollected,
      exposeTestApi,
      events: {
        onReady: () => !cancelled && setReady(true),
        onCaption: next => !cancelled && setCaption(next),
        onBeat: next => !cancelled && setBeat(next),
        onProgress: patch => progressRef.current(patch),
        onSailing: () => {
          if (cancelled) return;
          setSailing(true);
          setEndCard(true);
        },
        onHint: next => !cancelled && setHint(next),
      },
    })
      .then(runtime => {
        if (cancelled) return runtime.destroy();
        runtimeRef.current = runtime;
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      runtimeRef.current?.destroy();
      runtimeRef.current = null;
    };
    // Mount once per attempt; later prop changes are not live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry]);

  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(null), 5200);
    return () => window.clearTimeout(timer);
  }, [hint]);

  // Keyboard, for QA and desktop.
  useEffect(() => {
    const pressed = new Set<string>();
    const push = () => {
      const x = Number(pressed.has("arrowright") || pressed.has("d")) - Number(pressed.has("arrowleft") || pressed.has("a"));
      const y = Number(pressed.has("arrowdown") || pressed.has("s")) - Number(pressed.has("arrowup") || pressed.has("w"));
      const l = Math.hypot(x, y) || 1;
      runtimeRef.current?.setMove(x / l, y / l);
    };
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === " " || key === "enter" || key === "e") {
        event.preventDefault();
        if (!event.repeat) runtimeRef.current?.act();
        return;
      }
      pressed.add(key);
      push();
    };
    const up = (event: KeyboardEvent) => {
      pressed.delete(event.key.toLowerCase());
      push();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // One-handed touch: drag anywhere to move, tap to act. No React state per move.
  const touch = useRef<{ id: number; x: number; y: number; at: number; moved: boolean } | null>(null);
  const RADIUS = 52;
  const showStick = (x: number, y: number) => {
    const stick = stickRef.current;
    if (!stick) return;
    stick.style.transform = `translate(${x - 58}px, ${y - 58}px)`;
    stick.dataset.visible = "true";
  };
  const moveKnob = (dx: number, dy: number) => {
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (touch.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    touch.current = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now(), moved: false };
    const rect = event.currentTarget.getBoundingClientRect();
    showStick(event.clientX - rect.left, event.clientY - rect.top);
    moveKnob(0, 0);
  }, []);
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const t = touch.current;
    if (!t || t.id !== event.pointerId) return;
    const dx = event.clientX - t.x;
    const dy = event.clientY - t.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 9) t.moved = true;
    if (!t.moved) return;
    const k = distance > RADIUS ? RADIUS / distance : 1;
    moveKnob(dx * k, dy * k);
    runtimeRef.current?.setMove((dx * k) / RADIUS, (dy * k) / RADIUS);
  }, []);
  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const t = touch.current;
    if (!t || t.id !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    touch.current = null;
    if (stickRef.current) stickRef.current.dataset.visible = "false";
    runtimeRef.current?.setMove(0, 0);
    if (!t.moved && performance.now() - t.at < 350) runtimeRef.current?.act();
  }, []);

  return (
    <main className="wv-shell" data-testid="wayward-stage" data-runtime-ready={ready ? "true" : "false"} data-beat={beat ?? ""}>
      <section className="wv-stage" aria-label="The Wayward">
        <div ref={hostRef} className="wv-runtime" />
        <div
          className="wv-touch"
          aria-label="Drag to move Trailblazer. Tap to act."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div ref={stickRef} className="wv-stick" data-visible="false" aria-hidden="true">
            <div ref={knobRef} className="wv-knob" />
          </div>
        </div>
        <div className="wv-grade" aria-hidden="true" />
        {caption ? (
          <div className={`wv-caption is-${caption.speaker.toLowerCase()}`} key={caption.id} role="status" aria-live="polite">
            <small>{caption.speaker}</small>
            <span>{caption.text}</span>
          </div>
        ) : null}
        {hint && !caption ? <div className="wv-hint">{hint}</div> : null}
        <button className="wv-return" onClick={onReturn} aria-label="Return to the overworld">
          ←
        </button>
        {!ready && !failed ? (
          <div className="wv-loading" aria-live="polite">
            <small>THE ROAD</small>
            <strong>THE WAYWARD</strong>
            <i />
          </div>
        ) : null}
        {failed ? (
          <div className="wv-error" role="alert">
            <b>THE DECK DID NOT LOAD</b>
            <button onClick={() => setRetry(value => value + 1)}>RETRY APPROACH</button>
          </div>
        ) : null}
        {sailing && endCard ? (
          <div className="wv-endcard">
            <small>THE ROAD</small>
            <strong>THE WAYWARD</strong>
            <span>is sailing</span>
            <button onClick={onReturn}>Return to the overworld</button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
