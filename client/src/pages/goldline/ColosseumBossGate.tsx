import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import operatorSprite from "@/assets/goldline/generated/trailblazer-operator.png";
import Day1FieldMission, {
  type Day1TenDoorsMissionView,
} from "./Day1FieldMission";
import {
  COLOSSEUM_VILLAIN_TARGET_ID,
  projectColosseumMission,
} from "./colosseumCampaign";
import type { Day1TargetOutcome } from "../../../../shared/day1TenDoors";
import "./colosseum-boss-gate.css";
import "./colosseum-playable.css";
import "./colosseum-approved-art.css";

const CLOCKHEAD_SRC = "/assets/boreslay-hero/procrastinator-reference.png";
const ARENA_BACKGROUND_SRC = "/assets/goldline/colosseum/arena-background.jpg";
const SIX_DOOR_FACADE_SRC = "/assets/goldline/colosseum/six-door-facade.webp";
const VILLAIN_REVEAL_SRC = "/assets/goldline/colosseum/villain-reveal.webp";
const PLAYER_START = { x: 50, y: 80 } as const;

/**
 * Screen-space approach points for the six real-site slots painted over the
 * approved facade. The facade is intentionally scenery: movement + proximity
 * remain real, while the expensive architectural transformation is an illusion.
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

type Props = {
  mission: Day1TenDoorsMissionView;
  isRecordingOutcome: boolean;
  onRecordOutcome: (targetId: string, outcome: Day1TargetOutcome) => void;
  onBossDefeated: () => void;
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

  if (campaign.isComplete) {
    return <ColosseumFinale mission={campaign} onBossDefeated={onBossDefeated} />;
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
            title: "THE SIX REAL SITES",
            missionLine:
              "Visit all six real properties. Record what actually happened. The arena cannot reveal the villain until the trace is complete.",
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
  const [player, setPlayer] = useState({ ...PLAYER_START });
  const [joystick, setJoystick] = useState({ x: 0, y: 0 });
  const [shieldTaken, setShieldTaken] = useState(false);
  const [attackTick, setAttackTick] = useState(0);
  const movementRef = useRef({ x: 0, y: 0 });
  const activePointerRef = useRef<number | null>(null);
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current != null) window.clearTimeout(resetTimer.current);
    },
    []
  );

  // As soon as the shield is taken, Clockhead starts firing. This is a narrow
  // theatrical attack loop, not a new combat engine: each pulse re-aims at the
  // avatar's current screen-space position while the existing movement stays live.
  useEffect(() => {
    if (!shieldTaken || failedSite != null) return;
    setAttackTick(value => value + 1);
    const timer = window.setInterval(() => {
      setAttackTick(value => value + 1);
    }, 820);
    return () => window.clearInterval(timer);
  }, [failedSite, shieldTaken]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.04, Math.max(0, (now - last) / 1000));
      last = now;
      const movement = movementRef.current;
      if (failedSite == null && (movement.x !== 0 || movement.y !== 0)) {
        const speed = 24;
        setPlayer(current => ({
          x: clamp(current.x + movement.x * speed * dt, 5, 95),
          y: clamp(current.y + movement.y * speed * dt, 34, 86),
        }));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [failedSite]);

  useEffect(() => {
    if (failedSite != null) return;
    const hitIndex = SITE_APPROACH_POINTS.findIndex(point => {
      const dx = player.x - point.x;
      const dy = (player.y - point.y) * 1.15;
      return Math.hypot(dx, dy) <= 7.2;
    });
    if (hitIndex < 0) return;

    setFailedSite(hitIndex);
    setHasFailed(true);
    movementRef.current = { x: 0, y: 0 };
    setJoystick({ x: 0, y: 0 });
    activePointerRef.current = null;
    resetTimer.current = window.setTimeout(() => {
      setPlayer({ ...PLAYER_START });
      setFailedSite(null);
    }, 1350);
  }, [failedSite, player]);

  function joystickMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (failedSite != null) return;
    if (activePointerRef.current !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const rawX = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const rawY = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    const length = Math.max(1, Math.hypot(rawX, rawY));
    const next = { x: rawX / length, y: rawY / length };
    movementRef.current = next;
    setJoystick(next);
  }

  function joystickStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (failedSite != null) return;
    activePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const rawX = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const rawY = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    const length = Math.max(1, Math.hypot(rawX, rawY));
    const next = { x: rawX / length, y: rawY / length };
    movementRef.current = next;
    setJoystick(next);
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

  const moving = Math.hypot(joystick.x, joystick.y) > 0.08;

  return (
    <main
      className={`colosseum-shell colosseum-shell--playable colosseum-shell--approved-art ${shieldTaken ? "has-shield" : ""}`}
      data-testid="colosseum-boss-gate"
    >
      <img
        className="colosseum-approved-background"
        src={ARENA_BACKGROUND_SRC}
        alt=""
        aria-hidden="true"
      />
      <img
        className="colosseum-approved-facade"
        src={SIX_DOOR_FACADE_SRC}
        alt=""
        aria-hidden="true"
      />

      <header className="colosseum-objective">
        <span>THE HUNT</span>
        <strong>FIND THE REAL VILLAIN</strong>
        <small>{mission.visitedCount} / {mission.totalCount} REAL SITES TRACED</small>
      </header>

      <div
        className="colosseum-boss colosseum-boss--hologram"
        aria-label="The Procrastinator, main boss"
      >
        <div className="colosseum-boss-aura" />
        <img src={CLOCKHEAD_SRC} alt="The Procrastinator, clock-headed boss" />
        <span>LOCATION UNKNOWN</span>
      </div>

      {SITE_APPROACH_POINTS.map((point, index) => {
        const distance = Math.hypot(player.x - point.x, player.y - point.y);
        return (
          <span
            key={index}
            className={`colosseum-proximity-ring ${distance < 13 ? "is-near" : ""}`}
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
            aria-hidden="true"
          />
        );
      })}

      <div
        className={`colosseum-shield ${shieldTaken ? "is-taken" : "colosseum-shield--ready"}`}
        aria-hidden="true"
      >
        <span>◈</span>
      </div>

      {!shieldTaken && (
        <button
          type="button"
          className="colosseum-search-grab-shield"
          onClick={() => setShieldTaken(true)}
          data-testid="colosseum-search-grab-shield"
        >
          GRAB THE SHIELD
        </button>
      )}

      <div
        className={`colosseum-player colosseum-player--playable ${moving ? "is-moving" : ""} ${shieldTaken ? "has-shield" : ""}`}
        style={{ left: `${player.x}%`, top: `${player.y}%` }}
        aria-label="Trailblazer"
        data-testid="colosseum-player"
      >
        {shieldTaken && <span className="colosseum-player-shield">◈</span>}
        <img src={operatorSprite} alt="Trailblazer" />
      </div>

      {shieldTaken && failedSite == null && (
        <svg
          key={attackTick}
          className="colosseum-boss-fire"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line x1="50" y1="25" x2={player.x} y2={player.y - 3} />
          <circle cx={player.x} cy={player.y - 3} r="1.6" />
        </svg>
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
          <div
            className={`colosseum-shot colosseum-shot--${(failedSite % 3) + 1}`}
            aria-hidden="true"
          />
          <div className="colosseum-death-flash" />
          <div className="colosseum-alert" role="status">
            <span>REAL VILLAIN NOT INSIDE</span>
            <strong>YOU DIED</strong>
            <small>THE ARENA CANNOT SOLVE THIS FROM HERE.</small>
          </div>
        </>
      )}

      <div className={`colosseum-hunt-call ${hasFailed ? "is-awake" : ""}`}>
        <span>{hasFailed ? "THE ANSWER IS OUTSIDE THE GAME" : "THE SIGNAL IS BLIND"}</span>
        <button type="button" onClick={onBeginHunt} data-testid="colosseum-begin-hunt">
          BEGIN REAL-WORLD HUNT
        </button>
      </div>
    </main>
  );
}

function ColosseumFinale({
  mission,
  onBossDefeated,
}: {
  mission: Day1TenDoorsMissionView;
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
    const blast = window.setTimeout(() => setPhase("blast"), 320);
    const reveal = window.setTimeout(() => setPhase("revealed"), 1280);
    return () => {
      window.clearTimeout(blast);
      window.clearTimeout(reveal);
    };
  }, []);

  useEffect(() => {
    if (advance >= 100 && !victory) setVictory(true);
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
        <img className="colosseum-approved-facade colosseum-approved-facade--reveal" src={VILLAIN_REVEAL_SRC} alt="" />
      </div>

      {phase !== "revealed" && (
        <div className={`colosseum-explosion ${phase === "blast" ? "is-live" : ""}`}>
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      )}

      {phase === "revealed" && !victory && (
        <>
          <header className="colosseum-reveal-copy">
            <span>TRACE COMPLETE · 6 / 6</span>
            <strong>TARGET LOCATED</strong>
            <small>{villainTarget?.name ?? "TARGET"}</small>
          </header>

          <div
            className={`colosseum-final-player ${shieldTaken ? "has-shield" : ""}`}
            style={{ bottom: `${playerBottom}%` }}
          >
            {shieldTaken && <span className="carried-shield">◈</span>}
            <img src={operatorSprite} alt="Trailblazer" />
          </div>

          {!shieldTaken ? (
            <button
              type="button"
              className="colosseum-grab-shield"
              onClick={() => setShieldTaken(true)}
              data-testid="colosseum-grab-shield"
            >
              <span>◈</span>
              <b>GRAB THE SHIELD</b>
            </button>
          ) : (
            <>
              <div className="colosseum-final-projectiles" aria-hidden="true">
                <i />
                <i />
                <i />
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
                <strong>HOLD TO ADVANCE</strong>
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
