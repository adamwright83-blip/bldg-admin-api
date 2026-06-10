import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { Level4WarLayer, type Level4WarView, type WarProjectileView } from "./Level4WarLayer";

export type Level4ActiveChallenge = {
  id: string;
  kind:
    | "collections"
    | "vagueness"
    | "dispatch"
    | "building_penetration"
    | "referral_request"
    | "market_hole_outreach";
  title: string;
  targetLabel: string;
  missionLabel: string;
  ctaLabel: string;
  severity: "active" | "degraded" | "reckoning" | "boss";
};

type Level4BoardSceneProps = {
  gateState: "LOCKED" | "UNLOCKED" | "COMPLETE_TODAY" | "COLD_CASE_VISUAL_ONLY";
  activeChallenge: Level4ActiveChallenge | null;
  completionState?: {
    isCompleting: boolean;
    completedChallengeId?: string;
    completionLabel?: string;
  };
  visualProgressIndex?: number;
  dailyXp?: number;
  onPrimaryAction?: () => void;
  onPromiseClick?: () => void;
  /** War for the Bridge — live duel state; null renders the classic scene. */
  war?: Level4WarView | null;
  onEngageProjectile?: (laneKey: WarProjectileView["laneKey"]) => void;
  lastStrike?: { label: string; at: number } | null;
};

const LEVEL4_ANCHORS = {
  heroStart: { x: 23.5, y: 75 },
  heroStep1: { x: 34, y: 55 },
  heroStep2: { x: 43, y: 43 },
  villain: { x: 50, y: 46.5 },
  family: { x: 81, y: 76 },
  firstTask: { x: 37, y: 48 },
  bossTask: { x: 50, y: 66 },
  postVillainBridge: { x: 64, y: 49 },
};

const HERO_STEPS = [
  LEVEL4_ANCHORS.heroStart,
  LEVEL4_ANCHORS.heroStep1,
  LEVEL4_ANCHORS.heroStep2,
  LEVEL4_ANCHORS.villain,
  LEVEL4_ANCHORS.postVillainBridge,
  LEVEL4_ANCHORS.family,
];

const VISUAL_PROGRESS_DATE_KEY = "level4:visualProgressDate";
const VISUAL_PROGRESS_INDEX_KEY = "level4:visualProgressIndex";
const LAST_CELEBRATED_ACTION_KEY = "level4:lastCelebratedActionId";

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function readStoredProgress() {
  if (typeof window === "undefined") return 0;
  if (window.localStorage.getItem(VISUAL_PROGRESS_DATE_KEY) !== todayKey()) {
    window.localStorage.setItem(VISUAL_PROGRESS_DATE_KEY, todayKey());
    window.localStorage.setItem(VISUAL_PROGRESS_INDEX_KEY, "0");
    return 0;
  }
  const raw = Number(window.localStorage.getItem(VISUAL_PROGRESS_INDEX_KEY) ?? 0);
  return Number.isFinite(raw) ? Math.max(0, Math.min(raw, HERO_STEPS.length - 1)) : 0;
}

function anchorStyle(anchor: { x: number; y: number }) {
  return {
    "--x": String(anchor.x),
    "--y": String(anchor.y),
  } as CSSProperties;
}

export function Level4BoardScene({
  gateState,
  activeChallenge,
  completionState,
  visualProgressIndex,
  dailyXp = 0,
  onPrimaryAction,
  onPromiseClick,
  war = null,
  onEngageProjectile,
  lastStrike = null,
}: Level4BoardSceneProps) {
  const [progressIndex, setProgressIndex] = useState(() => visualProgressIndex ?? readStoredProgress());
  const [heroPose, setHeroPose] = useState<"front" | "back">("front");
  const [isDefeating, setIsDefeating] = useState(false);
  const [pathGlow, setPathGlow] = useState<"preboss" | "postboss" | null>(null);

  useEffect(() => {
    if (visualProgressIndex == null) return;
    setProgressIndex(Math.max(0, Math.min(visualProgressIndex, HERO_STEPS.length - 1)));
  }, [visualProgressIndex]);

  useEffect(() => {
    const completedId = completionState?.completedChallengeId;
    if (!completionState?.isCompleting || !completedId || typeof window === "undefined") return;
    if (window.localStorage.getItem(LAST_CELEBRATED_ACTION_KEY) === completedId) return;

    window.localStorage.setItem(LAST_CELEBRATED_ACTION_KEY, completedId);
    setIsDefeating(true);
    const nextIndex = Math.min(progressIndex + 1, HERO_STEPS.length - 1);
    const isBoss = activeChallenge?.severity === "boss";
    setPathGlow(isBoss ? "postboss" : "preboss");

    const timers = [
      window.setTimeout(() => {
        setHeroPose("back");
        setProgressIndex(nextIndex);
        window.localStorage.setItem(VISUAL_PROGRESS_DATE_KEY, todayKey());
        window.localStorage.setItem(VISUAL_PROGRESS_INDEX_KEY, String(nextIndex));
      }, 700),
      window.setTimeout(() => setHeroPose("front"), 1_700),
      window.setTimeout(() => {
        setIsDefeating(false);
        setPathGlow(null);
      }, 2_400),
    ];
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [completionState?.isCompleting, completionState?.completedChallengeId, activeChallenge?.severity, progressIndex]);

  const heroAnchor = HERO_STEPS[progressIndex] ?? HERO_STEPS[0];
  const currentHeroSrc = "/assets/level4/level4-hero.png";
  const particles = useMemo(() => Array.from({ length: 16 }, (_, i) => i), []);
  const isBossChallenge = activeChallenge?.severity === "boss";
  const taskAnchor = isBossChallenge ? LEVEL4_ANCHORS.bossTask : LEVEL4_ANCHORS.firstTask;
  const bossStatus = gateState === "LOCKED" ? "LOCKED" : gateState === "COMPLETE_TODAY" ? "CLEARED" : "ENGAGED";
  const threatLabel =
    activeChallenge?.severity === "reckoning"
      ? "RECKONING"
      : activeChallenge?.severity === "degraded"
        ? "HIGH"
        : activeChallenge
          ? "ACTIVE"
          : "CLEAR";
  const payloadLabel =
    activeChallenge?.kind === "building_penetration" || activeChallenge?.kind === "referral_request"
      ? "Building 3 intro ask"
      : activeChallenge?.missionLabel ?? "No active payload";

  return (
    <section className={cn("level4-scene", gateState === "COMPLETE_TODAY" && "is-complete")}>
      {/* ASSET CONTRACT:
       * The Level 4 background must be clean scene art only.
       * Do not use composited mockups with baked HUD/title/buttons/text.
       * React owns all live HUD, telemetry, speech bubbles, challenge panels,
       * lane strips, CTAs, actors, and data-bound labels.
       */}
      <img className="level4-scene__background" src="/assets/level4/level4-clean-scene.png" alt="" />

      <div className="level4-scene__actors-layer">
        <img
          className="level4-scene__villain"
          src="/assets/level4/procrastinator-villain.png"
          alt=""
          style={anchorStyle(LEVEL4_ANCHORS.villain)}
          draggable={false}
        />
        <img
          className="level4-scene__family"
          src="/assets/level4/family-back-side.png"
          alt=""
          style={anchorStyle(LEVEL4_ANCHORS.family)}
          draggable={false}
        />
        <img
          className={cn(
            "level4-scene__hero",
            heroPose === "front" ? "level4-scene__hero--front" : "level4-scene__hero--back",
            heroPose === "back" && "level4-scene__hero--moving"
          )}
          src={currentHeroSrc}
          alt=""
          style={anchorStyle(heroAnchor)}
          draggable={false}
        />
      </div>

      <div className="level4-scene__path-layer">
        <div className="level4-scene__bridge-tiles" aria-hidden>
          {Array.from({ length: 14 }, (_, index) => (
            <span
              key={index}
              className={cn(
                "level4-scene__bridge-tile",
                index < progressIndex ? "is-complete" : index === progressIndex ? "is-current" : "is-future"
              )}
            />
          ))}
        </div>
        {pathGlow ? <div className={cn("level4-scene__path-glow", `level4-scene__path-glow--${pathGlow}`)} /> : null}
      </div>

      {/* WAR FOR THE BRIDGE — the living duel rides above the path layer.
          When war state is available it carries the real story: front line,
          territory, boss HP posture, excuse projectiles, momentum flame. */}
      {war?.available ? (
        <Level4WarLayer war={war} onEngageProjectile={onEngageProjectile} lastStrike={lastStrike} />
      ) : null}

      <div className="level4-scene__task-layer">
        {activeChallenge && gateState !== "COMPLETE_TODAY" ? (
          <div
            className={cn(
              "level4-scene__task-token",
              "level4-scene__task-token--active",
              activeChallenge.severity === "boss" && "level4-scene__task-token--boss",
              isDefeating && "level4-scene__task-token--defeating"
            )}
            style={anchorStyle(taskAnchor)}
          >
            {isBossChallenge ? (
              <button
                type="button"
                className="level4-scene__weapon-artButton"
                disabled={completionState?.isCompleting}
                onClick={onPrimaryAction}
                aria-label={`Strike ${activeChallenge.targetLabel}: ${payloadLabel}`}
              >
                <img src="/assets/level4/level4-weaponloaded-strike.png" alt="" draggable={false} />
                <span className="sr-only">
                  Weapon loaded. Outreach missile. Target: {activeChallenge.targetLabel}. Payload: {payloadLabel}.
                </span>
                {completionState?.isCompleting ? <span className="level4-scene__weapon-executing">EXECUTING</span> : null}
              </button>
            ) : (
              <>
                <div className="level4-scene__task-kicker">MISSION BLOCKER</div>
                <div className="level4-scene__task-title">{activeChallenge.title}</div>
                <div className="level4-scene__task-target">
                  <span>TARGET:</span> {activeChallenge.targetLabel}
                </div>
                <div className="level4-scene__task-mission">
                  <span>INTEL:</span> {activeChallenge.missionLabel}
                </div>
                <button
                  type="button"
                  className="level4-scene__task-cta"
                  disabled={completionState?.isCompleting}
                  onClick={onPrimaryAction}
                >
                  {completionState?.isCompleting ? "EXECUTING" : activeChallenge.ctaLabel.replace("→", "")}
                </button>
              </>
            )}
          </div>
        ) : null}

        {gateState === "COMPLETE_TODAY" ? (
          <div className="level4-scene__complete-today">
            <span>LEVEL 4 COMPLETE FOR TODAY</span>
            <strong>NEXT CHALLENGE LOCKED UNTIL TOMORROW</strong>
          </div>
        ) : null}
      </div>

      <div className="level4-scene__hud-layer">
        <div
          className="level4-scene__mission-card"
          aria-label={`Level 04 boss encounter. Target The Procrastinator. Today: plus ${dailyXp.toLocaleString("en-US")} XP.`}
        >
          <img src="/assets/level4/level4-mission-card.png" alt="" draggable={false} />
        </div>

        <div className="level4-scene__boss-title" aria-label="Boss encounter: The Procrastinator">
          <img src="/assets/level4/level4-titletext.png" alt="" draggable={false} />
        </div>

        <div
          className="level4-scene__telemetry"
          aria-label={`System telemetry. Boss ${bossStatus}. Opportunity ${activeChallenge ? "open" : "quiet"}. Threat ${threatLabel}.`}
        >
          <img src="/assets/level4/level4-system-telemetry.png" alt="" draggable={false} />
        </div>

        <div className="level4-scene__family-label">
          <strong>HOME · FAMILY · FREEDOM</strong>
          <span>"the prize"</span>
        </div>

        <img
          className="level4-scene__speech level4-scene__speech--one"
          src="/assets/level4/level4-speech-itcanwait.png"
          alt="it can wait!"
          draggable={false}
        />
        <img
          className="level4-scene__speech level4-scene__speech--two"
          src="/assets/level4/level4-speech-mondaysbetter.png"
          alt="monday's better"
          draggable={false}
        />
        <img
          className="level4-scene__speech level4-scene__speech--three"
          src="/assets/level4/youdontwannaseempushy.png"
          alt="you don't wanna seem pushy..."
          draggable={false}
        />
      </div>

      <div
        className="level4-scene__fx-layer"
        style={
          {
            "--particle-x": String(taskAnchor.x),
            "--particle-y": String(taskAnchor.y),
          } as CSSProperties
        }
      >
        {isDefeating
          ? particles.map((i) => (
              <span
                key={i}
                className="level4-scene__particle"
                style={{
                  "--i": String(i),
                  "--angle": `${(360 / particles.length) * i}deg`,
                  "--travel": `${40 + (i % 6) * 10}px`,
                } as CSSProperties}
              />
            ))
          : null}
      </div>

      <button
        type="button"
        className="level4-scene__promise-zone"
        aria-label="Preview promise layer"
        onClick={onPromiseClick}
      >
        <span>Promise layer. Clear the boss gate to advance.</span>
      </button>
    </section>
  );
}
