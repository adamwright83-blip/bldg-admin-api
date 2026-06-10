/**
 * Level 4 — WAR FOR THE BRIDGE (board overlay)
 *
 * Renders the living duel on top of the existing boss-encounter scene:
 *  - the FRONT LINE: a glowing seam across the bridge at the war's position;
 *    tiles behind the hero burn warm (yours), tiles behind the villain sit
 *    cold (his)
 *  - hero & villain stand AT the line and shove — both interpolate smoothly
 *    (1s ease) whenever the line moves; the villain's posture weakens as his
 *    HP (the revenue gap) dies
 *  - EXCUSE PROJECTILES: the operator's own distortions drift from villain
 *    toward hero; clicking one = jumping to the lane that spawned it (the
 *    only way to shatter it is real action)
 *  - MOMENTUM FLAME on the hero while a combo is alive
 *  - RECKONING / VICTORY banners, and yesterday's settled outcome at dawn
 *
 * All numbers stay backstage: position, posture, fire and color carry it.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import "./Level4WarLayer.css";

export type WarProjectileView = {
  id: string;
  laneKey: "collections" | "vagueness" | "dispatch";
  excuse: string;
  progress: number;
  msToImpact: number;
};

export type Level4WarView = {
  available: boolean;
  frontLineHundredths: number;
  frontLineTile: number;
  bossHpPct: number;
  combo: { chain: number; multiplier: number; label: string | null; msLeft: number };
  projectiles: WarProjectileView[];
  victoryToday: boolean;
  reckoning: null | { outcome: "WON" | "HELD" | "LOST"; settledTile: number };
  yesterday: null | { outcome: "WON" | "HELD" | "LOST"; settledTile: number };
};

type Level4WarLayerProps = {
  war: Level4WarView | null | undefined;
  /** Route the operator to the lane that spawned an excuse. */
  onEngageProjectile?: (laneKey: WarProjectileView["laneKey"]) => void;
  /** Optional strike feedback (why-toast text) from the last action. */
  lastStrike?: { label: string; at: number } | null;
};

const TILE_COUNT = 14;

/**
 * The bridge runs lower-left → upper-right through the scene. Line t∈[0,1]
 * maps onto this segment; it matches the board art's walkway band.
 */
const BRIDGE_FROM = { x: 22, y: 76 };
const BRIDGE_TO = { x: 82, y: 44 };

function bridgePoint(t: number): { x: number; y: number } {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    x: BRIDGE_FROM.x + (BRIDGE_TO.x - BRIDGE_FROM.x) * clamped,
    y: BRIDGE_FROM.y + (BRIDGE_TO.y - BRIDGE_FROM.y) * clamped,
  };
}

function pos(style: { x: number; y: number }): CSSProperties {
  return { "--x": String(style.x), "--y": String(style.y) } as CSSProperties;
}

export function Level4WarLayer({ war, onEngageProjectile, lastStrike }: Level4WarLayerProps) {
  const lineT = (war?.frontLineHundredths ?? 700) / (TILE_COUNT * 100);
  const linePoint = bridgePoint(lineT);
  // Fighters flank the line: hero a half-tile behind it, villain a half ahead.
  const heroPoint = bridgePoint(lineT - 0.045);
  const villainPoint = bridgePoint(lineT + 0.055);

  const hp = war?.bossHpPct ?? 100;
  const comboLabel = war?.combo.label ?? null;

  // Strike flash: pop a pulse at the front line when a new strike lands.
  const [strikePulse, setStrikePulse] = useState<number | null>(null);
  const lastStrikeAtRef = useRef<number>(0);
  useEffect(() => {
    if (!lastStrike || lastStrike.at === lastStrikeAtRef.current) return;
    lastStrikeAtRef.current = lastStrike.at;
    setStrikePulse(lastStrike.at);
    const t = window.setTimeout(() => setStrikePulse(null), 900);
    return () => window.clearTimeout(t);
  }, [lastStrike]);

  const tiles = useMemo(() => Array.from({ length: TILE_COUNT }, (_, i) => i), []);
  if (!war) return null;

  const outcomeBanner = war.victoryToday
    ? { text: "BRIDGE TAKEN — THE PROCRASTINATOR FALLS", tone: "won" as const }
    : war.reckoning
      ? {
          text:
            war.reckoning.outcome === "WON"
              ? "RECKONING: GROUND WON TODAY"
              : war.reckoning.outcome === "LOST"
                ? "RECKONING: GROUND LOST — DAWN RESETS THE LINE"
                : "RECKONING: THE LINE HELD",
          tone:
            war.reckoning.outcome === "WON"
              ? ("won" as const)
              : war.reckoning.outcome === "LOST"
                ? ("lost" as const)
                : ("held" as const),
        }
      : null;

  return (
    <div className="l4war" aria-hidden={false}>
      {/* Territory tint: your ground burns warm behind the hero. */}
      <div className="l4war__tiles" role="img" aria-label={`Front line at tile ${war.frontLineTile + 1} of ${TILE_COUNT}`}>
        {tiles.map((i) => {
          const t = (i + 0.5) / TILE_COUNT;
          const p = bridgePoint(t);
          const owned = t <= lineT;
          return (
            <span
              key={i}
              className={cn("l4war__tile", owned ? "l4war__tile--ours" : "l4war__tile--his")}
              style={pos(p)}
            />
          );
        })}
      </div>

      {/* The front line itself. */}
      <div
        className={cn("l4war__line", strikePulse != null && "l4war__line--struck")}
        style={pos(linePoint)}
      >
        <span className="l4war__line-glow" />
      </div>

      {/* Fighters at the line. The scene's static hero/villain stay as set
          dressing; these are the duelists. */}
      <div className={cn("l4war__fighter l4war__fighter--hero", comboLabel && "is-aflame")} style={pos(heroPoint)}>
        <img src="/assets/level4/level4-hero.png" alt="" draggable={false} />
        {comboLabel ? (
          <span className="l4war__flame" aria-label={`Momentum ${comboLabel}`}>
            <i /><i /><i />
            <b>{comboLabel}</b>
          </span>
        ) : null}
      </div>
      <div
        className={cn(
          "l4war__fighter l4war__fighter--villain",
          hp <= 0 && "is-dead",
          hp > 0 && hp <= 25 && "is-dying",
          hp > 25 && hp <= 60 && "is-hurt"
        )}
        style={pos(villainPoint)}
      >
        <img src="/assets/level4/procrastinator-villain.png" alt="" draggable={false} />
        {/* HP as an aura, not a number: full = heavy void, dying = guttering. */}
        <span className="l4war__boss-aura" style={{ "--hp": String(hp) } as CSSProperties} />
      </div>

      {/* Excuse projectiles — his voice, your distortions, drifting in. */}
      {war.projectiles.map((proj) => {
        const t = lineT + (1 - proj.progress) * (1 - lineT) * 0.6 + 0.05;
        const p = bridgePoint(Math.min(0.98, t));
        const urgent = proj.progress > 0.72;
        return (
          <button
            key={proj.id}
            type="button"
            className={cn("l4war__excuse", urgent && "l4war__excuse--urgent")}
            style={pos({ x: p.x, y: p.y - 9 })}
            onClick={() => onEngageProjectile?.(proj.laneKey)}
            aria-label={`Incoming excuse: ${proj.excuse}. Act on ${proj.laneKey} to shatter it.`}
          >
            <span className="l4war__excuse-bubble">“{proj.excuse}”</span>
            <span className="l4war__excuse-fuse" style={{ "--p": String(proj.progress) } as CSSProperties} />
          </button>
        );
      })}

      {/* Strike pulse at the line. */}
      {strikePulse != null ? (
        <div className="l4war__strike" style={pos(linePoint)}>
          <span />
        </div>
      ) : null}

      {/* Why-toast: every push explains itself. */}
      {lastStrike && strikePulse != null ? (
        <div className="l4war__why" style={pos({ x: linePoint.x, y: linePoint.y - 14 })}>
          {lastStrike.label}
        </div>
      ) : null}

      {/* Morning memory + evening reckoning. */}
      {!outcomeBanner && war.yesterday ? (
        <div className={cn("l4war__yesterday", `is-${war.yesterday.outcome.toLowerCase()}`)}>
          YESTERDAY: {war.yesterday.outcome === "WON" ? "GROUND WON" : war.yesterday.outcome === "LOST" ? "GROUND LOST" : "LINE HELD"}
        </div>
      ) : null}
      {outcomeBanner ? (
        <div className={cn("l4war__reckoning", `is-${outcomeBanner.tone}`)}>{outcomeBanner.text}</div>
      ) : null}
    </div>
  );
}
