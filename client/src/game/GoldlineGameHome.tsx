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
  Check,
  ChevronRight,
  Crosshair,
  FileText,
  Footprints,
  Loader2,
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
} from "lucide-react";
import type { DriverGameWorldNode } from "../../../shared/driverGameWorld";
import type { GoldlineProgressionProjection } from "../../../shared/goldlineProgression";
import { gameWorldControlPercent } from "../../../shared/driverGameWorld";
import type {
  ColdCallBatch,
  ColdCallTarget,
} from "../../../shared/coldCallBurst";
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
import type { PreparedCorridorAssets } from "./runtime/GoldlineGame";
import {
  equipAnchorAbilities,
  shieldDamage,
  weakPointSize,
} from "./state/EncounterProjection";
import {
  moneyBandLabel,
  projectMissionTruth,
  projectPersistentHistory,
  projectPlayableMissions,
} from "./state/WorldProjection";
import { selectMissionDirector } from "./state/MissionDirector";
import { landmarkForMission } from "../../../shared/worldSemantics";
import {
  networkStatusLabel,
  useNetworkStatus,
} from "./session/useNetworkStatus";
import { loadAnyCheckpoint, saveCheckpoint } from "./session/checkpointStorage";
import { corridorGameAssets, loadCorridorPack } from "./world/corridorPack";
import {
  DEFAULT_CORRIDOR_ID,
  isPlayableCorridor,
  nextPlayableCorridorId,
} from "./world/corridorRegistry";
import { CorridorTransitionController } from "./runtime/corridorTransition";
import type { CorridorTransitionPhase } from "./runtime/corridorTransition";
import { useVisualViewportSize } from "./session/useVisualViewportSize";
import { registerGoldlineServiceWorker } from "./pwa/registerServiceWorker";
import { installPwaHeadTags } from "./pwa/installPwaHead";
import { isIOS, isStandalone } from "./pwa/pwaEnvironment";
import {
  hasInstallPrompt,
  subscribeInstallPrompt,
  triggerInstallPrompt,
} from "./pwa/installPrompt";
import { getGoldlineSessionId } from "./analytics/goldlineSession";
import type { GoldlineEventEmitter } from "./analytics/emitGoldlineEvent";
import { getAudioManager } from "./audio/AudioManager";
import {
  actionReadyFeedback,
  arcadeFeedback,
  authoritativeMutationFeedback,
  missionApproachFeedback,
  missFeedback,
} from "./audio/haptics";
import type { AgentWorldPresence } from "./world/PopulationSystem";
import { projectAgentWorldPresence } from "./world/agentPresenceProjection";
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
import { ScoutReportPanel } from "./agents/scout/ScoutReportPanel";
import {
  hasOnboardingMilestone,
  markOnboardingMilestone,
  type OnboardingMilestone,
} from "./onboarding/onboardingProgress";
import {
  archetypeForMission,
  channelForMission,
  type ArmoryWeapon,
  type EncounterResolution,
  type ObjectionArchetype,
  type SalesIntelChannel,
} from "./encounters/EncounterTypes";
import {
  createEncounterRuntime,
  transitionEncounter,
  type EncounterRuntimeState,
} from "./encounters/encounterLifecycle";
import { projectAuthoritativeOutcome } from "./encounters/authoritativeOutcome";
import { projectMissionAffordance } from "./encounters/missionAffordance";
import {
  resolveGoldlineAction,
  type GoldlineActionDescriptor,
  type GoldlineActionKind,
} from "./actions/actionRegistry";
import type { GoldlineActionServices } from "./actions/actionServices";
import { projectTodayRoute } from "./world/todayRoute";
import { projectChronicle } from "./world/chronicleProjection";
import { presentAgents, projectStronghold } from "./world/strongholdProjection";
import { deriveRouteGrammar } from "../../../shared/actionGrammar";
import { selectFictionForMission } from "./fiction/fictionDirector";
import { reconcileFictionOnResume } from "./fiction/longHorizonResume";
import type { FictionMissionInstance } from "./fiction/fictionDirector";

// New objection encounters load only when the player actually reaches one,
// so the base game runtime stays lean.
const GatekeeperEncounter = lazy(
  () => import("./encounters/gatekeeper/GatekeeperEncounter")
);
const GhostEncounter = lazy(() => import("./encounters/ghost/GhostEncounter"));
const StallerEncounter = lazy(
  () => import("./encounters/staller/StallerEncounter")
);
const GoldlineActionSurface = lazy(
  () => import("./actions/GoldlineActionSurface")
);
const GoldlineFictionMissionPanel = lazy(
  () => import("./fiction/FictionMissionPanel")
);

/**
 * Lets the existing CI-only harness render an authoring pack for screenshot
 * review without making that pack production-playable. This code path is
 * tree-dead in normal builds because the harness flag is compile-time false.
 */
function authoringPreviewCorridorId(): string | null {
  if (import.meta.env.VITE_GOLDLINE_TEST_HARNESS !== "1") return null;
  const requested = new URLSearchParams(window.location.search).get(
    "goldlineCorridorPreview"
  );
  return requested === "corridor_02" ? requested : null;
}

type GoldlineGameHomeProps = GoldlineHomeProps & {
  /**
   * Stable id of the signed-in player, used ONLY to scope the local
   * positional checkpoint so a shared device cannot hand one driver another
   * driver's position. Null while signed out — that session gets its own
   * bucket rather than sharing one with a real account.
   */
  playerIdentity?: string | null;
  worldNodes?: DriverGameWorldNode[];
  progression?: GoldlineProgressionProjection | null;
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
  actionServices: GoldlineActionServices;
  /**
   * Real evidenced coverage count for the active fiction mission's
   * underlying route, when a real source exists. Defaults to 0 because this
   * business domain has no batch/route completion endpoint yet (see
   * shared/actionGrammar.ts's discrepancy note) — production honestly shows
   * 0 rather than a fabricated number. Test harnesses may override this to
   * prove the FictionMissionPanel/two-clock wiring end-to-end.
   */
  authoritativeRouteCoverage?: number;
};

type UtilityPanel =
  | "menu"
  | "route"
  | "objectives"
  | "open-channel"
  | "stronghold"
  | null;

/**
 * Bundled Run-1 fallback art. NOT corridor content — these ship with the app
 * so the world can always boot even if a corridor's optional plates fail to
 * load. Every corridor-specific URL now comes from the corridor's manifest.
 */
const RUNTIME_FALLBACKS = {
  worldUrl,
  operatorUrl,
  characterBasePath: "/assets/goldline/characters/trailblazer",
};

function stateTone(state: PlayableMission["state"]) {
  if (state === "captured") return "gold";
  if (
    state === "contested" ||
    state === "recovery_available" ||
    state === "recovery_active"
  )
    return "amber";
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
  /** Shown only until the player's first real movement, then never again this device. */
  showMovementHint?: boolean;
  onFirstMove?: () => void;
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
    if (length > 0.15) props.onFirstMove?.();
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
      data-testid="goldline-joystick"
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
      {props.showMovementHint ? (
        <em className="joystick-hint" aria-hidden="true" />
      ) : null}
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
    <div
      className="signal-window"
      aria-label={`${(remaining / 1000).toFixed(1)} seconds remaining`}
    >
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
      <button
        className="mission-fork-toggle"
        onClick={props.onToggle}
        aria-expanded={props.expanded}
      >
        <Target />
        <span>
          {props.expanded ? "COLLAPSE" : `${props.missions.length} OBJECTIVES`}
        </span>
      </button>
      <div className="mission-fork-icons">
        {props.missions.map((mission, index) => (
          <button
            key={mission.key}
            className={`is-${stateTone(mission.state)} ${landmarkForMission({ visualState: mission.state }).cssClass}${mission.key === props.activeKey ? " is-active" : ""}${index === 0 ? " is-primary" : ""}`}
            onClick={() => props.onSelect(mission)}
            aria-label={`Select ${mission.name} — ${landmarkForMission({ visualState: mission.state }).label}${index === 0 ? " — primary" : ""}`}
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
  const [shellEl, setShellEl] = useState<HTMLElement | null>(null);
  const runtimeRef = useRef<GoldlineGame | null>(null);
  /** Serializes corridor travel and rejects stale loads. */
  const transitionsRef = useRef<CorridorTransitionController | null>(null);
  /** Which corridor the player is actually standing in right now. */
  const activeCorridorIdRef = useRef<string>(DEFAULT_CORRIDOR_ID);
  /**
   * Read through a ref so the long-lived mount effect always saves against
   * the current player without re-running (and tearing down the world) when
   * the identity query resolves.
   */
  const playerIdentityRef = useRef<string | null>(props.playerIdentity ?? null);
  playerIdentityRef.current = props.playerIdentity ?? null;
  const weakPointRef = useRef<HTMLButtonElement>(null);
  const gestureStart = useRef<{ x: number; y: number; at: number } | null>(
    null
  );
  const [runtimeFailed, setRuntimeFailed] = useState(false);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [action, setAction] = useState<CorridorAction | null>(null);
  const [actionLabel, setActionLabel] = useState<string | null>(null);
  const [branch, setBranch] = useState<CorridorBranch>("intel");
  const [progress, setProgress] = useState(0.06);
  const [objectivesExpanded, setObjectivesExpanded] = useState(false);
  const [utilityPanel, setUtilityPanel] = useState<UtilityPanel>(null);
  const [selectedAbility, setSelectedAbility] =
    useState<EquippedAbility | null>(null);
  const [signalReset, setSignalReset] = useState(0);
  const [shield, setShield] = useState(3);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [arcadeResolution, setArcadeResolution] =
    useState<ArcadeResolution>(null);
  const [view, setView] = useState<GameView>("explore");
  const [worldOutcomeCue, setWorldOutcomeCue] = useState<string | null>(null);
  const worldOutcomeCueTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const [coldCallOpen, setColdCallOpen] = useState(false);
  const [scoutOpen, setScoutOpen] = useState(false);
  const networkStatus = useNetworkStatus();
  const sessionIdRef = useRef(getGoldlineSessionId());
  const sessionStartRef = useRef(performance.now());
  const emit = props.onEmitEvent;
  const [movementLearned, setMovementLearned] = useState(() =>
    hasOnboardingMilestone("movement")
  );
  const [onboardingToast, setOnboardingToast] = useState<string | null>(null);
  const onboardingToastTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const showOnboardingToast = useRef((message: string) => {
    setOnboardingToast(message);
    if (onboardingToastTimer.current)
      clearTimeout(onboardingToastTimer.current);
    onboardingToastTimer.current = setTimeout(
      () => setOnboardingToast(null),
      1800
    );
  }).current;
  useEffect(
    () => () => {
      if (onboardingToastTimer.current)
        clearTimeout(onboardingToastTimer.current);
      if (worldOutcomeCueTimer.current)
        clearTimeout(worldOutcomeCueTimer.current);
    },
    []
  );
  const showWorldOutcomeCue = useRef((message: string) => {
    setWorldOutcomeCue(message);
    if (worldOutcomeCueTimer.current)
      clearTimeout(worldOutcomeCueTimer.current);
    worldOutcomeCueTimer.current = setTimeout(
      () => setWorldOutcomeCue(null),
      2400
    );
  }).current;
  const completeMilestone = useRef((milestone: OnboardingMilestone) => {
    markOnboardingMilestone(milestone);
    if (milestone === "movement") setMovementLearned(true);
  }).current;

  useEffect(() => {
    emit?.({
      eventName: "goldline_session_started",
      sessionId: sessionIdRef.current,
      properties: {
        sessionId: sessionIdRef.current,
        entryPoint: "goldline_home",
      },
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
  const [coldCallPortalState, setColdCallPortalState] = useState<
    "hidden" | "label" | "engage"
  >("hidden");
  const [missionSpatialState, setMissionSpatialState] = useState<
    "hidden" | "visible" | "engage"
  >("hidden");
  const [corridorExitNear, setCorridorExitNear] = useState(false);
  const [corridorTransitionPhase, setCorridorTransitionPhase] =
    useState<CorridorTransitionPhase>("idle");
  const [activeCorridorId, setActiveCorridorId] = useState(DEFAULT_CORRIDOR_ID);
  const [populationDiagnostics, setPopulationDiagnostics] = useState({
    ambientCount: 0,
    assetStage: "engineering_placeholder" as
      | "production"
      | "engineering_placeholder",
  });
  const [qualityTier, setQualityTier] = useState<"premium" | "reduced">(
    "premium"
  );

  useEffect(() => {
    const audio = getAudioManager();
    audio.primeOnGesture();
    return audio.bindLifecycle();
  }, []);

  const [canShowInstallPrompt, setCanShowInstallPrompt] =
    useState(hasInstallPrompt);
  useEffect(() => {
    const removeHeadTags = installPwaHeadTags();
    registerGoldlineServiceWorker();
    const unsubscribe = subscribeInstallPrompt(() =>
      setCanShowInstallPrompt(hasInstallPrompt())
    );
    return () => {
      removeHeadTags();
      unsubscribe();
    };
  }, []);
  const [encounterArchetype, setEncounterArchetype] =
    useState<ObjectionArchetype>("ANCHOR");
  const [encounterChannel, setEncounterChannel] =
    useState<SalesIntelChannel>("phone");
  const [contextWeapons, setContextWeapons] = useState<ArmoryWeapon[]>([]);
  const [isLoadingWeapons, setIsLoadingWeapons] = useState(false);
  const [trainerIntelAvailable, setTrainerIntelAvailable] = useState(false);
  const [encounterRuntime, setEncounterRuntime] =
    useState<EncounterRuntimeState | null>(null);
  const [presentedAction, setPresentedAction] =
    useState<GoldlineActionDescriptor | null>(null);
  const [standaloneActionRequestId, setStandaloneActionRequestId] = useState<
    string | null
  >(null);
  const pendingWeaponEvidenceRef = useRef<Promise<void>>(Promise.resolve());

  function sendEncounterEvent(
    event: Parameters<typeof transitionEncounter>[1]
  ) {
    setEncounterRuntime(current =>
      current ? transitionEncounter(current, event) : current
    );
  }

  const unranked = useMemo(
    () =>
      projectPlayableMissions({
        missions: props.salesMissions,
        moves: props.moves,
        worldNodes: props.worldNodes,
      }),
    [props.moves, props.salesMissions, props.worldNodes]
  );
  // Captured/closed missions correctly leave the playable list, but the
  // lifecycle still needs their freshly refetched truth for one final
  // AWAITING_OUTCOME projection before restoring world control.
  const authoritativeMissionTruth = useMemo(
    () =>
      projectMissionTruth({
        missions: props.salesMissions,
        moves: props.moves,
        worldNodes: props.worldNodes,
      }),
    [props.moves, props.salesMissions, props.worldNodes]
  );
  // Mission Director selects and paces which real missions get spotlighted —
  // primary first, up to 2 secondary — from real evidence only. `missions`
  // stays the same shape/order contract the rest of this component already
  // expects (MissionFork's first icon is now provably the real primary).
  const missionDirector = useMemo(
    () => selectMissionDirector(unranked, new Date(), props.progression),
    [props.progression, unranked]
  );
  const missions = useMemo(() => {
    if (!missionDirector.primary) return unranked;
    const rankedKeys = new Set(
      [missionDirector.primary, ...missionDirector.secondary].map(m => m.key)
    );
    const rest = unranked.filter(m => !rankedKeys.has(m.key));
    return [missionDirector.primary, ...missionDirector.secondary, ...rest];
  }, [missionDirector, unranked]);
  const prioritized = missionDirector.primary;
  const history = useMemo(
    () => projectPersistentHistory(props.worldNodes),
    [props.worldNodes]
  );
  const allMissions = useMemo(
    () => [...missions, ...history],
    [history, missions]
  );
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeMission =
    allMissions.find(mission => mission.key === activeKey) ??
    prioritized ??
    null;
  const outcomeMission = encounterRuntime
    ? (authoritativeMissionTruth.find(
        mission => mission.missionId === encounterRuntime.missionId
      ) ?? null)
    : null;
  // Keep the typed action surface mounted across its own authoritative
  // refetch. A winning/closed write legitimately removes the mission from
  // the playable list before the adapter resumes; binding the surface only to
  // `activeMission` would unmount it and suppress REAL_ACTION_PERSISTED.
  const presentedActionMission = presentedAction
    ? (authoritativeMissionTruth.find(
        mission => mission.missionId === presentedAction.missionId
      ) ?? activeMission)
    : null;
  const missionAffordance = activeMission
    ? projectMissionAffordance(activeMission, new Date())
    : null;
  const activeMissionArchetype = activeMission
    ? archetypeForMission({
        mission: activeMission,
        hasDecisionMakerContact: Boolean(activeMission.phoneUrl),
      })
    : null;
  // Today's Route (Slice 95): the full deterministic real-priority order,
  // uncapped — MissionDirector above spotlights the top 3 for gameplay, this
  // is the whole real route for the Stronghold/route-table view. Reprojects
  // automatically whenever `authoritativeMissionTruth`/`props.progression`
  // change (Slice 96) — no separate reroute mechanism needed.
  const liveRouteMissions = useMemo(
    () =>
      authoritativeMissionTruth.filter(
        mission => mission.state !== "captured" && mission.state !== "closed"
      ),
    [authoritativeMissionTruth]
  );
  const todayRoute = useMemo(
    () =>
      projectTodayRoute({
        missions: liveRouteMissions,
        now: new Date(),
        progression: props.progression,
        scoutCapability: props.scoutCapability,
        scoutReport: props.scoutReport,
      }),
    [liveRouteMissions, props.progression, props.scoutCapability, props.scoutReport]
  );
  const chronicle = useMemo(
    () => projectChronicle(props.worldNodes),
    [props.worldNodes]
  );
  // Slice 95/96: reprojection is just this effect firing again whenever
  // liveRouteMissions changes referentially — no separate reroute mechanism.
  // First render reports today_route_projected; every render after that
  // (a real authoritative change already happened) reports route_reprojected.
  const hasProjectedRouteRef = useRef(false);
  useEffect(() => {
    emit?.({
      eventName: hasProjectedRouteRef.current
        ? "route_reprojected"
        : "today_route_projected",
      sessionId: sessionIdRef.current,
      properties: {
        sessionId: sessionIdRef.current,
        entryCount: todayRoute.length,
      },
    });
    hasProjectedRouteRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayRoute]);
  const stronghold = useMemo(
    () =>
      projectStronghold({
        routeTable: todayRoute,
        agents: presentAgents([...(props.progression?.agents ?? [])]),
        // Sales Intel Admin data is deliberately adminProcedure-gated and the
        // driver role must never reach it (see
        // server/salesIntel/salesIntelAuthorization.test.ts) — Stronghold's
        // intel panel stays honestly empty rather than crossing that
        // boundary. shared/salesIntelTeachingCoverage.ts +
        // world/intelligenceFlywheel.ts are ready to wire a scoped,
        // driver-safe read endpoint in a future run.
        intel: null,
        chronicle,
      }),
    [todayRoute, props.progression, chronicle]
  );
  // The canonical NEUTRALIZE fixture's real business backing: a genuine
  // multi-stop route grammar derived from real due nearby-visit field moves.
  // Null whenever reality has not actually produced one — the Fiction
  // Director then simply has nothing to instantiate.
  const routeGrammar = useMemo(
    () => deriveRouteGrammar(props.moves?.recommendedMoves ?? []),
    [props.moves?.recommendedMoves]
  );
  const fictionMission = useMemo<FictionMissionInstance | null>(() => {
    if (!routeGrammar) return null;
    return selectFictionForMission(routeGrammar, {
      now: new Date(),
      identity: props.playerIdentity ?? null,
    });
  }, [routeGrammar, props.playerIdentity]);
  const [fictionMissionOpen, setFictionMissionOpen] = useState(false);
  const seenFictionKeysRef = useRef(new Set<string>());
  useEffect(() => {
    if (!fictionMission) return;
    if (seenFictionKeysRef.current.has(fictionMission.stableMissionKey)) return;
    seenFictionKeysRef.current.add(fictionMission.stableMissionKey);
    emit?.({
      eventName: "fiction_mission_instantiated",
      sessionId: sessionIdRef.current,
      properties: {
        sessionId: sessionIdRef.current,
        templateId: fictionMission.template.id,
        grammarKind: fictionMission.grammar.kind,
        count: fictionMission.grammar.count,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fictionMission]);
  // Long-horizon resume (Slice 101): whenever freshly re-read authoritative
  // truth lands — including after `useAuthoritativeActionResume`'s external-
  // handoff refetch, or an ordinary query refresh hours/days later — prune
  // any persisted fiction assignment whose real action is no longer live.
  // Reality wins: the Fiction Director never resurrects a finished story.
  useEffect(() => {
    const { prunedCount } = reconcileFictionOnResume({
      liveMissions: liveRouteMissions,
      now: new Date(),
      identity: props.playerIdentity ?? null,
    });
    if (prunedCount > 0) {
      emit?.({
        eventName: "long_horizon_resume",
        sessionId: sessionIdRef.current,
        properties: { sessionId: sessionIdRef.current, prunedCount },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRouteMissions, props.playerIdentity]);
  const agentWorldPresence = useMemo<AgentWorldPresence[]>(() => {
    return projectAgentWorldPresence(
      props.progression,
      props.scoutReport?.discoveries.length ?? 0
    );
  }, [props.progression, props.scoutReport?.discoveries.length]);
  const nextCorridorId = nextPlayableCorridorId(activeCorridorIdRef.current);
  const equippedAbilities = useMemo(
    () => equipAnchorAbilities(props.armory?.items ?? []),
    [props.armory?.items]
  );
  const activeMissionRef = useRef(activeMission);
  activeMissionRef.current = activeMission;
  const seenMissionKeysRef = useRef(new Set<string>());
  const prevActionRef = useRef<CorridorAction | null>(null);
  const seenScoutDiscoveryIdsRef = useRef(new Set<string>());
  const openChannelGap = detectOpenChannelGap({
    now: new Date(),
    selectedDate: props.selectedDate,
    nextCommitmentAt: props.today?.nextFixedCommitment?.scheduledAt,
    fixedStopCount:
      (props.pickups?.length ?? 0) + (props.deliveries?.length ?? 0),
    hasMission: Boolean(props.openChannelMission),
  });

  useEffect(() => {
    if (!hostRef.current) return;
    const game = new GoldlineGame(hostRef.current, {
      onActionAvailable: (next, label) => {
        setAction(next);
        setActionLabel(label);
        // A player only becomes able to INTERACT once real proximity to the
        // mission's gate trigger is reached — the same signal that already
        // gates the action button, not a fabricated distance check.
        if (next === "INTERACT" && prevActionRef.current !== "INTERACT") {
          const mission = activeMissionRef.current;
          if (mission) {
            emit?.({
              eventName: "mission_approached",
              sessionId: sessionIdRef.current,
              missionId: mission.missionId,
              properties: {
                sessionId: sessionIdRef.current,
                missionState: mission.state,
              },
            });
          }
        }
        prevActionRef.current = next;
      },
      onBranchChange: setBranch,
      onProgress: setProgress,
      onInteract: () => handleInteractRef.current(),
      onError: () => setRuntimeFailed(true),
      onPortalProximity: (anchorId, state) => {
        if (anchorId === "cold_call_portal") setColdCallPortalState(state);
      },
      onMissionProximity: (_missionId, state) => {
        setMissionSpatialState(state);
        if (state === "engage") {
          getAudioManager().playOnce(
            "mission_proximity",
            `mission:${_missionId}`
          );
          missionApproachFeedback(_missionId);
        }
      },
      onCorridorExitProximity: setCorridorExitNear,
      onPopulationReady: (ambientCount, assetStage) => {
        setPopulationDiagnostics({ ambientCount, assetStage });
        emit?.({
          eventName: "population_scene_presented",
          sessionId: sessionIdRef.current,
          missionId: null,
          properties: {
            sessionId: sessionIdRef.current,
            ambientCount,
            assetStage,
          },
        });
      },
      onTraversalAction: action => {
        const eventName =
          action === "JUMP"
            ? "traversal_jump"
            : action === "CLIMB"
              ? "traversal_climb"
              : "traversal_vault";
        emit?.({
          eventName,
          sessionId: sessionIdRef.current,
          missionId: activeMissionRef.current?.missionId ?? null,
          properties: { sessionId: sessionIdRef.current },
        });
        const milestone: OnboardingMilestone =
          action === "JUMP" ? "jump" : action === "CLIMB" ? "climb" : "vault";
        if (!hasOnboardingMilestone(milestone)) {
          completeMilestone(milestone);
          showOnboardingToast(`${action} LEARNED`);
        }
      },
      onQualityChange: (tier, avgFrameMs) => {
        setQualityTier(tier);
        emit?.({
          eventName: "visual_quality_adjusted",
          sessionId: sessionIdRef.current,
          missionId: null,
          properties: {
            sessionId: sessionIdRef.current,
            tier,
            avgFrameMs: Math.round(avgFrameMs * 100) / 100,
          },
        });
      },
      onCheckpointSafe: (progress, lateral, branch) => {
        saveCheckpoint(
          {
            // Records WHICH corridor the position belongs to, so resume can
            // restore into the right world rather than assuming corridor_01.
            corridorId: activeCorridorIdRef.current,
            progress,
            lateral,
            branch,
            savedAt: new Date().toISOString(),
          },
          playerIdentityRef.current
        );
      },
    });
    runtimeRef.current = game;

    const transitionStarted = new Set<string>();
    const transitions = new CorridorTransitionController({
      onPhaseChange: (phase, corridorId) => {
        setCorridorTransitionPhase(phase);
        if (phase === "signaling" && corridorId) {
          transitionStarted.add(corridorId);
          emit?.({
            eventName: "corridor_transition_started",
            sessionId: sessionIdRef.current,
            missionId: null,
            properties: {
              sessionId: sessionIdRef.current,
              corridorId,
            },
          });
        } else if (
          phase === "ready" &&
          corridorId &&
          transitionStarted.delete(corridorId)
        ) {
          emit?.({
            eventName: "corridor_transition_completed",
            sessionId: sessionIdRef.current,
            missionId: null,
            properties: {
              sessionId: sessionIdRef.current,
              corridorId,
            },
          });
        }
      },
    });
    transitionsRef.current = transitions;

    // Position only — authoritative business/world state is always
    // reconciled fresh from live props (see the activeMission effect below),
    // never restored from this checkpoint.
    const checkpoint = loadAnyCheckpoint(playerIdentityRef.current);
    // Cross-corridor resume: trust the checkpoint's corridor only if this
    // build still considers it playable, so a removed or unfinished corridor
    // can never strand the player outside the world.
    const previewCorridorId = authoringPreviewCorridorId();
    const bootCorridorId =
      previewCorridorId ??
      (checkpoint && isPlayableCorridor(checkpoint.corridorId)
        ? checkpoint.corridorId
        : DEFAULT_CORRIDOR_ID);
    activeCorridorIdRef.current = bootCorridorId;
    setActiveCorridorId(bootCorridorId);
    const restorable =
      checkpoint?.corridorId === bootCorridorId ? checkpoint : null;

    let cancelled = false;
    // The corridor is addressed by id: no caller here knows a single asset
    // URL. Everything the renderer needs comes from the validated manifest.
    void loadCorridorPack(bootCorridorId, {
      requirePlayable: previewCorridorId === null,
    })
      .then(pack => {
        if (cancelled) return false;
        transitions.adoptActiveCorridor(pack.id);
        return game.start({
          ...corridorGameAssets(pack, RUNTIME_FALLBACKS),
          initialProgress: restorable?.progress,
          initialLateral: restorable?.lateral,
          initialBranch: restorable?.branch,
        });
      })
      .then(started => {
        if (!cancelled && started) setRuntimeReady(true);
      })
      .catch(() => {
        // A corridor that cannot be trusted must not half-render. The
        // existing runtime-failure surface already explains this to the
        // player rather than leaving a blank canvas.
        if (!cancelled) setRuntimeFailed(true);
      });

    return () => {
      cancelled = true;
      runtimeRef.current = null;
      transitionsRef.current = null;
      transitions.dispose();
      game.destroy();
    };
  }, []);

  useEffect(() => {
    if (!corridorExitNear || !nextCorridorId) return;
    const game = runtimeRef.current;
    const transitions = transitionsRef.current;
    if (!game || !transitions) return;
    const destinationId = nextCorridorId;
    const prepared = new Map<string, PreparedCorridorAssets>();
    void transitions
      .requestCorridor(
        destinationId,
        async (corridorId, signal) => {
          const pack = await loadCorridorPack(corridorId, { signal });
          prepared.set(
            corridorId,
            await game.preloadCorridor(
              corridorGameAssets(pack, RUNTIME_FALLBACKS),
              signal
            )
          );
          return pack;
        },
        (pack, signal) => {
          if (signal.aborted) throw new DOMException("Aborted", "AbortError");
          const next = prepared.get(pack.id);
          if (!next) throw new Error(`corridor '${pack.id}' was not preloaded`);
          game.revealCorridor(next);
          prepared.delete(pack.id);
          activeCorridorIdRef.current = pack.id;
          setActiveCorridorId(pack.id);
          saveCheckpoint(
            {
              corridorId: pack.id,
              progress: 0.06,
              lateral: 0,
              branch: "intel",
              savedAt: new Date().toISOString(),
            },
            playerIdentityRef.current
          );
        }
      )
      .then(outcome => {
        prepared.forEach(candidate => game.discardPreparedCorridor(candidate));
        prepared.clear();
        if (outcome.outcome === "failed") {
          setFeedback("ROUTE HELD · DESTINATION UNAVAILABLE");
        }
      });
  }, [corridorExitNear, nextCorridorId]);

  useEffect(() => {
    if (!activeMission) {
      setMissionSpatialState("hidden");
      runtimeRef.current?.setWorldSignal("none");
      runtimeRef.current?.setLandmarkArchetype(null);
      runtimeRef.current?.setMissionEmbodiment(null);
      return;
    }
    setMissionSpatialState("hidden");
    if (!seenMissionKeysRef.current.has(activeMission.key)) {
      seenMissionKeysRef.current.add(activeMission.key);
      emit?.({
        eventName: "mission_seen",
        sessionId: sessionIdRef.current,
        missionId: activeMission.missionId,
        properties: {
          sessionId: sessionIdRef.current,
          missionState: activeMission.state,
        },
      });
    }
    runtimeRef.current?.setWorldState(activeMission.state);
    // The landmark shape/color at the gate is set from the same archetype
    // signal the encounter itself will use, so the player can read what
    // they're approaching from the world before ever opening it.
    if (activeMission.state === "captured") {
      // Fires only from real mission state, never from arcade performance.
      emit?.({
        eventName: "verified_capture",
        sessionId: sessionIdRef.current,
        missionId: activeMission.missionId,
        properties: {
          sessionId: sessionIdRef.current,
          estimatedValueBand:
            activeMission.verifiedAnnualValueCents != null
              ? "verified"
              : "unverified",
        },
      });
      completeMilestone("first_business_resolution");
    } else if (activeMission.state === "contested") {
      completeMilestone("first_business_resolution");
    } else if (activeMission.state === "closed") {
      completeMilestone("first_business_resolution");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMission?.key, activeMission?.state]);

  useEffect(() => {
    runtimeRef.current?.setLandmarkArchetype(activeMissionArchetype);
    runtimeRef.current?.setMissionEmbodiment(
      activeMission?.missionId && activeMissionArchetype && missionAffordance
        ? {
            missionId: activeMission.missionId,
            missionKey: activeMission.key,
            archetype: activeMissionArchetype,
            state: activeMission.state,
            affordance: missionAffordance.primary,
            worldSignal: missionAffordance.worldSignal,
          }
        : null
    );
  }, [
    activeMission?.key,
    activeMission?.missionId,
    activeMission?.state,
    activeMissionArchetype,
    missionAffordance?.primary,
    missionAffordance?.worldSignal,
  ]);

  useEffect(() => {
    runtimeRef.current?.setAgentPresence(agentWorldPresence);
  }, [agentWorldPresence, runtimeReady]);

  useEffect(() => {
    runtimeRef.current?.setWorldSignal(
      missionAffordance?.worldSignal ?? "none"
    );
  }, [missionAffordance?.worldSignal]);

  useEffect(() => {
    if (encounterRuntime?.phase !== "ACTION_READY") return;
    getAudioManager().playOnce("action_ready", encounterRuntime.encounterId);
    actionReadyFeedback(encounterRuntime.encounterId);
  }, [encounterRuntime?.encounterId, encounterRuntime?.phase]);

  useEffect(() => {
    if (!outcomeMission || encounterRuntime?.phase !== "AWAITING_OUTCOME")
      return;
    const outcome = projectAuthoritativeOutcome(outcomeMission);
    const revision = [
      outcomeMission.key,
      outcomeMission.state,
      outcomeMission.contestedUntil ?? "",
      outcomeMission.unlockedPath ?? "",
    ].join(":");
    if (
      outcome.kind === "captured" ||
      outcome.kind === "contested" ||
      outcome.kind === "closed"
    ) {
      getAudioManager().playOnce(
        outcome.kind === "captured"
          ? "captured_truth"
          : outcome.kind === "contested"
            ? "contested_truth"
            : "closed_truth",
        revision
      );
      authoritativeMutationFeedback(revision);
      sendEncounterEvent({ type: "AUTHORITATIVE_RESOLVED", revision });
      showWorldOutcomeCue(
        outcome.kind === "captured"
          ? "ROUTE STABILIZED · SERVER VERIFIED"
          : outcome.kind === "contested"
            ? "PATH CONTESTED · SERVER STATE PRESERVED"
            : "ROUTE DORMANT · AUTHORITATIVE CLOSURE"
      );
    } else if (outcome.kind === "recovery") {
      getAudioManager().playOnce("recovery_truth", revision);
      authoritativeMutationFeedback(revision);
      sendEncounterEvent({ type: "AUTHORITATIVE_RECOVERY", revision });
      showWorldOutcomeCue("RECOVERY PATH PROJECTED FROM SERVER TRUTH");
    } else {
      sendEncounterEvent({ type: "AUTHORITATIVE_UNRESOLVED", revision });
      showWorldOutcomeCue("BUSINESS STATE UNRESOLVED · NO WIN INFERRED");
    }
    runtimeRef.current?.exitEncounterStaging();
    setPresentedAction(null);
    setView("explore");
    // This projection runs only after the persisted action has moved the
    // lifecycle into AWAITING_OUTCOME. Arcade state is intentionally absent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    encounterRuntime?.phase,
    outcomeMission?.key,
    outcomeMission?.state,
    outcomeMission?.contestedUntil,
    outcomeMission?.unlockedPath,
  ]);

  useEffect(() => {
    const discoveries = props.scoutReport?.discoveries ?? [];
    const newDiscoveries = discoveries.filter(
      discovery => !seenScoutDiscoveryIdsRef.current.has(discovery.entityId)
    );
    if (newDiscoveries.length === 0) return;
    for (const discovery of newDiscoveries) {
      seenScoutDiscoveryIdsRef.current.add(discovery.entityId);
    }
    emit?.({
      eventName: "scout_discovery_created",
      sessionId: sessionIdRef.current,
      missionId: null,
      properties: {
        sessionId: sessionIdRef.current,
        discoveryCount: newDiscoveries.length,
      },
    });
    // Each discovery row is 1:1 with a real backend-created mission
    // (expansionScoutService persists discovery + mission together), so this
    // fires once per real mission that appeared, not a fabricated count.
    for (const discovery of newDiscoveries) {
      emit?.({
        eventName: "scout_mission_created",
        sessionId: sessionIdRef.current,
        missionId: discovery.missionId,
        properties: { sessionId: sessionIdRef.current },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.scoutReport]);

  const handleInteractRef = useRef(() => {});
  handleInteractRef.current = () => {
    if (!activeMission) return;
    if (
      activeMission.state === "captured" ||
      activeMission.state === "closed"
    ) {
      showWorldOutcomeCue(
        activeMission.state === "captured"
          ? "VERIFIED ROUTE HISTORY"
          : "AUTHORITATIVE CLOSED ROUTE"
      );
      return;
    }
    if (!activeMission.missionId) {
      const scoutAction = resolveGoldlineAction(
        {
          mission: activeMission,
          now: new Date(),
          followUp: null,
          scoutCapability: props.scoutCapability ?? null,
          scoutReport: props.scoutReport ?? null,
        },
        "SCOUT"
      );
      if (!scoutAction) {
        setFeedback("SCOUT REQUIRES SERVER-SUPPORTED CAPABILITY");
        return;
      }
      setStandaloneActionRequestId(crypto.randomUUID());
      setPresentedAction(scoutAction);
      return;
    }
    // Which objection this is, and on which channel, comes from real state.
    const archetype = archetypeForMission({
      mission: activeMission,
      hasDecisionMakerContact: Boolean(activeMission.phoneUrl),
    });
    const channel = channelForMission(activeMission);
    emit?.({
      eventName: "mission_engaged",
      sessionId: sessionIdRef.current,
      missionId: activeMission.missionId,
      properties: {
        sessionId: sessionIdRef.current,
        missionState: activeMission.state,
        archetype,
      },
    });
    completeMilestone("first_mission_engaged");
    setEncounterArchetype(archetype);
    setEncounterChannel(channel);
    setShield(3);
    setFeedback(null);
    setArcadeResolution(null);
    setSelectedAbility(null);
    setSignalReset(current => current + 1);
    setContextWeapons([]);
    setTrainerIntelAvailable(false);
    let runtime = createEncounterRuntime({
      encounterId: `${activeMission.missionId}:${crypto.randomUUID()}`,
      missionId: activeMission.missionId,
      archetype,
      channel,
    });
    runtime = transitionEncounter(runtime, {
      type: "PHYSICAL_APPROACH_COMPLETED",
    });
    setEncounterRuntime(runtime);
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
          const weapons = Array.isArray(result?.weapons) ? result.weapons : [];
          setContextWeapons(weapons);
          setTrainerIntelAvailable(
            Boolean(result?.trainerIntelligenceAvailable)
          );
          for (const weapon of weapons) {
            emit?.({
              eventName: "armory_weapon_viewed",
              sessionId: sessionIdRef.current,
              missionId: activeMission.missionId,
              properties: {
                sessionId: sessionIdRef.current,
                provenanceKind: weapon.provenance.type,
              },
            });
          }
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
    if (
      encounterRuntime?.phase === "STAGED" ||
      encounterRuntime?.phase === "ARMED"
    ) {
      sendEncounterEvent({ type: "STRATEGY_SELECTED", strategyId: weapon.id });
    }
    emit?.({
      eventName: "armory_weapon_selected",
      sessionId: sessionIdRef.current,
      missionId: activeMission?.missionId ?? null,
      properties: {
        sessionId: sessionIdRef.current,
        provenanceKind: weapon.provenance.type,
      },
    });
    completeMilestone("first_armory_choice");
    if (!props.onRecordWeaponUsage || !activeMission?.missionId) return;
    pendingWeaponEvidenceRef.current = props
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
      .then(() => {
        // Fired only once the evidence record actually persisted — this is
        // "used", distinct from armory_weapon_selected above.
        emit?.({
          eventName: "armory_weapon_used",
          sessionId: sessionIdRef.current,
          missionId: activeMission.missionId,
          properties: {
            sessionId: sessionIdRef.current,
            provenanceKind: weapon.provenance.type,
          },
        });
      })
      .catch(() => {
        // Evidence recording must never block the encounter.
      });
  }

  function handleColdCallStart(target: ColdCallTarget) {
    return props.onStartColdCall(target).then(batch => {
      emit?.({
        eventName: "cold_call_target_started",
        sessionId: sessionIdRef.current,
        missionId: target.missionId,
        properties: { sessionId: sessionIdRef.current },
      });
      return batch;
    });
  }

  function handleColdCallComplete(
    input: Parameters<GoldlineGameHomeProps["onCompleteColdCall"]>[0]
  ) {
    return props.onCompleteColdCall(input).then(batch => {
      emit?.({
        eventName: "cold_call_outcome_saved",
        sessionId: sessionIdRef.current,
        missionId: input.target.missionId,
        properties: { sessionId: sessionIdRef.current, outcome: input.outcome },
      });
      return batch;
    });
  }

  function handleColdCallSelectChain(target: ColdCallTarget) {
    return props.onSelectColdCallChain(target).then(batch => {
      emit?.({
        eventName: "cold_call_chain_continued",
        sessionId: sessionIdRef.current,
        missionId: null,
        properties: { sessionId: sessionIdRef.current, combo: batch.combo },
      });
      return batch;
    });
  }

  function handleRunScout() {
    emit?.({
      eventName: "scout_run_started",
      sessionId: sessionIdRef.current,
      missionId: null,
      properties: { sessionId: sessionIdRef.current },
    });
    return props.onRunScout();
  }

  function handleEncounterResolved(resolution: EncounterResolution) {
    setFeedback(resolution.feedback);
    setArcadeResolution(
      resolution.performance === "clean" ? "breached" : "miss"
    );
    if (encounterRuntime?.phase === "ARMED") {
      sendEncounterEvent({ type: "GAME_CHALLENGE_COMPLETED" });
    }
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

  async function openRealAction() {
    if (!activeMission?.missionId || encounterRuntime?.phase !== "ACTION_READY")
      return;
    try {
      // Preserve association ordering: the real action may proceed even if
      // evidence recording failed, but it must not race ahead of a successful
      // weapon-use write for this encounter.
      await pendingWeaponEvidenceRef.current;
      const now = new Date();
      const requested = projectMissionAffordance(activeMission, now)
        .primary as GoldlineActionKind | null;
      const followUp =
        requested === "FOLLOW_UP"
          ? await props.actionServices.loadFollowUp(activeMission.missionId)
          : null;
      const context = {
        mission: activeMission,
        now,
        followUp,
        scoutCapability: props.scoutCapability ?? null,
        scoutReport: props.scoutReport ?? null,
      };
      const action = requested
        ? resolveGoldlineAction(context, requested)
        : null;
      const truthfulFallback =
        action ?? resolveGoldlineAction(context, "REVIEW");
      if (!truthfulFallback) {
        setFeedback("NO AUTHORITATIVE BUSINESS ACTION IS AVAILABLE");
        return;
      }
      if (truthfulFallback.mode !== "read") {
        sendEncounterEvent({
          type: "REAL_ACTION_STARTED",
          requestId: crypto.randomUUID(),
        });
      }
      setPresentedAction(truthfulFallback);
    } catch (cause) {
      setFeedback(
        cause instanceof Error
          ? cause.message
          : "AUTHORITATIVE ACTION STATE IS UNAVAILABLE"
      );
    }
  }

  function performAction() {
    if (!action) return;
    const performed = runtimeRef.current?.performAction(action);
    if (!performed) return;
    if (action === "JUMP") getAudioManager().play("jump");
    else if (action === "VAULT" || action === "CLIMB")
      getAudioManager().play("vault");
  }

  /**
   * Physical encounter staging (Slice 59).
   *
   * The player never leaves the world to open an encounter: the renderer
   * keeps running, and the camera lifts/biases toward the landmark so both it
   * and Trailblazer stay visible above the encounter rail. Driven off `view`
   * in one place so entering and leaving are always symmetrical — there is no
   * exit path that can strand the camera in an encounter frame.
   */
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const staged = view === "encounter" || view === "awaiting_business_result";
    if (staged) runtime.stageEncounter();
    else runtime.exitEncounterStaging();
  }, [view, runtimeReady]);

  /** Mirrors the OS reduced-motion preference into camera framing. */
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => runtimeRef.current?.setReducedMotion(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [runtimeReady]);

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
    if (encounterRuntime?.phase === "ARMED") {
      sendEncounterEvent({ type: "GAME_CHALLENGE_COMPLETED" });
    }
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
    const deliberateInput =
      inside && (gestureDistance > 18 || performance.now() - start.at < 360);
    if (!deliberateInput) {
      setArcadeResolution("miss");
      setFeedback("MISS — SIGNAL SKIPPED THE WEAK POINT");
      missFeedback();
      if (encounterRuntime?.phase === "ARMED") {
        sendEncounterEvent({ type: "GAME_CHALLENGE_COMPLETED" });
      }
      return;
    }
    const damage = shieldDamage(selectedAbility.fit);
    const nextShield = Math.max(0, shield - damage);
    setShield(nextShield);
    setArcadeResolution(nextShield === 0 ? "breached" : "hit");
    setFeedback(
      nextShield === 0
        ? "BREACH — ARCADE OPENING CREATED"
        : `HIT — SHIELD ${nextShield}/3`
    );
    getAudioManager().play("weak_point_hit");
    arcadeFeedback();
    if (nextShield === 0) {
      if (encounterRuntime?.phase === "ARMED") {
        sendEncounterEvent({ type: "GAME_CHALLENGE_COMPLETED" });
      }
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
  const utilityNavigate = activeMission?.navigationUrl ?? null;
  const utilityCall = activeMission?.phoneUrl ?? null;

  useVisualViewportSize(shellEl);

  return (
    <main
      className="playable-goldline-shell"
      ref={setShellEl}
      data-testid="goldline-shell"
    >
      <section
        className={`playable-goldline is-${view}`}
        aria-label="Goldline playable field world"
        data-testid="goldline-world"
        data-game-view={view}
        data-encounter-phase={encounterRuntime?.phase ?? "NONE"}
        data-authoritative-outcome-state={outcomeMission?.state ?? "NONE"}
        data-mission-affordance={missionAffordance?.primary ?? "NONE"}
        data-world-signal={missionAffordance?.worldSignal ?? "none"}
        data-mission-reason={missionDirector.reasonCode ?? "NONE"}
        data-challenge-depth={missionDirector.challengeDepth}
        data-mission-spatial-state={missionSpatialState}
        data-population-asset-stage={populationDiagnostics.assetStage}
        data-ambient-population-count={populationDiagnostics.ambientCount}
        data-mission-embodiment-id={activeMission?.missionId ?? "NONE"}
        data-corridor-id={activeCorridorId}
        data-next-corridor-id={nextCorridorId ?? "NONE"}
        data-corridor-transition-phase={corridorTransitionPhase}
        data-player-progress={progress.toFixed(3)}
        data-visual-quality-tier={qualityTier}
      >
        <div ref={hostRef} className="goldline-canvas-host" />
        {!runtimeReady ? (
          <div className="game-loading">
            <Loader2 /> ENTERING TERRITORY · SYNCING FIELD…
          </div>
        ) : null}
        <div className="game-atmosphere" aria-hidden="true" />
        {missionAffordance?.primary ? (
          <div
            className="mission-affordance-signal"
            aria-label={`Available mission action: ${missionAffordance.primary}`}
          >
            {missionAffordance.primary}
          </div>
        ) : null}
        {worldOutcomeCue ? (
          <div className="world-outcome-cue" role="status">
            {worldOutcomeCue}
          </div>
        ) : null}
        {corridorExitNear && nextCorridorId ? (
          <div className="corridor-transition-signal" role="status">
            ROUTE CONTINUES · DESTINATION READY
          </div>
        ) : null}
        {networkStatus === "offline" ? (
          <div className="network-status-banner" role="status">
            {networkStatusLabel(networkStatus)}
          </div>
        ) : null}

        <header className="game-topbar">
          <button
            onClick={() => setUtilityPanel("menu")}
            aria-label="Open field utilities"
          >
            <Menu />
          </button>
          <div>
            <span>
              <Radio /> FIELD LINK
            </span>
            <b>{activeMission?.name ?? "NO ACTIVE MISSION"}</b>
            <small>STATIONARY PLAY · TEMP • INSIDE GAME LOOP</small>
          </div>
          <button
            onClick={() => setUtilityPanel("objectives")}
            aria-label="Open objectives"
          >
            <Target />
          </button>
        </header>

        <MissionFork
          missions={missions}
          activeKey={activeMission?.key ?? null}
          expanded={objectivesExpanded}
          onToggle={() => setObjectivesExpanded(value => !value)}
          onSelect={selectMission}
        />

        {view === "explore" && !coldCallOpen && !scoutOpen ? (
          <aside
            className="world-history-ribbon"
            aria-label="Persistent world history"
          >
            <span>
              <small>PERSISTENT WORLD HISTORY</small>
              <b title="Game progression only — not market share or ownership">
                WORLD CONTROL {gameWorldControlPercent(props.worldNodes ?? [])}%
              </b>
            </span>
            <div>
              {history.slice(0, 4).map(mission => (
                <button
                  key={mission.key}
                  className={`is-${mission.state}`}
                  onClick={() => {
                    setActiveKey(mission.key);
                    showWorldOutcomeCue(
                      mission.state === "captured"
                        ? "VERIFIED ROUTE HISTORY"
                        : "AUTHORITATIVE CLOSED ROUTE"
                    );
                  }}
                >
                  {mission.state === "captured" ? "◆" : "×"} {mission.name}
                </button>
              ))}
              {!history.length ? (
                <small>NO RESOLVED TERRITORY YET</small>
              ) : null}
            </div>
          </aside>
        ) : null}

        {view === "explore" ? (
          <>
            <div className="corridor-status">
              <span>{branchCopy(branch)}</span>
              <i>
                <b style={{ width: `${Math.round(progress * 100)}%` }} />
              </i>
            </div>
            {branch === "intel" && progress > 0.38 ? (
              <div className="intel-pickup">
                <Sparkles /> ENCOUNTER PREP REVEALED
              </div>
            ) : null}
            {onboardingToast ? (
              <div className="onboarding-toast" role="status">
                {onboardingToast}
              </div>
            ) : null}
            <Joystick
              disabled={false}
              onInput={(x, y) => runtimeRef.current?.setInput(x, y)}
              showMovementHint={!movementLearned}
              onFirstMove={() => completeMilestone("movement")}
            />
            <div className="context-actions">
              {action ? (
                <button
                  className={`is-${action.toLowerCase()}`}
                  onClick={performAction}
                >
                  <Footprints />
                  <span>
                    <b>{action}</b>
                    <small>{actionLabel}</small>
                  </span>
                </button>
              ) : (
                <div className="action-awaiting">
                  <Route />
                  <span>MOVE TO NEXT ACTION ZONE</span>
                </div>
              )}
            </div>
            <button
              className={`cold-call-entry is-portal-${coldCallPortalState}`}
              disabled={
                !props.coldCallBatch && props.coldCallEligibleCount === 0
              }
              onClick={async () => {
                if (!props.coldCallBatch) {
                  const created = await props.onCreateColdCall();
                  if (!created) return;
                  emit?.({
                    eventName: "cold_call_batch_started",
                    sessionId: sessionIdRef.current,
                    missionId: null,
                    properties: {
                      sessionId: sessionIdRef.current,
                      targetCount: created.totalTargets,
                    },
                  });
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
                      : (props.coldCallEmptyReason ?? "NO ELIGIBLE TARGETS")}
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
                <span>
                  {[0, 1, 2].map(index => (
                    <Shield
                      key={index}
                      className={index < shield ? "is-live" : ""}
                    />
                  ))}
                </span>
              </div>
            </header>
            <div
              className={`anchor-target-field${selectedAbility ? " is-armed" : ""}`}
              onPointerDown={event => {
                gestureStart.current = {
                  x: event.clientX,
                  y: event.clientY,
                  at: performance.now(),
                };
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
                <span>
                  <Crosshair />
                </span>
              </button>
              <div className="weak-point-copy">
                <b>WEAK POINT · TAP / FLICK ABILITY</b>
                <small>
                  {selectedAbility
                    ? `${selectedAbility.fit.toUpperCase()} FIT · ${selectedAbility.fitReason}`
                    : "CHOOSE AN ARMORY ABILITY FIRST"}
                </small>
              </div>
              {feedback ? (
                <div
                  className={`encounter-feedback is-${arcadeResolution ?? "info"}`}
                >
                  {feedback}
                </div>
              ) : null}
            </div>
            <div className="ability-loadout" aria-label="Armory abilities">
              {equippedAbilities.map(ability => (
                <button
                  key={ability.id}
                  className={`${selectedAbility?.id === ability.id ? "is-selected" : ""} is-${ability.fit}`}
                  onClick={() => {
                    if (view !== "encounter") return;
                    setSelectedAbility(ability);
                    if (
                      encounterRuntime?.phase === "STAGED" ||
                      encounterRuntime?.phase === "ARMED"
                    ) {
                      sendEncounterEvent({
                        type: "STRATEGY_SELECTED",
                        strategyId: String(ability.id),
                      });
                    }
                    setFeedback(null);
                    setSignalReset(current => current + 1);
                  }}
                >
                  <small>
                    {ability.fit} fit ·{" "}
                    {ability.provenance.replaceAll("_", " ")}
                  </small>
                  <b>{ability.title}</b>
                  <span>{ability.response}</span>
                </button>
              ))}
            </div>
            {encounterRuntime?.phase === "ACTION_READY" ? (
              <div className="business-resolution-gate">
                <b>
                  {arcadeResolution === "breached"
                    ? "ARCADE BREACH ≠ BUSINESS WIN"
                    : "ARCADE MISS · REAL OUTCOME REQUIRED"}
                </b>
                <small>
                  Call, visit, or log the sourced result. Goldline will resolve
                  only from backend truth.
                </small>
                <button
                  onClick={openRealAction}
                  disabled={!activeMission.missionId}
                >
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
                onOpenBusinessAction: openRealAction,
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

        {presentedAction && presentedActionMission ? (
          <Suspense
            fallback={
              <div className="game-loading">
                <Loader2 /> LOADING REAL ACTION…
              </div>
            }
          >
            <GoldlineActionSurface
              action={presentedAction}
              mission={presentedActionMission}
              requestId={
                encounterRuntime?.actionRequestId ?? standaloneActionRequestId
              }
              services={props.actionServices}
              onPersisted={() => {
                sendEncounterEvent({ type: "REAL_ACTION_PERSISTED" });
                setPresentedAction(null);
                setStandaloneActionRequestId(null);
                setView("awaiting_business_result");
              }}
              onClose={() => {
                const wasReadOnly = presentedAction.mode === "read";
                setPresentedAction(null);
                setStandaloneActionRequestId(null);
                if (encounterRuntime?.phase === "ACTION_IN_PROGRESS") {
                  sendEncounterEvent({ type: "REAL_ACTION_CANCELLED" });
                }
                if (wasReadOnly) {
                  runtimeRef.current?.exitEncounterStaging();
                  setView("explore");
                }
              }}
            />
          </Suspense>
        ) : null}

        {fictionMissionOpen && fictionMission ? (
          <Suspense
            fallback={
              <div className="game-loading">
                <Loader2 /> LOADING MISSION…
              </div>
            }
          >
            <GoldlineFictionMissionPanel
              instance={fictionMission}
              challengeDepth={missionDirector.challengeDepth}
              isDriving={false}
              authoritativeCount={props.authoritativeRouteCoverage ?? 0}
              onClose={() => setFictionMissionOpen(false)}
            />
          </Suspense>
        ) : null}

        {coldCallOpen && props.coldCallBatch ? (
          <ColdCallBurst
            batch={props.coldCallBatch}
            onClose={() => setColdCallOpen(false)}
            onStart={handleColdCallStart}
            onComplete={handleColdCallComplete}
            onSelectChain={handleColdCallSelectChain}
            onBreakCombo={props.onBreakColdCallCombo}
          />
        ) : null}

        {scoutOpen ? (
          <ScoutReportPanel
            report={props.scoutReport ?? null}
            isRunning={Boolean(props.isRunningScout)}
            onRun={handleRunScout}
            onClose={() => setScoutOpen(false)}
            onEngageMission={missionId => {
              const mission = allMissions.find(
                item => item.missionId === missionId
              );
              if (mission) selectMission(mission);
              setScoutOpen(false);
            }}
          />
        ) : null}

        {view === "explore" &&
        !coldCallOpen &&
        !scoutOpen &&
        props.scoutCapability?.unlocked ? (
          <button className="scout-entry" onClick={() => setScoutOpen(true)}>
            <Radar />
            <span>
              <b>EXPANSION SCOUT</b>
              <small>OPEN SOURCED REPORT</small>
            </span>
          </button>
        ) : null}

        {worldLocked ? null : (
          <nav className="game-utility-bar" aria-label="Business utilities">
            <a
              href={utilityNavigate ?? undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!utilityNavigate}
            >
              <MapPin />
              Navigate
            </a>
            <a href={utilityCall ?? undefined} aria-disabled={!utilityCall}>
              <Phone />
              Call
            </a>
            <button onClick={props.onOpenJournal}>
              <FileText />
              Mark
            </button>
            <button onClick={() => setUtilityPanel("objectives")}>
              <Target />
              Intel
            </button>
          </nav>
        )}

        {utilityPanel && utilityPanel !== "open-channel" ? (
          <div
            className="game-utility-backdrop"
            onClick={() => setUtilityPanel(null)}
          >
            <section onClick={event => event.stopPropagation()}>
              <button
                className="game-panel-close"
                onClick={() => setUtilityPanel(null)}
                aria-label="Close"
              >
                <X />
              </button>
              {utilityPanel === "menu" ? (
                <>
                  <small>REAL BUSINESS UTILITIES</small>
                  <h2>Field console</h2>
                  <div className="field-console-grid">
                    <button onClick={props.onOpenNewOrder}>NEW ORDER</button>
                    <button onClick={props.onOpenWalkIn}>
                      START VISIT / WALK-IN
                    </button>
                    <button onClick={props.onOpenJournal}>FIELD JOURNAL</button>
                    <button onClick={() => setUtilityPanel("route")}>
                      LIVE ROUTE
                    </button>
                    <button onClick={() => setUtilityPanel("open-channel")}>
                      OPEN CHANNEL
                    </button>
                    <button
                      onClick={() => {
                        setUtilityPanel("stronghold");
                        emit?.({
                          eventName: "stronghold_object_engaged",
                          sessionId: sessionIdRef.current,
                          properties: {
                            sessionId: sessionIdRef.current,
                            objectKind: "stronghold_panel",
                          },
                        });
                      }}
                    >
                      STRONGHOLD
                    </button>
                    {fictionMission ? (
                      <button
                        data-testid="enter-fiction-mission"
                        onClick={() => {
                          setUtilityPanel(null);
                          setFictionMissionOpen(true);
                          emit?.({
                            eventName: "fiction_mission_started",
                            sessionId: sessionIdRef.current,
                            properties: {
                              sessionId: sessionIdRef.current,
                              templateId: fictionMission.template.id,
                            },
                          });
                        }}
                      >
                        {fictionMission.template.title}
                      </button>
                    ) : null}
                    <button
                      onClick={() => void props.onResolveDay()}
                      disabled={props.isResolvingDay}
                    >
                      UNLOAD DAY
                    </button>
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
                  {!isStandalone() &&
                  hasOnboardingMilestone("first_mission_engaged") ? (
                    canShowInstallPrompt ? (
                      <button
                        className="pwa-install-cta"
                        onClick={() =>
                          void triggerInstallPrompt().then(() =>
                            setCanShowInstallPrompt(hasInstallPrompt())
                          )
                        }
                      >
                        INSTALL GOLDLINE
                      </button>
                    ) : isIOS() ? (
                      <p className="pwa-install-hint">
                        Add Goldline to your Home Screen: tap Share, then "Add
                        to Home Screen".
                      </p>
                    ) : null
                  ) : null}
                  {props.activeDispatch && props.onOpenDispatch ? (
                    <button
                      className="live-dispatch-button"
                      onClick={() => void props.onOpenDispatch?.()}
                    >
                      LIVE MISSION #{props.activeDispatch.missionId}{" "}
                      <ChevronRight />
                    </button>
                  ) : null}
                  <label className="game-date-field">
                    WORKING DATE
                    <input
                      type="date"
                      value={props.selectedDate}
                      onChange={event =>
                        props.onSelectedDateChange(event.target.value)
                      }
                    />
                  </label>
                </>
              ) : null}
              {utilityPanel === "route" ? (
                <>
                  <small>AUTHORITATIVE ROUTE</small>
                  <h2>Pickup & delivery</h2>
                  <div className="live-route-list">
                    {[
                      ...(props.pickups ?? []).map(order => ({
                        order,
                        status: "collected" as const,
                      })),
                      ...(props.deliveries ?? []).map(order => ({
                        order,
                        status: "delivered" as const,
                      })),
                    ].map(({ order, status }) => (
                      <article key={`${status}-${order.id}`}>
                        <span>
                          <b>
                            {`${order.firstName ?? ""} ${order.lastName ?? ""}`.trim() ||
                              `Order #${order.id}`}
                          </b>
                          <small>{order.address}</small>
                        </span>
                        <button
                          disabled={
                            props.isResolvingOrder ||
                            (status === "delivered" && !order.paid)
                          }
                          onClick={() =>
                            void props.onResolveOrder(order.id, status)
                          }
                        >
                          {status === "collected"
                            ? "MARK COLLECTED"
                            : order.paid
                              ? "MARK DELIVERED"
                              : "PAYMENT BLOCKED"}
                        </button>
                      </article>
                    ))}
                    {!props.pickups?.length && !props.deliveries?.length ? (
                      <p>No real route work is loaded for this date.</p>
                    ) : null}
                  </div>
                </>
              ) : null}
              {utilityPanel === "objectives" ? (
                <>
                  <small>MISSION FORK</small>
                  <h2>Choose what you pursue</h2>
                  <div className="objective-panel-list">
                    {missions.map(mission => (
                      <button
                        key={mission.key}
                        onClick={() => {
                          selectMission(mission);
                          setUtilityPanel(null);
                        }}
                      >
                        <Target />
                        <span>
                          <b>{mission.name}</b>
                          <small>
                            {moneyBandLabel(mission)} ·{" "}
                            {mission.timeBurdenMinutes ?? "?"} min ·{" "}
                            {mission.travelBurdenMinutes ?? "?"} travel
                          </small>
                        </span>
                      </button>
                    ))}
                    {!missions.length ? (
                      <p>No missions — Scout needs wins</p>
                    ) : null}
                  </div>
                </>
              ) : null}
              {utilityPanel === "stronghold" ? (
                <div data-testid="stronghold-panel">
                  <small>SOLO OPERATOR HOME BASE</small>
                  <h2>Stronghold</h2>

                  <h3>Route table</h3>
                  <div
                    className="stronghold-route-table"
                    data-testid="stronghold-route-table"
                  >
                    {stronghold.routeTable.map(entry => (
                      <article key={entry.mission.key}>
                        <span>
                          <b>{entry.mission.name}</b>
                          <small>
                            {entry.grammar ? entry.grammar.kind : "NO REAL ACTION"}
                          </small>
                        </span>
                      </article>
                    ))}
                    {!stronghold.routeTable.length ? (
                      <p>No real business action is live right now.</p>
                    ) : null}
                  </div>

                  <h3>Agents</h3>
                  <div className="stronghold-agents" data-testid="stronghold-agents">
                    {stronghold.agents.map(agent => (
                      <span key={agent.agentId}>{agent.agentId}</span>
                    ))}
                    {!stronghold.agents.length ? (
                      <p>No agent capabilities have real evidence yet.</p>
                    ) : null}
                  </div>

                  <h3>Chronicle</h3>
                  <div
                    className="stronghold-chronicle"
                    data-testid="stronghold-chronicle"
                  >
                    {stronghold.chronicle.slice(0, 8).map(entry => (
                      <article key={entry.mission.key}>
                        <b>{entry.mission.name}</b>
                        <small>{entry.mutation.destinationTreatment}</small>
                      </article>
                    ))}
                    {!stronghold.chronicle.length ? (
                      <p>No resolved history yet.</p>
                    ) : null}
                  </div>
                </div>
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
