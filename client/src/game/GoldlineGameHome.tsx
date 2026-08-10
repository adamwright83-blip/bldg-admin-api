import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  CalendarClock,
  Check,
  ChevronRight,
  Crosshair,
  FileText,
  Footprints,
  Loader2,
  LockKeyhole,
  Map,
  MapPin,
  Menu,
  Phone,
  Radio,
  Route,
  Shield,
  Sparkles,
  Target,
  X,
  Zap,
} from "lucide-react";
import type { DriverGameWorldNode } from "../../../shared/driverGameWorld";
import { coolingLabel } from "../../../shared/driverGameWorld";
import type { GoldlineHomeProps } from "../pages/goldline/GoldlineHome";
import GoldlineHome from "../pages/goldline/GoldlineHome";
import OpenChannel from "../pages/goldline/OpenChannel";
import { detectOpenChannelGap } from "../pages/driver/goldlineDriverModel";
import worldUrl from "@/assets/goldline/generated/goldline-world-empty.png";
import operatorUrl from "@/assets/goldline/generated/trailblazer-operator.png";
import { GoldlineGame } from "./runtime/GoldlineGame";
import {
  equipAnchorAbilities,
  shieldDamage,
  weakPointSize,
} from "./state/EncounterProjection";
import {
  moneyBandLabel,
  projectPlayableMissions,
} from "./state/WorldProjection";
import type {
  ArcadeResolution,
  CorridorAction,
  CorridorBranch,
  EquippedAbility,
  GameView,
  PlayableMission,
} from "./state/GameState";
import "./goldline-game.css";

type GoldlineGameHomeProps = GoldlineHomeProps & {
  worldNodes?: DriverGameWorldNode[];
  isLoadingWorld?: boolean;
  isBeginningRekindle?: boolean;
  onBeginRekindle: (missionId: number) => Promise<DriverGameWorldNode>;
};

type UtilityPanel = "menu" | "route" | "objectives" | "open-channel" | null;

function formatDue(value: string | null) {
  if (!value) return "Awaiting a sourced follow-up time";
  return new Date(value).toLocaleString([], {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatVerifiedMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function stateTone(state: PlayableMission["state"]) {
  if (state === "captured") return "gold";
  if (state === "contested" || state === "recovery_active") return "amber";
  if (state === "closed") return "muted";
  return "cyan";
}

function branchCopy(branch: CorridorBranch) {
  if (branch === "safe") return "SAFE LINE · LOWER FRICTION / LONGER ROUTE";
  if (branch === "upper") return "UPPER LINE · VAULT REQUIRED / EXECUTION EDGE";
  return "INTEL LINE · OPTIONAL ENCOUNTER PREP";
}

function Joystick(props: {
  disabled: boolean;
  onInput: (x: number, y: number) => void;
}) {
  const baseRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  function update(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = baseRef.current?.getBoundingClientRect();
    if (!rect) return;
    const radius = rect.width / 2;
    let x = (event.clientX - (rect.left + radius)) / radius;
    let y = (event.clientY - (rect.top + radius)) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    setKnob({ x, y });
    props.onInput(x, y);
  }

  function release(event?: ReactPointerEvent<HTMLDivElement>) {
    if (event && pointerRef.current === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerRef.current = null;
    setKnob({ x: 0, y: 0 });
    props.onInput(0, 0);
  }

  return (
    <div
      ref={baseRef}
      className={`game-joystick${props.disabled ? " is-disabled" : ""}`}
      aria-label="Move Operator"
      role="application"
      onPointerDown={event => {
        if (props.disabled) return;
        pointerRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        update(event);
      }}
      onPointerMove={event => {
        if (pointerRef.current === event.pointerId) update(event);
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <i
        style={{
          transform: `translate(${knob.x * 31}px, ${knob.y * 31}px)`,
        }}
      />
      <span>MOVE</span>
    </div>
  );
}

function SignalWindow(props: {
  active: boolean;
  resetKey: number;
  onExpired: () => void;
}) {
  const [remaining, setRemaining] = useState(6200);
  const expiredRef = useRef(false);
  const onExpiredRef = useRef(props.onExpired);

  onExpiredRef.current = props.onExpired;

  useEffect(() => {
    setRemaining(6200);
    expiredRef.current = false;
  }, [props.resetKey]);

  useEffect(() => {
    if (!props.active) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      if (document.hidden) {
        last = now;
        frame = requestAnimationFrame(tick);
        return;
      }
      const delta = now - last;
      last = now;
      setRemaining(current => {
        const next = Math.max(0, current - delta);
        if (next === 0 && !expiredRef.current) {
          expiredRef.current = true;
          queueMicrotask(() => onExpiredRef.current());
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [props.active, props.resetKey]);

  return (
    <div className="signal-window" aria-label={`${(remaining / 1000).toFixed(1)} seconds remaining`}>
      <span style={{ transform: `scaleX(${remaining / 6200})` }} />
      <b>SIGNAL OVERRIDE {(remaining / 1000).toFixed(1)}s</b>
    </div>
  );
}

function MissionFork(props: {
  missions: PlayableMission[];
  activeKey: string | null;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (mission: PlayableMission) => void;
}) {
  if (!props.missions.length) {
    return (
      <button className="mission-empty-chip" onClick={props.onToggle}>
        <Target />
        <span>No missions — Scout needs wins</span>
      </button>
    );
  }
  return (
    <aside className={`mission-fork${props.expanded ? " is-expanded" : ""}`}>
      <button className="mission-fork-toggle" onClick={props.onToggle} aria-expanded={props.expanded}>
        <Target />
        <span>{props.expanded ? "COLLAPSE" : `${props.missions.length} OBJECTIVES`}</span>
      </button>
      <div className="mission-fork-icons">
        {props.missions.map((mission, index) => (
          <button
            key={mission.key}
            className={`is-${stateTone(mission.state)}${mission.key === props.activeKey ? " is-active" : ""}`}
            onClick={() => props.onSelect(mission)}
            aria-label={`Select ${mission.name}`}
          >
            {index + 1}
          </button>
        ))}
      </div>
      {props.expanded ? (
        <div className="mission-fork-list">
          {props.missions.map(mission => (
            <button
              key={mission.key}
              className={mission.key === props.activeKey ? "is-active" : ""}
              onClick={() => props.onSelect(mission)}
            >
              <span>
                <small>{mission.state.replaceAll("_", " ")}</small>
                <b>{mission.name}</b>
                <em>{moneyBandLabel(mission)}</em>
              </span>
              <span>
                <small>
                  {mission.timeBurdenMinutes == null
                    ? "TIME NOT SOURCED"
                    : `${mission.timeBurdenMinutes} MIN WORK`}
                </small>
                <small>
                  {mission.travelBurdenMinutes == null
                    ? "TRAVEL NOT SOURCED"
                    : `${mission.travelBurdenMinutes} MIN TRAVEL`}
                </small>
                <small>{mission.confidence} confidence</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

export default function GoldlineGameHome(props: GoldlineGameHomeProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<GoldlineGame | null>(null);
  const weakPointRef = useRef<HTMLButtonElement>(null);
  const gestureStart = useRef<{ x: number; y: number; at: number } | null>(null);
  const [runtimeFailed, setRuntimeFailed] = useState(false);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [action, setAction] = useState<CorridorAction | null>(null);
  const [actionLabel, setActionLabel] = useState<string | null>(null);
  const [branch, setBranch] = useState<CorridorBranch>("intel");
  const [progress, setProgress] = useState(0.06);
  const [objectivesExpanded, setObjectivesExpanded] = useState(false);
  const [utilityPanel, setUtilityPanel] = useState<UtilityPanel>(null);
  const [selectedAbility, setSelectedAbility] = useState<EquippedAbility | null>(null);
  const [signalReset, setSignalReset] = useState(0);
  const [shield, setShield] = useState(3);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [arcadeResolution, setArcadeResolution] = useState<ArcadeResolution>(null);
  const [view, setView] = useState<GameView>("explore");

  const missions = useMemo(
    () =>
      projectPlayableMissions({
        missions: props.salesMissions,
        moves: props.moves,
        worldNodes: props.worldNodes,
      }),
    [props.moves, props.salesMissions, props.worldNodes]
  );
  const prioritized =
    missions.find(mission => mission.state === "recovery_active") ??
    missions.find(mission => mission.state === "contested") ??
    missions.find(mission => mission.state === "captured") ??
    missions[0] ??
    null;
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeMission =
    missions.find(mission => mission.key === activeKey) ?? prioritized;
  const activeSalesMission = props.salesMissions?.find(
    mission => mission.id === activeMission?.missionId
  );
  const equippedAbilities = useMemo(
    () => equipAnchorAbilities(props.armory?.items ?? []),
    [props.armory?.items]
  );
  const openChannelGap = detectOpenChannelGap({
    now: new Date(),
    selectedDate: props.selectedDate,
    nextCommitmentAt: props.today?.nextFixedCommitment?.scheduledAt,
    fixedStopCount: (props.pickups?.length ?? 0) + (props.deliveries?.length ?? 0),
    hasMission: Boolean(props.openChannelMission),
  });

  useEffect(() => {
    if (!hostRef.current) return;
    const game = new GoldlineGame(hostRef.current, {
      onActionAvailable: (next, label) => {
        setAction(next);
        setActionLabel(label);
      },
      onBranchChange: setBranch,
      onProgress: setProgress,
      onInteract: () => handleInteractRef.current(),
      onError: () => setRuntimeFailed(true),
    });
    runtimeRef.current = game;
    void game.start({ worldUrl, operatorUrl }).then(started => {
      if (started) setRuntimeReady(true);
    });
    return () => {
      runtimeRef.current = null;
      game.destroy();
    };
  }, []);

  useEffect(() => {
    if (!activeMission) return;
    runtimeRef.current?.setWorldState(activeMission.state);
    if (activeMission.state === "captured") setView("captured");
    else if (activeMission.state === "contested") setView("rekindle");
    else if (activeMission.state === "recovery_active") setView("recovery_active");
    else if (activeMission.state === "closed") setView("closed");
  }, [activeMission?.key, activeMission?.state]);

  const handleInteractRef = useRef(() => {});
  handleInteractRef.current = () => {
    if (!activeMission) return;
    if (activeMission.state === "captured") return setView("captured");
    if (activeMission.state === "contested") return setView("rekindle");
    if (activeMission.state === "recovery_active") return setView("recovery_active");
    if (activeMission.state === "closed") return setView("closed");
    if (!activeMission.missionId) {
      const move = props.moves?.recommendedMoves.find(
        item => item.id === activeMission.moveId
      );
      if (move) void props.onAcceptMove(move);
      return;
    }
    setShield(3);
    setFeedback(null);
    setArcadeResolution(null);
    setSelectedAbility(null);
    setSignalReset(current => current + 1);
    setView("encounter");
  };

  function performAction() {
    if (action) runtimeRef.current?.performAction(action);
  }

  function selectMission(mission: PlayableMission) {
    setActiveKey(mission.key);
    setObjectivesExpanded(false);
    setView("explore");
    setFeedback(`ROUTE LOCKED · ${mission.name}`);
  }

  function expireSignal() {
    if (view !== "encounter" || !selectedAbility) return;
    setArcadeResolution("miss");
    setFeedback("MISS — ANCHOR HOLDS");
    setView("awaiting_business_result");
  }

  function resolveGesture(event: ReactPointerEvent<HTMLDivElement>) {
    if (!selectedAbility || view !== "encounter") return;
    const rect = weakPointRef.current?.getBoundingClientRect();
    const start = gestureStart.current;
    gestureStart.current = null;
    if (!rect || !start) return;
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    const gestureDistance = Math.hypot(
      event.clientX - start.x,
      event.clientY - start.y
    );
    const deliberateInput = inside && (gestureDistance > 18 || performance.now() - start.at < 360);
    if (!deliberateInput) {
      setArcadeResolution("miss");
      setFeedback("MISS — SIGNAL SKIPPED THE WEAK POINT");
      setView("awaiting_business_result");
      return;
    }
    const damage = shieldDamage(selectedAbility.fit);
    const nextShield = Math.max(0, shield - damage);
    setShield(nextShield);
    setArcadeResolution(nextShield === 0 ? "breached" : "hit");
    setFeedback(nextShield === 0 ? "BREACH — ARCADE OPENING CREATED" : `HIT — SHIELD ${nextShield}/3`);
    if (nextShield === 0) {
      setView("awaiting_business_result");
    } else {
      setSelectedAbility(null);
      setSignalReset(current => current + 1);
    }
  }

  if (runtimeFailed) return <GoldlineHome {...props} />;

  const worldLocked = view !== "explore";
  const abilitySize = selectedAbility
    ? weakPointSize(selectedAbility.fit) +
      (branch === "upper" ? 8 : branch === "intel" ? 4 : 0)
    : 68;
  const utilityMissionPath = activeMission?.destinationPath ?? null;
  const utilityNavigate = activeMission?.navigationUrl ?? null;
  const utilityCall = activeMission?.phoneUrl ?? null;

  return (
    <main className="playable-goldline-shell">
      <section className={`playable-goldline is-${view}`} aria-label="Goldline playable field world">
        <div ref={hostRef} className="goldline-canvas-host" />
        {!runtimeReady ? (
          <div className="game-loading"><Loader2 /> LOADING PLAYABLE WORLD…</div>
        ) : null}
        <div className="game-atmosphere" aria-hidden="true" />

        <header className="game-topbar">
          <button onClick={() => setUtilityPanel("menu")} aria-label="Open field utilities"><Menu /></button>
          <div>
            <span><Radio /> FIELD LINK</span>
            <b>{activeMission?.name ?? "NO ACTIVE MISSION"}</b>
            <small>STATIONARY PLAY · TEMP • INSIDE GAME LOOP</small>
          </div>
          <button onClick={() => setUtilityPanel("objectives")} aria-label="Open objectives"><Target /></button>
        </header>

        <MissionFork
          missions={missions}
          activeKey={activeMission?.key ?? null}
          expanded={objectivesExpanded}
          onToggle={() => setObjectivesExpanded(value => !value)}
          onSelect={selectMission}
        />

        {view === "explore" ? (
          <>
            <div className="corridor-status">
              <span>{branchCopy(branch)}</span>
              <i><b style={{ width: `${Math.round(progress * 100)}%` }} /></i>
            </div>
            {branch === "intel" && progress > 0.38 ? (
              <div className="intel-pickup"><Sparkles /> ENCOUNTER PREP REVEALED</div>
            ) : null}
            <Joystick disabled={false} onInput={(x, y) => runtimeRef.current?.setInput(x, y)} />
            <div className="context-actions">
              {action ? (
                <button className={`is-${action.toLowerCase()}`} onClick={performAction}>
                  <Footprints />
                  <span><b>{action}</b><small>{actionLabel}</small></span>
                </button>
              ) : (
                <div className="action-awaiting"><Route /><span>MOVE TO NEXT ACTION ZONE</span></div>
              )}
            </div>
          </>
        ) : null}

        {(view === "encounter" || view === "awaiting_business_result") && activeMission ? (
          <section className="anchor-encounter" aria-label="Anchor encounter">
            <header>
              <div>
                <small>THE ANCHOR · “WE ALREADY HAVE A COMPANY”</small>
                {view === "encounter" ? (
                  <SignalWindow
                    active={Boolean(selectedAbility)}
                    resetKey={signalReset}
                    onExpired={expireSignal}
                  />
                ) : (
                  <div className="signal-window is-resolved">
                    <span />
                    <b>SIGNAL RESOLVED · LOG OUTCOME</b>
                  </div>
                )}
              </div>
              <div className="shield-readout">
                <b>SHIELD {shield}/3</b>
                <span>{[0, 1, 2].map(index => <Shield key={index} className={index < shield ? "is-live" : ""} />)}</span>
              </div>
            </header>
            <div
              className={`anchor-target-field${selectedAbility ? " is-armed" : ""}`}
              onPointerDown={event => {
                gestureStart.current = { x: event.clientX, y: event.clientY, at: performance.now() };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerUp={resolveGesture}
            >
              <button
                ref={weakPointRef}
                className="anchor-weak-point"
                style={{ width: abilitySize, height: abilitySize }}
                aria-label="Weak point — tap or flick selected ability here"
              >
                <span><Crosshair /></span>
              </button>
              <div className="weak-point-copy">
                <b>WEAK POINT · TAP / FLICK ABILITY</b>
                <small>{selectedAbility ? `${selectedAbility.fit.toUpperCase()} FIT · ${selectedAbility.fitReason}` : "CHOOSE AN ARMORY ABILITY FIRST"}</small>
              </div>
              {feedback ? <div className={`encounter-feedback is-${arcadeResolution ?? "info"}`}>{feedback}</div> : null}
            </div>
            <div className="ability-loadout" aria-label="Armory abilities">
              {equippedAbilities.map(ability => (
                <button
                  key={ability.id}
                  className={`${selectedAbility?.id === ability.id ? "is-selected" : ""} is-${ability.fit}`}
                  onClick={() => {
                    if (view !== "encounter") return;
                    setSelectedAbility(ability);
                    setFeedback(null);
                    setSignalReset(current => current + 1);
                  }}
                >
                  <small>{ability.fit} fit · {ability.provenance.replaceAll("_", " ")}</small>
                  <b>{ability.title}</b>
                  <span>{ability.response}</span>
                </button>
              ))}
            </div>
            {view === "awaiting_business_result" ? (
              <div className="business-resolution-gate">
                <b>{arcadeResolution === "breached" ? "ARCADE BREACH ≠ BUSINESS WIN" : "ARCADE MISS · REAL OUTCOME REQUIRED"}</b>
                <small>Call, visit, or log the sourced result. Goldline will resolve only from backend truth.</small>
                <button onClick={() => utilityMissionPath && window.location.assign(utilityMissionPath)} disabled={!utilityMissionPath}>
                  LOG REAL RESULT <ChevronRight />
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {view === "captured" && activeMission ? (
          <section className="victory-beat" aria-live="polite">
            <small>VICTORY BEAT 1 · VERIFIED BUSINESS OUTCOME</small>
            <h1>STRONGHOLD CAPTURED</h1>
            <h2>{activeMission.name}</h2>
            <div className="his-flag">HIS</div>
            {activeMission.verifiedAnnualValueCents != null ? (
              <strong>{formatVerifiedMoney(activeMission.verifiedAnnualValueCents)}/YEAR SECURED</strong>
            ) : (
              <strong>ACCOUNT WON · VALUE NOT VERIFIED</strong>
            )}
            <p><Check /> REWARD LANDED · BACKEND VERIFIED</p>
            <div><span>WAR CHEST</span><span>TERRITORY SECURED</span></div>
            <button onClick={() => setView("explore")}>LET THE REWARD LAND <ChevronRight /></button>
          </section>
        ) : null}

        {(view === "rekindle" || view === "recovery_active") && activeMission ? (
          <section className={`rekindle-hud${view === "recovery_active" ? " is-active" : ""}`} aria-live="polite">
            <header>
              <span><b>MISS —</b><strong>ANCHOR HOLDS</strong></span>
              <span><Zap /> GOLD RECOVERY PATH UNLOCKED</span>
            </header>
            <div className="rekindle-quest">
              <small>{view === "recovery_active" ? "RECOVERY ACTIVE" : "REKINDLE · 1 MOVE"}</small>
              <h2>{activeMission.name}</h2>
              <p>Real follow-up → active recovery quest</p>
              <div className="cooling-rune">
                <CalendarClock />
                <b>{coolingLabel(activeMission.contestedUntil)}</b>
                <span>{formatDue(activeMission.contestedUntil)}</span>
              </div>
              <ol>
                <li className={activeSalesMission?.steps.some(step => /packet|collateral|proof/i.test(`${step.label} ${step.detail}`)) ? "is-sourced" : "is-unavailable"}>
                  <FileText /> PREP PACKET
                  <small>{activeSalesMission?.steps.some(step => /packet|collateral|proof/i.test(`${step.label} ${step.detail}`)) ? "Sourced mission step" : "No packet action in backend"}</small>
                </li>
                <li className={activeMission.contestedUntil ? "is-sourced" : "is-unavailable"}>
                  <CalendarClock /> SCHEDULE FOLLOW-UP
                  <small>{formatDue(activeMission.contestedUntil)}</small>
                </li>
                <li className={activeMission.phoneUrl ? "is-sourced" : "is-unavailable"}>
                  <Phone /> CALL
                  <small>{activeMission.phoneUrl ? "Sourced decision-maker phone" : "No phone sourced"}</small>
                </li>
              </ol>
              {view === "rekindle" ? (
                <button
                  className="begin-rekindle"
                  disabled={!activeMission.missionId || props.isBeginningRekindle}
                  onClick={async () => {
                    if (!activeMission.missionId) return;
                    await props.onBeginRekindle(activeMission.missionId);
                    runtimeRef.current?.setWorldState("recovery_active");
                    setView("recovery_active");
                  }}
                >
                  {props.isBeginningRekindle ? <Loader2 /> : <Zap />}
                  BEGIN REKINDLE <ChevronRight />
                </button>
              ) : (
                <div className="recovery-actions">
                  <button onClick={() => utilityMissionPath && window.location.assign(utilityMissionPath)}><CalendarClock /> OPEN REAL SCHEDULE</button>
                  <a href={utilityCall ?? undefined} aria-disabled={!utilityCall}><Phone /> CALL WHEN DUE</a>
                </div>
              )}
            </div>
          </section>
        ) : null}

        {view === "closed" && activeMission ? (
          <section className="closed-hud">
            <LockKeyhole />
            <small>AUTHORITATIVE CLOSURE</small>
            <h2>{activeMission.name}</h2>
            <strong>CLOSED · NO REKINDLE</strong>
            <p>{activeMission.lossReason ?? "The business opportunity is closed. No recovery path is fabricated."}</p>
            <button onClick={() => setView("explore")}>RETURN TO WORLD</button>
          </section>
        ) : null}

        {worldLocked ? null : (
          <nav className="game-utility-bar" aria-label="Business utilities">
            <a href={utilityNavigate ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!utilityNavigate}><MapPin />Navigate</a>
            <a href={utilityCall ?? undefined} aria-disabled={!utilityCall}><Phone />Call</a>
            <button onClick={props.onOpenJournal}><FileText />Mark</button>
            <button onClick={() => setUtilityPanel("objectives")}><Target />Intel</button>
          </nav>
        )}

        {utilityPanel && utilityPanel !== "open-channel" ? (
          <div className="game-utility-backdrop" onClick={() => setUtilityPanel(null)}>
            <section onClick={event => event.stopPropagation()}>
              <button className="game-panel-close" onClick={() => setUtilityPanel(null)} aria-label="Close"><X /></button>
              {utilityPanel === "menu" ? (
                <>
                  <small>REAL BUSINESS UTILITIES</small>
                  <h2>Field console</h2>
                  <div className="field-console-grid">
                    <button onClick={props.onOpenNewOrder}>NEW ORDER</button>
                    <button onClick={props.onOpenWalkIn}>START VISIT / WALK-IN</button>
                    <button onClick={props.onOpenJournal}>FIELD JOURNAL</button>
                    <button onClick={() => setUtilityPanel("route")}>LIVE ROUTE</button>
                    <button onClick={() => setUtilityPanel("open-channel")}>OPEN CHANNEL</button>
                    <button onClick={() => void props.onResolveDay()} disabled={props.isResolvingDay}>UNLOAD DAY</button>
                  </div>
                  {props.activeDispatch && props.onOpenDispatch ? (
                    <button className="live-dispatch-button" onClick={() => void props.onOpenDispatch?.()}>LIVE MISSION #{props.activeDispatch.missionId} <ChevronRight /></button>
                  ) : null}
                  <label className="game-date-field">WORKING DATE<input type="date" value={props.selectedDate} onChange={event => props.onSelectedDateChange(event.target.value)} /></label>
                </>
              ) : null}
              {utilityPanel === "route" ? (
                <>
                  <small>AUTHORITATIVE ROUTE</small>
                  <h2>Pickup & delivery</h2>
                  <div className="live-route-list">
                    {[...(props.pickups ?? []).map(order => ({ order, status: "collected" as const })), ...(props.deliveries ?? []).map(order => ({ order, status: "delivered" as const }))].map(({ order, status }) => (
                      <article key={`${status}-${order.id}`}>
                        <span><b>{`${order.firstName ?? ""} ${order.lastName ?? ""}`.trim() || `Order #${order.id}`}</b><small>{order.address}</small></span>
                        <button disabled={props.isResolvingOrder || (status === "delivered" && !order.paid)} onClick={() => void props.onResolveOrder(order.id, status)}>{status === "collected" ? "MARK COLLECTED" : order.paid ? "MARK DELIVERED" : "PAYMENT BLOCKED"}</button>
                      </article>
                    ))}
                    {!props.pickups?.length && !props.deliveries?.length ? <p>No real route work is loaded for this date.</p> : null}
                  </div>
                </>
              ) : null}
              {utilityPanel === "objectives" ? (
                <>
                  <small>MISSION FORK</small>
                  <h2>Choose what you pursue</h2>
                  <div className="objective-panel-list">
                    {missions.map(mission => (
                      <button key={mission.key} onClick={() => { selectMission(mission); setUtilityPanel(null); }}>
                        <Target /><span><b>{mission.name}</b><small>{moneyBandLabel(mission)} · {mission.timeBurdenMinutes ?? "?"} min · {mission.travelBurdenMinutes ?? "?"} travel</small></span>
                      </button>
                    ))}
                    {!missions.length ? <p>No missions — Scout needs wins</p> : null}
                  </div>
                </>
              ) : null}
            </section>
          </div>
        ) : null}

        <OpenChannel
          open={utilityPanel === "open-channel"}
          mission={props.openChannelMission}
          gap={openChannelGap}
          isGenerating={Boolean(props.isGeneratingOpenChannel)}
          isApproving={Boolean(props.isApprovingOpenChannel)}
          onClose={() => setUtilityPanel(null)}
          onGenerate={props.onGenerateOpenChannel}
          onApprove={props.onApproveOpenChannel}
        />
      </section>
    </main>
  );
}
