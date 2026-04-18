import {
  type CSSProperties,
  type ForwardedRef,
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import "./Level4Offensive.css";

import boardPng from "@/assets/l4/board.png";
import manFigure from "@/assets/l4/man.png";
import womanFigure from "@/assets/l4/woman.png";
import frameTexture from "@/assets/l4/frame_texture_2k.png";
import panelFace from "@/assets/l4/panel_face_tile_1k.png";
import centerGrit from "@/assets/l4/center_grit_bg_1920.png";
import hudPlate from "@/assets/l4/hud_overlay_plate.png";
import youAreHereBadge from "@/assets/l4/you_are_here_badge.png";
import mapPanelArt from "@/assets/l4/map_panel_art.png";

type LaneId = 1 | 2 | 3;

/**
 * Level 4 game loop — behavioral pressure model:
 *   calm  (idle < 20 min OR outside work hours)
 *   descent (20–50 min of idle; crusher lowers, vignette tightens, telemetry decays)
 *   impact (≥50 min idle OR ceiling hit bottom; blackout + eye censor + locked revive CTA)
 *   resetting (post-success flash/stamp/recoil)
 *   victory (all 3 lanes cleared for the day)
 *
 * Transitions are driven by real wall-clock idle time stored in localStorage, so
 * page refresh and re-entering /level4 do not reset the crusher.
 */
type GamePhase = "calm" | "descent" | "impact" | "victory" | "resetting";
type RevivePhase = "idle" | "flash" | "stamp";

/** Maps phase → existing ceiling CSS states. */
function wallVisualFromPhase(phase: GamePhase): "top" | "descending" | "bottomed" | "resetting" {
  if (phase === "resetting") return "resetting";
  if (phase === "descent") return "descending";
  if (phase === "impact") return "bottomed";
  return "top";
}

/** Behavioral timing — real minutes on a wall clock. */
const L4_MIN = 60_000;
const L4_IDLE_TO_THREAT_MS = 20 * L4_MIN;
const L4_THREAT_DURATION_MS = 30 * L4_MIN;
const L4_IMPACT_THRESHOLD_MS = L4_IDLE_TO_THREAT_MS + L4_THREAT_DURATION_MS;
const L4_PARTIAL_RELIEF_MS = 0.15 * L4_IDLE_TO_THREAT_MS;
/** Work hours window [start, end) in local time. Outside this, crusher is frozen in calm. */
const L4_WORK_HOUR_START = 8;
const L4_WORK_HOUR_END = 19;
/** Render tick rate — the telemetry counter updates at this cadence (~10 Hz). */
const L4_TICK_MS = 100;

/** Revive choreography durations. */
const L4_FLASH_DURATION_MS = 150;
const L4_STAMP_DURATION_MS = 1_500;
const L4_WALL_RESET_SNAP_MS = 200;
const L4_FAILURE_PAUSE_MS = 3_000;

/** localStorage keys — survive refresh so crusher state cannot be reset by leaving the page. */
const L4_LS_LAST_ACTION = "l4.lastMeaningfulActionAt";
const L4_LS_COMPLETED = "l4.completedLanes";
const L4_LS_COMPLETED_DAY = "l4.completedDay";

/** ?fast=1 URL flag compresses real minutes → seconds for visual QA. */
function readFastFactor(): number {
  if (typeof window === "undefined") return 1;
  const p = new URLSearchParams(window.location.search).get("fast");
  if (p === "1" || p === "true") return 60;
  const n = p != null ? Number(p) : NaN;
  return Number.isFinite(n) && n > 1 ? n : 1;
}

function isWorkHours(d = new Date()): boolean {
  const h = d.getHours();
  return h >= L4_WORK_HOUR_START && h < L4_WORK_HOUR_END;
}

function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Max travel (px). Actual drop is clamped to the measured canvas stack so overflow:hidden never fully clips the crusher. */
const L4_WALL_DROP_MAX_PX = 380;
/** Bar + spike strip + margins — must stay inside the track at max translate. */
const L4_WALL_BAR_EST_PX = 76;

type MapNodeId = "opus" | "century" | "beaudry";

type MapNode = {
  id: MapNodeId;
  label: string;
  sublabel: string;
  tone: "captured" | "director" | "general";
};

const MAP_NODES: MapNode[] = [
  { id: "opus", label: "Opus LA", sublabel: "Captured / Established", tone: "captured" },
  { id: "century", label: "Century Park East", sublabel: "Director Building(typ)", tone: "director" },
  { id: "beaudry", label: "Targeted Park", sublabel: "General Building(typ)", tone: "general" },
];

function nextActiveLane(completed: Record<LaneId, boolean>): LaneId | null {
  if (!completed[1]) return 1;
  if (!completed[2]) return 2;
  if (!completed[3]) return 3;
  return null;
}

function allLanesCleared(completed: Record<LaneId, boolean>) {
  return completed[1] && completed[2] && completed[3];
}

/** Saw-tooth path for SVG spike strip (sharp points down — reads as danger, not a flat trim). */
function buildCeilingSpikePath(teeth: number, width: number, peakY: number): string {
  const step = width / teeth;
  let d = "M 0 0";
  for (let i = 0; i < teeth; i++) {
    const x = i * step;
    d += ` L ${x + step / 2} ${peakY} L ${x + step} 0`;
  }
  d += ` L ${width} 0 Z`;
  return d;
}

const L4_SPIKE_PATH = buildCeilingSpikePath(72, 240, 20);

async function resolveDeploy(fn?: () => void | Promise<boolean | void>): Promise<boolean> {
  if (!fn) return true;
  const r = fn();
  if (r != null && typeof (r as Promise<boolean | void>).then === "function") {
    const v = await (r as Promise<boolean | void>);
    return v !== false;
  }
  return true;
}

export type Level4OffensiveProps = {
  className?: string;
  soberDays?: number;
  debtCents?: number;
  recoveredTodayCents?: number;
  onDeployLane1?: () => void | Promise<boolean | void>;
  onDeployLane2?: () => void | Promise<boolean | void>;
  onDeployLane3?: () => void | Promise<boolean | void>;
  lane1Executed?: boolean;
  /** Optional honest-label overrides, wired by Level4OffensiveHost off live state. */
  lane1Title?: string;
  lane1Body?: string;
  lane1CtaLabel?: string;
  lane2Title?: string;
  lane2Body?: string;
  lane2CtaLabel?: string;
  lane2Disabled?: boolean;
  lane3Title?: string;
  lane3Body?: string;
  lane3CtaLabel?: string;
  /** When set, the lane 3 deploy CTA is labeled as stubbed rather than suggesting real capture. */
  lane3Stubbed?: boolean;
  /** Gameplay-testability hooks — see SimulationOverride. Host owns client-only state. */
  onInjectSyntheticLane2?: () => void;
  onResetSyntheticLane2?: () => void;
  syntheticLane2Active?: boolean;
};

/** Imperative handle so the Host can force revive / reset from the deploy-success path
 *  as belt-and-suspenders if the promise-driven trigger ever loses its resolution. */
export type Level4OffensiveHandle = {
  forceRevive: (lane?: LaneId) => void;
  forcePhase: (phase: GamePhase | null) => void;
  resetCycle: () => void;
};

export const Level4Offensive = forwardRef(function Level4Offensive(
  {
    className,
    soberDays = 2114,
    onDeployLane1,
    onDeployLane2,
    onDeployLane3,
    lane1Executed = false,
    lane1Title,
    lane1Body,
    lane1CtaLabel,
    lane2Title,
    lane2Body,
    lane2CtaLabel,
    lane2Disabled = false,
    lane3Title,
    lane3Body,
    lane3CtaLabel,
    lane3Stubbed = false,
    onInjectSyntheticLane2,
    onResetSyntheticLane2,
    syntheticLane2Active = false,
  }: Level4OffensiveProps,
  handleRef: ForwardedRef<Level4OffensiveHandle>
) {
  /** ?fast=N is the initial seed; Simulation Override can change it at runtime. */
  const [fastFactor, setFastFactor] = useState<number>(readFastFactor);
  const idleToThreatMs = L4_IDLE_TO_THREAT_MS / fastFactor;
  const impactThresholdMs = L4_IMPACT_THRESHOLD_MS / fastFactor;
  const partialReliefMs = L4_PARTIAL_RELIEF_MS / fastFactor;

  /** Simulation Override forcing a fixed phase — bypasses idle/work-hour derivation. null = live. */
  const [forcedPhase, setForcedPhase] = useState<GamePhase | null>(null);
  /** "auto" = real clock; "on" = always in-hours; "off" = always off-hours. */
  const [workHoursOverride, setWorkHoursOverride] = useState<"auto" | "on" | "off">("auto");
  /** Simulation Override terminal visibility. */
  const [simOpen, setSimOpen] = useState(false);

  const [selectedNodeId, setSelectedNodeId] = useState<MapNodeId>("beaudry");
  const [completedLanes, setCompletedLanes] = useState<Record<LaneId, boolean>>(() => {
    if (typeof window === "undefined") return { 1: false, 2: false, 3: false };
    const savedDay = window.localStorage.getItem(L4_LS_COMPLETED_DAY);
    const saved = window.localStorage.getItem(L4_LS_COMPLETED);
    if (savedDay === todayKey() && saved) {
      try {
        const parsed = JSON.parse(saved) as Record<LaneId, boolean>;
        return { 1: !!parsed[1], 2: !!parsed[2], 3: !!parsed[3] };
      } catch {
        /* fall through */
      }
    }
    return { 1: false, 2: false, 3: false };
  });
  const [gamePhase, setGamePhase] = useState<GamePhase>("calm");
  const [revivePhase, setRevivePhase] = useState<RevivePhase>("idle");
  const [reviveLane, setReviveLane] = useState<LaneId | null>(null);
  const [lane1Pulse, setLane1Pulse] = useState(false);
  const [ctaErrorLane, setCtaErrorLane] = useState<LaneId | null>(null);
  const [ctaWaitLane, setCtaWaitLane] = useState<LaneId | null>(null);
  const [descentPaused, setDescentPaused] = useState(false);

  /** Wall-clock anchor for idle pressure. Persisted across refresh. */
  const [lastActionAt, setLastActionAt] = useState<number>(() => {
    if (typeof window === "undefined") return Date.now();
    const raw = window.localStorage.getItem(L4_LS_LAST_ACTION);
    const n = raw ? Number(raw) : NaN;
    if (!Number.isFinite(n)) {
      const now = Date.now();
      window.localStorage.setItem(L4_LS_LAST_ACTION, String(now));
      return now;
    }
    return n;
  });
  /** Tick value — drives telemetry counter and threshold transitions. */
  const [nowTick, setNowTick] = useState(() => Date.now());

  const timersRef = useRef<number[]>([]);
  const canvasStackRef = useRef<HTMLDivElement | null>(null);
  const lane1Ref = useRef<HTMLDivElement | null>(null);
  const resetInFlightRef = useRef(false);
  const descentPausedRef = useRef(false);

  descentPausedRef.current = descentPaused;
  const wallVisual = wallVisualFromPhase(gamePhase);
  const spikeGradientId = `l4-spike-metal-${useId().replace(/:/g, "")}`;

  /** Idle ms since last meaningful action, clamped at 0. */
  const idleMs = Math.max(0, nowTick - lastActionAt);
  /** 0 during calm, 0..1 during descent, 1 at/after impact threshold. */
  const descentProgress =
    idleMs <= idleToThreatMs
      ? 0
      : Math.min(1, (idleMs - idleToThreatMs) / (impactThresholdMs - idleToThreatMs));
  const structuralIntegrity = Math.max(0, 100 - descentProgress * 100);
  const workHoursActive =
    workHoursOverride === "on"
      ? true
      : workHoursOverride === "off"
        ? false
        : isWorkHours(new Date(nowTick));

  const syncWallDropToTrack = useCallback(() => {
    const el = canvasStackRef.current;
    if (!el) return;
    const h = el.clientHeight;
    const drop = Math.max(80, Math.min(L4_WALL_DROP_MAX_PX, h - L4_WALL_BAR_EST_PX));
    el.style.setProperty("--l4-wall-drop", `${drop}px`);
  }, []);

  useLayoutEffect(() => {
    syncWallDropToTrack();
    const el = canvasStackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => syncWallDropToTrack());
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncWallDropToTrack]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  }, []);

  const activeLane = useMemo(() => nextActiveLane(completedLanes), [completedLanes]);

  /** Tick — drives telemetry counter and wall-clock threshold transitions. */
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), L4_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  /** Parent can flag L1 done; persist to localStorage so refresh does not undo completion. */
  useEffect(() => {
    if (!lane1Executed) return;
    setCompletedLanes((p) => {
      if (p[1]) return p;
      if (resetInFlightRef.current) return p;
      const next = { ...p, 1: true } as Record<LaneId, boolean>;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(L4_LS_COMPLETED, JSON.stringify(next));
        window.localStorage.setItem(L4_LS_COMPLETED_DAY, todayKey());
      }
      return next;
    });
  }, [lane1Executed]);

  useEffect(() => {
    if (gamePhase === "descent") setCtaWaitLane(null);
  }, [gamePhase]);

  /**
   * Behavioral phase derivation — reads wall-clock idle, not a timer schedule.
   * calm     : idleMs < idleToThreatMs  OR  outside work hours
   * descent  : idleToThreatMs ≤ idleMs < impactThresholdMs
   * impact   : idleMs ≥ impactThresholdMs
   * victory  : all 3 lanes cleared today
   * resetting: driven by runReviveSequence (flash/stamp)
   */
  useEffect(() => {
    if (resetInFlightRef.current) return;
    if (revivePhase !== "idle") return;

    // Simulation Override: forcedPhase pins the machine regardless of idle / hours / victory.
    if (forcedPhase !== null) {
      if (gamePhase !== forcedPhase) setGamePhase(forcedPhase);
      return;
    }

    if (allLanesCleared(completedLanes)) {
      if (gamePhase !== "victory") setGamePhase("victory");
      return;
    }

    if (!workHoursActive) {
      if (gamePhase !== "calm") setGamePhase("calm");
      return;
    }

    if (descentPaused && gamePhase === "descent") return;

    if (idleMs >= impactThresholdMs) {
      if (gamePhase !== "impact") setGamePhase("impact");
    } else if (idleMs >= idleToThreatMs) {
      if (gamePhase !== "descent") setGamePhase("descent");
    } else {
      if (gamePhase !== "calm") setGamePhase("calm");
    }
  }, [
    idleMs,
    idleToThreatMs,
    impactThresholdMs,
    workHoursActive,
    descentPaused,
    completedLanes,
    gamePhase,
    revivePhase,
    forcedPhase,
  ]);

  /**
   * FULL RESET sequence on successful deploy/execute:
   *   620ms flash → 1500ms stamp → lane locked green, crusher snaps to top, idle clock resets.
   * Guarded against double-fire so the child-promise path and the Host imperative ref path
   * are safely idempotent when both try to kick off a revive for the same deploy.
   */
  const runReviveSequence = useCallback(
    (lane: LaneId) => {
      if (resetInFlightRef.current) return;
      resetInFlightRef.current = true;
      clearTimers();
      setDescentPaused(false);
      setReviveLane(lane);
      setRevivePhase("flash");
      setGamePhase("resetting");

      const now = Date.now();
      setLastActionAt(now);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(L4_LS_LAST_ACTION, String(now));
      }

      schedule(() => {
        setRevivePhase("stamp");
      }, L4_FLASH_DURATION_MS);

      schedule(() => {
        setCompletedLanes((p) => {
          const next = { ...p, [lane]: true };
          if (typeof window !== "undefined") {
            window.localStorage.setItem(L4_LS_COMPLETED, JSON.stringify(next));
            window.localStorage.setItem(L4_LS_COMPLETED_DAY, todayKey());
          }
          return next;
        });
        setRevivePhase("idle");
        setReviveLane(null);
        resetInFlightRef.current = false;
        const final = Date.now();
        setLastActionAt(final);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(L4_LS_LAST_ACTION, String(final));
        }
      }, L4_FLASH_DURATION_MS + L4_STAMP_DURATION_MS);
    },
    [clearTimers, schedule]
  );

  /** Simulation Override: wipe client-side gameplay state without touching server/audit rows. */
  const resetCycle = useCallback(() => {
    clearTimers();
    resetInFlightRef.current = false;
    setForcedPhase(null);
    setWorkHoursOverride("auto");
    setFastFactor(1);
    setRevivePhase("idle");
    setReviveLane(null);
    setDescentPaused(false);
    setCtaErrorLane(null);
    setCtaWaitLane(null);
    setCompletedLanes({ 1: false, 2: false, 3: false });
    const now = Date.now();
    setLastActionAt(now);
    setGamePhase("calm");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(L4_LS_COMPLETED);
      window.localStorage.removeItem(L4_LS_COMPLETED_DAY);
      window.localStorage.setItem(L4_LS_LAST_ACTION, String(now));
    }
    if (onResetSyntheticLane2) onResetSyntheticLane2();
  }, [clearTimers, onResetSyntheticLane2]);

  /** Simulation Override: pin phase. Passing null releases the pin. */
  const forcePhase = useCallback(
    (phase: GamePhase | null) => {
      clearTimers();
      resetInFlightRef.current = false;
      setRevivePhase("idle");
      setReviveLane(null);
      setDescentPaused(false);
      if (phase === null) {
        setForcedPhase(null);
        return;
      }
      setForcedPhase(phase);
      setGamePhase(phase);
      // When forcing IMPACT we also snap idle forward so the telemetry reads 0%.
      if (phase === "impact" && typeof window !== "undefined") {
        const impactNow = Date.now() - (impactThresholdMs + 1_000);
        setLastActionAt(impactNow);
        window.localStorage.setItem(L4_LS_LAST_ACTION, String(impactNow));
      }
      if (phase === "calm" && typeof window !== "undefined") {
        const now = Date.now();
        setLastActionAt(now);
        window.localStorage.setItem(L4_LS_LAST_ACTION, String(now));
      }
    },
    [clearTimers, impactThresholdMs]
  );

  /** Simulation Override: run the full revive choreography on the active lane (or L1 fallback). */
  const forceRevive = useCallback(() => {
    const target = nextActiveLane(completedLanes) ?? 1;
    // Release any forced pin so the revive sequence's resetting → calm transition takes.
    setForcedPhase(null);
    runReviveSequence(target);
  }, [completedLanes, runReviveSequence]);

  /** Shift+D toggles the Simulation Override terminal. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.shiftKey && (e.key === "D" || e.key === "d") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Ignore when typing in inputs so we don't hijack admin usage of the chrome.
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        e.preventDefault();
        setSimOpen((v) => !v);
      } else if (e.key === "Escape" && simOpen) {
        setSimOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [simOpen]);

  useImperativeHandle(
    handleRef,
    (): Level4OffensiveHandle => ({
      forceRevive: (lane) => {
        const target = lane ?? nextActiveLane(completedLanes) ?? 1;
        setForcedPhase(null);
        runReviveSequence(target);
      },
      forcePhase,
      resetCycle,
    }),
    [completedLanes, runReviveSequence, forcePhase, resetCycle]
  );

  async function tryCompleteLane(lane: LaneId) {
    if (activeLane !== lane) return;
    if (resetInFlightRef.current) return;
    if (revivePhase !== "idle") return;

    const fn = lane === 1 ? onDeployLane1 : lane === 2 ? onDeployLane2 : onDeployLane3;

    // No wired deploy hook: treat the click as the full success path.
    if (!fn) {
      runReviveSequence(lane);
      return;
    }

    // PARTIAL RELIEF: opening a preview / drafting pushes idle back by +15% of idle-to-threat.
    const now = Date.now();
    const boosted = Math.min(now, lastActionAt + partialReliefMs);
    setLastActionAt(boosted);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(L4_LS_LAST_ACTION, String(boosted));
    }

    const ok = await resolveDeploy(fn);
    if (!ok) {
      setCtaErrorLane(lane);
      window.setTimeout(() => setCtaErrorLane(null), L4_FAILURE_PAUSE_MS);
      setDescentPaused(true);
      window.setTimeout(() => setDescentPaused(false), L4_FAILURE_PAUSE_MS);
      return;
    }

    setCtaErrorLane(null);
    runReviveSequence(lane);
  }

  function scrollToLane1() {
    lane1Ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setLane1Pulse(true);
    window.setTimeout(() => setLane1Pulse(false), 1400);
  }

  const showDebugZones = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug");

  const selectedNode = useMemo(() => MAP_NODES.find((n) => n.id === selectedNodeId)!, [selectedNodeId]);
  const textureVars = useMemo(
    () =>
      ({
        "--l4-frame-texture": `url(${frameTexture})`,
        "--l4-panel-face": `url(${panelFace})`,
        "--l4-center-grit": `url(${centerGrit})`,
        "--l4-hud-plate": `url(${hudPlate})`,
        "--l4-you-are-here": `url(${youAreHereBadge})`,
        "--l4-map-art": `url(${mapPanelArt})`,
        "--l4-wall-reset": `${L4_WALL_RESET_SNAP_MS}ms`,
        "--l4-wall-drop": `${L4_WALL_DROP_MAX_PX}px`,
        "--l4-flash-duration": `${L4_FLASH_DURATION_MS}ms`,
        "--l4-stamp-duration": `${L4_STAMP_DURATION_MS}ms`,
        "--l4-ceiling-rig-h": "4.5rem",
      }) as CSSProperties,
    []
  );

  const dossier = useMemo(() => {
    if (selectedNode.id === "beaudry") {
      return {
        header: "TACTICAL DOSSIER (STATE-ful)",
        stateLabel: "STATE A",
        profile: "785 units. DTLA Financial Core. Time-poor professionals.",
        wedge: "Closet Valet wardrobe. Eliminate dry-cleaning rut.",
        vector: "Resident Services pitch + incremental capture.",
        cta: "GENERATED PITCH",
      };
    }
    if (selectedNode.id === "century") {
      return {
        header: "TACTICAL DOSSIER (STATE-ful)",
        stateLabel: "STATE B",
        profile: "12 active / 418 total. 2.8% penetration.",
        wedge: "Social proof capture via adjacent units.",
        vector: "Refer-a-Neighbor mailer to target floors.",
        cta: "GENERATED PITCH",
      };
    }
    return {
      header: "TACTICAL DOSSIER (STATE-ful)",
      stateLabel: "STATE C",
      profile: "Foothold captured. Resident flow active.",
      wedge: "Upsell: closet audit + seasonal rotation.",
      vector: "Concierge playbook + flyer refresh.",
      cta: "GENERATED PITCH",
    };
  }, [selectedNode.id]);

  const ceilingStatusLabel = !workHoursActive
    ? "OFF-HOURS"
    : revivePhase !== "idle"
      ? "REVIVE"
      : gamePhase === "calm"
        ? "TOP"
        : gamePhase === "descent"
          ? "DESCENDING"
          : gamePhase === "impact"
            ? "IMPACT"
            : gamePhase === "resetting"
              ? "RESET"
              : gamePhase === "victory"
                ? "CLEAR"
                : "TOP";

  const boardTone = gamePhase === "impact" ? "is-board-dim" : "is-board-warm";
  const vignetteOpacity = gamePhase === "impact" ? 1 : descentProgress;

  const laneUrgency = (lane: LaneId) => {
    if (activeLane !== lane) return "";
    if (gamePhase === "impact") return "is-cta-max";
    if (gamePhase === "descent") return "is-cta-urgent";
    return "";
  };

  return (
    <section className={cn("l4-root", className)} style={textureVars}>
      <header className="l4-topBanner">
        <div className="l4-topBannerInner">
          <div className="l4-topTitle">Three buildings away from a different life.</div>
          <div className="l4-topSubtitle">Every action today moves you closer or keeps where you are.</div>
        </div>
      </header>

      {allLanesCleared(completedLanes) && (
        <div className="l4-allCleared" role="status">
          ALL LANES CLEARED. EMPIRE EXPANDING.
        </div>
      )}

      <div className="l4-grid">
        <aside className="l4-panel l4-left">
          <nav className="l4-nav">
            {(["ORDERS", "CUSTOMERS", "LEADS", "SETTINGS"] as const).map((label) => (
              <button key={label} type="button" className="l4-navBtn">
                <span className="l4-navCheck" aria-hidden>
                  ✓
                </span>
                <span className="l4-navLabel">{label}</span>
              </button>
            ))}
          </nav>

          <div className="l4-metrics">
            <div className="l4-metricLabel">SOBER DAYS:</div>
            <div className="l4-metricValue">{soberDays.toLocaleString("en-US")}</div>
            <div className="l4-metricSub">Refined compact debt ledger</div>
          </div>

          <div className="l4-fallbackLabel">Fallback</div>

          <div className="l4-growthPanel">
            <div className="l4-growthTitle">GROWTH FOCUS</div>
            <ul className="l4-growthList">
              <li>+$45 → Send CPA invoice</li>
              <li>+$28 → Follow up Sarah</li>
              <li>+$45 → Follow up Aaliyah</li>
            </ul>
          </div>

          <div className="l4-leftFooter">
            <button type="button" className="l4-startBtn" onClick={scrollToLane1}>
              [START HERE]
            </button>
          </div>
        </aside>

        <main className={cn("l4-canvas", gamePhase === "impact" && "is-impact")}>
          <div className="l4-threatCeiling">
            <div className="l4-ceilingBadge">
              <span className="l4-ceilingBadgeIcon" aria-hidden>
                {revivePhase !== "idle" ? "↑" : gamePhase === "resetting" ? "↑" : "↓"}
              </span>
              <span className="l4-ceilingBadgeLabel">CEILING STATUS:</span>
              <span className="l4-ceilingBadgeValue">{ceilingStatusLabel}</span>
            </div>
            <div
              className={cn(
                "l4-telemetry",
                (gamePhase === "descent" || gamePhase === "impact") && "is-active"
              )}
              aria-hidden
            >
              STRUCTURAL INTEGRITY: {structuralIntegrity.toFixed(3)}%
            </div>
          </div>

          <div
            ref={canvasStackRef}
            className={cn("l4-canvasStack", revivePhase !== "idle" && "is-recoiling")}
            style={{ ["--l4-descent-progress" as any]: String(descentProgress) }}
          >
            <div className="l4-ceilingSpacer" aria-hidden />
            <div
              className={cn("l4-boardStage", boardTone)}
              style={{ backgroundImage: `url(${boardPng})` }}
            >
            {showDebugZones && (
              <>
                <div
                  className="l4-debugZone"
                  style={{ top: 0, height: "32%", borderBottom: "2px dashed rgba(255,0,0,.6)" }}
                  data-zone="overlay-safe (0-32%)"
                />
                <div
                  className="l4-debugZone"
                  style={{
                    top: "32%",
                    bottom: "22%",
                    borderTop: "2px dashed rgba(0,255,0,.6)",
                    borderBottom: "2px dashed rgba(0,255,0,.6)",
                  }}
                  data-zone="avatar-band (32-78%)"
                />
                <div
                  className="l4-debugZone"
                  style={{ bottom: 0, height: "22%", borderTop: "2px dashed rgba(0,120,255,.6)" }}
                  data-zone="badge-zone (78-100%)"
                />
              </>
            )}

            <div className="l4-marketOverlay">
              <div className="l4-overlayRow1">MARKET HOLE DETECTED: PANTS ALTERATIONS</div>
              <div className="l4-overlayRow2">+400% ZIPPER REPAIR SEARCHES WITHIN 3 MILES</div>
              <div className="l4-overlayRow3">Impending hope of bought house and marriage</div>
            </div>

            <div
              className={cn(
                "l4-avatarLayer",
                gamePhase === "descent" && "is-threat",
                gamePhase === "impact" && "is-impact"
              )}
              aria-hidden
            >
              <img
                src={manFigure}
                alt=""
                className={cn("l4-figure l4-figureMan", gamePhase === "impact" && "is-crush")}
                draggable={false}
              />
              <img
                src={womanFigure}
                alt=""
                className={cn("l4-figure l4-figureWoman", gamePhase === "impact" && "is-crush")}
                draggable={false}
              />
            </div>

            <div className="l4-youAreHere" aria-hidden>
              YOU ARE HERE
            </div>

            <div
              className="l4-vignette"
              style={{ opacity: vignetteOpacity }}
              aria-hidden
            />

            {gamePhase === "impact" && (
              <>
                <div className="l4-eyeCensor" aria-hidden>
                  [ SIGNAL LOST ]
                </div>
                <div className="l4-impactOverlay" role="alert" aria-live="assertive">
                  <div className="l4-impactOverlayInner">
                    <span className="l4-impactTitle">EXTRACTION FAILED // CYCLE BROKEN</span>
                    <span className="l4-impactSub">Use REVIVE on the active lane to reset the threat.</span>
                  </div>
                </div>
              </>
            )}
          </div>

            <div className="l4-ceilingCrusher" aria-hidden>
              <div
                className={cn(
                  "l4-ceiling",
                  wallVisual === "top" && "is-wall-top",
                  wallVisual === "descending" && "is-wall-descending",
                  wallVisual === "bottomed" && "is-wall-bottomed",
                  wallVisual === "resetting" && "is-wall-resetting",
                  descentPaused && wallVisual === "descending" && "is-descent-paused"
                )}
              >
                <div className="l4-ceilingBar is-spikey-bar">
                  <p className={cn("l4-threatText", gamePhase === "impact" && "is-impact")}>
                    {gamePhase === "impact"
                      ? "Impact. The future is crushed unless you revive."
                      : "Stagnation will be the death of you."}
                  </p>
                  <svg
                    className="l4-ceilingSpikeStrip"
                    viewBox="0 0 240 20"
                    preserveAspectRatio="none"
                    aria-hidden
                  >
                    <defs>
                      <linearGradient id={spikeGradientId} x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#8a8580" />
                        <stop offset="25%" stopColor="#4a4542" />
                        <stop offset="55%" stopColor="#1f1c1a" />
                        <stop offset="100%" stopColor="#0a0908" />
                      </linearGradient>
                    </defs>
                    <path
                      d={L4_SPIKE_PATH}
                      fill={`url(#${spikeGradientId})`}
                      stroke="rgba(0,0,0,0.65)"
                      strokeWidth="0.35"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </main>

        <aside className="l4-panel l4-right">
          <div className="l4-mapHeader">
            <div className="l4-mapTitle">The Empire - Always-on Map</div>
            <div className="l4-mapHamburger" aria-hidden>
              ☰
            </div>
          </div>

          <div className="l4-map">
            <div className="l4-mapBg" aria-hidden />
            <svg className="l4-mapLines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              <path d="M22,18 L58,44 L74,70" className="l4-mapLine" />
            </svg>
            <div className="l4-mapNodes">
              {MAP_NODES.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={cn(
                    "l4-node",
                    n.tone === "captured" && "is-captured",
                    n.tone === "director" && "is-director",
                    n.tone === "general" && "is-general",
                    selectedNodeId === n.id && "is-selected"
                  )}
                  style={
                    n.id === "opus"
                      ? { left: "20%", top: "16%" }
                      : n.id === "century"
                        ? { left: "60%", top: "44%" }
                        : { left: "72%", top: "72%" }
                  }
                  onClick={() => setSelectedNodeId(n.id)}
                >
                  <span className="l4-nodeDot" aria-hidden />
                  <span className="l4-nodeLabel">{n.label}</span>
                  <span className="l4-nodeSub">{n.sublabel}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="l4-dossier">
            <div className="l4-dossierHeader">{dossier.header}</div>
            <div className="l4-dossierState">{dossier.stateLabel}</div>
            <div className="l4-dossierBody">
              <div className="l4-dossierRow">
                <span className="k">PROFILE:</span> {dossier.profile}
              </div>
              <div className="l4-dossierRow">
                <span className="k">WEDGE:</span> {dossier.wedge}
              </div>
              <div className="l4-dossierRow">
                <span className="k">VECTOR:</span> {dossier.vector}
              </div>
            </div>
            <button type="button" className="l4-dossierCta">
              [ {dossier.cta} ]
            </button>
          </div>

          <div className="l4-keepInFrame">
            <div className="l4-keepTitle">KEEP IN FRAME: →</div>
            <div className="l4-keepBody">
              Consolidated "KEEP IN FRAME" notes. Pre populated with original text.
            </div>
          </div>
        </aside>
      </div>

      <div className="l4-ritual">
        <div
          ref={lane1Ref}
          className={cn(
            "l4-lane",
            activeLane === 1 && !completedLanes[1] && "is-primary",
            lane1Pulse && "is-pulse",
            laneUrgency(1)
          )}
          data-lane="1"
        >
          <div className="l4-laneHead">
            <div>
              <div className="l4-laneTitle">{lane1Title ?? "LANE 1 | FAST CASH | Rainy Day Valet SMS"}</div>
              <div className="l4-laneBody">{lane1Body ?? "It is pouring. Solve Los Feliz High-rise inconvenience."}</div>
            </div>
            <button
              type="button"
              className={cn(
                "l4-laneCta",
                gamePhase === "impact" && activeLane === 1 && !completedLanes[1]
                  ? "is-revive"
                  : activeLane === 1 && !completedLanes[1]
                    ? "is-green"
                    : "is-dim",
                ctaErrorLane === 1 && "is-error"
              )}
              onClick={() => void tryCompleteLane(1)}
            >
              {completedLanes[1]
                ? "DONE ✓"
                : ctaWaitLane === 1
                  ? "WAIT —"
                  : ctaErrorLane === 1
                    ? "RETRY →"
                    : gamePhase === "impact" && activeLane === 1
                      ? "[ REVIVE / EXECUTE ]"
                      : (lane1CtaLabel ?? "DEPLOY SMS →")}
            </button>
          </div>
        </div>

        <div
          className={cn(
            "l4-lane",
            activeLane === 2 && !completedLanes[2] && "is-primary",
            laneUrgency(2)
          )}
          data-lane="2"
        >
          <div className="l4-laneHead">
            <div>
              <div className="l4-laneTitle">{lane2Title ?? "LANE 2 | COMPOUNDING | Concierge Opt-In"}</div>
              <div className="l4-laneBody">{lane2Body ?? "Scale retention. Insert into intake flow."}</div>
            </div>
            <button
              type="button"
              disabled={lane2Disabled}
              className={cn(
                "l4-laneCta",
                gamePhase === "impact" && activeLane === 2 && !completedLanes[2]
                  ? "is-revive"
                  : activeLane === 2 && !completedLanes[2]
                    ? "is-green"
                    : "is-dim",
                ctaErrorLane === 2 && "is-error",
                lane2Disabled && "is-disabled"
              )}
              onClick={() => {
                if (lane2Disabled) return;
                void tryCompleteLane(2);
              }}
            >
              {completedLanes[2]
                ? "DONE ✓"
                : ctaWaitLane === 2
                  ? "WAIT —"
                  : ctaErrorLane === 2
                    ? "RETRY →"
                    : gamePhase === "impact" && activeLane === 2
                      ? "[ REVIVE / EXECUTE ]"
                      : (lane2CtaLabel ?? "INTEGRATE STEP →")}
            </button>
          </div>
        </div>

        <div className={cn("l4-lane", activeLane === 3 && !completedLanes[3] && "is-primary", laneUrgency(3))} data-lane="3">
          <div className="l4-laneHead">
            <div>
              <div className="l4-laneTitle">{lane3Title ?? "LANE 3 | EXPANSION | The Beaudry"}</div>
              <div className="l4-laneBody">{lane3Body ?? "Capture new tower target. 64-story luxury high-rise."}</div>
              {lane3Stubbed && (
                <div className="l4-laneStub" style={{ fontSize: "10px", fontFamily: "monospace", opacity: 0.7, marginTop: "4px" }}>
                  BLOCK C — stubbed for v1. No live intel; deploy logs an acknowledgement only.
                </div>
              )}
            </div>
            <button
              type="button"
              className={cn(
                "l4-laneCta",
                gamePhase === "impact" && activeLane === 3 && !completedLanes[3]
                  ? "is-revive"
                  : activeLane === 3 && !completedLanes[3]
                    ? "is-green"
                    : "is-dim",
                ctaErrorLane === 3 && "is-error"
              )}
              onClick={() => void tryCompleteLane(3)}
            >
              {completedLanes[3]
                ? "DONE ✓"
                : ctaWaitLane === 3
                  ? "WAIT —"
                  : ctaErrorLane === 3
                    ? "RETRY →"
                    : gamePhase === "impact" && activeLane === 3
                      ? "[ REVIVE / EXECUTE ]"
                      : (lane3CtaLabel ?? (lane3Stubbed ? "ACKNOWLEDGE STUB →" : "GENERATE FLYER →"))}
            </button>
          </div>
        </div>

        <div className="l4-ticker">MUTED TEXT TICKER</div>
        <div className="l4-diamond" aria-hidden>
          ◆
        </div>
      </div>

      {/* Section-level payoff overlays — lifted OUT of .l4-boardStage so they are not
          clipped by its overflow/filter stacking context and so they paint over the
          closing Radix dialog backdrop during a successful deploy. position: fixed
          guarantees full-viewport coverage regardless of scroll or ancestor overflow. */}
      {revivePhase === "flash" && <div className="l4-reviveFlashLayer" aria-hidden />}
      {revivePhase === "stamp" && (
        <div className="l4-reviveStampLayer" role="status" aria-live="polite">
          <div className="l4-reviveStampInner">[ THREAT NEUTRALIZED ]</div>
          <div className="l4-reviveStampSub">target secured · future reclaimed</div>
        </div>
      )}

      {/* Discreet footer trigger — double-chevron matches the tactical chrome. */}
      <button
        type="button"
        className="l4-simTrigger"
        aria-label="Open Simulation Override (Shift+D)"
        onClick={() => setSimOpen((v) => !v)}
      >
        ⌖⌖
      </button>

      {simOpen && (
        <SimulationOverride
          onClose={() => setSimOpen(false)}
          gamePhase={gamePhase}
          forcedPhase={forcedPhase}
          workHoursOverride={workHoursOverride}
          workHoursActive={workHoursActive}
          fastFactor={fastFactor}
          structuralIntegrity={structuralIntegrity}
          idleMs={idleMs}
          syntheticLane2Active={syntheticLane2Active}
          onForcePhase={forcePhase}
          onForceRevive={forceRevive}
          onSetWorkHoursOverride={setWorkHoursOverride}
          onSetFastFactor={setFastFactor}
          onResetCycle={resetCycle}
          onInjectSyntheticLane2={onInjectSyntheticLane2}
          onResetSyntheticLane2={onResetSyntheticLane2}
        />
      )}
    </section>
  );
});

type SimulationOverrideProps = {
  onClose: () => void;
  gamePhase: GamePhase;
  forcedPhase: GamePhase | null;
  workHoursOverride: "auto" | "on" | "off";
  workHoursActive: boolean;
  fastFactor: number;
  structuralIntegrity: number;
  idleMs: number;
  syntheticLane2Active: boolean;
  onForcePhase: (phase: GamePhase | null) => void;
  onForceRevive: () => void;
  onSetWorkHoursOverride: (mode: "auto" | "on" | "off") => void;
  onSetFastFactor: (factor: number) => void;
  onResetCycle: () => void;
  onInjectSyntheticLane2?: () => void;
  onResetSyntheticLane2?: () => void;
};

function SimulationOverride(p: SimulationOverrideProps) {
  const idleSeconds = Math.floor(p.idleMs / 1000);
  return (
    <div className="l4-simOverride" role="dialog" aria-label="Simulation Override">
      <div className="l4-simOverridePanel">
        <div className="l4-simOverrideHead">
          <span className="l4-simOverrideTitle">[ SIMULATION OVERRIDE ]</span>
          <span className="l4-simOverrideSub">gameplay verification // no db writes</span>
          <button
            type="button"
            className="l4-simOverrideClose"
            onClick={p.onClose}
            aria-label="Close override (Esc)"
          >
            ×
          </button>
        </div>

        <div className="l4-simOverrideReadout">
          <span>PHASE:</span>
          <span className="l4-simOverrideValue">
            {p.gamePhase.toUpperCase()}
            {p.forcedPhase !== null ? " (PINNED)" : ""}
          </span>
          <span>HOURS:</span>
          <span className="l4-simOverrideValue">
            {p.workHoursActive ? "IN-HOURS" : "OFF-HOURS"} ·{" "}
            {p.workHoursOverride === "auto" ? "auto" : p.workHoursOverride === "on" ? "forced on" : "forced off"}
          </span>
          <span>SPEED:</span>
          <span className="l4-simOverrideValue">{p.fastFactor}× · idle {idleSeconds}s</span>
          <span>INTEG:</span>
          <span className="l4-simOverrideValue">{p.structuralIntegrity.toFixed(3)}%</span>
        </div>

        <div className="l4-simOverrideSection">
          <div className="l4-simOverrideSectionLabel">FORCE PHASE</div>
          <div className="l4-simOverrideBtnRow">
            <button type="button" className="l4-simOverrideBtn" onClick={() => p.onForcePhase("calm")}>
              [ FORCE: CALM ]
            </button>
            <button type="button" className="l4-simOverrideBtn" onClick={() => p.onForcePhase("descent")}>
              [ FORCE: THREAT ]
            </button>
            <button type="button" className="l4-simOverrideBtn is-warn" onClick={() => p.onForcePhase("impact")}>
              [ FORCE: IMPACT ]
            </button>
            <button type="button" className="l4-simOverrideBtn is-good" onClick={p.onForceRevive}>
              [ FORCE: REVIVE ]
            </button>
            {p.forcedPhase !== null && (
              <button type="button" className="l4-simOverrideBtn is-ghost" onClick={() => p.onForcePhase(null)}>
                [ UNPIN PHASE ]
              </button>
            )}
          </div>
        </div>

        <div className="l4-simOverrideSection">
          <div className="l4-simOverrideSectionLabel">WORK-HOURS</div>
          <div className="l4-simOverrideBtnRow">
            <button
              type="button"
              className={cn("l4-simOverrideBtn", p.workHoursOverride === "on" && "is-active")}
              onClick={() => p.onSetWorkHoursOverride("on")}
            >
              [ TOGGLE: WORK-HOURS ]
            </button>
            <button
              type="button"
              className={cn("l4-simOverrideBtn", p.workHoursOverride === "off" && "is-active")}
              onClick={() => p.onSetWorkHoursOverride("off")}
            >
              [ TOGGLE: OFF-HOURS ]
            </button>
            <button
              type="button"
              className={cn("l4-simOverrideBtn is-ghost", p.workHoursOverride === "auto" && "is-active")}
              onClick={() => p.onSetWorkHoursOverride("auto")}
            >
              [ AUTO: REAL CLOCK ]
            </button>
          </div>
        </div>

        <div className="l4-simOverrideSection">
          <div className="l4-simOverrideSectionLabel">TIME</div>
          <div className="l4-simOverrideBtnRow">
            <button
              type="button"
              className={cn("l4-simOverrideBtn", p.fastFactor === 100 && "is-active")}
              onClick={() => p.onSetFastFactor(100)}
            >
              [ ACCELERATE TIME: 100× ]
            </button>
            <button
              type="button"
              className={cn("l4-simOverrideBtn is-ghost", p.fastFactor === 1 && "is-active")}
              onClick={() => p.onSetFastFactor(1)}
            >
              [ REAL TIME: 1× ]
            </button>
          </div>
        </div>

        <div className="l4-simOverrideSection">
          <div className="l4-simOverrideSectionLabel">LANES & REPLAY</div>
          <div className="l4-simOverrideBtnRow">
            <button type="button" className="l4-simOverrideBtn is-warn" onClick={p.onResetCycle}>
              [ RESET LEVEL 4 CYCLE ]
            </button>
            {p.onInjectSyntheticLane2 && !p.syntheticLane2Active && (
              <button type="button" className="l4-simOverrideBtn" onClick={p.onInjectSyntheticLane2}>
                [ INJECT SYNTHETIC LANE 2 ]
              </button>
            )}
            {p.onResetSyntheticLane2 && p.syntheticLane2Active && (
              <button type="button" className="l4-simOverrideBtn is-ghost" onClick={p.onResetSyntheticLane2}>
                [ CLEAR SYNTHETIC LANE 2 ]
              </button>
            )}
          </div>
        </div>

        <div className="l4-simOverrideFootnote">
          client-only · no db writes · resets do not reverse logged admin_action_log rows · esc or shift+d to close
        </div>
      </div>
    </div>
  );
}
