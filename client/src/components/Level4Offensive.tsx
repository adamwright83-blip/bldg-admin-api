import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type LaneId = 1 | 2 | 3;
type CeilingState = "idle" | "failure" | "success";
type MapNodeId = "opus" | "century" | "beaudry";

const SOBER_DAYS = 2114;

type MapNode = {
  id: MapNodeId;
  label: string;
  type: "captured" | "target" | "expansion";
};

const MAP_NODES: MapNode[] = [
  { id: "opus", label: "Opus LA", type: "captured" },
  { id: "century", label: "Century Park East", type: "expansion" },
  { id: "beaudry", label: "The Beaudry", type: "target" },
];

const FIGURE_ASSETS = {
  man: "https://drive.google.com/uc?export=view&id=1b6xOQr_tUsQxMAiCpUtdPJ_T1Tlb1s2M",
  woman: "https://drive.google.com/uc?export=view&id=1R--qaD5bCyxszYYawSkwvDi_dYjNuCya",
} as const;

export function Level4Offensive({
  className,
}: {
  className?: string;
}) {
  const [activeSection, setActiveSection] = useState<"orders" | "customers" | "leads" | "settings">("orders");
  const [selectedNodeId, setSelectedNodeId] = useState<MapNodeId>("beaudry");
  const [ceilingState, setCeilingState] = useState<CeilingState>("idle");
  const [lane1Pulse, setLane1Pulse] = useState(false);
  const [lane2Primary, setLane2Primary] = useState(false);

  // Timer logic (native React timers, CSS transitions do the motion).
  const deadlineMs = 20_000;
  const startedAtRef = useRef<number>(Date.now());
  const failureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lane1Ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    startedAtRef.current = Date.now();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function scrollToLane1() {
    lane1Ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setLane1Pulse(true);
    window.setTimeout(() => setLane1Pulse(false), 1400);
  }

  function executeLane1() {
    setCeilingState("success");
    setLane2Primary(true);
    // visually suggest next action by pulsing Lane 2 after a beat
    window.setTimeout(() => setLane2Primary(true), 300);
  }

  const selectedNode = useMemo(() => MAP_NODES.find((n) => n.id === selectedNodeId)!, [selectedNodeId]);

  const dossier = useMemo(() => {
    if (selectedNode.id === "beaudry") {
      return {
        header: "THE BEAUDRY | TARGET DOSSIER",
        profile: "785 units. DTLA financial core. Time-poor luxury residents.",
        wedge: "Premium Closet Valet. Remove the dry-cleaning run.",
        vector: "Resident services / concierge partnership.",
        cta: "GENERATE BEAUDRY PITCH →",
      };
    }
    if (selectedNode.id === "century") {
      return {
        header: "CENTURY PARK EAST | PENETRATION BRIEF",
        profile: "12 active units. 418 total units. Penetration: 2.8%.",
        wedge: "Leverage existing resident social proof to capture adjacent units.",
        vector: "Deploy 'Refer-a-Neighbor' targeted mailer to specific floors.",
        cta: "GENERATE FLOOR MAILER →",
      };
    }
    return {
      header: "OPUS LA | CAPTURED ASSET",
      profile: "Captured foothold. Existing resident flow established.",
      wedge: "Upsell: closet audit + seasonal rotation pickup.",
      vector: "Concierge playbook + building flyer refresh.",
      cta: "GENERATE EXPANSION PLAN →",
    };
  }, [selectedNode.id]);

  return (
    <section className={cn("l4-root rounded-[10px] border border-[#2a2a2a] bg-[#111] overflow-hidden", className)}>
      <div className="l4-topBanner">
        <div className="l4-topBannerInner">
          <div className="l4-topTitle">Three buildings away</div>
          <div className="l4-topSubtitle">Three buildings away from a different life.</div>
        </div>
      </div>

      <div className="l4-grid">
        {/* LEFT: SCORECARD */}
        <aside className="l4-panel l4-left">
          <div className="l4-nav">
            {[
              ["orders", "ORDERS"],
              ["customers", "CUSTOMERS"],
              ["leads", "LEADS"],
              ["settings", "SETTINGS"],
            ].map(([id, label]) => {
              const active = activeSection === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveSection(id as any)}
                  className={cn("l4-navBtn", active && "is-active")}
                >
                  <span className="l4-led" aria-hidden />
                  <span className="l4-navLabel">[ {label} ]</span>
                </button>
              );
            })}
          </div>

          <div className="l4-metrics">
            <div className="l4-metricBlock">
              <div className="l4-metricLabel">SOBER DAYS</div>
              <div className="l4-metricValue">
                {SOBER_DAYS.toLocaleString("en-US")}
              </div>
            </div>
            <div className="l4-kv">
              <div className="l4-kvRow">
                <div className="l4-kvKey">DEBT</div>
                <div className="l4-kvVal muted">$0</div>
              </div>
              <div className="l4-kvRow">
                <div className="l4-kvKey">RECOVERED TODAY</div>
                <div className="l4-kvVal good">+$5,380</div>
              </div>
            </div>
          </div>

          <div className="l4-leftFooter">
            <button type="button" className="l4-startBtn" onClick={scrollToLane1}>
              [ START HERE ]
            </button>
            <div className="l4-leftHint">Click to scroll + pulse Lane 1.</div>
          </div>
        </aside>

        {/* CENTER: SPEAR */}
        <main className="l4-center">
          {/* Threat ceiling */}
          <div
            className={cn(
              "l4-ceiling",
              ceilingState === "idle" && "is-idle",
              ceilingState === "failure" && "is-failure",
              ceilingState === "success" && "is-success"
            )}
          >
            <div className="l4-ceilingBar">
              <div className="l4-threatText">Stagnation will be the death of you.</div>
              <div className="l4-ceilingStatus">
                <span className="l4-ceilingStatusLabel">CEILING STATUS:</span>{" "}
                <span className="l4-ceilingStatusValue">DESCENDING</span>{" "}
                <span className="l4-arrowDown" aria-hidden>↓</span>
              </div>
            </div>
            <div className="l4-spikes" aria-hidden>
              {Array.from({ length: 28 }).map((_, i) => (
                <span key={i} className="l4-spike" />
              ))}
            </div>
          </div>

          {/* Board composite */}
          <div className="l4-boardWrap">
            <div className="l4-board">
              <div className={cn("l4-boardNode", ceilingState === "success" && "is-success")} />

              <img
                src={FIGURE_ASSETS.man}
                alt=""
                className={cn(
                  "l4-figure l4-figureMan",
                  ceilingState === "failure" && "is-crush",
                  ceilingState === "success" && "is-merge"
                )}
                aria-hidden
                draggable={false}
              />
              <img
                src={FIGURE_ASSETS.woman}
                alt=""
                className={cn(
                  "l4-figure l4-figureWoman",
                  ceilingState === "failure" && "is-crush",
                  ceilingState === "success" && "is-merge"
                )}
                aria-hidden
                draggable={false}
              />

              <div className="l4-boardOverlay">
                <div className="l4-overlayTitle">**MARKET HOLE DETECTED: Pants Alterations**</div>
                <div className="l4-overlayValue">+400% ZIPPER REPAIR SEARCHES WITHIN 3 MILES.</div>
              </div>
            </div>
          </div>

          {/* Ritual stack */}
          <div className="l4-ritual">
            <div
              ref={lane1Ref}
              className={cn("l4-lane", "is-primary", lane1Pulse && "is-pulse")}
              data-lane="1"
            >
              <div className="l4-laneHead">
                <div className="l4-laneTitle">LANE 1 | FAST CASH | Rainy Day Valet SMS</div>
                <button type="button" className="l4-laneCta" onClick={executeLane1}>
                  [ DEPLOY SMS → ]
                </button>
              </div>
              <div className="l4-laneBody">Inconvenience. Est. Conversion: 14%.</div>
            </div>

            <div className={cn("l4-lane", lane2Primary && "is-primaryNext")} data-lane="2">
              <div className="l4-laneHead">
                <div className="l4-laneTitle">LANE 2 | COMPOUNDING | Concierge Opt-In</div>
                <button type="button" className={cn("l4-laneCta", "is-dim")}>
                  [ INTEGRATE STEP → ]
                </button>
              </div>
              <div className="l4-laneBody">Scale retention. Insert into intake flow. Est. LTV Boost: +22%.</div>
            </div>

            <div className="l4-lane" data-lane="3">
              <div className="l4-laneHead">
                <div className="l4-laneTitle">LANE 3 | EXPANSION | THE BEAUDRY</div>
                <button type="button" className={cn("l4-laneCta", "is-dim")}>
                  [ GENERATE BEAUDRY PITCH → ]
                </button>
              </div>
              <div className="l4-laneBody">785 units. DTLA financial core. High-density premium target.</div>
            </div>

            <div className="l4-microAction">→ TEXT MARIA G. FOR REFERRAL | Takes ~45 sec</div>
          </div>
        </main>

        {/* RIGHT: MAP + DOSSIER */}
        <aside className="l4-panel l4-right">
          <div className="l4-mapHeader">
            <div className="l4-mapTitle">Active Growth Expansion Map</div>
            <div className="l4-mapSub">The Empire — Always-on</div>
          </div>

          <div className="l4-map">
            <div className="l4-mapBg" aria-hidden />

            {/* connection lines */}
            <svg className="l4-mapLines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              <path d="M22,18 L62,46 L78,72" className="l4-mapLine" />
            </svg>

            {/* nodes */}
            <div className="l4-mapNodes">
              {MAP_NODES.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={cn(
                    "l4-node",
                    n.type === "captured" && "is-captured",
                    n.type === "target" && "is-target",
                    n.type === "expansion" && "is-expansion",
                    selectedNodeId === n.id && "is-selected"
                  )}
                  style={
                    n.id === "opus"
                      ? { left: "18%", top: "14%" }
                      : n.id === "century"
                        ? { left: "58%", top: "42%" }
                        : { left: "74%", top: "70%" }
                  }
                  onClick={() => setSelectedNodeId(n.id)}
                >
                  <span className="l4-nodeIso" aria-hidden />
                  <span className="l4-nodeLabel">{n.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="l4-dossier">
            <div className="l4-dossierHeader">{dossier.header}</div>
            <div className="l4-dossierBody">
              <div className="l4-dossierRow">
                <div className="k">PROFILE:</div>
                <div className="v">{dossier.profile}</div>
              </div>
              <div className="l4-dossierRow">
                <div className="k">WEDGE:</div>
                <div className="v">{dossier.wedge}</div>
              </div>
              <div className="l4-dossierRow">
                <div className="k">VECTOR:</div>
                <div className="v">{dossier.vector}</div>
              </div>
            </div>
            <button type="button" className="l4-dossierCta">
              [ {dossier.cta} ]
            </button>
            <div className="l4-keepInFrame">“KEEP IN FRAME” notes</div>
          </div>
        </aside>
      </div>
    </section>
  );
}

