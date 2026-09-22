import { memo, useId, type CSSProperties } from "react";
import { AVATAR_TUNING, type Avatar } from "./colosseumAvatar";
import {
  STAGE_HEIGHT,
  stageDepthScale,
  stagePercent,
  trailblazerHeightAt,
  type StagePoint,
} from "./colosseumStage";

const TRAILBLAZER_BASE = "/assets/goldline/characters/trailblazer/directional";

export const TRAILBLAZER_FRAME_URLS = (["front", "back", "left", "right"] as const).flatMap(
  facing => [
    `${TRAILBLAZER_BASE}/idle-${facing}.webp`,
    ...Array.from(
      { length: 5 },
      (_, index) => `${TRAILBLAZER_BASE}/walk-${facing}-${String(index + 1).padStart(2, "0")}.webp`
    ),
  ]
);

export function trailblazerPose(avatar: Avatar, stride: number): string {
  if (!avatar.moving) return `${TRAILBLAZER_BASE}/idle-${avatar.facing}.webp`;
  const index = String((Math.floor(stride) % 5) + 1).padStart(2, "0");
  return `${TRAILBLAZER_BASE}/walk-${avatar.facing}-${index}.webp`;
}

/** Stage units of travel per walk frame, so her feet never slide. */
export function strideLength(y: number): number {
  return 2.1 * stageDepthScale(y);
}

/** Depth order for anything standing on the floor. */
export function depthIndex(y: number): number {
  return 100 + Math.round(y * 4);
}

/**
 * Trailblazer's shield: bronze, round, with the broken ring of the Gold Line
 * across its face (WORLD_BIBLE §9, §24).
 */
export const ShieldGlyph = memo(function ShieldGlyph({ className = "" }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg className={`shield-glyph ${className}`} viewBox="-50 -50 100 100" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}-rim`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff0bd" />
          <stop offset="0.35" stopColor="#d49a3e" />
          <stop offset="0.7" stopColor="#8a5a1f" />
          <stop offset="1" stopColor="#4d300f" />
        </linearGradient>
        <radialGradient id={`${uid}-face`} cx="0.38" cy="0.32" r="0.8">
          <stop offset="0" stopColor="#f7d98f" />
          <stop offset="0.55" stopColor="#b9812f" />
          <stop offset="1" stopColor="#6e4515" />
        </radialGradient>
      </defs>
      <circle r="47" fill={`url(#${uid}-rim)`} stroke="#3d250b" strokeWidth="2" />
      <circle r="38" fill={`url(#${uid}-face)`} stroke="#5a3a12" strokeWidth="1.2" />
      <path className="shield-glyph-ring" d="M 22 -18 A 28 28 0 1 1 -12 -25" fill="none" strokeWidth="5" strokeLinecap="round" />
      <path className="shield-glyph-line" d="M -30 22 L 30 -22" fill="none" strokeWidth="3.4" strokeLinecap="round" />
      <circle r="6.5" fill="#fff4cf" stroke="#6e4515" strokeWidth="1.4" />
      {[0, 60, 120, 180, 240, 300].map(angle => (
        <circle
          key={angle}
          cx={Math.cos((angle * Math.PI) / 180) * 42.5}
          cy={Math.sin((angle * Math.PI) / 180) * 42.5}
          r="1.9"
          fill="#fff0bd"
          stroke="#4d300f"
          strokeWidth="0.6"
        />
      ))}
    </svg>
  );
});

type SpriteProps = {
  avatar: Avatar;
  stride: number;
  carriesShield: boolean;
  drained?: boolean;
  /** Where the dodge started, for afterimages. */
  dodgeFrom?: StagePoint | null;
  /** Guard and stored force, floated over her head once she can fight. */
  showStatus?: boolean;
};

function TrailblazerSpriteImpl({
  avatar,
  stride,
  carriesShield,
  drained = false,
  dodgeFrom = null,
  showStatus = false,
}: SpriteProps) {
  const feet = avatar.feet;
  const height = trailblazerHeightAt(feet.y);
  const position = stagePercent(feet);
  const pose = trailblazerPose(avatar, stride);
  const guarding = carriesShield && avatar.guarding;
  const perfectWindow = guarding && avatar.guardHeldMs <= AVATAR_TUNING.perfectBlockMs;
  const dodging = avatar.dodgeMs > 0;
  const slashing = avatar.slashMs > 0;
  const hurt = avatar.hurtMs > AVATAR_TUNING.hurtInvulnerableMs - 160;
  const blinking = avatar.hurtMs > 0 && !hurt && Math.floor(avatar.hurtMs / 90) % 2 === 0;

  const style = {
    left: position.left,
    top: position.top,
    height: `${(height / STAGE_HEIGHT) * 100}%`,
    zIndex: depthIndex(feet.y),
  } as CSSProperties;

  // Afterimages are their own figures on the stage, strung along the dodge.
  const ghosts =
    dodging && dodgeFrom
      ? [0.3, 0.62].map(t => {
          const at = {
            x: dodgeFrom.x + (feet.x - dodgeFrom.x) * t,
            y: dodgeFrom.y + (feet.y - dodgeFrom.y) * t,
          };
          const place = stagePercent(at);
          return {
            key: t,
            style: {
              left: place.left,
              top: place.top,
              height: `${(trailblazerHeightAt(at.y) / STAGE_HEIGHT) * 100}%`,
              zIndex: depthIndex(at.y) - 1,
              opacity: 0.16 + t * 0.22,
            } as CSSProperties,
          };
        })
      : [];

  return (
    <>
    {ghosts.map(ghost => (
      <div key={ghost.key} className="tb tb--ghost" style={ghost.style} aria-hidden="true">
        <img className="tb-body" src={pose} alt="" draggable={false} />
      </div>
    ))}
    <div
      className={[
        "tb",
        avatar.moving ? "is-moving" : "",
        dodging ? "is-dodging" : "",
        slashing ? `is-slashing is-combo-${Math.min(3, Math.max(1, avatar.slashCombo || 1))}` : "",
        guarding ? "is-guarding" : "",
        perfectWindow ? "is-perfect-window" : "",
        hurt ? "is-hurt" : "",
        blinking ? "is-blinking" : "",
        drained ? "is-drained" : "",
        `faces-${avatar.facing}`,
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      aria-hidden="true"
    >
      <i className="tb-shadow" />
      {carriesShield && <ShieldGlyph className={`tb-shield${guarding ? " is-raised" : ""}`} />}
      <img className="tb-body" src={pose} alt="" draggable={false} />
      {guarding && <i className="tb-guard-rim" />}
      {showStatus && (
        <div className={`tb-status${avatar.force >= AVATAR_TUNING.forceMax ? " is-charged" : ""}`}>
          <span className="tb-status-guard">
            {Array.from({ length: avatar.maxGuardPips }, (_, index) => (
              <i key={index} className={index < avatar.guardPips ? "is-live" : ""} />
            ))}
          </span>
          <span className="tb-status-force">
            {Array.from({ length: AVATAR_TUNING.forceMax }, (_, index) => (
              <i key={index} className={index < avatar.force ? "is-live" : ""} />
            ))}
          </span>
        </div>
      )}
    </div>
    </>
  );
}

export const TrailblazerSprite = memo(TrailblazerSpriteImpl);
