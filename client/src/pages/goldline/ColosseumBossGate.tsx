import { useEffect, useMemo, useRef, useState } from "react";
import vorgan from "@/assets/goldline/vorgan.png";
import Day1TenDoors, {
  type Day1TenDoorsMissionView,
} from "./Day1TenDoors";
import {
  COLOSSEUM_VILLAIN_TARGET_ID,
  projectColosseumMission,
} from "./colosseumCampaign";
import type { Day1TargetOutcome } from "../../../../shared/day1TenDoors";
import "./colosseum-boss-gate.css";

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
        <Day1TenDoors
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
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current != null) window.clearTimeout(resetTimer.current);
    },
    []
  );

  function testSite(index: number) {
    if (failedSite != null) return;
    setFailedSite(index);
    setHasFailed(true);
    resetTimer.current = window.setTimeout(() => setFailedSite(null), 1350);
  }

  return (
    <main className="colosseum-shell" data-testid="colosseum-boss-gate">
      <div className="colosseum-sky" aria-hidden="true" />
      <div className="colosseum-rim" aria-hidden="true" />
      <div className="colosseum-floor" aria-hidden="true" />

      <header className="colosseum-objective">
        <span>THE HUNT</span>
        <strong>FIND THE REAL VILLAIN</strong>
        <small>{mission.visitedCount} / {mission.totalCount} REAL SITES TRACED</small>
      </header>

      <div className="colosseum-boss colosseum-boss--hologram" aria-label="Main boss hologram">
        <div className="colosseum-boss-aura" />
        <img src={vorgan} alt="" />
        <span>LOCATION UNKNOWN</span>
      </div>

      <div className="colosseum-sites" aria-label="Six possible villain locations">
        {mission.targets.map((target, index) => (
          <button
            type="button"
            key={target.id}
            className={`colosseum-site colosseum-site--${index + 1}`}
            onClick={() => testSite(index)}
            aria-label={`Search possible location ${index + 1}`}
          >
            <span className="colosseum-site-roof" />
            <span className="colosseum-site-body">
              <i />
              <i />
              <i />
            </span>
            <b>{String(index + 1).padStart(2, "0")}</b>
          </button>
        ))}
      </div>

      <div className="colosseum-shield colosseum-shield--locked" aria-hidden="true">
        <span>◈</span>
      </div>

      <div className="colosseum-player" aria-label="Player">
        <span />
      </div>

      {failedSite != null && (
        <>
          <div className={`colosseum-shot colosseum-shot--${(failedSite % 3) + 1}`} />
          <div className="colosseum-death-flash" />
          <div className="colosseum-alert" role="status">
            <span>REAL VILLAIN NOT INSIDE</span>
            <strong>SIGNAL LOST</strong>
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
    if (advance < 100 || victory) return;
    setVictory(true);
    const openWorld = window.setTimeout(onBossDefeated, 1450);
    return () => window.clearTimeout(openWorld);
  }, [advance, onBossDefeated, victory]);

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
      className={`colosseum-shell colosseum-finale is-${phase}`}
      style={{ "--player-bottom": `${playerBottom}%` } as React.CSSProperties}
      data-testid="colosseum-finale"
    >
      <div className="colosseum-scene colosseum-scene--search" aria-hidden="true">
        <div className="colosseum-sky" />
        <div className="colosseum-rim" />
        <div className="colosseum-floor" />
        <div className="colosseum-ghost-buildings">
          {mission.targets.map((target, index) => (
            <span key={target.id} className={`ghost-building ghost-building--${index + 1}`} />
          ))}
        </div>
      </div>

      <div className="colosseum-scene colosseum-scene--revealed" aria-hidden="true">
        <div className="colosseum-sky colosseum-sky--after" />
        <div className="colosseum-rim colosseum-rim--after" />
        <div className="colosseum-floor colosseum-floor--after" />
        <div className="colosseum-target-building">
          <span />
          <b>{villainTarget?.name ?? "TARGET"}</b>
        </div>
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
            <small>THE FALSE LOCATIONS ARE GONE.</small>
          </header>

          <div className="colosseum-boss colosseum-boss--final" aria-hidden="true">
            <div className="colosseum-boss-aura" />
            <img src={vorgan} alt="" />
          </div>

          <div
            className={`colosseum-final-player ${shieldTaken ? "has-shield" : ""}`}
            style={{ bottom: `${playerBottom}%` }}
          >
            {shieldTaken && <span className="carried-shield">◈</span>}
            <i />
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
