import { useEffect, useState } from "react";
import { isCompanionUnlocked, type CompanionId } from "./companionUnlockStorage";

/**
 * Reveals an unlocked companion in the driver app.
 *
 * Plays the companion's baked idle frames when the Blender pipeline has
 * produced them (scripts/assets/blender/glb_to_frames.py writes a
 * `<id>.frames.json` sidecar next to the PNGs). Until then it shows Adam's
 * concept art, labelled as such, so the unlock is never an empty card.
 */
const COMPANION_ART: Record<CompanionId, { name: string; concept: string; framesDir: string; blurb: string }> = {
  rook: {
    name: "Rook",
    concept: "/assets/goldline/companions/rook-concept-v1.png",
    framesDir: "/assets/goldline/companions/rook",
    blurb: "The lanky, kit-laden messenger — Kingdom 2's companion.",
  },
};

type FramesSidecar = { states?: { idle?: { files?: string[] } } };

const IDLE_FRAME_MS = 140;

export function CompanionUnlockCard({ id }: { id: CompanionId }) {
  const [unlocked, setUnlocked] = useState(() => isCompanionUnlocked(id));
  const [frames, setFrames] = useState<string[] | null>(null);
  const [frame, setFrame] = useState(0);
  const art = COMPANION_ART[id];

  useEffect(() => {
    const onUnlock = (e: Event) => {
      const detail = (e as CustomEvent<{ id: CompanionId }>).detail;
      if (detail?.id === id) setUnlocked(true);
    };
    window.addEventListener("companion-unlocked", onUnlock);
    return () => window.removeEventListener("companion-unlocked", onUnlock);
  }, [id]);

  // Load baked frames if the pipeline has shipped them; silently keep concept art otherwise.
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    fetch(`${art.framesDir}/${id}.frames.json`)
      .then(r => (r.ok ? r.json() : null))
      .then((meta: FramesSidecar | null) => {
        const files = meta?.states?.idle?.files;
        if (!cancelled && files && files.length > 0) {
          setFrames(files.map(f => `${art.framesDir}/${f}`));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [unlocked, id, art.framesDir]);

  useEffect(() => {
    if (!frames) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const t = window.setInterval(() => setFrame(f => (f + 1) % frames.length), IDLE_FRAME_MS);
    return () => window.clearInterval(t);
  }, [frames]);

  if (!unlocked) return null;

  const src = frames ? frames[frame] : art.concept;
  return (
    <div className="companion-unlock-card" style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: 12, borderRadius: 12, background: "rgba(0,0,0,0.04)",
    }}>
      <img src={src} alt={art.name} style={{ width: 72, height: 72, objectFit: "contain" }} />
      <div>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{art.name} — Unlocked</div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>{frames ? art.blurb : `Concept art. ${art.blurb}`}</div>
      </div>
    </div>
  );
}
