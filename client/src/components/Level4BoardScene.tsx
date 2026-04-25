import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

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
};

const LEVEL4_ANCHORS = {
  heroStart: { x: 19, y: 67 },
  heroStep1: { x: 28, y: 57 },
  heroStep2: { x: 38, y: 46 },
  villain: { x: 50, y: 31 },
  family: { x: 80, y: 62 },
  firstTask: { x: 30, y: 50 },
  postVillainBridge: { x: 63, y: 50 },
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
  const currentHeroSrc = heroPose === "back" ? "/assets/level4/hero_back.png" : "/assets/level4/hero_front.png";
  const particles = useMemo(() => Array.from({ length: 16 }, (_, i) => i), []);
  const isBossChallenge = activeChallenge?.severity === "boss";
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
      <img className="level4-scene__background" src="/assets/level4/level4-boss-scene.png" alt="" />

      <div className="level4-scene__hud-layer">
        <div className="level4-scene__mission-card">
          <div className="level4-scene__hud-header">LEVEL 04 · BOSS ENCOUNTER</div>
          <dl>
            <div><dt>TARGET</dt><dd>The Procrastinator</dd></div>
            <div><dt>PATTERN</dt><dd>Delay loop · "later"</dd></div>
            <div><dt>WEAKNESS</dt><dd>Specific action + time</dd></div>
            <div><dt>RECORD</dt><dd>Today: +{dailyXp.toLocaleString("en-US")} XP</dd></div>
          </dl>
          <div className="level4-scene__hud-status">ENGAGE WHEN READY</div>
        </div>

        <div className="level4-scene__boss-title" aria-label="Boss encounter: The Procrastinator">
          <div className="level4-scene__boss-kicker">△ BOSS ENCOUNTER △</div>
          <div className="level4-scene__boss-name">THE PROCRASTINATOR</div>
          <div className="level4-scene__boss-subtitle">"Tomorrow's Champion"</div>
        </div>

        <div className="level4-scene__telemetry">
          <div className="level4-scene__hud-header level4-scene__hud-header--gold">SYSTEM TELEMETRY</div>
          <dl>
            <div><dt>BOSS</dt><dd className={bossStatus === "ENGAGED" ? "is-hot" : ""}>{bossStatus}</dd></div>
            <div><dt>COOLDOWN</dt><dd>UNKNOWN</dd></div>
            <div><dt>OPPORTUNITY</dt><dd>{activeChallenge ? "OPEN" : "QUIET"}</dd></div>
            <div><dt>TERRITORY</dt><dd>REAL DATA</dd></div>
            <div><dt>THREAT</dt><dd className={threatLabel === "HIGH" || threatLabel === "RECKONING" ? "is-hot" : ""}>{threatLabel}</dd></div>
          </dl>
          <div className="level4-scene__telemetry-footer">PRESS [STRIKE] TO ENGAGE</div>
        </div>

        <div className="level4-scene__operator-label">OPERATOR-04 · ORIGIN</div>
        <div className="level4-scene__family-label">
          <strong>HOME · FAMILY · FREEDOM</strong>
          <span>"the prize"</span>
        </div>

        <div className="level4-scene__speech level4-scene__speech--one">it can wait!</div>
        <div className="level4-scene__speech level4-scene__speech--two">monday's better</div>
        <div className="level4-scene__speech level4-scene__speech--three">you don't wanna seem pushy...</div>
      </div>

      <div className="level4-scene__actors-layer">
        <img
          className="level4-scene__villain"
          src="/assets/level4/villain.png"
          alt=""
          style={anchorStyle(LEVEL4_ANCHORS.villain)}
          draggable={false}
        />
        <img
          className="level4-scene__family"
          src="/assets/level4/family.png"
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

      <div className="level4-scene__task-layer">
        {activeChallenge && gateState !== "COMPLETE_TODAY" ? (
          <div
            className={cn(
              "level4-scene__task-token",
              "level4-scene__task-token--active",
              activeChallenge.severity === "boss" && "level4-scene__task-token--boss",
              isDefeating && "level4-scene__task-token--defeating"
            )}
            style={anchorStyle(LEVEL4_ANCHORS.firstTask)}
          >
            <div className="level4-scene__task-kicker">
              {isBossChallenge ? "WEAPON LOADED" : "MISSION BLOCKER"}
            </div>
            <div className="level4-scene__task-title">{isBossChallenge ? "OUTREACH MISSILE" : activeChallenge.title}</div>
            <div className="level4-scene__task-target">
              <span>TARGET:</span> {activeChallenge.targetLabel}
            </div>
            <div className="level4-scene__task-mission">
              <span>{isBossChallenge ? "PAYLOAD:" : "INTEL:"}</span> {isBossChallenge ? payloadLabel : activeChallenge.missionLabel}
            </div>
            <button
              type="button"
              className="level4-scene__task-cta"
              disabled={completionState?.isCompleting}
              onClick={onPrimaryAction}
            >
              {completionState?.isCompleting ? "EXECUTING" : isBossChallenge ? "[ STRIKE ]" : activeChallenge.ctaLabel.replace("→", "")}
            </button>
          </div>
        ) : null}

        {gateState === "COMPLETE_TODAY" ? (
          <div className="level4-scene__complete-today">
            <span>LEVEL 4 COMPLETE FOR TODAY</span>
            <strong>NEXT CHALLENGE LOCKED UNTIL TOMORROW</strong>
          </div>
        ) : null}
      </div>

      <div className="level4-scene__fx-layer">
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
