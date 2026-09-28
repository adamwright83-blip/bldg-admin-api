import { useEffect, useState, type ReactNode } from "react";
import "./companion-reveal.css";

/**
 * A companion's reward card, and the idle loop it plays.
 *
 * Ported from `goldline/rook-3d-asset-pipeline` (2026-09-12), where it first
 * played Rook's baked idle frames. The frame handling is unchanged in spirit:
 * read `<id>.frames.json`, play the idle state's frames at 140ms, fall back to
 * the concept art (captioned as concept art) if the frames never arrive. What
 * changed: the caller now owns when the card shows and what it means. The
 * component is presentation-only and may be used for a reveal before durable
 * ownership. Frames are fully preloaded before the loop starts, so a phone
 * never flickers through half-loaded frames.
 *
 * Presentation only. Showing this card records nothing; whoever renders it
 * decides what, if anything, is persisted.
 */

export type CompanionArtId = "rook";

const COMPANION_ART: Record<CompanionArtId, { name: string; concept: string; framesDir: string }> = {
  rook: {
    name: "Rook",
    concept: "/assets/goldline/companions/rook-concept-v1.png",
    framesDir: "/assets/goldline/companions/rook",
  },
};

type FramesSidecar = { states?: { idle?: { files?: string[] } } };
type IdleSet = { urls: string[]; ready: Promise<void> };

const IDLE_FRAME_MS = 140;
const idleSets = new Map<CompanionArtId, Promise<IdleSet | null>>();

function loadIdleSet(id: CompanionArtId): Promise<IdleSet | null> {
  const cached = idleSets.get(id);
  if (cached) return cached;
  const art = COMPANION_ART[id];
  const pending = fetch(`${art.framesDir}/${id}.frames.json`)
    .then(response => (response.ok ? (response.json() as Promise<FramesSidecar>) : null))
    .then(meta => {
      const files = meta?.states?.idle?.files;
      if (!files || files.length === 0) return null;
      const urls = files.map(file => `${art.framesDir}/${file}`);
      const ready = Promise.all(
        urls.map(
          url =>
            new Promise<void>(resolve => {
              const image = new Image();
              image.decoding = "async";
              image.onload = () => resolve();
              image.onerror = () => resolve();
              image.src = url;
            })
        )
      ).then(() => undefined);
      return { urls, ready };
    })
    .catch(() => null)
    .then(set => {
      // A failed fetch may be retried by the next caller.
      if (!set) idleSets.delete(id);
      return set;
    });
  idleSets.set(id, pending);
  return pending;
}

/** Start fetching a companion's idle frames ahead of its reveal. */
export function preloadCompanionIdle(id: CompanionArtId) {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  void loadIdleSet(id);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** The companion's idle, looping once every frame is in; its first frame under reduced motion. */
export function useCompanionIdle(id: CompanionArtId, playing = true) {
  const art = COMPANION_ART[id];
  const [urls, setUrls] = useState<string[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void loadIdleSet(id).then(set => {
      if (cancelled) return;
      if (!set) {
        setFailed(true);
        return;
      }
      setUrls(set.urls);
      void set.ready.then(() => {
        if (!cancelled) setLoaded(true);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!playing || !urls || !loaded || prefersReducedMotion()) return;
    const timer = window.setInterval(() => setFrame(current => (current + 1) % urls.length), IDLE_FRAME_MS);
    return () => window.clearInterval(timer);
  }, [playing, urls, loaded]);

  return {
    name: art.name,
    src: urls ? urls[frame % urls.length]! : failed ? art.concept : null,
    isConcept: !urls && failed,
  };
}

export function CompanionUnlockReveal({
  id,
  kicker,
  title,
  subtitle,
  children,
  actionLabel,
  onAction,
  className = "",
}: {
  id: CompanionArtId;
  kicker: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  actionLabel: string;
  onAction: () => void;
  className?: string;
}) {
  const idle = useCompanionIdle(id);
  return (
    <section className={`companion-reveal ${className}`} aria-labelledby="companion-reveal-title">
      <div className="companion-reveal-stage" aria-hidden={idle.src ? undefined : true}>
        <i className="companion-reveal-halo" />
        {idle.src && <img className="companion-reveal-figure" src={idle.src} alt={idle.name} draggable={false} />}
        <i className="companion-reveal-ground" />
      </div>
      <small className="companion-reveal-kicker">{kicker}</small>
      <h2 id="companion-reveal-title" className="companion-reveal-title">
        {title}
      </h2>
      {subtitle && <p className="companion-reveal-sub">{subtitle}</p>}
      {children}
      <button type="button" className="companion-reveal-cta" onClick={onAction} autoFocus>
        {actionLabel}
      </button>
      {idle.isConcept && <small className="companion-reveal-caption">Concept art</small>}
    </section>
  );
}
