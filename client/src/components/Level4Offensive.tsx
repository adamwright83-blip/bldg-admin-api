import {
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

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
 * Level 4 game loop (aligned with working Google AI Studio flow):
 * calm → descent → impact (fail) → revive → calm, or CTA success during calm/descent → resetting → calm|victory.
 */
type GamePhase = "calm" | "descent" | "impact" | "victory" | "resetting";

/** Maps phase → existing ceiling CSS states (no layout/CSS rewrites). */
function wallVisualFromPhase(phase: GamePhase): "top" | "descending" | "bottomed" | "resetting" {
  if (phase === "resetting") return "resetting";
  if (phase === "descent") return "descending";
  if (phase === "impact") return "bottomed";
  return "top";
}

/** Tuned so a full lane cycle fits ~20–25s — impact is reachable without a 30s+ wait. */
const L4_CALM_LANE1_MS = 6_000;
const L4_CALM_LANE23_MS = 5_000;
const L4_DESCENT_DURATION_MS = 14_000;
const L4_WALL_RESET_SNAP_MS = 420;
const L4_FAILURE_PAUSE_MS = 3_000;

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
};

export function Level4Offensive({
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
}: Level4OffensiveProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<MapNodeId>("beaudry");
  const [completedLanes, setCompletedLanes] = useState<Record<LaneId, boolean>>({
    1: false,
    2: false,
    3: false,
  });
  const [gamePhase, setGamePhase] = useState<GamePhase>("calm");
  const [cycleNonce, setCycleNonce] = useState(0);
  const [lane1Pulse, setLane1Pulse] = useState(false);
  const [ctaErrorLane, setCtaErrorLane] = useState<LaneId | null>(null);
  /** Unwired deploy lane clicked during calm — must wait for threat to arm (descent). */
  const [ctaWaitLane, setCtaWaitLane] = useState<LaneId | null>(null);
  const [descentPaused, setDescentPaused] = useState(false);

  const timersRef = useRef<number[]>([]);
  const canvasStackRef = useRef<HTMLDivElement | null>(null);
  const lane1Ref = useRef<HTMLDivElement | null>(null);
  const resetInFlightRef = useRef(false);
  const descentPausedRef = useRef(false);
  /** Wall hits impact at this time (ms since epoch); extended when descent is paused for deploy failure. */
  const impactDeadlineRef = useRef<number | null>(null);

  descentPausedRef.current = descentPaused;
  const wallVisual = wallVisualFromPhase(gamePhase);
  const spikeGradientId = `l4-spike-metal-${useId().replace(/:/g, "")}`;

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

  /** Parent can flag L1 done; never merge while wall reset timers are in flight. */
  useEffect(() => {
    if (!lane1Executed) return;
    setCompletedLanes((p) => {
      if (p[1]) return p;
      if (resetInFlightRef.current) return p;
      return { ...p, 1: true };
    });
  }, [lane1Executed]);

  useEffect(() => {
    if (gamePhase === "descent") setCtaWaitLane(null);
  }, [gamePhase]);

  /** Primary game loop: calm → descent (timer), descent → impact (deadline), victory freezes the loop. */
  useEffect(() => {
    if (resetInFlightRef.current) return;
    clearTimers();

    if (allLanesCleared(completedLanes)) {
      setGamePhase("victory");
      impactDeadlineRef.current = null;
      return clearTimers;
    }

    if (activeLane === null) {
      return clearTimers;
    }

    if (gamePhase === "victory" || gamePhase === "resetting" || gamePhase === "impact") {
      return clearTimers;
    }

    if (gamePhase === "calm") {
      const calmMs = activeLane === 1 ? L4_CALM_LANE1_MS : L4_CALM_LANE23_MS;
      schedule(() => {
        if (resetInFlightRef.current) return;
        impactDeadlineRef.current = Date.now() + L4_DESCENT_DURATION_MS;
        setGamePhase("descent");
      }, calmMs);
      return clearTimers;
    }

    if (gamePhase === "descent") {
      if (descentPaused) {
        return clearTimers;
      }
      const deadline = impactDeadlineRef.current ?? Date.now() + L4_DESCENT_DURATION_MS;
      if (!impactDeadlineRef.current) {
        impactDeadlineRef.current = deadline;
      }
      const remaining = Math.max(0, impactDeadlineRef.current - Date.now());
      schedule(() => {
        if (resetInFlightRef.current || descentPausedRef.current) return;
        setGamePhase("impact");
      }, remaining);
      return clearTimers;
    }

    return clearTimers;
  }, [gamePhase, activeLane, cycleNonce, completedLanes, descentPaused, clearTimers, schedule]);

  const runWallResetAfterSuccess = useCallback(
    (lane: LaneId) => {
      resetInFlightRef.current = true;
      clearTimers();
      setDescentPaused(false);
      impactDeadlineRef.current = null;
      setGamePhase("resetting");
      schedule(() => {
        setCompletedLanes((p) => {
          const next = { ...p, [lane]: true };
          const allDone = next[1] && next[2] && next[3];
          setGamePhase(allDone ? "victory" : "calm");
          resetInFlightRef.current = false;
          setCycleNonce((n) => n + 1);
          return next;
        });
      }, L4_WALL_RESET_SNAP_MS);
    },
    [clearTimers, schedule]
  );

  async function tryCompleteLane(lane: LaneId) {
    if (activeLane !== lane) return;
    if (resetInFlightRef.current) return;
    if (gamePhase === "resetting") return;

    if (gamePhase === "impact") {
      clearTimers();
      impactDeadlineRef.current = null;
      setDescentPaused(false);
      setCtaErrorLane(null);
      setGamePhase("calm");
      setCycleNonce((n) => n + 1);
      return;
    }

    if (gamePhase !== "calm" && gamePhase !== "descent") return;

    const fn = lane === 1 ? onDeployLane1 : lane === 2 ? onDeployLane2 : onDeployLane3;

    // No deploy hook: do not allow a silent one-click clear during calm (that made L2/L3 feel like no game).
    if (!fn) {
      if (gamePhase === "calm") {
        setCtaWaitLane(lane);
        window.setTimeout(() => setCtaWaitLane(null), 1_400);
        return;
      }
      runWallResetAfterSuccess(lane);
      return;
    }

    const ok = await resolveDeploy(fn);
    if (!ok) {
      setCtaErrorLane(lane);
      window.setTimeout(() => setCtaErrorLane(null), L4_FAILURE_PAUSE_MS);
      setDescentPaused(true);
      impactDeadlineRef.current =
        (impactDeadlineRef.current ?? Date.now() + L4_DESCENT_DURATION_MS) + L4_FAILURE_PAUSE_MS;
      window.setTimeout(() => setDescentPaused(false), L4_FAILURE_PAUSE_MS);
      return;
    }

    setCtaErrorLane(null);
    runWallResetAfterSuccess(lane);
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
        "--l4-descent-duration": `${L4_DESCENT_DURATION_MS}ms`,
        "--l4-wall-reset": `${L4_WALL_RESET_SNAP_MS}ms`,
        "--l4-wall-drop": `${L4_WALL_DROP_MAX_PX}px`,
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

  const ceilingStatusLabel =
    gamePhase === "calm"
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
                {gamePhase === "resetting" ? "↑" : "↓"}
              </span>
              <span className="l4-ceilingBadgeLabel">CEILING STATUS:</span>
              <span className="l4-ceilingBadgeValue">{ceilingStatusLabel}</span>
            </div>
          </div>

          <div ref={canvasStackRef} className="l4-canvasStack">
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

            <div className="l4-avatarLayer" aria-hidden>
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

            {gamePhase === "impact" && (
              <div className="l4-impactOverlay" role="alert" aria-live="assertive">
                <div className="l4-impactOverlayInner">
                  <span className="l4-impactTitle">IMPACT</span>
                  <span className="l4-impactSub">Use REVIVE on the active lane to reset the threat.</span>
                </div>
              </div>
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
                      ? "REVIVE →"
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
                      ? "REVIVE →"
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
                      ? "REVIVE →"
                      : (lane3CtaLabel ?? (lane3Stubbed ? "ACKNOWLEDGE STUB →" : "GENERATE FLYER →"))}
            </button>
          </div>
        </div>

        <div className="l4-ticker">MUTED TEXT TICKER</div>
        <div className="l4-diamond" aria-hidden>
          ◆
        </div>
      </div>
    </section>
  );
}
