import { useEffect, useState } from "react";
import { isCompanionUnlocked, type CompanionId } from "./companionUnlockStorage";

/**
 * Reveals unlocked companion concept art in the driver app.
 *
 * This is Adam's own concept artwork, shown as-is — a 2D reward, not a game
 * asset. The Blender/image-to-3D pipeline for this companion is real but
 * incomplete (blocked on a gated Hugging Face model as of this writing), so
 * this card intentionally does not claim to be anything more than "here is
 * the art you unlocked."
 */
const COMPANION_ART: Record<CompanionId, { name: string; src: string; blurb: string }> = {
  rook: {
    name: "Rook",
    src: "/assets/goldline/companions/rook-concept-v1.png",
    blurb: "Concept art. The lanky, kit-laden messenger — Kingdom 2's companion.",
  },
};

export function CompanionUnlockCard({ id }: { id: CompanionId }) {
  const [unlocked, setUnlocked] = useState(() => isCompanionUnlocked(id));

  useEffect(() => {
    const onUnlock = (e: Event) => {
      const detail = (e as CustomEvent<{ id: CompanionId }>).detail;
      if (detail?.id === id) setUnlocked(true);
    };
    window.addEventListener("companion-unlocked", onUnlock);
    return () => window.removeEventListener("companion-unlocked", onUnlock);
  }, [id]);

  if (!unlocked) return null;

  const art = COMPANION_ART[id];
  return (
    <div className="companion-unlock-card" style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: 12, borderRadius: 12, background: "rgba(0,0,0,0.04)",
    }}>
      <img
        src={art.src}
        alt={art.name}
        style={{ width: 64, height: 64, objectFit: "contain" }}
      />
      <div>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{art.name} — Unlocked</div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>{art.blurb}</div>
      </div>
    </div>
  );
}
