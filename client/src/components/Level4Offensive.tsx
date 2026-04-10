import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
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

type CeilingState = "idle" | "failure" | "success";
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

export type Level4OffensiveProps = {
  className?: string;
  soberDays?: number;
  debtCents?: number;
  recoveredTodayCents?: number;
  onDeployLane1?: () => void;
  lane1Executed?: boolean;
};

export function Level4Offensive({
  className,
  soberDays = 2114,
  onDeployLane1,
  lane1Executed = false,
}: Level4OffensiveProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<MapNodeId>("beaudry");
  const [ceilingState, setCeilingState] = useState<CeilingState>("idle");
  const [lane1Pulse, setLane1Pulse] = useState(false);
  const [lane2Primary, setLane2Primary] = useState(false);

  const deadlineMs = 20_000;
  const failureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lane1Ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCeilingState("idle");
    setLane2Primary(false);
    setLane1Pulse(false);
    if (failureTimerRef.current) clearTimeout(failureTimerRef.current);
    failureTimerRef.current = setTimeout(() => {
      setCeilingState((s) => (s === "success" ? s : "failure"));
    }, deadlineMs);
    return () => {
      if (failureTimerRef.current) clearTimeout(failureTimerRef.current);
      failureTimerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!lane1Executed) return;
    setCeilingState("success");
    setLane2Primary(true);
    if (failureTimerRef.current) {
      clearTimeout(failureTimerRef.current);
      failureTimerRef.current = null;
    }
  }, [lane1Executed]);

  function scrollToLane1() {
    lane1Ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setLane1Pulse(true);
    window.setTimeout(() => setLane1Pulse(false), 1400);
  }

  function executeLane1() {
    setCeilingState("success");
    setLane2Primary(true);
    if (failureTimerRef.current) {
      clearTimeout(failureTimerRef.current);
      failureTimerRef.current = null;
    }
    onDeployLane1?.();
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

  return (
    <section className={cn("l4-root", className)} style={textureVars}>
      {/* GLOBAL TOP BANNER (outside 3-column split) */}
      <header className="l4-topBanner">
        <div className="l4-topBannerInner">
          <div className="l4-topTitle">Three buildings away from a different life.</div>
          <div className="l4-topSubtitle">Every action today moves you closer or keeps where you are.</div>
        </div>
      </header>

      {/* 3-COLUMN GRID */}
      <div className="l4-grid">
        {/* LEFT SIDEBAR */}
        <aside className="l4-panel l4-left">
          <nav className="l4-nav">
            {(["ORDERS", "CUSTOMERS", "LEADS", "SETTINGS"] as const).map((label) => (
              <button key={label} type="button" className="l4-navBtn">
                <span className="l4-navCheck" aria-hidden>✓</span>
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

        {/* CENTER CANVAS — 3 explicit vertical regions, no free-floating overlap */}
        <main className="l4-canvas">
          {/* REGION 1: ThreatCeiling — top strip */}
          <div className="l4-threatCeiling">
            <div className="l4-ceilingBadge">
              <span className="l4-ceilingBadgeIcon" aria-hidden>↓</span>
              <span className="l4-ceilingBadgeLabel">CEILING STATUS:</span>
              <span className="l4-ceilingBadgeValue">DESCENDING</span>
            </div>
            <div
              className={cn(
                "l4-ceiling",
                ceilingState === "idle" && "is-idle",
                ceilingState === "failure" && "is-failure",
                ceilingState === "success" && "is-success"
              )}
            >
              <div className="l4-ceilingBar">
                <p className="l4-threatText">Stagnation will be the death of you.</p>
              </div>
            </div>
          </div>

          {/* REGION 2: BoardStage — image + overlays in fixed aspect box */}
          <div className="l4-boardStage" style={{ backgroundImage: `url(${boardPng})` }}>
            {showDebugZones && (
              <>
                <div className="l4-debugZone" style={{ top: 0, height: '32%', borderBottom: '2px dashed rgba(255,0,0,.6)' }} data-zone="overlay-safe (0-32%)" />
                <div className="l4-debugZone" style={{ top: '32%', bottom: '22%', borderTop: '2px dashed rgba(0,255,0,.6)', borderBottom: '2px dashed rgba(0,255,0,.6)' }} data-zone="avatar-band (32-78%)" />
                <div className="l4-debugZone" style={{ bottom: 0, height: '22%', borderTop: '2px dashed rgba(0,120,255,.6)' }} data-zone="badge-zone (78-100%)" />
              </>
            )}

            {/* Layer 1: Market hole overlay — top zone of board */}
            <div className="l4-marketOverlay">
              <div className="l4-overlayTitle">**MARKET HOLE DETECTED: Pants Alterations**</div>
              <div className="l4-overlayValue">+400% ZIPPERS SEARCH 3mi.</div>
              <div className="l4-overlaySub">Impending Hope of bought house and marige</div>
            </div>

            {/* Layer 2: Avatar figures — middle zone of board */}
            <div className="l4-avatarLayer" aria-hidden>
              <img
                src={manFigure}
                alt=""
                className={cn(
                  "l4-figure l4-figureMan",
                  ceilingState === "failure" && "is-crush",
                  ceilingState === "success" && "is-merge"
                )}
                draggable={false}
              />
              <img
                src={womanFigure}
                alt=""
                className={cn(
                  "l4-figure l4-figureWoman",
                  ceilingState === "failure" && "is-crush",
                  ceilingState === "success" && "is-merge"
                )}
                draggable={false}
              />
            </div>

            {/* Layer 3: YOU ARE HERE badge — bottom zone of board */}
            <div className="l4-youAreHere" aria-hidden>YOU ARE HERE</div>
          </div>
        </main>

        {/* RIGHT SIDEBAR */}
        <aside className="l4-panel l4-right">
          <div className="l4-mapHeader">
            <div className="l4-mapTitle">The Empire - Always-on Map</div>
            <div className="l4-mapHamburger" aria-hidden>☰</div>
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
              <div className="l4-dossierRow"><span className="k">PROFILE:</span> {dossier.profile}</div>
              <div className="l4-dossierRow"><span className="k">WEDGE:</span> {dossier.wedge}</div>
              <div className="l4-dossierRow"><span className="k">VECTOR:</span> {dossier.vector}</div>
            </div>
            <button type="button" className="l4-dossierCta">[ {dossier.cta} ]</button>
          </div>

          <div className="l4-keepInFrame">
            <div className="l4-keepTitle">KEEP IN FRAME: →</div>
            <div className="l4-keepBody">Consolidated "KEEP IN FRAME" notes. Pre populated with original text.</div>
          </div>
        </aside>
      </div>

      {/* LANE STACK — full width below the grid */}
      <div className="l4-ritual">
        <div ref={lane1Ref} className={cn("l4-lane is-primary", lane1Pulse && "is-pulse")} data-lane="1">
          <div className="l4-laneHead">
            <div>
              <div className="l4-laneTitle">LANE 1 | FAST CASH | Rainy Day Valet SMS</div>
              <div className="l4-laneBody">It is pouring. Solve Los Feliz High-rise inconvenience.</div>
            </div>
            <button type="button" className="l4-laneCta is-green" onClick={executeLane1}>DEPLOY SMS →</button>
          </div>
        </div>

        <div className={cn("l4-lane", lane2Primary && "is-primaryNext")} data-lane="2">
          <div className="l4-laneHead">
            <div>
              <div className="l4-laneTitle">LANE 2 | COMPOUNDING | Concierge Opt-In</div>
              <div className="l4-laneBody">Scale retention Insert into intake flow.</div>
            </div>
            <button type="button" className="l4-laneCta is-dim">INTEGRATE STEP →</button>
          </div>
        </div>

        <div className="l4-lane" data-lane="3">
          <div className="l4-laneHead">
            <div>
              <div className="l4-laneTitle">LANE 3 | EXPANSION | The Beaudry</div>
              <div className="l4-laneBody">Capture new tower target. 64-story luxury high-rise.</div>
            </div>
            <button type="button" className="l4-laneCta is-dim">GENERATE FLYER →</button>
          </div>
        </div>

        <div className="l4-ticker">MUTED TEXT TICKER</div>
        <div className="l4-diamond" aria-hidden>◆</div>
      </div>
    </section>
  );
}
