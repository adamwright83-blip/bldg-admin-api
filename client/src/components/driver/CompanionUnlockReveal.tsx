import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  isCompanionRevealSeen,
  isCompanionUnlocked,
  markCompanionRevealSeen,
  type CompanionId,
} from "./companionUnlockStorage";

/**
 * A one-time, full-screen companion reveal on the live driver game home.
 *
 * Why a moment and not a persistent card: every edge of the live game screen is
 * already occupied. The top bar spans the full width, the vehicle key and
 * Colosseum return own top-left, next-up and game nav own bottom-left, and the
 * action surface, utility bar and context actions own bottom-right. A card
 * parked anywhere would sit on live controls in some state. The reveal owns the
 * screen once, then gets out of the way.
 *
 * Shows when the companion is unlocked and the reveal has not been seen. It
 * checks on mount as well as on the unlock event, because winning the Clockhead
 * duel fires the event while the Colosseum screen is up, then dismisses it and
 * mounts the game home — which is where this lives.
 *
 * Plays baked idle frames when glb_to_frames has shipped them; otherwise shows
 * Adam's concept art, captioned as concept art.
 */
const COMPANIONS: Record<CompanionId, { name: string; concept: string; framesDir: string; line: string }> = {
  rook: {
    name: "Rook",
    concept: "/assets/goldline/companions/rook-concept-v1.png",
    framesDir: "/assets/goldline/companions/rook",
    line: "The lanky, kit-laden messenger has joined you.",
  },
};

type FramesSidecar = { states?: { idle?: { files?: string[] } } };
const IDLE_FRAME_MS = 140;

export function CompanionUnlockReveal({ id }: { id: CompanionId }) {
  const art = COMPANIONS[id];
  const [open, setOpen] = useState(() => isCompanionUnlocked(id) && !isCompanionRevealSeen(id));
  const [frames, setFrames] = useState<string[] | null>(null);
  const [frame, setFrame] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onUnlock = (e: Event) => {
      const detail = (e as CustomEvent<{ id: CompanionId }>).detail;
      if (detail?.id === id && !isCompanionRevealSeen(id)) setOpen(true);
    };
    window.addEventListener("companion-unlocked", onUnlock);
    return () => window.removeEventListener("companion-unlocked", onUnlock);
  }, [id]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`${art.framesDir}/${id}.frames.json`)
      .then(r => (r.ok ? r.json() : null))
      .then((meta: FramesSidecar | null) => {
        const files = meta?.states?.idle?.files;
        if (!cancelled && files && files.length > 0) setFrames(files.map(f => `${art.framesDir}/${f}`));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, id, art.framesDir]);

  useEffect(() => {
    if (!open || !frames) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setFrame(f => (f + 1) % frames.length), IDLE_FRAME_MS);
    return () => window.clearInterval(t);
  }, [open, frames]);

  useEffect(() => {
    if (!open) return;
    buttonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function dismiss() {
    markCompanionRevealSeen(id);
    setOpen(false);
  }

  if (!open || typeof document === "undefined") return null;

  const src = frames ? frames[frame] : art.concept;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${art.name} unlocked`}
      onClick={dismiss}
      style={{
        position: "fixed", inset: 0, zIndex: 600,
        display: "grid", placeItems: "center",
        padding: "max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))",
        background: "radial-gradient(circle at 50% 42%, #0a1b25e6 0%, #040b10f2 70%)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(360px, 100%)", textAlign: "center", color: "#deffff",
          padding: "20px 18px 18px",
          border: "1px solid #72deed88", borderRadius: 18,
          background: "linear-gradient(160deg, #07131af0, #0a1b25f2 55%, #071116f0)",
          boxShadow: "0 18px 60px #000c, inset 0 0 32px #35dff31a",
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#e6bf53" }}>
          Companion unlocked
        </div>
        <img
          src={src}
          alt={art.name}
          style={{ display: "block", width: "100%", height: 280, objectFit: "contain", margin: "10px 0 4px",
                   filter: "drop-shadow(0 14px 18px #000a)" }}
        />
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "0.02em" }}>{art.name}</div>
        <div style={{ fontSize: 14, opacity: 0.82, marginTop: 4 }}>{art.line}</div>
        {!frames && <div style={{ fontSize: 11, opacity: 0.5, marginTop: 6 }}>Concept art</div>}
        <button
          ref={buttonRef}
          onClick={dismiss}
          style={{
            marginTop: 16, width: "100%", padding: "12px 0", borderRadius: 12, cursor: "pointer",
            fontSize: 15, fontWeight: 700, color: "#071116",
            border: "1px solid #ffeeb8", background: "linear-gradient(180deg, #f5d26a, #e6bf53)",
          }}
        >
          Continue
        </button>
      </div>
    </div>,
    document.body,
  );
}
