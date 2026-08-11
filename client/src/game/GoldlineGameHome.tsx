import {
  lazy,
  Suspense,
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
  Radar,
  Radio,
  Route,
  Shield,
  Sparkles,
  Target,
  X,
  Zap,
} from "lucide-react";
import type { DriverGameWorldNode } from "../../../shared/driverGameWorld";
import {
  coolingLabel,
  gameWorldControlPercent,
} from "../../../shared/driverGameWorld";
import type { ColdCallBatch, ColdCallTarget } from "../../../shared/coldCallBurst";
import type {
  CapabilityEvaluation,
  ScoutReport,
} from "../../../shared/expansionScout";
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
  projectPersistentHistory,
  projectPlayableMissions,
} from "./state/WorldProjection";
import { landmarkForMission } from "../../../shared/worldSemantics";
import { networkStatusLabel, useNetworkStatus } from "./session/useNetworkStatus";
import { getGoldlineSessionId } from "./analytics/goldlineSession";
import type { GoldlineEventEmitter } from "./analytics/emitGoldlineEvent";
import { getAudioManager } from "./audio/AudioManager";
import { arcadeFeedback, missFeedback } from "./audio/haptics";
import type {
  ArcadeResolution,
  CorridorAction,
  CorridorBranch,
  EquippedAbility,
  GameView,
  PlayableMission,
} from "./state/GameState";
import "./goldline-game.css";
import { ColdCallBurst } from "./encounters/coldCall/ColdCallBurst";
import { VictoryCeremony } from "./victory/VictoryCeremony";
import { ScoutCapabilityChamber } from "./capabilities/ScoutCapabilityChamber";
import { ScoutReportPanel } from "./agents/scout/ScoutReportPanel";
import {
  archetypeForMission,
  channelForMission,
  type ArmoryWeapon,
  type EncounterResolution,
  type ObjectionArchetype,
  type SalesIntelChannel,
} from "./encounters/EncounterTypes";

// New objection encounters load only when the player actually reaches one,
// so the base game runtime stays lean.
const GatekeeperEncounter = lazy(
  () => import("./encounters/gatekeeper/GatekeeperEncounter")
);
const GhostEncounter = lazy(() => import("./encounters/ghost/GhostEncounter"));
const StallerEncounter = lazy(
  () => import("./encounters/staller/StallerEncounter")
);

type GoldlineGameHomeProps = GoldlineHomeProps & {
  worldNodes?: DriverGameWorldNode[];
  isLoadingWorld?: boolean;
  isBeginningRekindle?: boolean;
  onBeginRekindle: (missionId: number) => Promise<DriverGameWorldNode>;
  coldCallBatch?: ColdCallBatch | null;
  coldCallEligibleCount: number;
  coldCallEmptyReason?: string | null;
  isCreatingColdCall?: boolean;
  onCreateColdCall: () => Promise<ColdCallBatch | null>;
  onStartColdCall: (target: ColdCallTarget) => Promise<ColdCallBatch>;
  onCompleteColdCall: (input: {
    target: ColdCallTarget;
    outcome:
      | "no_answer"
      | "left_voicemail"
      | "spoke"
      | "visit_booked"
      | "not_a_fit"
      | "contact_unavailable";
    notes: string;
  }) => Promise<ColdCallBatch>;
  onSelectColdCallChain: (target: ColdCallTarget) => Promise<ColdCallBatch>;
  onBreakColdCallCombo: () => Promise<ColdCallBatch>;
  scoutCapability?: CapabilityEvaluation | null;
  isEvaluatingScout?: boolean;
  onEvaluateScout: () => Promise<void>;
  scoutReport?: ScoutReport | null;
  isRunningScout?: boolean;
  onRunScout: () => Promise<void>;
  onEmitEvent?: GoldlineEventEmitter;
  onRequestWeapons?: (input: {
    archetype: ObjectionArchetype;
    channel: SalesIntelChannel;
    missionId: number | null;
  }) => Promise<{
    weapons: ArmoryWeapon[];
    trainerIntelligenceAvailable: boolean;
  }>;
  onRecordWeaponUsage?: (input: {
    missionId: number;
    weaponId: string;
    frameworkId: string | null;
    archetype: ObjectionArchetype;
    channel: SalesIntelChannel;
    provenanceKind: "trainer_source" | "personal_evidence" | "foundation";
    requestId: string;
  }) => Promise<unknown>;
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
            className={`is-${stateTone(mission.state)} ${landmarkForMission({ visualState: mission.state }).cssClass}${mission.key === props.activeKey ? " is-active" : ""}`}
            onClick={() => props.onSelect(mission)}
            aria-label={`Select ${mission.name} — ${landmarkForMission({ visualState: mission.state }).label}`}
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
  const [coldCallOpen, setColdCallOpen] = useState(false);
  const [scoutOpen, setScoutOpen] = useState(false);
  const [scoutCapabilityOpen, setScoutCapabilityOpen] = useState(false);
  const networkStatus = useNetworkStatus();
  const sessionIdRef = useRef(getGoldlineSessionId());
  const sessionStartRef = useRef(performance.now());
  const emit = props.onEmitEvent;

  useEffect(() => {
    emit?.({
      eventName: "goldline_session_started",
      sessionId: sessionIdRef.current,
      properties: { sessionId: sessionIdRef.current, entryPoint: "goldline_home" },
    });
    return () => {
      emit?.({
        eventName: "goldline_session_ended",
        sessionId: sessionIdRef.current,
        properties: {
          sessionId: sessionIdRef.current,
          durationMs: Math.round(performance.now() - sessionStartRef.current),
        },
      });
    };
    // Fires once per mount/unmount; emit is expected stable from the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [audioMuted, setAudioMuted] = useState(() => getAudioManager().isMuted);
  const [coldCallPortalState, setColdCallPortalState] = useState<"hidden" | "label" | "engage">("hidden");

  useEffect(() => {
    const audio = getAudioManager();
    audio.primeOnGesture();
    const handleVisibility = () => audio.setBackgrounded(document.hidden);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);
  const [encounterArchetype, setEncounterArchetype] =
    useState<ObjectionArchetype>("ANCHOR");
  const [encounterChannel, setEncounterChannel] =
    useState<SalesIntelChannel>("phone");
  const [contextWeapons, setContextWeapons] = useState<ArmoryWeapon[]>([]);
  const [isLoadingWeapons, setIsLoadingWeapons] = useState(false);
  const [trainerIntelAvailable, setTrainerIntelAvailable] = useState(false);

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
    missions[0] ??
    null;
  const history = useMemo(
    () => projectPersistentHistory(props.worldNodes),
    [props.worldNodes]
  );
  const allMissions = useMemo(() => [...missions, ...history], [history, missions]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeMission =
    allMissions.find(mission => mission.key === activeKey) ??
    prioritized ??
    history.find(mission => mission.state === "captured") ??
    null;
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
      onPortalProximity: (anchorId, state) => {
        if (anchorId === "cold_call_portal") setColdCallPortalState(state);
      },
    });
    runtimeRef.current = game;
    void game
      .start({
        worldUrl,
        operatorUrl,
        midUrl: "/assets/goldline/corridor_01/mid.webp",
        farUrl: "/assets/goldline/corridor_01/far.webp",
        foregroundUrl: "/assets/goldline/corridor_01/foreground.webp",
        effectsUrl: "/assets/goldline/corridor_01/effects.webp",
        portalUrl: "/assets/goldline/corridor_01/portal_coldcall.webp",
        strongholdUrl: "/assets/goldline/corridor_01/stronghold.webp",
        characterBasePath: "/assets/goldline/characters/trailblazer",
      })
      .then(started => {
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
    if (activeMission.state === "captured") {
      setView("captured");
      // Fires only from real mission state, never from arcade performance —
      // the same authoritative signal that gates VictoryCeremony itself.
      emit?.({
        eventName: "verified_capture",
        sessionId: sessionIdRef.current,
        missionId: activeMission.missionId,
        properties: {
          sessionId: sessionIdRef.current,
          estimatedValueBand:
            activeMission.verifiedAnnualValueCents != null ? "verified" : "unverified",
        },
      });
    } else if (activeMission.state === "contested") setView("rekindle");
    else if (activeMission.state === "recovery_active") setView("recovery_active");
    else if (activeMission.state === "closed") setView("closed");
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Which objection this is, and on which channel, comes from real state.
    const archetype = archetypeForMission({
      mission: activeMission,
      hasDecisionMakerContact: Boolean(activeMission.phoneUrl),
    });
    const channel = channelForMission(activeMission);
    setEncounterArchetype(archetype);
    setEncounterChannel(channel);
    setShield(3);
    setFeedback(null);
    setArcadeResolution(null);
    setSelectedAbility(null);
    setSignalReset(current => current + 1);
    setContextWeapons([]);
    setTrainerIntelAvailable(false);
    if (props.onRequestWeapons) {
      setIsLoadingWeapons(true);
      void props
        .onRequestWeapons({
          archetype,
          channel,
          missionId: activeMission.missionId,
        })
        .then(result => {
          // Defensive: never hand the loadout a malformed payload.
          setContextWeapons(Array.isArray(result?.weapons) ? result.weapons : []);
          setTrainerIntelAvailable(
            Boolean(result?.trainerIntelligenceAvailable)
          );
        })
        .catch(() => setContextWeapons([]))
        .finally(() => setIsLoadingWeapons(false));
    }
    setView("encounter");
    const startedEventByArchetype = {
      ANCHOR: "anchor_encounter_started",
      GATEKEEPER: "gatekeeper_encounter_started",
      GHOST: "ghost_encounter_started",
      STALLER: "staller_encounter_started",
    } as const;
    emit?.({
      eventName: startedEventByArchetype[archetype],
      sessionId: sessionIdRef.current,
      missionId: activeMission.missionId,
      properties: { sessionId: sessionIdRef.current, channel },
    });
  };

  /** Records a real selection so personal evidence can accumulate. */
  function handleWeaponSelected(weapon: ArmoryWeapon) {
    emit?.({
      eventName: "armory_weapon_selected",
      sessionId: sessionIdRef.current,
      missionId: activeMission?.missionId ?? null,
      properties: { sessionId: sessionIdRef.current, provenanceKind: weapon.provenance.type },
    });
    if (!props.onRecordWeaponUsage || !activeMission?.missionId) return;
    void props
      .onRecordWeaponUsage({
        missionId: activeMission.missionId,
        weaponId: weapon.id,
        frameworkId:
          weapon.provenance.type === "trainer_source"
            ? weapon.provenance.frameworkId
            : null,
        archetype: weapon.archetype,
        channel: weapon.channel,
        provenanceKind: weapon.provenance.type,
        requestId: crypto.randomUUID(),
      })
      .catch(() => {
        // Evidence recording must never block the encounter.
      });
  }

  function handleEncounterResolved(resolution: EncounterResolution) {
    setFeedback(resolution.feedback);
    setArcadeResolution(resolution.performance === "clean" ? "breached" : "miss");
    setView("awaiting_business_result");
    emit?.({
      eventName: "encounter_resolved",
      sessionId: sessionIdRef.current,
      missionId: activeMission?.missionId ?? null,
      properties: {
        sessionId: sessionIdRef.current,
        archetype: encounterArchetype,
        performance: resolution.performance,
      },
    });
  }

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
      missFeedback();
      setView("awaiting_business_result");
      return;
    }
    const damage = shieldDamage(selectedAbility.fit);
    const nextShield = Math.max(0, shield - damage);
    setShield(nextShield);
    setArcadeResolution(nextShield === 0 ? "breached" : "hit");
    setFeedback(nextShield === 0 ? "BREACH — ARCADE OPENING CREATED" : `HIT — SHIELD ${nextShield}/3`);
    getAudioManager().play("weak_point_hit");
    arcadeFeedback();
    if (nextShield === 0) {
      setView("awaiting_business_result");
    } else {
      setSelectedAbility(null);
      setSignalReset(current => current + 1);
    }
  }

  if (runtimeFailed) return <GoldlineHome {...props} />;

  const worldLocked = view !== "explore" || coldCallOpen || scoutOpen;
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
          <div className="game-loading"><Loader2 /> ENTERING TERRITORY · SYNCING FIELD…</div>
        ) : null}
        <div className="game-atmosphere" aria-hidden="true" />
        {networkStatus === "offline" ? (
          <div className="network-status-banner" role="status">
            {networkStatusLabel(networkStatus)}
          </div>
        ) : null}

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

        {view === "explore" && !coldCallOpen && !scoutOpen ? (
          <aside className="world-history-ribbon" aria-label="Persistent world history">
            <span>
              <small>PERSISTENT WORLD HISTORY</small>
              <b title="Game progression only — not market share or ownership">WORLD CONTROL {gameWorldControlPercent(props.worldNodes ?? [])}%</b>
            </span>
            <div>
              {history.slice(0, 4).map(mission => (
                <button
                  key={mission.key}
                  className={`is-${mission.state}`}
                  onClick={() => {
                    setActiveKey(mission.key);
                    setView(mission.state === "captured" ? "captured" : "closed");
                  }}
                >
                  {mission.state === "captured" ? "◆" : "×"} {mission.name}
                </button>
              ))}
              {!history.length ? <small>NO RESOLVED TERRITORY YET</small> : null}
            </div>
          </aside>
        ) : null}

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
            <button
              className={`cold-call-entry is-portal-${coldCallPortalState}`}
              disabled={!props.coldCallBatch && props.coldCallEligibleCount === 0}
              onClick={async () => {
                if (!props.coldCallBatch) {
                  const created = await props.onCreateColdCall();
                  if (!created) return;
                }
                setColdCallOpen(true);
              }}
            >
              <Radio />
              <span>
                <b>COLD CALL BURST</b>
                <small>
                  {props.coldCallBatch
                    ? `${props.coldCallBatch.totalTargets - props.coldCallBatch.completedCount} REAL TARGETS REMAIN`
                    : props.coldCallEligibleCount
                      ? `${props.coldCallEligibleCount} REAL TARGETS READY`
                      : props.coldCallEmptyReason ?? "NO ELIGIBLE TARGETS"}
                </small>
              </span>
            </button>
          </>
        ) : null}

        {(view === "encounter" || view === "awaiting_business_result") &&
        activeMission &&
        encounterArchetype === "ANCHOR" ? (
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

        {(view === "encounter" || view === "awaiting_business_result") &&
        activeMission &&
        encounterArchetype !== "ANCHOR" ? (
          <Suspense
            fallback={
              <div className="game-loading">
                <Loader2 /> LOADING ENCOUNTER…
              </div>
            }
          >
            {(() => {
              const encounterProps = {
                mission: activeMission,
                archetype: encounterArchetype,
                channel: encounterChannel,
                weapons: contextWeapons,
                isLoadingWeapons,
                trainerIntelligenceAvailable: trainerIntelAvailable,
                onSelectWeapon: handleWeaponSelected,
                onResolved: handleEncounterResolved,
                onOpenBusinessAction: () =>
                  utilityMissionPath && window.location.assign(utilityMissionPath),
                onClose: () => setView("explore"),
              };
              if (encounterArchetype === "GATEKEEPER") {
                return <GatekeeperEncounter {...encounterProps} />;
              }
              if (encounterArchetype === "GHOST") {
                return <GhostEncounter {...encounterProps} />;
              }
              return <StallerEncounter {...encounterProps} />;
            })()}
          </Suspense>
        ) : null}

        {view === "captured" && activeMission ? (
          <VictoryCeremony
            mission={activeMission}
            onLanded={() => {
              setView("explore");
              setScoutCapabilityOpen(true);
            }}
          />
        ) : null}

        {coldCallOpen && props.coldCallBatch ? (
          <ColdCallBurst
            batch={props.coldCallBatch}
            onClose={() => setColdCallOpen(false)}
            onStart={props.onStartColdCall}
            onComplete={props.onCompleteColdCall}
            onSelectChain={props.onSelectColdCallChain}
            onBreakCombo={props.onBreakColdCallCombo}
          />
        ) : null}

        {scoutOpen ? (
          <ScoutReportPanel
            report={props.scoutReport ?? null}
            isRunning={Boolean(props.isRunningScout)}
            onRun={props.onRunScout}
            onClose={() => setScoutOpen(false)}
            onEngageMission={missionId => {
              const mission = allMissions.find(item => item.missionId === missionId);
              if (mission) selectMission(mission);
              setScoutOpen(false);
            }}
          />
        ) : null}

        {view === "explore" && !coldCallOpen && !scoutOpen && scoutCapabilityOpen && history.some(item => item.state === "captured") ? (
          <ScoutCapabilityChamber
            evaluation={props.scoutCapability ?? null}
            isEvaluating={Boolean(props.isEvaluatingScout)}
            onEvaluate={props.onEvaluateScout}
            onOpenScout={() => {
              setScoutCapabilityOpen(false);
              setScoutOpen(true);
            }}
          />
        ) : null}

        {view === "explore" && !coldCallOpen && !scoutOpen && !scoutCapabilityOpen && props.scoutCapability?.unlocked ? (
          <button
            className="scout-entry"
            onClick={() => setScoutOpen(true)}
          >
            <Radar />
            <span><b>EXPANSION SCOUT</b><small>OPEN SOURCED REPORT</small></span>
          </button>
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
                    <button
                      onClick={() => {
                        const audio = getAudioManager();
                        const next = !audio.isMuted;
                        audio.setMuted(next);
                        setAudioMuted(next);
                      }}
                    >
                      SOUND {audioMuted ? "OFF" : "ON"}
                    </button>
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
