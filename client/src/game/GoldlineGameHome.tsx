import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Check,
  ChevronRight,
  ChevronUp,
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
import type {
  ArrivedOperatorStop,
  GoldlineHomeProps,
} from "../pages/goldline/GoldlineHome";
import { operatorStopEntityId } from "../../../shared/impactSignal";
import type { Order } from "@shared/types";
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
  corridorSectionTitle,
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
import { planPickupExpedition } from "./expedition/expeditionPlan";
import {
  externalProvenanceLabel,
  externalReconciliationLabel,
  type ExternalOperationalOrder,
} from "../../../shared/externalOperationalOrder";
import {
  prepareExpeditionObjective,
  reprojectLocalTargetRunObjective,
  type PreparedExpeditionObjective,
} from "./expedition/expeditionObjective";
import { ExpeditionHud } from "./expedition/ExpeditionHud";
import {
  projectStrongholdRestoration,
  restorationDelta,
  type CollectedEvidenceOrder,
  type StrongholdRestoration,
} from "./expedition/strongholdRestoration";
import { EXPEDITION, type ExpeditionSnapshot } from "./expedition/expeditionState";
import {
  markMechanicLearned,
  mechanicLearningState,
  nextUnlearnedMechanic,
  type ExpeditionMechanic,
} from "./expedition/expeditionTeaching";
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
import type {
  AuthoritativeVisitRouteProjection,
  AuthoritativeVisitRouteStop,
} from "../../../server/field/types";
import { projectTodayRoute } from "./world/todayRoute";
import { projectChronicle } from "./world/chronicleProjection";
import { presentAgents, projectStronghold } from "./world/strongholdProjection";
import { toStrongholdIntel } from "./world/intelligenceFlywheel";
import type { DriverSafeSalesIntel } from "../../../shared/driverSafeSalesIntel";
import {
  deriveAuthoritativeRouteGrammar,
  type ActionGrammar,
} from "../../../shared/actionGrammar";
import type { ExistingGameplayHost } from "../../../shared/goldlineCampaignRuntime";
import {
  campaignObjectiveMissionId,
  campaignObjectiveOrderId,
} from "../../../shared/goldlineCampaignRuntime";
import { selectFictionForMission } from "./fiction/fictionDirector";
import { reconcileFictionOnResume } from "./fiction/longHorizonResume";
import type { FictionMissionInstance } from "./fiction/fictionDirector";
import { SurveyPulse } from "./expedition/surveyPulse";
import { usePhysicalArrival } from "./session/usePhysicalArrival";
import { useDrivingLikelihood } from "./session/useDrivingLikelihood";

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
  /** Server-authorized, allowlisted Stronghold summary. Null is truthful. */
  driverSafeSalesIntel?: DriverSafeSalesIntel | null;
  /**
   * Stable id of the signed-in player, used ONLY to scope the local
   * positional checkpoint so a shared device cannot hand one driver another
   * driver's position. Null while signed out — that session gets its own
   * bucket rather than sharing one with a real account.
   */
  playerIdentity?: string | null;
  preferredFictionTemplateId?: string | null;
  /** Current chapter grammar when one exists — visit-route PLACE_ITEM is the fallback. */
  campaignChapterGrammar?: ActionGrammar | null;
  requestedGameplayHost?: ExistingGameplayHost | null;
  focusedCampaignObjectiveId?: string | null;
  onPersistFictionAssignment?: (record: {
    stableMissionKey: string;
    templateId: string;
    rulesVersion: number;
  }) => void;
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
   * AUTHORITATIVE collected-order evidence — order id and status only, read
   * from the existing admin.listByStatus queries for collected / processing
   * / ready / delivered.
   *
   * This is the ONLY thing that may declare a pickup secured. It is server
   * truth arriving through a normal query, not a local echo of a mutation
   * this client happened to fire: a pickup collected on another surface
   * shows up here identically, and the Stronghold payoff derived from it
   * survives a reload because it was never stored locally in the first
   * place. No new endpoint, no new table, no ledger.
   */
  collectedOrderEvidence?: readonly CollectedEvidenceOrder[];
  /**
   * Externally-managed operational work (CleanCloud and hand-entered jobs).
   * Real work this business physically does, for orders it does not own the
   * billing for — see shared/externalOperationalOrder.ts.
   */
  externalOrders?: readonly ExternalOperationalOrder[];
  /**
   * Records that the PHYSICAL work happened. Deliberately cannot report
   * anything about the owning external system, because this build has no API
   * access to it.
   */
  onCompleteExternalOrder?: (id: string) => Promise<boolean>;
  /** The operator states they updated the external system themselves. */
  onReconcileExternalOrder?: (id: string) => Promise<boolean>;
  authoritativeVisitRoute?: AuthoritativeVisitRouteProjection | null;
  authoritativeRouteCoverage?: number;
  isStartingVisitRoute?: boolean;
  onStartVisitRoute?: (missionIds: number[]) => Promise<void>;
  /** Opens the authoritative route/day plan from anywhere in the game shell. */
  onOpenTodayRoute?: () => void;
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
  /**
   * SURVEY settle (see `expedition/surveyPulse.ts`). The stick reports the
   * raw press so the pulse can watch for a thumb that stays near centre.
   * `deflection` is the normalised 0..1 magnitude the stick already
   * computes for movement — no new geometry, and no third touch zone.
   */
  onPressStart?: (deflection: number) => void;
  onPressUpdate?: (deflection: number) => void;
  onPressEnd?: () => void;
  /** 0..1 gathering ring; 0 hides it. */
  settleProgress?: number;
}) {
  const baseRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const onInputRef = useRef(props.onInput);
  onInputRef.current = props.onInput;
  // Same reasoning as onInputRef: the disabled-mid-touch effect must not
  // re-run because the parent passed a fresh inline callback.
  const onPressEndRef = useRef(props.onPressEnd);
  onPressEndRef.current = props.onPressEnd;

  /**
   * When `disabled` flips true mid-touch (e.g. Trailblazer just went down),
   * the browser does not fire pointerUp/pointerCancel on its own — the
   * finger is still physically down. Without this, pointerRef stays
   * populated, the knob stays visually displaced, and GoldlineGame's stored
   * input can remain nonzero. Redeploy re-enabling movement would then
   * immediately launch Trailblazer from stale input with no new touch.
   */
  useEffect(() => {
    if (!props.disabled) return;
    const pointerId = pointerRef.current;
    if (pointerId != null && baseRef.current?.hasPointerCapture(pointerId)) {
      baseRef.current.releasePointerCapture(pointerId);
    }
    pointerRef.current = null;
    setKnob({ x: 0, y: 0 });
    onInputRef.current(0, 0);
    onPressEndRef.current?.();
    // Deliberately depends only on props.disabled — the caller passes an
    // inline onInput callback, and depending on it directly would retrigger
    // this effect (and re-zero real input) on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.disabled]);

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
    props.onPressUpdate?.(Math.min(1, length));
    if (length > 0.15) props.onFirstMove?.();
  }

  function release(event?: ReactPointerEvent<HTMLDivElement>) {
    if (event && pointerRef.current === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerRef.current = null;
    setKnob({ x: 0, y: 0 });
    props.onInput(0, 0);
    props.onPressEnd?.();
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
        props.onPressStart?.(0);
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
      {props.settleProgress ? (
        <b
          className="joystick-settle"
          aria-hidden="true"
          style={{ opacity: props.settleProgress }}
        />
      ) : null}
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
  /**
   * SURVEY settle + cooldown. Lives here rather than inside `Joystick`
   * because the cooldown must outlive any single touch.
   */
  const surveyPulseRef = useRef(new SurveyPulse());
  const [settleProgress, setSettleProgress] = useState(0);
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
  useEffect(() => {
    if (props.requestedGameplayHost === "local_target_run") {
      setUtilityPanel("open-channel");
    }
  }, [props.requestedGameplayHost]);
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
  const driving = useDrivingLikelihood();
  const drivingLikely = driving.snapshot.likely;
  const sessionIdRef = useRef(getGoldlineSessionId());
  const sessionStartRef = useRef(performance.now());
  const emit = props.onEmitEvent;
  /**
   * A thumb resting perfectly still fires no pointermove, so the settle
   * would never complete on gesture events alone — and the cooldown has to
   * drain whether or not the stick is touched. One rAF loop owns both, and
   * only runs while there is something to advance.
   */
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const pulse = surveyPulseRef.current;
      pulse.step(Math.min(0.25, (now - last) / 1000));
      last = now;
      if (pulse.getPhase() === "settling") {
        const game = runtimeRef.current;
        if (game?.getExpeditionSnapshot()?.outcome !== "running") {
          pulse.cancel();
          setSettleProgress(0);
        } else {
          if (pulse.pointerUpdate(now, 0)) game.expeditionSurvey();
          setSettleProgress(pulse.getSettleProgress(now));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const [movementLearned, setMovementLearned] = useState(() =>
    hasOnboardingMilestone("movement")
  );
  const [showFirstEntryExplainer, setShowFirstEntryExplainer] = useState(
    () => !hasOnboardingMilestone("first_entry_explained")
  );
  const dismissFirstEntryExplainer = useRef(() => {
    markOnboardingMilestone("first_entry_explained");
    setShowFirstEntryExplainer(false);
  }).current;
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
  const [orderSpatialState, setOrderSpatialState] = useState<
    "hidden" | "visible" | "engage"
  >("hidden");
  const [objectiveOffscreen, setObjectiveOffscreen] = useState<
    "ahead" | null
  >(null);
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
  // Set only while a NEUTRALIZE route-stop's VISIT surface is open (see
  // handleSelectRouteStop) — distinguishes that flow from the spotlighted
  // single-mission encounter flow so completion/close can return the player
  // to the same fiction mission instead of the encounter's own outcome view.
  const [selectedRouteStop, setSelectedRouteStop] =
    useState<AuthoritativeVisitRouteStop | null>(null);
  // Set only while a genuine pickup/delivery's action surface is open (see
  // handleSelectOrder) — same purpose as selectedRouteStop above: keeps
  // completion/close from routing through the spotlighted single-mission
  // encounter's own outcome view.
  const [selectedOrder, setSelectedOrder] = useState<{
    order: Order;
    status: "collected" | "delivered";
  } | null>(null);
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
  const focusedMission = useMemo(() => {
    const focus = props.focusedCampaignObjectiveId;
    if (!focus) return null;
    const missionId = campaignObjectiveMissionId(focus);
    return (
      (missionId != null
        ? allMissions.find(mission => mission.missionId === missionId)
        : null) ??
      allMissions.find(
        mission =>
          mission.key === focus ||
          mission.key === `mission:${focus}` ||
          String(mission.missionId) === focus
      ) ??
      null
    );
  }, [allMissions, props.focusedCampaignObjectiveId]);
  const activeMission =
    allMissions.find(mission => mission.key === activeKey) ??
    focusedMission ??
    prioritized ??
    null;
  useEffect(() => {
    if (focusedMission) setActiveKey(focusedMission.key);
    if (
      props.focusedCampaignObjectiveId &&
      props.requestedGameplayHost !== "local_target_run"
    ) {
      setUtilityPanel("objectives");
    }
  }, [
    focusedMission,
    props.focusedCampaignObjectiveId,
    props.requestedGameplayHost,
  ]);
  const outcomeMission = encounterRuntime
    ? (authoritativeMissionTruth.find(
        mission => mission.missionId === encounterRuntime.missionId
      ) ?? null)
    : null;
  // Same real order list the route panel renders, pickups before deliveries.
  // The world only ever embodies the first order that genuinely has a real
  // address on file — an address-less order fails closed and is skipped
  // rather than fabricating a destination for it.
  const orderObjectives = useMemo(
    () => [
      ...(props.pickups ?? []).map(order => ({
        order,
        status: "collected" as const,
      })),
      ...(props.deliveries ?? []).map(order => ({
        order,
        status: "delivered" as const,
      })),
    ],
    [props.pickups, props.deliveries]
  );
  const nextOrderObjective = useMemo(() => {
    const addressed = orderObjectives.filter(item => item.order.address?.trim());
    const focusId = props.focusedCampaignObjectiveId
      ? campaignObjectiveOrderId(props.focusedCampaignObjectiveId)
      : null;
    if (focusId != null) {
      const focused = addressed.find(item => item.order.id === focusId);
      if (focused) return focused;
    }
    return addressed[0] ?? null;
  }, [orderObjectives, props.focusedCampaignObjectiveId]);
  // The expedition shell is driven by a truthful operational objective, not
  // by the presence of a Laundry Butler-native pickup alone. Native pickup
  // keeps priority; otherwise the first pending, human-approved Open Channel
  // task becomes playable. Fiction never invents work here.
  const preparedObjective = useMemo(
    () =>
      prepareExpeditionObjective({
        pickup:
          nextOrderObjective && nextOrderObjective.status !== "delivered"
            ? nextOrderObjective.order
            : null,
        openChannelMission: props.openChannelMission ?? null,
        externalOrders: props.externalOrders,
      }),
    [nextOrderObjective, props.openChannelMission, props.externalOrders]
  );
  // Keep the typed action surface mounted across its own authoritative
  // refetch. A winning/closed write legitimately removes the mission from
  // the playable list before the adapter resumes; binding the surface only to
  // `activeMission` would unmount it and suppress REAL_ACTION_PERSISTED.
  // A NEUTRALIZE route-stop mission comes from `activateCommercialMissionForField`
  // (a `nearby_commercial_visit` field move), not the AI mission-builder flow
  // `authoritativeMissionTruth` projects from — it can legitimately be absent
  // there. Build a minimal, truthful stand-in directly from the stop's own
  // real fields (never fabricated) so the surface never silently falls back
  // to an unrelated `activeMission`.
  const routeStopFallbackMission = useMemo<PlayableMission | null>(() => {
    if (!selectedRouteStop) return null;
    if (
      !presentedAction ||
      presentedAction.missionId !== selectedRouteStop.missionId
    )
      return null;
    return {
      key: `route-stop:${selectedRouteStop.missionId}`,
      missionId: selectedRouteStop.missionId,
      moveId: selectedRouteStop.moveId,
      name: selectedRouteStop.accountName,
      address: selectedRouteStop.address,
      navigationUrl: selectedRouteStop.navigationUrl,
      phoneUrl: null,
      destinationPath: selectedRouteStop.destinationPath,
      state: "active",
      timeBurdenMinutes: null,
      travelBurdenMinutes: null,
      estimatedValueLowCents: null,
      estimatedValueHighCents: null,
      confidence: "unknown",
      expiresAt: null,
      contestedUntil: null,
      verifiedAnnualValueCents: null,
      realizedRevenueCents: 0,
      unlockedPath: null,
      lossReason: null,
    };
  }, [presentedAction, selectedRouteStop]);
  // A genuine pickup/delivery has no commercial-mission concept at all — its
  // PICKUP/DELIVERY descriptor (see handleSelectOrder) uses `-order.id` as
  // `missionId` purely as a private, collision-free join key back to this
  // stand-in (real commercial mission ids are always positive; another real
  // order can never produce the same negative key), never a fabricated
  // mission identity.
  const orderFallbackMission = useMemo<PlayableMission | null>(() => {
    if (!selectedOrder) return null;
    if (
      !presentedAction ||
      presentedAction.missionId !== -selectedOrder.order.id
    )
      return null;
    const { order } = selectedOrder;
    const address = order.address?.trim() || null;
    return {
      key: `order:${order.id}`,
      missionId: -order.id,
      moveId: `order:${order.id}`,
      name:
        `${order.firstName ?? ""} ${order.lastName ?? ""}`.trim() ||
        `Order #${order.id}`,
      address,
      navigationUrl: address
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
        : null,
      phoneUrl: null,
      destinationPath: null,
      state: "active",
      timeBurdenMinutes: null,
      travelBurdenMinutes: null,
      estimatedValueLowCents: null,
      estimatedValueHighCents: null,
      confidence: "unknown",
      expiresAt: null,
      contestedUntil: null,
      verifiedAnnualValueCents: null,
      realizedRevenueCents: 0,
      unlockedPath: null,
      lossReason: null,
    };
  }, [presentedAction, selectedOrder]);
  const presentedActionMission = presentedAction
    ? (authoritativeMissionTruth.find(
        mission => mission.missionId === presentedAction.missionId
      ) ??
      routeStopFallbackMission ??
      orderFallbackMission ??
      activeMission)
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
    [
      liveRouteMissions,
      props.progression,
      props.scoutCapability,
      props.scoutReport,
    ]
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
        intel: props.driverSafeSalesIntel
          ? toStrongholdIntel(props.driverSafeSalesIntel)
          : null,
        chronicle,
      }),
    [todayRoute, props.progression, props.driverSafeSalesIntel, chronicle]
  );
  // Production fiction binds to the current chapter's action grammar when
  // the compiler named one. Frozen visit-route membership remains the
  // fallback for courier/route chapters that have no chapter grammar.
  const routeGrammar = useMemo(
    () =>
      deriveAuthoritativeRouteGrammar(props.authoritativeVisitRoute ?? null),
    [props.authoritativeVisitRoute]
  );
  const suggestedVisitMissionIds = useMemo(
    () =>
      (props.moves?.recommendedMoves ?? [])
        .filter(move => move.moveType === "nearby_commercial_visit")
        .map(move => move.missionId)
        .filter((missionId): missionId is number => missionId !== null),
    [props.moves?.recommendedMoves]
  );
  const fictionMission = useMemo<FictionMissionInstance | null>(() => {
    const grammar = props.campaignChapterGrammar ?? routeGrammar;
    if (!grammar) return null;
    return selectFictionForMission(grammar, {
      now: new Date(),
      identity: props.playerIdentity ?? null,
      preferredTemplateId: props.preferredFictionTemplateId ?? null,
      persistAssignment: props.onPersistFictionAssignment,
    });
  }, [
    props.campaignChapterGrammar,
    routeGrammar,
    props.playerIdentity,
    props.preferredFictionTemplateId,
    props.onPersistFictionAssignment,
  ]);
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
  const seenPressureRefs = useRef(new Set<string>());
  useEffect(() => {
    for (const item of props.today?.timeline ?? []) {
      if (item.kind !== "field_commitment" && item.kind !== "reported_opportunity") continue;
      const ref = item.source.sourceReference;
      if (seenPressureRefs.current.has(ref)) continue;
      seenPressureRefs.current.add(ref);
      emit?.({
        eventName: "future_pressure_presented",
        sessionId: sessionIdRef.current,
        missionId: null,
        properties: { sessionId: sessionIdRef.current, kind: item.kind, hasPhysicalEntity: Boolean(item.physicalEntityId) },
      });
    }
  }, [props.today?.timeline, emit]);

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
      onInteract: () => {
        if (handleOrderInteractRef.current()) return;
        handleInteractRef.current();
      },
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
      onOrderProximity: (orderKey, _kind, state) => {
        setOrderSpatialState(state);
        if (state === "engage") {
          getAudioManager().playOnce("mission_proximity", orderKey);
        }
      },
      onObjectiveOffscreen: setObjectiveOffscreen,
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
    if (import.meta.env.VITE_GOLDLINE_TEST_HARNESS === "1") {
      (window as unknown as { __goldlineGame?: GoldlineGame }).__goldlineGame =
        game;
    }

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
          // The section title moment: crossing into the next corridor is an
          // EVENT, not a silent asset swap. Reuses the existing transient
          // chip and audio cue rather than inventing new presentation.
          const title = corridorSectionTitle(corridorId);
          if (title) showWorldOutcomeCue(title);
          getAudioManager().playOnce("corridor_transition", corridorId);
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
          // A transition requested BEFORE the player entered the expedition
          // can still resolve mid-combat. Cancelling at entry handles most
          // of it; this refuses the reveal outright as the last line of
          // defence, and disposes the prepared assets so nothing leaks.
          if (game.isExpeditionActive()) {
            const stale = prepared.get(pack.id);
            if (stale) {
              game.discardPreparedCorridor(stale);
              prepared.delete(pack.id);
            }
            throw new DOMException("Aborted", "AbortError");
          }
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

  // Tells the runtime which of the two route-end presentations to draw at
  // the exit band: a waypost when a playable next corridor exists, the
  // authored "world ends here" monument when this is the last one.
  useEffect(() => {
    runtimeRef.current?.setHasNextCorridor(nextCorridorId !== null);
  }, [activeCorridorId, nextCorridorId, runtimeReady]);

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

  // A genuine pickup/delivery becomes a real playable-world objective — the
  // player must move Trailblazer to its authored interaction zone before the
  // primary in-world PICKUP/DELIVERY mechanic becomes available (see
  // handleInteractRef below and OrderSurface's withinInteractionZone gate).
  // Only the current "next objective" is ever embodied — completing or
  // resolving it naturally advances this effect to the next genuine order.
  useEffect(() => {
    runtimeRef.current?.setOrderEmbodiment(
      nextOrderObjective
        ? {
            orderId: nextOrderObjective.order.id,
            orderKey: `order:${nextOrderObjective.order.id}`,
            kind:
              nextOrderObjective.status === "delivered"
                ? "delivery"
                : "pickup",
            label:
              `${nextOrderObjective.order.firstName ?? ""} ${nextOrderObjective.order.lastName ?? ""}`.trim() ||
              `Order #${nextOrderObjective.order.id}`,
            blocked:
              nextOrderObjective.status === "delivered" &&
              !nextOrderObjective.order.paid,
          }
        : null
    );
  }, [nextOrderObjective?.order.id, nextOrderObjective?.status]);

  /**
   * A truthful operational objective PREPARES an expedition. It does not
   * start one. The player crosses the threshold explicitly; whether the
   * climax resolves a native pickup or an approved Open Channel task is
   * decided only by that objective's canonical adapter.
   */

  const [expeditionSnapshot, setExpeditionSnapshot] =
    useState<ExpeditionSnapshot>({
      hp: EXPEDITION.maxHp,
      momentum: 0,
      outcome: "running",
      route: "unchosen",
      relic: null,
    });

  /**
   * §PR77 Part 4 contextual teaching. Bumped whenever a mechanic is marked
   * learned so the HUD hint recomputes immediately rather than waiting for
   * an unrelated re-render — `expeditionTeaching`'s localStorage reads are
   * not themselves reactive.
   */
  const [teachingVersion, setTeachingVersion] = useState(0);
  const markTaught = useCallback((mechanic: ExpeditionMechanic) => {
    markMechanicLearned(mechanic, playerIdentityRef.current);
    setTeachingVersion(v => v + 1);
  }, []);

  /**
   * PINNED expedition identity AND the single lifecycle truth.
   * `activeExpedition !== null` is the whole active-run state — there is
   * deliberately no separate "entered" boolean alongside it. Keeping two
   * truths for one lifecycle produced a no-op guard
   * (`if (!expeditionEntered) setExpeditionEntered(false)`) that was itself
   * a sign the split didn't mean anything.
   *
   * Derived once, on ENTER, from whatever the prepared pickup was AT THAT
   * MOMENT — never re-derived from the live order list afterward. This
   * exists because the canonical pickup handler optimistically removes a
   * completed order from the pickup query cache as soon as the mutation
   * succeeds. Without pinning, pressing SECURE CARGO would make
   * nextOrderObjective advance to the NEXT pickup the instant the write
   * landed, tearing the whole expedition down through the effect below at
   * exactly the moment the authoritative payoff needs to render on top of
   * it. A later query update may legitimately advance nextOrderObjective;
   * it must never silently swap the run already being played.
   */
  type ActiveExpedition = PreparedExpeditionObjective & {
    /**
     * Pickup-only Stronghold BEFORE reading. Open Channel work deliberately
     * carries no restoration snapshot because completing effort is not an
     * economic/fulfillment pickup win.
     */
    restorationBefore: StrongholdRestoration | null;
  };
  const [activeExpedition, setActiveExpedition] =
    useState<ActiveExpedition | null>(null);

  const physicalArrivalTarget = useMemo(() => {
    if (activeExpedition?.kind !== "local_target_run") return null;
    const target = activeExpedition.currentTarget;
    if (activeExpedition.simulated || target.lat == null || target.lng == null) return null;
    return { id: target.id, lat: target.lat, lng: target.lng };
  }, [
    activeExpedition?.kind,
    activeExpedition?.kind === "local_target_run"
      ? activeExpedition.currentTarget.id
      : null,
    activeExpedition?.kind === "local_target_run"
      ? activeExpedition.currentTarget.lat
      : null,
    activeExpedition?.kind === "local_target_run"
      ? activeExpedition.currentTarget.lng
      : null,
    activeExpedition?.kind === "local_target_run"
      ? activeExpedition.simulated
      : null,
  ]);
  const physicalArrival = usePhysicalArrival({
    enabled: activeExpedition?.kind === "local_target_run" && physicalArrivalTarget !== null,
    target: physicalArrivalTarget,
  });
  const localTargetRealArrivalConfirmed =
    activeExpedition?.kind === "local_target_run" &&
    !activeExpedition.simulated &&
    physicalArrival.snapshot?.phase === "arrived";

  /**
   * WHERE THE OPERATOR IS — reported upward only once it is actually true.
   *
   * ARRIVED is the one moment this app already commits to a physical location:
   * it pins the customer and the address on screen and offers to record the
   * work as done. Anything earlier is an assignment, not a position, and
   * attaching a building to an observation on the strength of an assignment
   * would put a wrong place in the permanent record.
   *
   * Open Channel work reports nothing on purpose. Its objective label is a task
   * title ("drop the door hangers"), not a place, and deriving a building from
   * a sentence about work is exactly the invention this must not do.
   */
  const reportStop = props.onOperatorStopChange;
  /**
   * The arrival identifies an ORDER, so that is what it claims. Not an account,
   * not a building — see [[OperatorStopIdentity]] for why nothing here can
   * honestly reach a canonical place id.
   *
   * Open Channel work reports nothing: its label is a task title ("drop the
   * door hangers"), which names an activity rather than anything identifiable.
   */
  const arrivedStop: ArrivedOperatorStop | null =
    activeExpedition != null && expeditionSnapshot.outcome === "arrived"
      ? activeExpedition.kind === "native_pickup"
        ? {
            entityType: "native_order",
            entityId: operatorStopEntityId(
              "native_order",
              activeExpedition.orderId
            ),
            entityLabel: activeExpedition.label,
          }
        : activeExpedition.kind === "external_order"
          ? {
              entityType: "external_order",
              // The objective's `externalOrderId` is our own row id, not
              // CleanCloud's order number — #74 kept their identifiers out of
              // this seam deliberately, and that is what makes it stable here.
              entityId: operatorStopEntityId(
                "external_order",
                activeExpedition.externalOrderId
              ),
              entityLabel: activeExpedition.label,
            }
          : activeExpedition.kind === "local_target_run" &&
              localTargetRealArrivalConfirmed
            ? {
                entityType: "sourced_target",
                // The current target's own stable, provider-backed (or
                // clearly-labeled-simulated) id — never a free-text join,
                // and never the mission/task id (those identify the RUN,
                // not the business standing at this doorstep).
                entityId: operatorStopEntityId(
                  "sourced_target",
                  activeExpedition.currentTarget.id
                ),
                entityLabel: activeExpedition.currentTarget.name,
                localTargetRunContext: {
                  missionId: activeExpedition.missionId,
                  taskId: activeExpedition.taskId,
                },
              }
            : null
      : null;

  /**
   * Reported on a genuine change of stop, not on every render that rebuilds an
   * identical object. The identity itself travels through a ref rather than
   * being encoded into the key and parsed back out — a customer name is free
   * text and any delimiter chosen for that round trip is one a real label can
   * contain.
   */
  const arrivedStopRef = useRef<ArrivedOperatorStop | null>(null);
  arrivedStopRef.current = arrivedStop;
  const arrivedStopKey = arrivedStop
    ? JSON.stringify([arrivedStop.entityId, arrivedStop.entityLabel])
    : null;
  useEffect(() => {
    reportStop?.(arrivedStopRef.current);
  }, [reportStop, arrivedStopKey]);

  /**
   * AUTHORITATIVE collected truth, as one evidence collection. Order id and
   * status, nothing else — this is the only input the Stronghold payoff has.
   */
  const collectedOrderEvidence = useMemo<readonly CollectedEvidenceOrder[]>(
    () => props.collectedOrderEvidence ?? [],
    [props.collectedOrderEvidence]
  );

  /** The Stronghold as authoritative evidence says it stands RIGHT NOW. */
  const restorationNow = useMemo(
    () =>
      projectStrongholdRestoration({
        orders: collectedOrderEvidence,
        expeditionOrderId:
          activeExpedition?.kind === "native_pickup"
            ? activeExpedition.orderId
            : null,
      }),
    [collectedOrderEvidence, activeExpedition]
  );

  const enterExpedition = useCallback(() => {
    if (!preparedObjective || drivingLikely) return;
    // A plain Open Channel desk task has no real physical arrival — the
    // expedition shell is reserved for objectives that do (native_pickup,
    // external_order, local_target_run). It completes in the base via
    // completeBaseOpenChannelObjective below and must never stage combat.
    if (preparedObjective.kind === "open_channel") return;
    setExpeditionSnapshot({
      hp: EXPEDITION.maxHp,
      momentum: 0,
      outcome: "running",
      route: "unchosen",
      relic: null,
    });
    setActiveExpedition({
      ...preparedObjective,
      restorationBefore:
        preparedObjective.kind === "native_pickup"
          ? projectStrongholdRestoration({
              orders: collectedOrderEvidence,
              expeditionOrderId: preparedObjective.orderId,
            })
          : null,
    });
  }, [preparedObjective, collectedOrderEvidence, drivingLikely]);

  const exitExpedition = useCallback(() => {
    setActiveExpedition(null);
    setCargoPhase("idle");
  }, []);

  useEffect(() => {
    if (!drivingLikely) return;
    runtimeRef.current?.setInput(0, 0);
    if (activeExpedition) exitExpedition();
    setColdCallOpen(false);
    setScoutOpen(false);
  }, [drivingLikely, activeExpedition, exitExpedition]);

  /**
   * A plain Open Channel desk task ("design door hangers") is real work with
   * no physical arrival — it is sealed right here in the base, through the
   * exact same canonical write the expedition's SEAL THE WORK used to call,
   * just without staging a cargo-box expedition around it. `open_channel`
   * kind objectives whose payload is actually a LOCAL_TARGET_RUN never reach
   * here (prepareExpeditionObjective returns "local_target_run" for those).
   */
  const [baseOpenChannelPhase, setBaseOpenChannelPhase] =
    useState<"idle" | "sealing">("idle");
  const completeBaseOpenChannelObjective = useCallback(async () => {
    if (!preparedObjective || preparedObjective.kind !== "open_channel") return;
    if (baseOpenChannelPhase === "sealing") return;
    setBaseOpenChannelPhase("sealing");
    try {
      const ok = await props.onCompleteOpenChannelTask(
        preparedObjective.missionId,
        preparedObjective.taskId
      );
      if (ok) {
        getAudioManager().play("captured_truth");
        showWorldOutcomeCue("WORK SEALED");
      }
    } finally {
      setBaseOpenChannelPhase("idle");
    }
  }, [preparedObjective, baseOpenChannelPhase, props.onCompleteOpenChannelTask]);

  /**
   * §PR77 Part 20/gate J. Every other objective kind is deliberately pinned
   * at ENTER (see the ActiveExpedition doc comment above) — but a
   * LOCAL_TARGET_RUN's progress is written by a Field Intel capture that
   * happens WHILE the run is already active (markLocalTargetRunTargetVisited,
   * server-side), and the operator is standing right there when it lands.
   * Making them exit and re-enter just to see "TARGET 2 OF 3" would be
   * exactly the kind of dead, confusing UI Adam's own playtest is about.
   * This re-derives ONLY the target-run view fields from the live mission —
   * never the pin itself, never any other objective kind.
   */
  useEffect(() => {
    if (activeExpedition?.kind !== "local_target_run") return;
    const mission = props.openChannelMission ?? null;
    if (!mission || mission.id !== activeExpedition.missionId) return;
    const task = mission.tasks.find(row => row.id === activeExpedition.taskId);
    if (!task) return;
    // Every sourced target visited: reprojectLocalTargetRunObjective returns
    // null here (there is no "current" target left to point at), but the
    // progress figure itself must still catch up to reality rather than
    // freezing one visit short of the truth. Keep the last known target for
    // display — objectiveConfirmed/cargoSecured takes over the headline.
    if (task.status === "completed" && activeExpedition.visitedCount < activeExpedition.totalCount) {
      setActiveExpedition(current =>
        current && current.kind === "local_target_run"
          ? { ...current, visitedCount: current.totalCount }
          : current
      );
      return;
    }
    const refreshed = reprojectLocalTargetRunObjective(
      activeExpedition.missionId,
      activeExpedition.taskId,
      mission
    );
    if (!refreshed) return;
    if (
      refreshed.currentTarget.id === activeExpedition.currentTarget.id &&
      refreshed.visitedCount === activeExpedition.visitedCount
    ) {
      return;
    }
    setActiveExpedition(current =>
      current && current.kind === "local_target_run"
        ? { ...current, ...refreshed }
        : current
    );
  }, [activeExpedition, props.openChannelMission]);

  /**
   * SECURE CARGO's local phase. Deliberately NOT a completion state:
   *
   *   idle      — the player has not pressed it
   *   verifying — the canonical mutation succeeded; server truth is awaited
   *   failed    — the mutation itself failed; the pickup is still pending
   *
   * There is no "secured" member. Nothing here can declare the cargo
   * secured, because the mutation succeeding is not the same fact as the
   * order being collected. Only authoritative evidence settles that, which
   * is what lets a pickup collected on another surface reconcile
   * identically.
   */
  type CargoPhase = "idle" | "verifying" | "failed";
  const [cargoPhase, setCargoPhase] = useState<CargoPhase>("idle");

  /**
   * REALITY WINS. The single predicate for "this pickup is genuinely
   * collected", read from server truth rather than from whether this client
   * pressed the button.
   */
  const pinnedOrderCollected =
    activeExpedition?.kind === "native_pickup" &&
    restorationNow.expeditionOrderCollected;
  const pinnedOpenChannelTaskCompleted =
    activeExpedition?.kind === "open_channel" &&
    props.openChannelMission?.id === activeExpedition.missionId &&
    props.openChannelMission.tasks.some(
      task =>
        task.id === activeExpedition.taskId && task.status === "completed"
    );
  /**
   * External work is confirmed by the SAME rule as everything else: refreshed
   * authoritative state, not the mutation returning. The evidence here is our
   * own external record reporting the physical work complete — which is a
   * genuine fact this app owns. It says nothing about CleanCloud, which is
   * why the reconciliation badge is a separate signal entirely.
   */
  const pinnedExternalOrderCompleted =
    activeExpedition?.kind === "external_order" &&
    (props.externalOrders ?? []).some(
      order =>
        order.id === activeExpedition.externalOrderId &&
        order.operationalStatus === "completed"
    );
  /**
   * §PR77 Part 20. markLocalTargetRunTargetVisited marks the parent task
   * "completed" the same way completeOpenChannelTask does, once every sourced
   * target has a recorded visit — read the same way pinnedOpenChannelTaskCompleted
   * does, so a finished referral run gets the same real completion payoff as
   * every other objective kind instead of silently going stale.
   */
  const pinnedLocalTargetRunCompleted =
    activeExpedition?.kind === "local_target_run" &&
    props.openChannelMission?.id === activeExpedition.missionId &&
    props.openChannelMission.tasks.some(
      task =>
        task.id === activeExpedition.taskId && task.status === "completed"
    );
  const objectiveConfirmed = Boolean(
    activeExpedition?.kind === "native_pickup"
      ? pinnedOrderCollected
      : activeExpedition?.kind === "open_channel"
        ? pinnedOpenChannelTaskCompleted
        : activeExpedition?.kind === "external_order"
          ? pinnedExternalOrderCompleted
          : activeExpedition?.kind === "local_target_run"
            ? pinnedLocalTargetRunCompleted
            : false
  );

  /**
   * True while any completed external job still owes its owning system an
   * update. This is real outstanding work, and the rest of the app has to
   * treat it as such rather than as an idle day.
   */
  const externalReconciliationOutstanding = (props.externalOrders ?? []).some(
    order =>
      order.operationalStatus === "completed" &&
      order.reconciliationStatus === "update_required"
  );

  /**
   * What the operator still owes the owning system, once the physical work is
   * done. Null for native work — there is no other system to update.
   */
  const externalReconciliation =
    activeExpedition?.kind === "external_order"
      ? ((props.externalOrders ?? []).find(
          order => order.id === activeExpedition.externalOrderId
        ) ?? null)
      : null;

  /** The honest pickup before/after, both derived from real evidence. */
  const payoffDelta = useMemo(
    () =>
      activeExpedition?.kind === "native_pickup" &&
      activeExpedition.restorationBefore
        ? restorationDelta(activeExpedition.restorationBefore, restorationNow)
        : null,
    [activeExpedition, restorationNow]
  );

  /**
   * §33 Redeploy and §34 Press On. Both are expedition-level only — the run
   * continues or compromises, and the real pickup is untouched either way.
   * The snapshot is refreshed immediately rather than waiting for the next
   * poll tick so the terminal HUD clears on the same interaction.
   */
  const redeployExpedition = useCallback(() => {
    if (!runtimeRef.current?.expeditionRedeploy()) return;
    const snapshot = runtimeRef.current.getExpeditionSnapshot();
    if (snapshot) setExpeditionSnapshot(snapshot);
  }, []);

  const pressOnExpedition = useCallback(() => {
    if (!runtimeRef.current?.expeditionPressOn()) return;
    const snapshot = runtimeRef.current.getExpeditionSnapshot();
    if (snapshot) setExpeditionSnapshot(snapshot);
  }, []);

  const completeExpeditionObjective = useCallback(async () => {
    if (!activeExpedition) return;
    // A LOCAL_TARGET_RUN has no single "collect" action to confirm — its
    // parent task covers every sourced target, and completing IT here would
    // silently claim every remaining target visited from one tap. Real
    // progress is written exactly one place: markLocalTargetRunTargetVisited,
    // triggered only by a confirmed Field Intel capture at the current
    // target (see LogSignalSheet's onConfirm in GoldlineDriverController).
    // The UI never offers this control for that kind (see ExpeditionHud's
    // completionMode below); this guard is defense in depth.
    if (activeExpedition.kind === "local_target_run") return;
    if (cargoPhase === "verifying") return;
    setCargoPhase("verifying");
    try {
      // ONE ADAPTER PER PROVENANCE. Each objective kind resolves through the
      // canonical write of the system that actually owns it — and can reach no
      // other. An external job cannot touch a native order, and a native
      // pickup cannot touch external state.
      const ok =
        activeExpedition.kind === "native_pickup"
          ? await props.actionServices.resolveOrder({
              orderId: activeExpedition.orderId,
              status: "collected",
            })
          : activeExpedition.kind === "external_order"
            ? await (props.onCompleteExternalOrder?.(
                activeExpedition.externalOrderId
              ) ?? Promise.resolve(false))
            : await props.onCompleteOpenChannelTask(
                activeExpedition.missionId,
                activeExpedition.taskId
              );
      // The adapter returning only means its canonical write was accepted.
      // The HUD remains VERIFYING until the corresponding authoritative query
      // reports the pinned objective resolved.
      if (!ok) setCargoPhase("failed");
    } catch {
      setCargoPhase("failed");
    }
  }, [
    activeExpedition,
    cargoPhase,
    props.actionServices,
    props.onCompleteOpenChannelTask,
    props.onCompleteExternalOrder,
  ]);

  /**
   * The payoff fires from AUTHORITATIVE EVIDENCE, not from the mutation.
   *
   * Note what is absent from the condition: any check that this client
   * pressed SECURE CARGO. If a dispatcher collected the same order on the
   * admin surface while this expedition was being played, the evidence
   * arrives through the same query and reconciles here identically. That is
   * the difference between reporting server truth and echoing our own write.
   */
  const payoffFiredForObjectiveRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeExpedition || !objectiveConfirmed) return;
    if (payoffFiredForObjectiveRef.current === activeExpedition.key) return;
    payoffFiredForObjectiveRef.current = activeExpedition.key;

    // Server-verified feedback. For Open Channel this means the persisted
    // task is completed; it does NOT imply a customer, revenue, or pickup.
    getAudioManager().play("captured_truth");
    arcadeFeedback();
    runtimeRef.current?.finishExpeditionAtStronghold();
  }, [activeExpedition, objectiveConfirmed]);

  useEffect(() => {
    if (activeExpedition == null) payoffFiredForObjectiveRef.current = null;
  }, [activeExpedition]);

  /**
   * The persistent physical payoff, pushed to the world whenever real
   * evidence changes. Not gated on an expedition being active: the lit
   * threshold is what the Stronghold IS, so it must be correct the moment
   * the app loads and every time afterward. That is what makes a reload
   * reproduce it — the state is a projection of order truth, not something
   * this component accumulated.
   */
  useEffect(() => {
    runtimeRef.current?.setStrongholdRestoration(restorationNow);
  }, [restorationNow, runtimeReady]);

  /**
   * ONE confirmation pulse, and only for a delta that genuinely happened.
   * Keyed on the pinned BEFORE reading, so a Stronghold that was already
   * fully restored produces no fabricated missing segment to light up.
   */
  const pulsedForOrderRef = useRef<number | null>(null);
  useEffect(() => {
    if (activeExpedition?.kind !== "native_pickup" || !payoffDelta) return;
    if (!payoffDelta.changed) return;
    if (pulsedForOrderRef.current === activeExpedition.orderId) return;
    pulsedForOrderRef.current = activeExpedition.orderId;
    runtimeRef.current?.pulseStrongholdRestoration(payoffDelta);
  }, [activeExpedition, payoffDelta]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (activeExpedition == null) {
      runtime.endExpedition();
      return;
    }

    // Take ownership of the world: any corridor load already in flight must
    // not resolve and swap the corridor out from under active combat.
    transitionsRef.current?.cancelInflight();

    runtime.startExpedition(
      // The authored plan is fiction-only. A deterministic objective seed
      // varies dressing without treating an Open Channel task as an order.
      planPickupExpedition({ orderId: activeExpedition.planSeed }),
      {
        onPlayerDamaged: () => {
          getAudioManager().play("player_hurt");
          missFeedback();
        },
        onGuardAbsorbed: () => getAudioManager().play("vault"),
        onHostileDefeated: () => {
          getAudioManager().play("hostile_down");
          arcadeFeedback();
        },
        // §PR77 Part 4 "first strike lands" — the deliberate tap verb,
        // distinct from onHostileDefeated (which also fires from the
        // ambient lash and the Line) and from onStrikeAttempt (which fires
        // on a whiff too and only drives pad feedback, never teaching).
        onStrikeLanded: () => {
          getAudioManager().play("strike_hit");
          markTaught("strike");
        },
        // §PR77 Part 4 "first evade" — a flick that genuinely began.
        onDodgeBegan: () => markTaught("evade"),
        onLineLatched: () => {
          getAudioManager().play("vault");
          arcadeFeedback();
          // §PR77 Part 4 "first Line lock+fire".
          markTaught("line");
        },
        onHazardTriggered: () => {
          getAudioManager().play("vault");
          arcadeFeedback();
        },
        // A relic is taken by walking to its plinth, so there is no modal to
        // confirm it. The acknowledgement has to be felt instead.
        onRelicTaken: () => {
          getAudioManager().play("vault");
          arcadeFeedback();
          // §PR77 Part 4 "first relic walk-through".
          markTaught("relic");
        },
        // The seal breaking is the moment the road ahead opens. Movement is
        // already unclamped when this fires — the feedback marks it, it does
        // not gate it.
        onSealFractured: () => {
          getAudioManager().play("barrier_release");
          arcadeFeedback();
        },
        onDefeated: () => missFeedback(),
      }
    );

    return () => runtime.endExpedition();
    // Deliberately keyed on the PINNED objective key, not on any
    // live-derived route/task value — see the identity-pinning note above.
  }, [activeExpedition?.key, runtimeReady]);

  // Poll of the full typed fictional run snapshot for the HUD.
  useEffect(() => {
    if (!activeExpedition) return;
    const id = window.setInterval(() => {
      const snapshot = runtimeRef.current?.getExpeditionSnapshot();
      if (snapshot) setExpeditionSnapshot(snapshot);
    }, 120);
    return () => window.clearInterval(id);
  }, [activeExpedition]);

  /**
   * §PR77 Part 4 "first route choice". There is no dedicated fork-chosen
   * callback — `route` is already polled into `expeditionSnapshot` above,
   * so the transition away from "unchosen" is read here rather than adding
   * a second plumbing path for the same fact.
   */
  const lastRouteRef = useRef(expeditionSnapshot.route);
  useEffect(() => {
    if (
      lastRouteRef.current === "unchosen" &&
      expeditionSnapshot.route !== "unchosen"
    ) {
      markTaught("fork");
    }
    lastRouteRef.current = expeditionSnapshot.route;
  }, [expeditionSnapshot.route, markTaught]);

  /**
   * §PR77 Part 4 contextual teaching hint. Shows the single next unlearned
   * mechanic in canonical order while the expedition is genuinely running
   * — the authored encounter order in expeditionPlan.ts already introduces
   * mechanics one at a time, so this naturally lines up with what the
   * player is about to face without a second copy of corridor proximity.
   * `teachingVersion` forces a recompute the instant a mechanic is marked
   * learned; localStorage reads are otherwise not reactive.
   */
  const teachingHint = useMemo(() => {
    if (!activeExpedition || expeditionSnapshot.outcome !== "running") return null;
    const identity = playerIdentityRef.current;
    const mechanic = nextUnlearnedMechanic(identity);
    if (!mechanic) return null;
    if (mechanicLearningState(mechanic, true, identity) !== "teaching") return null;
    switch (mechanic) {
      case "strike":
        return "TAP TO STRIKE";
      case "evade":
        return "FLICK TO EVADE";
      case "line":
        return "HOLD TO AIM THE LINE";
      case "relic":
        return "WALK THROUGH A RELIC TO TAKE IT";
      case "fork":
        return "CHOOSE A PATH AT THE FORK";
      default:
        return null;
    }
    // teachingVersion is read only to force recomputation on mark-learned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeExpedition, expeditionSnapshot.outcome, teachingVersion]);

  /**
   * §PR77 Part 17 mission-context sheet content. `detail` is an address for
   * native_pickup/external_order (so Navigate is offered) but free task
   * text for open_channel — never offered as a destination.
   */
  const missionContextObjective = activeExpedition ?? preparedObjective;
  const missionContextDetail = missionContextObjective?.detail ?? null;
  const missionContextNavigationUrl = useMemo(() => {
    if (!missionContextObjective) return null;
    // A LOCAL_TARGET_RUN target already carries its own real (or clearly
    // simulated) navigationUrl — use it directly rather than re-deriving
    // one from `detail`.
    if (missionContextObjective.kind === "local_target_run") {
      return missionContextObjective.currentTarget.navigationUrl;
    }
    if (
      missionContextObjective.kind !== "native_pickup" &&
      missionContextObjective.kind !== "external_order"
    ) {
      return null;
    }
    const address = missionContextObjective.detail?.trim();
    if (!address) return null;
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
  }, [missionContextObjective]);
  const missionContextProgress =
    activeExpedition?.kind === "local_target_run"
      ? {
          progressLabel: activeExpedition.progressLabel,
          visitedCount: activeExpedition.visitedCount,
          totalCount: activeExpedition.totalCount,
          simulated: activeExpedition.simulated,
        }
      : null;

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

  // A genuine world INTERACT gesture prefers a pickup/delivery that is
  // currently in its authored interaction zone over the spotlighted
  // single-mission encounter — the runtime itself only fires INTERACT at
  // all when at least one of the two is engage-approachable (see
  // GoldlineGame.performAction). Returns true when it truthfully handled
  // the interact so the caller does not also try the mission path.
  const handleOrderInteractRef = useRef<() => boolean>(() => false);
  handleOrderInteractRef.current = () => {
    if (orderSpatialState !== "engage" || !nextOrderObjective) return false;
    handleSelectOrder(nextOrderObjective.order, nextOrderObjective.status);
    return true;
  };

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

  /**
   * NEUTRALIZE route stop → in-game VISIT. Opens the same
   * `GoldlineActionSurface` VISIT lifecycle the spotlighted single-mission
   * flow already uses, built directly from this stop's own authoritative
   * fields — no page navigation, no fabricated business facts. Fails closed
   * (stays in Goldline, truthful feedback, no write) when the stop has no
   * real address on record rather than opening the surface with one invented.
   */
  function handleSelectRouteStop(stop: AuthoritativeVisitRouteStop) {
    if (stop.evidenced) return;
    emit?.({
      eventName: "growth_action_opened",
      sessionId: sessionIdRef.current,
      missionId: stop.missionId,
      properties: { sessionId: sessionIdRef.current, actionKind: "commercial_visit" },
    });
    if (!stop.address || !stop.navigationUrl) {
      setFeedback("STOP UNAVAILABLE · NO LOCATION ON RECORD");
      return;
    }
    const action: GoldlineActionDescriptor = {
      kind: "VISIT",
      mode: "external",
      missionId: stop.missionId,
      label: "DEPART",
      address: stop.address,
      navigationUrl: stop.navigationUrl,
      destinationPath: stop.destinationPath,
    };
    setSelectedRouteStop(stop);
    setStandaloneActionRequestId(crypto.randomUUID());
    setPresentedAction(action);
  }

  /**
   * A genuine pickup or delivery → in-game PICKUP/DELIVERY surface. Built
   * directly from the real order's own fields (never fabricated) and opened
   * through the same in-canvas overlay mechanism as route stops and
   * spotlighted single-mission actions — never a page navigation. Fails
   * closed (truthful feedback, no surface, no write) when the order genuinely
   * has no address on record.
   */
  function handleSelectOrder(order: Order, status: "collected" | "delivered") {
    const address = order.address?.trim() || null;
    if (!address) {
      setFeedback("ROUTE STOP UNAVAILABLE · NO LOCATION ON RECORD");
      return;
    }
    const navigationUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
    const customerName =
      `${order.firstName ?? ""} ${order.lastName ?? ""}`.trim() ||
      `Order #${order.id}`;
    // Only the world's current "next objective" is ever spatially embodied
    // (see the setOrderEmbodiment effect below) — so only that order can
    // genuinely be within its interaction zone. A different, not-yet-current
    // order truthfully cannot be in range yet.
    const withinInteractionZone =
      order.id === nextOrderObjective?.order.id &&
      orderSpatialState === "engage";
    const action: GoldlineActionDescriptor =
      status === "delivered"
        ? {
            kind: "DELIVERY",
            mode: "write",
            missionId: -order.id,
            label: "DELIVER",
            orderId: order.id,
            customerName,
            address,
            navigationUrl,
            paid: order.paid,
            withinInteractionZone,
          }
        : {
            kind: "PICKUP",
            mode: "write",
            missionId: -order.id,
            label: "PICK UP",
            orderId: order.id,
            customerName,
            address,
            navigationUrl,
            withinInteractionZone,
          };
    setSelectedOrder({ order, status });
    setStandaloneActionRequestId(crypto.randomUUID());
    setPresentedAction(action);
    // The route list lives inside the higher-z-index utility backdrop,
    // which would otherwise sit above (and intercept clicks for) the
    // in-canvas action surface. Closing it here is a drill-down, not an
    // exit from Goldline — the world canvas underneath was never unmounted.
    setUtilityPanel(null);
  }

  function performAction() {
    if (drivingLikely) return;
    // Defense in depth: GoldlineGame.performAction() already rejects while
    // an expedition is active, but a stale React `action` value could
    // still reach this handler in the same render cycle an expedition
    // starts. The expedition's own ACT surface never calls this function.
    if (activeExpedition) return;
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
      data-driving-likely={drivingLikely ? "true" : "false"}
      data-expedition-state={
        activeExpedition != null
          ? "active"
          : preparedObjective != null
            ? "ready"
            : "none"
      }
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
        data-objective-offscreen={objectiveOffscreen ?? "NONE"}
        data-route-end-marker={
          nextCorridorId !== null ? "waypost" : "end-of-world"
        }
      >
        <div ref={hostRef} className="goldline-canvas-host" />
        {(activeExpedition != null ||
          (preparedObjective != null &&
            preparedObjective.kind !== "open_channel")) &&
        runtimeReady ? (
          <ExpeditionHud
            runtime={runtimeRef.current}
            active={activeExpedition != null}
            interactionDisabled={drivingLikely}
            onEnter={enterExpedition}
            onExit={exitExpedition}
            objectiveLabel={
              activeExpedition?.label ?? preparedObjective?.label ?? ""
            }
            objectiveDetail={missionContextDetail}
            objectiveNavigationUrl={missionContextNavigationUrl}
            hp={expeditionSnapshot.hp}
            maxHp={EXPEDITION.maxHp}
            momentum={expeditionSnapshot.momentum}
            maxMomentum={EXPEDITION.maxMomentum}
            terminalState={expeditionSnapshot.outcome}
            onRedeploy={redeployExpedition}
            onPressOn={pressOnExpedition}
            pinnedCustomer={
              activeExpedition?.kind === "local_target_run"
                ? activeExpedition.currentTarget.name
                : activeExpedition?.label
            }
            pinnedAddress={
              activeExpedition?.kind === "local_target_run"
                ? activeExpedition.currentTarget.address
                : activeExpedition?.detail
            }
            // A LOCAL_TARGET_RUN has no single "collect" action — real
            // progress is written only by a confirmed Field Intel capture
            // (markLocalTargetRunTargetVisited), never by a tap here. See
            // completeExpeditionObjective's own guard for the same rule.
            onSecureCargo={
              activeExpedition?.kind === "local_target_run"
                ? undefined
                : completeExpeditionObjective
            }
            onLogSignal={
              activeExpedition?.kind === "local_target_run" &&
              !localTargetRealArrivalConfirmed
                ? props.onOpenJournal
                : arrivedStop
                  ? () => {
                      // Carry the already-confirmed doorstep identity into the
                      // controller synchronously before opening capture. The
                      // passive reporting effect below remains useful for the
                      // general operating bar, but this real-action boundary
                      // must not depend on a later React effect/render.
                      props.onOperatorStopChange?.(arrivedStop);
                      props.onOpenLogSignal?.();
                    }
                  : props.onOpenLogSignal
            }
            logSignalLabel={
              activeExpedition?.kind === "local_target_run" &&
              !localTargetRealArrivalConfirmed
                ? "OPEN FIELD JOURNAL"
                : "LOG A SIGNAL"
            }
            awaitingSignalLabel={
              activeExpedition?.kind === "local_target_run" &&
              !localTargetRealArrivalConfirmed
                ? physicalArrival.availability === "permission_denied" ||
                    physicalArrival.availability === "unsupported" ||
                    physicalArrival.availability === "unavailable"
                  ? "LOCATION NOT CONFIRMED · JOURNAL REMAINS AVAILABLE"
                  : "VERIFYING REAL ARRIVAL · STAY NEAR THE TARGET"
                : undefined
            }
            teachingHint={teachingHint}
            cargoPhase={cargoPhase}
            completionActionLabel={
              activeExpedition?.kind === "open_channel"
                ? "SEAL THE WORK"
                : activeExpedition?.kind === "local_target_run"
                  ? "RUN COMPLETE"
                  : "SECURE CARGO"
            }
            missionProgress={missionContextProgress}
            // Provenance travels with the objective. External work is marked
            // at the threshold AND on arrival, so there is no moment where the
            // operator could take it for a native Laundry Butler order. A
            // simulated target run is marked the same honest way — never
            // presented as if it were real sourcing.
            provenanceLabel={
              preparedObjective?.kind === "external_order"
                ? externalProvenanceLabel({
                    sourceSystem: preparedObjective.sourceSystem,
                  })
                : (activeExpedition?.kind === "local_target_run"
                      ? activeExpedition.simulated
                      : preparedObjective?.kind === "local_target_run" &&
                        preparedObjective.simulated)
                  ? "SIMULATED · PLACES UNAVAILABLE"
                  : null
            }
            reconciliationLabel={
              externalReconciliation
                ? externalReconciliationLabel(externalReconciliation)
                : null
            }
            onReconcile={
              externalReconciliation &&
              externalReconciliation.operationalStatus === "completed" &&
              externalReconciliation.reconciliationStatus === "update_required" &&
              props.onReconcileExternalOrder
                ? () =>
                    void props.onReconcileExternalOrder?.(
                      externalReconciliation.id
                    )
                : undefined
            }
            reconcileActionLabel={`I UPDATED ${externalProvenanceLabel({
              sourceSystem:
                externalReconciliation?.sourceSystem ?? "manual_external",
            })}`}
            confirmedLabel={
              activeExpedition?.kind === "open_channel"
                ? "WORK SEALED"
                : activeExpedition?.kind === "local_target_run"
                  ? "RUN COMPLETE — EVERY TARGET VISITED"
                  : "CARGO SECURED"
            }
            failedLabel={
              activeExpedition?.kind === "open_channel"
                ? "WORK NOT RECORDED — STILL PENDING"
                : "PICKUP NOT RECORDED — STILL PENDING"
            }
            // AUTHORITATIVE, not local: this is server truth about the
            // pinned order, so a pickup collected on another surface
            // renders CARGO SECURED here exactly the same way.
            cargoSecured={objectiveConfirmed}
          />
        ) : null}
        {!runtimeReady ? (
          <div className="game-loading">
            <Loader2 /> ENTERING TERRITORY · SYNCING FIELD…
          </div>
        ) : null}
        <div className="game-atmosphere" aria-hidden="true" />
        {drivingLikely ? (
          <div className="driving-safety-shield" role="status" data-testid="driving-safety-shield">
            <b>TRAVEL IN PROGRESS</b>
            <span>GOLDLINE IS WATCHING THE ROUTE · CONTROLS RETURN WHEN PARKED</span>
          </div>
        ) : null}
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
        {objectiveOffscreen === "ahead" ? (
          <div
            className="objective-direction-cue"
            role="status"
            data-testid="objective-direction-cue"
          >
            <ChevronUp /> OBJECTIVE AHEAD
          </div>
        ) : null}
        {/* Forward route cue: shown whenever the route genuinely continues
            (a playable next corridor exists, or the player has not yet
            reached this corridor's exit band) and no other directional cue
            is already on screen. Never points at nothing — it disappears
            once the player is in the exit band on the last playable
            corridor, which is exactly where the end-of-world marker takes
            over. */}
        {activeExpedition == null &&
        !corridorExitNear &&
        objectiveOffscreen !== "ahead" ? (
          <div
            className="objective-direction-cue is-forward-route"
            role="status"
            data-testid="forward-route-cue"
          >
            <ChevronUp /> ROUTE CONTINUES AHEAD
          </div>
        ) : null}
        {/* Honest end of the built world: a sparse, authored, in-world
            monument line — never an invisible wall with no explanation.
            Shown only in the last playable corridor's own exit band, paired
            with the physical monument object GoldlineGame draws there. */}
        {activeExpedition == null && corridorExitNear && nextCorridorId === null ? (
          <div
            className="corridor-transition-signal is-end-of-world"
            role="status"
            data-testid="end-of-world-marker"
          >
            THE LINE ENDS HERE — BEYOND IS UNWRITTEN
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
            <b>{activeMission?.name ?? preparedObjective?.label ?? "NO ACTIVE MISSION"}</b>
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
                <small>NO MISSIONS RESOLVED YET</small>
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
            {activeMission && missionSpatialState !== "hidden" ? (
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
              disabled={
                drivingLikely ||
                (activeExpedition != null &&
                  expeditionSnapshot.outcome !== "running")
              }
              onInput={(x, y) => runtimeRef.current?.setInput(x, y)}
              showMovementHint={!movementLearned}
              onFirstMove={() => completeMilestone("movement")}
              settleProgress={settleProgress}
              onPressStart={deflection => {
                const game = runtimeRef.current;
                if (game?.getExpeditionSnapshot()?.outcome !== "running") {
                  surveyPulseRef.current.cancel();
                  setSettleProgress(0);
                  return;
                }
                surveyPulseRef.current.pointerDown(
                  performance.now(),
                  deflection
                );
                setSettleProgress(0);
              }}
              onPressUpdate={deflection => {
                const game = runtimeRef.current;
                if (game?.getExpeditionSnapshot()?.outcome !== "running") {
                  surveyPulseRef.current.cancel();
                  setSettleProgress(0);
                  return;
                }
                const now = performance.now();
                if (surveyPulseRef.current.pointerUpdate(now, deflection)) {
                  game.expeditionSurvey();
                }
                setSettleProgress(
                  surveyPulseRef.current.getSettleProgress(now)
                );
              }}
              onPressEnd={() => {
                surveyPulseRef.current.pointerUp();
                setSettleProgress(0);
              }}
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
              ) : !activeMission &&
                !nextOrderObjective &&
                preparedObjective?.kind === "open_channel" ? (
                <button
                  className="is-interact"
                  data-testid="seal-open-channel-task"
                  disabled={baseOpenChannelPhase === "sealing"}
                  onClick={completeBaseOpenChannelObjective}
                >
                  <Footprints />
                  <span>
                    <b>SEAL THE WORK</b>
                    <small>{preparedObjective.label}</small>
                  </span>
                </button>
              ) : activeMission || nextOrderObjective || preparedObjective ? (
                <div className="action-awaiting" data-testid="objective-ahead">
                  <Route />
                  <span>FOLLOW THE GOLD LINE</span>
                </div>
              ) : (
                <div
                  className="action-awaiting is-empty"
                  data-testid="no-active-objective"
                >
                  <Route />
                  <span>
                    <b>NO ACTIVE OBJECTIVE</b>
                    <small>No unresolved route work right now.</small>
                  </span>
                </div>
              )}
            </div>
            <button
              className={`cold-call-entry is-portal-${coldCallPortalState}`}
              disabled={
                drivingLikely ||
                (!props.coldCallBatch && props.coldCallEligibleCount === 0)
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
                // A route-stop visit is not the spotlighted single-mission
                // encounter — it never entered `encounterRuntime`, and
                // completing it should return the player to the SAME
                // NEUTRALIZE mission (the fiction panel stays mounted
                // untouched), not into the encounter's own outcome view.
                // `GoldlineActionSurface` has already called
                // `services.refetchAuthoritativeTruth`, which refreshes
                // `visitRoute` — the panel picks up the new coverage on its
                // own via `props.authoritativeVisitRoute`.
                if (selectedRouteStop) {
                  setPresentedAction(null);
                  setStandaloneActionRequestId(null);
                  setSelectedRouteStop(null);
                  return;
                }
                // A pickup/delivery is likewise not the spotlighted
                // single-mission encounter. `services.resolveOrder` already
                // performed its own broad authoritative refresh
                // (pickups/deliveries/Open Channel progress/etc. — see
                // GoldlineDriverController's invalidateDriverTruth) before
                // resolving, so the objective list picks up server truth on
                // its own; no separate refetch call is needed here.
                if (selectedOrder) {
                  const { order, status } = selectedOrder;
                  setFeedback(
                    `${status === "delivered" ? "DELIVERED" : "COLLECTED"} · ${
                      `${order.firstName ?? ""} ${order.lastName ?? ""}`.trim() ||
                      `Order #${order.id}`
                    }`
                  );
                  setPresentedAction(null);
                  setStandaloneActionRequestId(null);
                  setSelectedOrder(null);
                  return;
                }
                sendEncounterEvent({ type: "REAL_ACTION_PERSISTED" });
                setPresentedAction(null);
                setStandaloneActionRequestId(null);
                setView("awaiting_business_result");
              }}
              onClose={() => {
                if (selectedRouteStop) {
                  setPresentedAction(null);
                  setStandaloneActionRequestId(null);
                  setSelectedRouteStop(null);
                  return;
                }
                if (selectedOrder) {
                  setPresentedAction(null);
                  setStandaloneActionRequestId(null);
                  setSelectedOrder(null);
                  return;
                }
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
              isDriving={drivingLikely}
              authoritativeCount={props.authoritativeRouteCoverage ?? 0}
              routeStops={props.authoritativeVisitRoute?.stops}
              onSelectStop={handleSelectRouteStop}
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
            {props.onOpenLogSignal ? (
              /*
                Capture lives in the operating bar, not in a menu behind it. The
                observation worth keeping happens at a doorstep, and anything
                more than one tap away from where the operator already is will
                not survive the walk back to the van.
              */
              <button
                onClick={props.onOpenLogSignal}
                data-testid="game-log-signal"
              >
                <Radio />
                Signal
              </button>
            ) : null}
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
                  {/*
                    CleanCloud intake. #74 shipped the importer and the
                    controller has always passed the callback, but the only
                    doorway added was on GoldlineHome — which is now just the
                    Suspense/runtime-failure fallback. On the live game screen
                    the capability existed with no way to reach it.

                    Spans both columns and sits first because importing the
                    day's real pickups and dropoffs is day truth, not a
                    utility: nothing else in this panel changes what the
                    operator is actually driving to.

                    Opens the sheet exactly as #74 built it, on its own
                    IMPORT CLEAN CLOUD DAY / ADD CLEAN CLOUD JOB chooser — so
                    the label names both paths rather than promising only one.
                  */}
                  {props.onOpenTodayRoute ? (
                    <button
                      className="field-console-today-route"
                      data-testid="field-console-today-route"
                      onClick={() => {
                        setUtilityPanel(null);
                        props.onOpenTodayRoute?.();
                      }}
                    >
                      <b>TODAY’S ROUTE</b>
                      <small>Pickups · Drop-offs · Sales stops</small>
                    </button>
                  ) : null}

                  {props.onOpenAddExternalWork ? (
                    <button
                      className="field-console-cleancloud"
                      data-testid="field-console-cleancloud"
                      onClick={() => {
                        // Leave the panel on the way out. Its backdrop sits at
                        // z-index 70 over the whole shell, so a sheet opened
                        // from behind it renders visibly but swallows every
                        // tap — the menu has to close, not stack.
                        setUtilityPanel(null);
                        props.onOpenAddExternalWork?.();
                      }}
                    >
                      <b>CLEAN CLOUD WORK</b>
                      <small>Import screenshots or add a job</small>
                    </button>
                  ) : null}

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
                    {!fictionMission &&
                    suggestedVisitMissionIds.length >= 2 &&
                    props.onStartVisitRoute ? (
                      <button
                        data-testid="start-authoritative-visit-route"
                        disabled={props.isStartingVisitRoute}
                        onClick={() =>
                          void props.onStartVisitRoute?.(
                            suggestedVisitMissionIds
                          )
                        }
                      >
                        START COMMERCIAL VISIT ROUTE
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
                    {orderObjectives.map(({ order, status }) => {
                      const unavailable = !order.address?.trim();
                      const blocked = status === "delivered" && !order.paid;
                      const isNext = order.id === nextOrderObjective?.order.id;
                      const label = unavailable
                        ? "UNAVAILABLE"
                        : blocked
                          ? "PAYMENT BLOCKED"
                          : status === "collected"
                            ? "RETRIEVE CARGO"
                            : "DELIVER CARGO";
                      return (
                        <article
                          key={`${status}-${order.id}`}
                          data-next-objective={isNext}
                        >
                          <span>
                            {isNext ? (
                              <small className="objective-next-badge">
                                NEXT OBJECTIVE
                              </small>
                            ) : null}
                            <b>
                              {`${order.firstName ?? ""} ${order.lastName ?? ""}`.trim() ||
                                `Order #${order.id}`}
                            </b>
                            <small>
                              {order.address || "No location on record"}
                            </small>
                          </span>
                          <button
                            disabled={props.isResolvingOrder || unavailable}
                            data-order-unavailable={unavailable}
                            onClick={() => handleSelectOrder(order, status)}
                          >
                            {label}
                          </button>
                        </article>
                      );
                    })}
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
                            {entry.grammar
                              ? entry.grammar.kind
                              : "NO REAL ACTION"}
                          </small>
                        </span>
                      </article>
                    ))}
                    {!stronghold.routeTable.length ? (
                      <p>No real business action is live right now.</p>
                    ) : null}
                  </div>

                  <h3>Agents</h3>
                  <div
                    className="stronghold-agents"
                    data-testid="stronghold-agents"
                  >
                    {stronghold.agents.map(agent => (
                      <span key={agent.agentId}>{agent.agentId}</span>
                    ))}
                    {!stronghold.agents.length ? (
                      <p>No agent capabilities have real evidence yet.</p>
                    ) : null}
                  </div>

                  <h3>Sales intelligence</h3>
                  <div
                    className="stronghold-intel"
                    data-testid="stronghold-intel"
                  >
                    {stronghold.intel ? (
                      <>
                        <p>
                          {stronghold.intel.acceptedTeachingCount} accepted
                          teaching
                          {stronghold.intel.acceptedTeachingCount === 1
                            ? ""
                            : "s"}
                        </p>
                        {stronghold.intel.byCategory.map(entry => (
                          <span key={entry.category}>
                            {entry.category.replace(/_/g, " ")} · {entry.count}
                          </span>
                        ))}
                      </>
                    ) : (
                      <p>No reviewed sales intelligence is available.</p>
                    )}
                  </div>

                  <h3>Chronicle</h3>
                  <div
                    className="stronghold-chronicle"
                    data-testid="stronghold-chronicle"
                  >
                    {stronghold.chronicle.slice(0, 8).map(entry => (
                      <article key={entry.mission.key}>
                        <b>{entry.mission.name}</b>
                        <span
                          className={`world-route-treatment is-${entry.mutation.routeTreatment}`}
                          aria-label={`Route ${entry.mutation.routeTreatment}`}
                        >
                          <i aria-hidden />
                          route
                        </span>
                        <span
                          className={`world-destination-treatment is-${entry.mutation.destinationTreatment}`}
                          aria-label={`Destination ${entry.mutation.destinationTreatment}`}
                        >
                          <i aria-hidden />
                          destination
                        </span>
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
          shouldAutoIgnite={
            !action &&
            !activeMission &&
            !nextOrderObjective &&
            !preparedObjective &&
            // An outstanding external update is WORK, so the day is not empty
            // and the briefing must not auto-open over it. Without this,
            // finishing a CleanCloud job made the day look finished and the
            // ignition overlay opened on top of the very control the operator
            // needed next — "I UPDATED CLEAN CLOUD".
            !externalReconciliationOutstanding
          }
          isGenerating={Boolean(props.isGeneratingOpenChannel)}
          isApproving={Boolean(props.isApprovingOpenChannel)}
          onClose={() => setUtilityPanel(null)}
          onGenerate={props.onGenerateOpenChannel}
          onApprove={props.onApproveOpenChannel}
        />
      </section>
      {showFirstEntryExplainer ? (
        <div
          className="first-entry-explainer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="first-entry-title"
          data-testid="first-entry-explainer"
        >
          <div className="first-entry-explainer-card">
            <h2 id="first-entry-title">YOUR BUSINESS IS THE ADVENTURE</h2>
            <p>
              Real work appears as objectives in this world.
              <br />
              Follow the Gold Line.
              <br />
              Do the real action.
              <br />
              Goldline updates from the real result.
            </p>
            <button type="button" onClick={dismissFirstEntryExplainer}>
              GOT IT
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
