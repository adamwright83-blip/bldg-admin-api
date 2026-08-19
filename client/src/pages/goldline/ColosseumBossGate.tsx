import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Day1FieldMission, {
  type Day1TenDoorsMissionView,
} from "./Day1FieldMission";
import {
  COLOSSEUM_VILLAIN_TARGET_ID,
  projectColosseumMission,
} from "./colosseumCampaign";
import {
  CLOCKHEAD_PROJECTILE_ORIGIN,
  movementFacing,
  perspectiveScale,
  spawnClockheadProjectiles,
  stepColosseumProjectiles,
  sweepAngleDegrees,
  sweepHitsPlayer,
  type ClockheadAttackKind,
  type ColosseumPoint,
  type ColosseumProjectile,
} from "./colosseumCombat";
import { getAudioManager } from "../../game/audio/AudioManager";
import {
  arcadeFeedback,
  combatGuardFeedback,
  combatHurtFeedback,
  combatRevealFeedback,
} from "../../game/audio/haptics";
import type { Day1TargetOutcome } from "../../../../shared/day1TenDoors";
import "./colosseum-boss-gate.css";
import "./colosseum-playable.css";
import "./colosseum-approved-art.css";

const CLOCKHEAD_SRC = "/assets/boreslay-hero/procrastinator-reference.png";
const ARENA_BACKGROUND_SRC = "/assets/goldline/colosseum/arena-background.jpg";
const SIX_DOOR_FACADE_SRC = "/assets/goldline/colosseum/six-door-facade.webp";
const VILLAIN_REVEAL_SRC = "/assets/goldline/colosseum/villain-reveal.webp";
const TRAILBLAZER_BASE = "/assets/goldline/characters/trailblazer/directional";
const PLAYER_START: ColosseumPoint = { x: 50, y: 80 };
const SHIELD_POINT: ColosseumPoint = { x: 50, y: 62 };
const PLAYER_MAX_HP = 3;
const PLAYER_SPEED = 24;
const PLAYER_ACCELERATION = 92;
const PLAYER_DECELERATION = 128;
const ATTACK_SEQUENCE: readonly ClockheadAttackKind[] = [
  "aimed",
  "fan",
  "aimed",
  "sweep",
];

/**
 * Six fictional doors stay painted into the arena even though today's
 * authoritative business campaign is five real Koreatown prospects. The
 * architecture is a puzzle; its count is never used as business truth.
 */
const SITE_APPROACH_POINTS = [
  { x: 8, y: 48 },
  { x: 24, y: 45 },
  { x: 40, y: 43 },
  { x: 60, y: 43 },
  { x: 76, y: 45 },
  { x: 92, y: 48 },
] as const;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function approach(value: number, target: number, maxDelta: number): number {
  if (value < target) return Math.min(target, value + maxDelta);
  if (value > target) return Math.max(target, value - maxDelta);
  return value;
}

function trailblazerPose(
  facing: "front" | "back" | "left" | "right",
  moving: boolean,
  frame: number
): string {
  if (!moving) return `${TRAILBLAZER_BASE}/idle-${facing}.webp`;
  const index = String((frame % 5) + 1).padStart(2, "0");
  return `${TRAILBLAZER_BASE}/walk-${facing}-${index}.webp`;
}

function projectileAngle(projectile: ColosseumProjectile): number {
  return (Math.atan2(projectile.vy, projectile.vx) * 180) / Math.PI;
}

type Props = {
  mission: Day1TenDoorsMissionView;
  isRecordingOutcome: boolean;
  onRecordOutcome: (targetId: string, outcome: Day1TargetOutcome) => void;
  onBossDefeated: () => void;
};

type Impact = {
  id: number;
  kind: "shield" | "player";
  x: number;
  y: number;
};

type SweepState = {
  id: number;
  startedAt: number;
  hitResolved: boolean;
};

export function ColosseumBossLoading() {
  return (
    <div className="colosseum-loading" aria-label="Entering the Colosseum">
      <div className="colosseum-loading-mark">GOLDLINE</div>
      <div className="colosseum-loading-copy">ENTERING THE COLOSSEUM</div>
    </div>
  );
}

export default function ColosseumBossGate({
  mission,
  isRecordingOutcome,
  onRecordOutcome,
  onBossDefeated,
}: Props) {
  const campaign = useMemo(() => projectColosseumMission(mission), [mission]);
  const [fieldMode, setFieldMode] = useState(false);
  const captureMode =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("capture") === "1";

  if (campaign.isComplete) {
    return (
      <ColosseumFinale
        mission={campaign}
        captureMode={captureMode}
        onBossDefeated={onBossDefeated}
      />
    );
  }

  if (fieldMode) {
    return (
      <div className="colosseum-field-mode">
        <button
          type="button"
          className="colosseum-return"
          onClick={() => setFieldMode(false)}
        >
          ← RETURN TO COLOSSEUM
        </button>
        <Day1FieldMission
          mission={campaign}
          isRecordingOutcome={isRecordingOutcome}
          onRecordOutcome={onRecordOutcome}
          onDismiss={() => setFieldMode(false)}
          presentation={{
            eyebrow: "THE SIGNAL IS BLIND INSIDE THE ARENA",
            title: `${campaign.totalCount} REAL SITES`,
            missionLine: `Visit all ${campaign.totalCount} real properties. Record what actually happened. The arena cannot reveal the villain until the trace is complete.`,
          }}
        />
      </div>
    );
  }

  return (
    <ColosseumSearchArena
      mission={campaign}
      onBeginHunt={() => setFieldMode(true)}
    />
  );
}

function ColosseumSearchArena({
  mission,
  onBeginHunt,
}: {
  mission: Day1TenDoorsMissionView;
  onBeginHunt: () => void;
}) {
  const [failedSite, setFailedSite] = useState<number | null>(null);
  const [hasFailed, setHasFailed] = useState(false);
  const [player, setPlayer] = useState<ColosseumPoint>({ ...PLAYER_START });
  const [joystick, setJoystick] = useState({ x: 0, y: 0 });
  const [shieldTaken, setShieldTaken] = useState(false);
  const [health, setHealth] = useState(PLAYER_MAX_HP);
  const [playerDown, setPlayerDown] = useState(false);
  const [moving, setMoving] = useState(false);
  const [facing, setFacing] = useState<"front" | "back" | "left" | "right">(
    "back"
  );
  const [runFrame, setRunFrame] = useState(0);
  const [projectiles, setProjectiles] = useState<ColosseumProjectile[]>([]);
  const [telegraph, setTelegraph] = useState<ClockheadAttackKind | null>(null);
  const [sweepProgress, setSweepProgress] = useState<number | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [hitFlash, setHitFlash] = useState(false);

  const playerRef = useRef<ColosseumPoint>({ ...PLAYER_START });
  const velocityRef = useRef({ x: 0, y: 0 });
  const movementRef = useRef({ x: 0, y: 0 });
  const activePointerRef = useRef<number | null>(null);
  const resetTimer = useRef<number | null>(null);
  const downResetTimer = useRef<number | null>(null);
  const frameClockRef = useRef(0);
  const movingRef = useRef(false);
  const projectileRef = useRef<ColosseumProjectile[]>([]);
  const attackSequenceRef = useRef(0);
  const sweepRef = useRef<SweepState | null>(null);
  const shieldTakenRef = useRef(false);
  const failedSiteRef = useRef<number | null>(null);
  const playerDownRef = useRef(false);
  const healthRef = useRef(PLAYER_MAX_HP);
  const invulnerableUntilRef = useRef(0);
  const freezeUntilRef = useRef(0);
  const impactIdRef = useRef(0);

  useEffect(() => {
    getAudioManager().primeOnGesture(window);
  }, []);

  useEffect(() => {
    shieldTakenRef.current = shieldTaken;
  }, [shieldTaken]);

  useEffect(() => {
    failedSiteRef.current = failedSite;
  }, [failedSite]);

  useEffect(() => {
    playerDownRef.current = playerDown;
  }, [playerDown]);

  useEffect(
    () => () => {
      if (resetTimer.current != null) window.clearTimeout(resetTimer.current);
      if (downResetTimer.current != null)
        window.clearTimeout(downResetTimer.current);
    },
    []
  );

  const updateProjectileState = useCallback((next: ColosseumProjectile[]) => {
    projectileRef.current = next;
    setProjectiles(next);
  }, []);

  const kickPlayer = useCallback((distance: number) => {
    const current = playerRef.current;
    const dx = current.x - CLOCKHEAD_PROJECTILE_ORIGIN.x;
    const dy = current.y - CLOCKHEAD_PROJECTILE_ORIGIN.y;
    const length = Math.hypot(dx, dy) || 1;
    const next = {
      x: clamp(current.x + (dx / length) * distance, 5, 95),
      y: clamp(current.y + (dy / length) * distance, 34, 86),
    };
    playerRef.current = next;
    setPlayer(next);
  }, []);

  const showImpact = useCallback(
    (kind: Impact["kind"], x: number, y: number) => {
      impactIdRef.current += 1;
      const id = impactIdRef.current;
      setImpact({ id, kind, x, y });
      window.setTimeout(() => {
        setImpact(current => (current?.id === id ? null : current));
      }, 180);
    },
    []
  );

  const absorbProjectile = useCallback(
    (x: number, y: number) => {
      freezeUntilRef.current = performance.now() + 70;
      showImpact("shield", x, y);
      kickPlayer(0.9);
      getAudioManager().play("shield_clang");
      combatGuardFeedback();
    },
    [kickPlayer, showImpact]
  );

  const damagePlayer = useCallback(
    (x: number, y: number) => {
      const now = performance.now();
      if (
        now < invulnerableUntilRef.current ||
        playerDownRef.current ||
        failedSiteRef.current != null
      )
        return;

      invulnerableUntilRef.current = now + 700;
      freezeUntilRef.current = now + 92;
      const nextHealth = Math.max(0, healthRef.current - 1);
      healthRef.current = nextHealth;
      setHealth(nextHealth);
      setHitFlash(true);
      window.setTimeout(() => setHitFlash(false), 140);
      showImpact("player", x, y);
      kickPlayer(2.8);
      getAudioManager().play("player_stagger");
      combatHurtFeedback();

      if (nextHealth === 0) {
        playerDownRef.current = true;
        setPlayerDown(true);
        movementRef.current = { x: 0, y: 0 };
        velocityRef.current = { x: 0, y: 0 };
        setJoystick({ x: 0, y: 0 });
        updateProjectileState([]);
        downResetTimer.current = window.setTimeout(() => {
          const reset = { ...PLAYER_START };
          playerRef.current = reset;
          setPlayer(reset);
          healthRef.current = PLAYER_MAX_HP;
          setHealth(PLAYER_MAX_HP);
          playerDownRef.current = false;
          setPlayerDown(false);
        }, 1450);
      }
    },
    [kickPlayer, showImpact, updateProjectileState]
  );

  // Clockhead uses a small authored pattern rather than a generic enemy AI.
  // Wind-up is long enough to read on a phone; release commits to the player's
  // current position and never homes afterwards.
  useEffect(() => {
    if (!shieldTaken || failedSite != null || playerDown) {
      setTelegraph(null);
      sweepRef.current = null;
      setSweepProgress(null);
      updateProjectileState([]);
      return;
    }

    let cancelled = false;
    const timers: number[] = [];
    const later = (callback: () => void, delay: number) => {
      const timer = window.setTimeout(callback, delay);
      timers.push(timer);
    };

    const runAttack = () => {
      if (cancelled) return;
      const kind = ATTACK_SEQUENCE[
        attackSequenceRef.current % ATTACK_SEQUENCE.length
      ];
      attackSequenceRef.current += 1;
      setTelegraph(kind);
      getAudioManager().play(kind === "sweep" ? "clockhead_sweep" : "clockhead_charge");

      const windup = kind === "sweep" ? 680 : 540;
      later(() => {
        if (cancelled) return;
        setTelegraph(null);
        if (kind === "sweep") {
          const sweep = {
            id: attackSequenceRef.current,
            startedAt: performance.now(),
            hitResolved: false,
          };
          sweepRef.current = sweep;
          setSweepProgress(0);
        } else {
          const spawned = spawnClockheadProjectiles(
            kind,
            playerRef.current,
            attackSequenceRef.current
          );
          updateProjectileState([...projectileRef.current, ...spawned]);
          getAudioManager().play("clockhead_fire");
        }
        later(runAttack, kind === "sweep" ? 1180 : 980);
      }, windup);
    };

    later(runAttack, 420);
    return () => {
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [failedSite, playerDown, shieldTaken, updateProjectileState]);

  // One RAF owns movement, acceleration/deceleration, projectile travel,
  // collision, run frames and the sweeping clock hand. No CSS beam can claim
  // a hit; every impact below comes from geometry that genuinely intersected.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.04, Math.max(0, (now - last) / 1000));
      last = now;

      const frozen = now < freezeUntilRef.current;
      const disabled =
        failedSiteRef.current != null || playerDownRef.current || frozen;

      if (!disabled) {
        const input = movementRef.current;
        const inputMagnitude = Math.hypot(input.x, input.y);
        const targetX = input.x * PLAYER_SPEED;
        const targetY = input.y * PLAYER_SPEED;
        const rate = inputMagnitude > 0.03 ? PLAYER_ACCELERATION : PLAYER_DECELERATION;
        const velocity = velocityRef.current;
        velocity.x = approach(velocity.x, targetX, rate * dt);
        velocity.y = approach(velocity.y, targetY, rate * dt);

        if (Math.hypot(velocity.x, velocity.y) > 0.05) {
          const current = playerRef.current;
          const next = {
            x: clamp(current.x + velocity.x * dt, 5, 95),
            y: clamp(current.y + velocity.y * dt, 34, 86),
          };
          playerRef.current = next;
          setPlayer(next);
        }

        const isMoving = Math.hypot(velocity.x, velocity.y) > 1.2;
        if (isMoving !== movingRef.current) {
          movingRef.current = isMoving;
          setMoving(isMoving);
        }
        if (isMoving) {
          frameClockRef.current += dt;
          if (frameClockRef.current >= 0.085) {
            frameClockRef.current = 0;
            setRunFrame(frame => (frame + 1) % 5);
          }
        }

        if (projectileRef.current.length > 0) {
          const stepped = stepColosseumProjectiles(
            projectileRef.current,
            dt,
            playerRef.current,
            shieldTakenRef.current,
            now < invulnerableUntilRef.current
          );
          if (
            stepped.projectiles.length !== projectileRef.current.length ||
            stepped.projectiles.some(
              (shot, index) =>
                shot.x !== projectileRef.current[index]?.x ||
                shot.y !== projectileRef.current[index]?.y
            )
          ) {
            updateProjectileState(stepped.projectiles);
          }
          for (const collision of stepped.collisions) {
            if (collision.kind === "shield")
              absorbProjectile(collision.x, collision.y);
            else damagePlayer(collision.x, collision.y);
          }
        }

        const sweep = sweepRef.current;
        if (sweep) {
          const progress = Math.min(1, (now - sweep.startedAt) / 900);
          setSweepProgress(progress);
          if (
            !sweep.hitResolved &&
            progress > 0.08 &&
            sweepHitsPlayer(progress, playerRef.current)
          ) {
            sweep.hitResolved = true;
            damagePlayer(playerRef.current.x, playerRef.current.y - 3);
          }
          if (progress >= 1) {
            sweepRef.current = null;
            setSweepProgress(null);
          }
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [absorbProjectile, damagePlayer, updateProjectileState]);

  useEffect(() => {
    if (failedSite != null || playerDown) return;
    const hitIndex = SITE_APPROACH_POINTS.findIndex(point => {
      const dx = player.x - point.x;
      const dy = (player.y - point.y) * 1.15;
      return Math.hypot(dx, dy) <= 7.2;
    });
    if (hitIndex < 0) return;

    setFailedSite(hitIndex);
    failedSiteRef.current = hitIndex;
    setHasFailed(true);
    movementRef.current = { x: 0, y: 0 };
    velocityRef.current = { x: 0, y: 0 };
    setJoystick({ x: 0, y: 0 });
    activePointerRef.current = null;
    updateProjectileState([]);
    getAudioManager().play("arcade_miss");
    combatHurtFeedback();
    resetTimer.current = window.setTimeout(() => {
      const reset = { ...PLAYER_START };
      playerRef.current = reset;
      setPlayer(reset);
      failedSiteRef.current = null;
      setFailedSite(null);
    }, 1350);
  }, [failedSite, player, playerDown, updateProjectileState]);

  function setJoystickFromEvent(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const rawX =
      (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const rawY =
      (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    const length = Math.max(1, Math.hypot(rawX, rawY));
    const next = { x: rawX / length, y: rawY / length };
    movementRef.current = next;
    setJoystick(next);
    if (Math.hypot(next.x, next.y) > 0.08) setFacing(movementFacing(next));
  }

  function joystickMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (failedSite != null || playerDown) return;
    if (activePointerRef.current !== event.pointerId) return;
    setJoystickFromEvent(event);
  }

  function joystickStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (failedSite != null || playerDown) return;
    activePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setJoystickFromEvent(event);
  }

  function joystickEnd(event?: ReactPointerEvent<HTMLDivElement>) {
    if (
      event &&
      activePointerRef.current != null &&
      event.pointerId !== activePointerRef.current
    )
      return;
    activePointerRef.current = null;
    movementRef.current = { x: 0, y: 0 };
    setJoystick({ x: 0, y: 0 });
  }

  const shieldDistance = Math.hypot(
    player.x - SHIELD_POINT.x,
    player.y - SHIELD_POINT.y
  );
  const canTakeShield = !shieldTaken && shieldDistance <= 8.5;
  const playerScale = perspectiveScale(player.y);
  const pose = trailblazerPose(facing, moving, runFrame);
  const sweepAngle =
    sweepProgress == null ? null : sweepAngleDegrees(sweepProgress);

  return (
    <main
      className={`colosseum-shell colosseum-shell--playable colosseum-shell--approved-art ${shieldTaken ? "has-shield" : ""} ${hitFlash ? "is-player-hit" : ""}`}
      data-testid="colosseum-boss-gate"
    >
      <div
        className={`colosseum-world ${impact ? `is-kick is-kick-${impact.kind}` : ""}`}
        aria-hidden="true"
      >
        <img
          className="colosseum-approved-background"
          src={ARENA_BACKGROUND_SRC}
          alt=""
        />
        <img
          className="colosseum-approved-facade"
          src={SIX_DOOR_FACADE_SRC}
          alt=""
        />

        <div className="colosseum-atmosphere">
          <i /><i /><i /><i /><i /><i /><i /><i />
        </div>
        <div className="colosseum-banner colosseum-banner--left" />
        <div className="colosseum-banner colosseum-banner--right" />

        <div
          className={`colosseum-boss colosseum-boss--hologram ${telegraph ? `is-telegraphing is-${telegraph}` : ""}`}
        >
          <div className="colosseum-boss-aura" />
          <div className="colosseum-clockhead-telegraph" />
          <img src={CLOCKHEAD_SRC} alt="" />
          <span>LOCATION UNKNOWN</span>
        </div>

        {SITE_APPROACH_POINTS.map((point, index) => {
          const distance = Math.hypot(player.x - point.x, player.y - point.y);
          return (
            <span
              key={index}
              className={`colosseum-proximity-ring ${distance < 13 ? "is-near" : ""}`}
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
            />
          );
        })}

        <div
          className={`colosseum-shield ${shieldTaken ? "is-taken" : "colosseum-shield--ready"}`}
          style={{ left: `${SHIELD_POINT.x}%`, top: `${SHIELD_POINT.y}%` }}
        >
          <span>◈</span>
        </div>

        <div
          className={`colosseum-player colosseum-player--playable ${moving ? "is-moving" : ""} ${shieldTaken ? "has-shield" : ""} ${playerDown ? "is-down" : ""}`}
          style={
            {
              left: `${player.x}%`,
              top: `${player.y}%`,
              "--player-scale": playerScale,
            } as CSSProperties
          }
        >
          {shieldTaken && <span className="colosseum-player-shield">◈</span>}
          <img src={pose} alt="" />
          {moving && <i className="colosseum-foot-dust" />}
        </div>

        {projectiles.map(projectile => (
          <span
            key={projectile.id}
            className="colosseum-projectile"
            style={
              {
                left: `${projectile.x}%`,
                top: `${projectile.y}%`,
                "--projectile-angle": `${projectileAngle(projectile)}deg`,
              } as CSSProperties
            }
          >
            <i />
          </span>
        ))}

        {sweepAngle != null && (
          <span
            className="colosseum-sweep-hand"
            style={
              {
                left: `${CLOCKHEAD_PROJECTILE_ORIGIN.x}%`,
                top: `${CLOCKHEAD_PROJECTILE_ORIGIN.y}%`,
                "--sweep-angle": `${sweepAngle}deg`,
              } as CSSProperties
            }
          />
        )}

        {impact && (
          <span
            key={impact.id}
            className={`colosseum-impact colosseum-impact--${impact.kind}`}
            style={{ left: `${impact.x}%`, top: `${impact.y}%` }}
          >
            <i /><i /><i /><i /><i /><i /><i /><i />
          </span>
        )}

        <div className="colosseum-foreground-occlusion" />
      </div>

      <header className="colosseum-objective">
        <span>THE HUNT</span>
        <strong>FIND THE REAL VILLAIN</strong>
        <small>
          {mission.visitedCount} / {mission.totalCount} REAL SITES TRACED
        </small>
      </header>

      <div className="colosseum-guard-pips" aria-label={`${health} guard remaining`}>
        {[0, 1, 2].map(index => (
          <i key={index} className={index < health ? "is-live" : ""} />
        ))}
      </div>

      {!shieldTaken && (
        <div className={`colosseum-shield-prompt ${canTakeShield ? "is-ready" : ""}`}>
          <span>{canTakeShield ? "SHIELD IN REACH" : "REACH THE SHIELD"}</span>
          {canTakeShield && (
            <button
              type="button"
              onClick={() => {
                setShieldTaken(true);
                shieldTakenRef.current = true;
                getAudioManager().play("vault");
                arcadeFeedback();
              }}
              data-testid="colosseum-search-grab-shield"
            >
              ◈ TAKE SHIELD
            </button>
          )}
        </div>
      )}

      <div
        className="colosseum-joystick"
        onPointerDown={joystickStart}
        onPointerMove={joystickMove}
        onPointerUp={joystickEnd}
        onPointerCancel={joystickEnd}
        data-testid="colosseum-joystick"
        aria-label="Move Trailblazer"
      >
        <i
          className="colosseum-joystick-knob"
          style={{
            transform: `translate(${joystick.x * 28}px, ${joystick.y * 28}px)`,
          }}
        />
        <span className="colosseum-joystick-label">MOVE</span>
      </div>

      {failedSite != null && (
        <>
          <div className="colosseum-death-flash" />
          <div className="colosseum-alert" role="status">
            <span>REAL VILLAIN NOT INSIDE</span>
            <strong>YOU DIED</strong>
            <small>THE ARENA CANNOT SOLVE THIS FROM HERE.</small>
          </div>
        </>
      )}

      {playerDown && failedSite == null && (
        <div className="colosseum-alert colosseum-alert--combat" role="status">
          <span>CLOCKHEAD BROKE YOUR GUARD</span>
          <strong>REDEPLOYING</strong>
          <small>READ THE WIND-UP. MOVE BEFORE THE SHOT COMMITS.</small>
        </div>
      )}

      <div className={`colosseum-hunt-call ${hasFailed ? "is-awake" : ""}`}>
        <span>
          {hasFailed ? "THE ANSWER IS OUTSIDE THE GAME" : "THE SIGNAL IS BLIND"}
        </span>
        <button type="button" onClick={onBeginHunt} data-testid="colosseum-begin-hunt">
          BEGIN REAL-WORLD HUNT
        </button>
      </div>
    </main>
  );
}

function ColosseumFinale({
  mission,
  captureMode,
  onBossDefeated,
}: {
  mission: Day1TenDoorsMissionView;
  captureMode: boolean;
  onBossDefeated: () => void;
}) {
  const villainTarget =
    mission.targets.find(target => target.id === COLOSSEUM_VILLAIN_TARGET_ID) ??
    mission.targets[mission.targets.length - 1];
  const [phase, setPhase] = useState<"armed" | "blast" | "revealed">("armed");
  const [shieldTaken, setShieldTaken] = useState(false);
  const [advance, setAdvance] = useState(0);
  const [victory, setVictory] = useState(false);
  const advanceTimer = useRef<number | null>(null);

  useEffect(() => {
    getAudioManager().primeOnGesture(window);
    const blast = window.setTimeout(() => {
      setPhase("blast");
      getAudioManager().play("target_reveal");
      combatRevealFeedback();
    }, 430);
    const reveal = window.setTimeout(() => setPhase("revealed"), 1460);
    return () => {
      window.clearTimeout(blast);
      window.clearTimeout(reveal);
    };
  }, []);

  useEffect(() => {
    if (advance >= 100 && !victory) {
      setVictory(true);
      getAudioManager().play("hostile_down");
      arcadeFeedback();
    }
  }, [advance, victory]);

  useEffect(() => {
    if (!victory) return;
    const openWorld = window.setTimeout(onBossDefeated, 1450);
    return () => window.clearTimeout(openWorld);
  }, [onBossDefeated, victory]);

  useEffect(
    () => () => {
      if (advanceTimer.current != null) window.clearInterval(advanceTimer.current);
    },
    []
  );

  function stopAdvance() {
    if (advanceTimer.current != null) {
      window.clearInterval(advanceTimer.current);
      advanceTimer.current = null;
    }
  }

  function startAdvance() {
    if (!shieldTaken || victory || advanceTimer.current != null) return;
    advanceTimer.current = window.setInterval(() => {
      setAdvance(value => Math.min(100, value + 2.6));
    }, 38);
  }

  const playerBottom = 11 + advance * 0.43;
  const revealName = captureMode
    ? "VERIFIED REAL-WORLD TARGET"
    : villainTarget?.name ?? "TARGET";

  return (
    <main
      className={`colosseum-shell colosseum-finale colosseum-shell--approved-art is-${phase}`}
      style={{ "--player-bottom": `${playerBottom}%` } as CSSProperties}
      data-testid="colosseum-finale"
    >
      <div className="colosseum-scene colosseum-scene--search" aria-hidden="true">
        <img className="colosseum-approved-background" src={ARENA_BACKGROUND_SRC} alt="" />
        <img className="colosseum-approved-facade" src={SIX_DOOR_FACADE_SRC} alt="" />
      </div>

      <div className="colosseum-scene colosseum-scene--revealed" aria-hidden="true">
        <img className="colosseum-approved-background" src={ARENA_BACKGROUND_SRC} alt="" />
        <img
          className="colosseum-approved-facade colosseum-approved-facade--reveal"
          src={VILLAIN_REVEAL_SRC}
          alt=""
        />
      </div>

      {phase !== "revealed" && (
        <>
          <div className={`colosseum-goldline-rip ${phase === "blast" ? "is-live" : ""}`} />
          <div className={`colosseum-explosion ${phase === "blast" ? "is-live" : ""}`}>
            {Array.from({ length: 12 }, (_, index) => <i key={index} />)}
          </div>
        </>
      )}

      {phase === "revealed" && !victory && (
        <>
          <header className="colosseum-reveal-copy">
            <span>
              TRACE COMPLETE · {mission.totalCount} / {mission.totalCount}
            </span>
            <strong>TARGET LOCATED</strong>
            <small>{revealName}</small>
          </header>

          <div
            className={`colosseum-final-player ${shieldTaken ? "has-shield" : ""}`}
            style={{ bottom: `${playerBottom}%` }}
          >
            {shieldTaken && <span className="carried-shield">◈</span>}
            <img
              src={`${TRAILBLAZER_BASE}/${advance > 2 ? "walk-back-03" : "idle-back"}.webp`}
              alt="Trailblazer"
            />
          </div>

          {!shieldTaken ? (
            <button
              type="button"
              className="colosseum-grab-shield"
              onClick={() => {
                setShieldTaken(true);
                getAudioManager().play("shield_clang");
                arcadeFeedback();
              }}
              data-testid="colosseum-grab-shield"
            >
              <span>◈</span>
              <b>TAKE SHIELD</b>
            </button>
          ) : (
            <>
              <div className="colosseum-final-projectiles" aria-hidden="true">
                <i /><i /><i />
              </div>
              <div className="colosseum-final-block-sparks" aria-hidden="true">
                <i /><i /><i /><i />
              </div>
              <button
                type="button"
                className="colosseum-advance-pad"
                onPointerDown={startAdvance}
                onPointerUp={stopAdvance}
                onPointerCancel={stopAdvance}
                onPointerLeave={stopAdvance}
                data-testid="colosseum-advance"
              >
                <strong>HOLD THE LINE</strong>
                <span>{Math.round(advance)}%</span>
              </button>
            </>
          )}
        </>
      )}

      {victory && (
        <div className="colosseum-victory" role="status">
          <span>TARGET BREACHED</span>
          <strong>THE BOSS IS DOWN</strong>
          <small>GOLDLINE IS OPEN.</small>
        </div>
      )}
    </main>
  );
}
