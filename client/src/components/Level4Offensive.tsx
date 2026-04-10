import { type CSSProperties, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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
/** Spikey wall only — never a smooth bar. */
type WallState = "top" | "descending" | "bottomed" | "resetting";

const L4_CALM_LANE1_MS = 10_000;
const L4_CALM_LANE23_MS = 8_000;
const L4_DESCENT_DURATION_MS = 20_000;
const L4_WALL_RESET_SNAP_MS = 420;
const L4_FAILURE_PAUSE_MS = 3_000;

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
};

export function Level4Offensive({
  className,
  soberDays = 2114,
  onDeployLane1,
  onDeployLane2,
  onDeployLane3,
  lane1Executed = false,
}: Level4OffensiveProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<MapNodeId>("beaudry");
  const [completedLanes, setCompletedLanes] = useState<Record<LaneId, boolean>>({
    1: false,
    2: false,
    3: false,
  });
  const [wallState, setWallState] = useState<WallState>("top");
  const [cycleNonce, setCycleNonce] = useState(0);
  const [lane1Pulse, setLane1Pulse] = useState(false);
  const [ctaErrorLane, setCtaErrorLane] = useState<LaneId | null>(null);
  const [descentPaused, setDescentPaused] = useState(false);

  const timersRef = useRef<number[]>([]);
  const lane1Ref = useRef<HTMLDivElement | null>(null);
  const resetInFlightRef = useRef(false);
  const descentPausedRef = useRef(false);

  descentPausedRef.current = descentPaused;
  const spikeGradientId = `l4-spike-metal-${useId().replace(/:/g, "")}`;

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
    if (resetInFlightRef.current) {
      return;
    }

    clearTimers();

    const nothingLeft = activeLane === null || allLanesCleared(completedLanes);
    if (nothingLeft) {
      setWallState("top");
      return;
    }

    const calmMs = activeLane === 1 ? L4_CALM_LANE1_MS : L4_CALM_LANE23_MS;
    setWallState("top");

    schedule(() => {
      if (resetInFlightRef.current) return;
      setWallState((p) => (p === "top" ? "descending" : p));
    }, calmMs);

    return clearTimers;
  }, [activeLane, cycleNonce, clearTimers, schedule]);

  const runWallResetAfterSuccess = useCallback(
    (lane: LaneId) => {
      resetInFlightRef.current = true;
      clearTimers();
      setDescentPaused(false);
      setWallState("resetting");
      schedule(() => {
        setCompletedLanes((p) => ({ ...p, [lane]: true }));
        setWallState("top");
        resetInFlightRef.current = false;
        setCycleNonce((n) => n + 1);
      }, L4_WALL_RESET_SNAP_MS);
    },
    [clearTimers, schedule]
  );

  async function tryCompleteLane(lane: LaneId) {
    if (activeLane !== lane) return;
    if (resetInFlightRef.current) return;
    if (wallState === "resetting") return;

    const fn = lane === 1 ? onDeployLane1 : lane === 2 ? onDeployLane2 : onDeployLane3;
    const ok = await resolveDeploy(fn);
    if (!ok) {
      setCtaErrorLane(lane);
      window.setTimeout(() => setCtaErrorLane(null), L4_FAILURE_PAUSE_MS);
      setDescentPaused(true);
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
        "--l4-wall-drop": "380px",
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
    wallState === "top"
      ? "TOP"
      : wallState === "descending"
        ? "DESCENDING"
        : wallState === "bottomed"
          ? "BOTTOMED"
          : "RESET";

  const boardTone = "is-board-warm";

  const laneUrgency = (lane: LaneId) => {
    if (activeLane !== lane) return "";
    if (wallState === "bottomed") return "is-cta-max";
    if (wallState === "descending") return "is-cta-urgent";
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

        <main className="l4-canvas">
          <div className="l4-threatCeiling">
            <div className="l4-ceilingBadge">
              <span className="l4-ceilingBadgeIcon" aria-hidden>
                {wallState === "resetting" ? "↑" : "↓"}
              </span>
              <span className="l4-ceilingBadgeLabel">CEILING STATUS:</span>
              <span className="l4-ceilingBadgeValue">{ceilingStatusLabel}</span>
            </div>
            <div
              className={cn(
                "l4-ceiling",
                wallState === "top" && "is-wall-top",
                wallState === "descending" && "is-wall-descending",
                wallState === "bottomed" && "is-wall-bottomed",
                wallState === "resetting" && "is-wall-resetting",
                descentPaused && wallState === "descending" && "is-descent-paused"
              )}
              onTransitionEnd={(e) => {
                if (e.propertyName !== "transform" || e.target !== e.currentTarget) return;
                if (resetInFlightRef.current || descentPausedRef.current) return;
                setWallState((p) => (p === "descending" ? "bottomed" : p));
              }}
            >
              <div className="l4-ceilingBar is-spikey-bar">
                <p className="l4-threatText">Stagnation will be the death of you.</p>
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
              <img src={manFigure} alt="" className="l4-figure l4-figureMan" draggable={false} />
              <img src={womanFigure} alt="" className="l4-figure l4-figureWoman" draggable={false} />
            </div>

            <div className="l4-youAreHere" aria-hidden>
              YOU ARE HERE
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
              <div className="l4-laneTitle">LANE 1 | FAST CASH | Rainy Day Valet SMS</div>
              <div className="l4-laneBody">It is pouring. Solve Los Feliz High-rise inconvenience.</div>
            </div>
            <button
              type="button"
              className={cn(
                "l4-laneCta",
                activeLane === 1 && !completedLanes[1] ? "is-green" : "is-dim",
                ctaErrorLane === 1 && "is-error"
              )}
              onClick={() => void tryCompleteLane(1)}
            >
              {ctaErrorLane === 1 ? "RETRY →" : completedLanes[1] ? "DONE ✓" : "DEPLOY SMS →"}
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
              <div className="l4-laneTitle">LANE 2 | COMPOUNDING | Concierge Opt-In</div>
              <div className="l4-laneBody">Scale retention. Insert into intake flow.</div>
            </div>
            <button
              type="button"
              className={cn(
                "l4-laneCta",
                activeLane === 2 && !completedLanes[2] ? "is-green" : "is-dim",
                ctaErrorLane === 2 && "is-error"
              )}
              onClick={() => void tryCompleteLane(2)}
            >
              {ctaErrorLane === 2 ? "RETRY →" : completedLanes[2] ? "DONE ✓" : "INTEGRATE STEP →"}
            </button>
          </div>
        </div>

        <div className={cn("l4-lane", activeLane === 3 && !completedLanes[3] && "is-primary", laneUrgency(3))} data-lane="3">
          <div className="l4-laneHead">
            <div>
              <div className="l4-laneTitle">LANE 3 | EXPANSION | The Beaudry</div>
              <div className="l4-laneBody">Capture new tower target. 64-story luxury high-rise.</div>
            </div>
            <button
              type="button"
              className={cn(
                "l4-laneCta",
                activeLane === 3 && !completedLanes[3] ? "is-green" : "is-dim",
                ctaErrorLane === 3 && "is-error"
              )}
              onClick={() => void tryCompleteLane(3)}
            >
              {ctaErrorLane === 3 ? "RETRY →" : completedLanes[3] ? "DONE ✓" : "GENERATE FLYER →"}
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
