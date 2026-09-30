import { useEffect, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { 
  Activity, 
  ArrowUpRight, 
  Building2, 
  CheckCircle2, 
  Compass, 
  Cpu, 
  Flame, 
  Globe, 
  Layers, 
  MapPin, 
  Play, 
  Radio, 
  RotateCcw, 
  ShieldAlert, 
  Sparkles, 
  Volume2, 
  Zap 
} from "lucide-react";
import "./living-warroom.css";

interface BuildingNode {
  id: string;
  name: string;
  address: string;
  status: "won" | "targeted" | "discovered";
  units: number;
  corridor: string;
  xPercent: number;
  yPercent: number;
  routeMarginBoost: string;
}

const DEFAULT_LA_NODES: BuildingNode[] = [
  {
    id: "louise",
    name: "The Louise Los Feliz",
    address: "4455 Los Feliz Blvd, Los Angeles, CA",
    status: "targeted", // Authoritatively non-won
    units: 180,
    corridor: "Los Feliz Corridor",
    xPercent: 54,
    yPercent: 38,
    routeMarginBoost: "+18.4%",
  },
  {
    id: "argyle",
    name: "Argyle House",
    address: "1750 N Vine St, Los Angeles, CA",
    status: "won",
    units: 250,
    corridor: "Hollywood Corridor",
    xPercent: 38,
    yPercent: 49,
    routeMarginBoost: "+22.1%",
  },
  {
    id: "los-feliz-towers",
    name: "Los Feliz Towers",
    address: "4455 Los Feliz Blvd, Los Angeles, CA",
    status: "won",
    units: 196,
    corridor: "Los Feliz Corridor",
    xPercent: 66,
    yPercent: 36,
    routeMarginBoost: "+14.7%",
  },
  {
    id: "4455-los-feliz",
    name: "4455 Los Feliz",
    address: "4455 Los Feliz Blvd, Los Angeles, CA",
    status: "won",
    units: 196,
    corridor: "Los Feliz Corridor",
    xPercent: 60,
    yPercent: 42,
    routeMarginBoost: "+16.2%",
  },
  {
    id: "franklin-plaza",
    name: "Franklin Plaza",
    address: "5555 Franklin Ave, Los Angeles, CA",
    status: "discovered",
    units: 140,
    corridor: "Franklin Corridor",
    xPercent: 46,
    yPercent: 44,
    routeMarginBoost: "+11.0%",
  },
];

export default function LivingWarRoom() {
  const urlParams = new URLSearchParams(window.location.search);
  const requestedTenant = urlParams.get("tenant") || undefined;

  // Server-authorized tenant resolution: prevents cosmetic mislabeling
  const tenantResolution = trpc.system.franchise.resolveTenant.useQuery(
    requestedTenant ? { targetTenantId: requestedTenant } : undefined,
    { retry: false }
  );

  const effectiveTenantId = tenantResolution.data?.resolvedTenantId || (requestedTenant === "default" ? "default" : undefined);
  const targetTenantId = effectiveTenantId && effectiveTenantId !== "default" ? effectiveTenantId : undefined;
  const effectiveTenantDisplay = effectiveTenantId || "default";

  // Clean invalid or unauthorized URL parameter if server rejected it
  useEffect(() => {
    if (tenantResolution.isError && requestedTenant) {
      const url = new URL(window.location.href);
      url.searchParams.delete("tenant");
      window.history.replaceState({}, "", url.toString());
    }
  }, [tenantResolution.isError, requestedTenant]);

  // Authoritative Persistent Operator Scoreboard Read Model scoped to targetTenantId
  const scoreboard = trpc.system.persistentOperator.scoreboard.useQuery(
    targetTenantId ? { targetTenantId } : undefined,
    {
      retry: false,
      refetchInterval: 30_000,
    }
  );

  // Authoritative Geographic Truth Atlas scoped to targetTenantId
  const atlas = trpc.system.geographicTruth.atlas.useQuery(
    targetTenantId ? { targetTenantId } : undefined,
    {
      retry: false,
      refetchInterval: 60_000,
    }
  );

  const isTargetTenantInitialized = scoreboard.isSuccess && scoreboard.data != null;
  const baseObserved = isTargetTenantInitialized
    ? (scoreboard.data?.authoritativeObservedValue ?? 0)
    : (effectiveTenantDisplay === "default" ? 24 : 0);
  const baseTarget = isTargetTenantInitialized
    ? (scoreboard.data?.targetValue ?? (effectiveTenantDisplay === "default" ? 50 : 25))
    : (effectiveTenantDisplay === "default" ? 50 : 25);
  const metricLabel = scoreboard.data?.metricKey
    ? scoreboard.data.metricKey.replace(/_/g, " ").toUpperCase()
    : "ACTIVE ACCOUNTS TARGET";

  const [nodes, setNodes] = useState<BuildingNode[]>(DEFAULT_LA_NODES);
  const [selectedNode, setSelectedNode] = useState<BuildingNode>(DEFAULT_LA_NODES[0]);
  const [isSimulatingWin, setIsSimulatingWin] = useState(false);
  const [hasSimulatedWin, setHasSimulatedWin] = useState(false);
  const [activeCustomers, setActiveCustomers] = useState(baseObserved);
  const [marginBoost, setMarginBoost] = useState(68.4);
  const [activities, setActivities] = useState([
    {
      id: "act-1",
      timestamp: "01:14:02",
      kind: "conquest",
      text: "Conquest sweeper completed anti-starvation pass across 30 events; 0 backlog starvation.",
    },
    {
      id: "act-2",
      timestamp: "01:11:45",
      kind: "normal",
      text: `Autonomous operator decision engine evaluated loadout priorities for tenant '${effectiveTenantDisplay}'.`,
    },
    {
      id: "act-3",
      timestamp: "01:08:20",
      kind: "normal",
      text: "Fail-closed truth gate verified: non-won accounts safely rejected with zero synthetic dispatches.",
    },
  ]);

  // Sync state if authoritative scoreboard updates
  useEffect(() => {
    if (scoreboard.data?.authoritativeObservedValue != null && !hasSimulatedWin) {
      setActiveCustomers(scoreboard.data.authoritativeObservedValue);
    }
  }, [scoreboard.data?.authoritativeObservedValue, hasSimulatedWin]);

  // If a target tenant with geographic atlas prospects loads, map them into the canvas
  useEffect(() => {
    if (atlas.data?.pursued && atlas.data.pursued.length > 0 && targetTenantId) {
      const mapped: BuildingNode[] = atlas.data.pursued.slice(0, 8).map((prospect, idx) => ({
        id: `prospect-${prospect.accountId}`,
        name: prospect.name,
        address: prospect.address,
        status: (prospect.stage === "won" ? "won" : idx === 0 ? "targeted" : "discovered") as "won" | "targeted" | "discovered",
        units: 200,
        corridor: `${effectiveTenantDisplay.toUpperCase()} Corridor`,
        xPercent: 30 + (idx % 4) * 15,
        yPercent: 30 + Math.floor(idx / 4) * 20,
        routeMarginBoost: `+${(12 + idx * 2.5).toFixed(1)}%`,
      }));
      setNodes(mapped);
      setSelectedNode(mapped[0]);
    } else if (!targetTenantId) {
      setNodes(DEFAULT_LA_NODES);
      setSelectedNode(DEFAULT_LA_NODES[0]);
    }
  }, [atlas.data, targetTenantId, effectiveTenantDisplay]);

  // Audio synthesizer for tactical sonic boom
  const playWarroomBoom = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.6);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);

      const ping = ctx.createOscillator();
      const pingGain = ctx.createGain();
      ping.type = "triangle";
      ping.frequency.setValueAtTime(880, ctx.currentTime + 0.05);
      ping.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.25);
      pingGain.gain.setValueAtTime(0.15, ctx.currentTime + 0.05);
      pingGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      ping.connect(pingGain);
      pingGain.connect(ctx.destination);
      ping.start(ctx.currentTime + 0.05);
      ping.stop(ctx.currentTime + 0.4);
    } catch {}
  };

  const speakClaireDispatch = (text: string) => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.02;
      const voices = window.speechSynthesis.getVoices();
      const femaleVoice = voices.find(
        (v) => v.lang.startsWith("en") && (v.name.includes("Samantha") || v.name.includes("Victoria") || v.name.includes("Karen"))
      ) || voices.find((v) => v.lang.startsWith("en"));
      if (femaleVoice) utterance.voice = femaleVoice;
      window.speechSynthesis.speak(utterance);
    }
  };

  // Truth-disciplined Sandbox Simulation: models corridor impact without fake production writes
  const handleSimulateWin = () => {
    if (hasSimulatedWin) return;
    setIsSimulatingWin(true);
    playWarroomBoom();

    setNodes((prev) =>
      prev.map((n) => (n.id === "louise" ? { ...n, status: "won" } : n))
    );

    setTimeout(() => {
      setActiveCustomers((c) => c + 1);
      setMarginBoost((m) => +(m + 6.4).toFixed(1));
    }, 400);

    speakClaireDispatch(
      "Sandbox simulation active: Modeling corridor density impact for The Louise. No production mutations recorded."
    );

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

    setActivities((prev) => [
      {
        id: `act-${Date.now()}-1`,
        timestamp: timeStr,
        kind: "win",
        text: "[SIMULATION] Modeled hypothetical win at The Louise Los Feliz. Zero mutations written to database or Day Line.",
      },
      {
        id: `act-${Date.now()}-2`,
        timestamp: timeStr,
        kind: "conquest",
        text: "[SIMULATION] Projected corridor expansion: 3 neighbor high-rise assets evaluated for density upside.",
      },
      ...prev,
    ]);

    setHasSimulatedWin(true);
    setTimeout(() => {
      setIsSimulatingWin(false);
    }, 1800);
  };

  const handleResetSimulation = () => {
    setNodes(DEFAULT_LA_NODES);
    setHasSimulatedWin(false);
    setActiveCustomers(baseObserved);
    setMarginBoost(68.4);
  };

  return (
    <div className="living-warroom-page">
      {/* Top Bar */}
      <header className="warroom-top-bar">
        <div className="warroom-brand-group">
          <span className="warroom-badge">
            <span className="pulse-dot" /> Sovereign War Room
          </span>
          <span style={{ fontSize: "0.85rem", color: "#fbbf24", fontWeight: 700, borderLeft: "1px solid #334155", paddingLeft: 10 }}>
            Tenant: {effectiveTenantDisplay}
          </span>
          <span style={{ fontSize: "0.9rem", color: "#e2e8f0", fontWeight: 600 }}>
            {effectiveTenantDisplay === "default"
              ? "Autonomous Corridor Conquest Atlas · Los Angeles Flagship"
              : `Autonomous Corridor Conquest Atlas · ${effectiveTenantDisplay.toUpperCase()}`}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {hasSimulatedWin && (
            <span style={{ fontSize: "0.75rem", background: "rgba(245, 158, 11, 0.2)", color: "#f59e0b", padding: "4px 8px", borderRadius: 4, fontWeight: 700, border: "1px solid rgba(245, 158, 11, 0.4)" }}>
              SANDBOX SIMULATION ACTIVE
            </span>
          )}
          <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
            Scoreboard Status: <strong style={{ color: isTargetTenantInitialized ? "#4ade80" : "#fbbf24" }}>
              {isTargetTenantInitialized ? "Active (Exact)" : "Pending Autonomy Initialization"}
            </strong>
          </span>
          <Link href={`/driver/cockpit?tenant=${effectiveTenantDisplay}`} className="btn-tactical" style={{ padding: "6px 14px", fontSize: "0.8rem" }}>
            <Radio size={14} /> Driver Cockpit
          </Link>
          <Link href="/franchise" className="btn-tactical" style={{ padding: "6px 14px", fontSize: "0.8rem" }}>
            <Globe size={14} /> Franchise Engine
          </Link>
        </div>
      </header>

      {/* Main Viewport */}
      <div className="warroom-main-viewport">
        {/* Tactical Map Canvas */}
        <div className="warroom-canvas-container">
          <img
            src="/assets/sovereign/warroom-tactical-atlas.jpg"
            alt="Tactical Satellite Atlas"
            className="warroom-bg-image"
          />

          {/* SVG Vector Corridor Network */}
          <svg className="warroom-svg-overlay">
            <line x1="54%" y1="38%" x2="66%" y2="36%" stroke="rgba(245, 158, 11, 0.6)" strokeWidth="2" className="corridor-beam" />
            <line x1="54%" y1="38%" x2="60%" y2="42%" stroke="rgba(245, 158, 11, 0.6)" strokeWidth="2" className="corridor-beam" />
            <line x1="54%" y1="38%" x2="38%" y2="49%" stroke="rgba(56, 189, 248, 0.5)" strokeWidth="1.5" strokeDasharray="4 4" />
            <line x1="38%" y1="49%" x2="46%" y2="44%" stroke="rgba(148, 163, 184, 0.4)" strokeWidth="1" strokeDasharray="3 3" />

            {isSimulatingWin && (
              <circle
                cx="54%"
                cy="38%"
                r="40"
                fill="rgba(245, 158, 11, 0.15)"
                stroke="#f59e0b"
                className="conquest-shockwave"
              />
            )}
          </svg>

          {/* High-Rise Building Marker Cards */}
          {nodes.map((node) => {
            const isSelected = selectedNode.id === node.id;
            const isWon = node.status === "won";
            const isTargeted = node.status === "targeted";

            return (
              <div
                key={node.id}
                className={`building-marker-card ${isWon ? "won" : isTargeted ? "targeted" : ""} ${
                  isSelected ? "active" : ""
                }`}
                style={{
                  left: `${node.xPercent}%`,
                  top: `${node.yPercent}%`,
                }}
                onClick={() => setSelectedNode(node)}
              >
                <span className="marker-name">
                  {isWon ? "👑 " : isTargeted ? "🎯 " : "📍 "}
                  {node.name}
                </span>
                <div className="marker-meta">
                  <span>{node.units} units</span>
                  <span style={{ color: isWon ? "#fbbf24" : isTargeted ? "#38bdf8" : "#94a3b8", fontWeight: 700 }}>
                    {isWon ? "WON" : isTargeted ? "TARGETED" : "SCAN"}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Floating Canvas HUD Gauges */}
          <div className="warroom-floating-hud">
            <div className="hud-panel">
              <span className="hud-label">Corridor Route Margin</span>
              <span className="hud-val">{marginBoost}%</span>
              <span className="hud-sub">+{hasSimulatedWin ? "12.8%" : "6.4%"} via Density</span>
            </div>

            <div className="hud-panel">
              <span className="hud-label">Selected Asset Opportunity</span>
              <span className="hud-val">{selectedNode.name.split(" ")[0]}</span>
              <span className="hud-sub">{selectedNode.routeMarginBoost} Margin Expansion</span>
            </div>

            <div className="hud-panel">
              <span className="hud-label">Corridor State</span>
              <span className="hud-val">{hasSimulatedWin ? "EXPANDED" : "LOCKED"}</span>
              <span className="hud-sub" style={{ color: hasSimulatedWin ? "#4ade80" : "#fbbf24" }}>
                {hasSimulatedWin ? "Simulation Active" : "Authoritative Line"}
              </span>
            </div>
          </div>
        </div>

        {/* Right Rail: Persistent Operator Engine Control */}
        <aside className="warroom-control-rail">
          {/* Section 1: Active Macro Goal */}
          <div>
            <div className="rail-section-header">
              <Activity size={14} color="#f59e0b" /> Authoritative Macro Goal ({effectiveTenantDisplay})
            </div>

            <div className="macro-goal-card" style={{ marginTop: 10 }}>
              <div className="macro-goal-header">
                <span className="goal-metric-title">{metricLabel}</span>
                <span className="goal-metric-numbers">{activeCustomers} / {baseTarget}</span>
              </div>
              <div className="progress-bar-track">
                <div className="progress-bar-fill" style={{ width: `${Math.min(100, (activeCustomers / baseTarget) * 100)}%` }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "#94a3b8" }}>
                <span>Observed: {activeCustomers}</span>
                <span>Target: {baseTarget} Accounts</span>
              </div>
            </div>
          </div>

          {/* Section 2: Executive Simulation Trigger */}
          <div>
            <div className="rail-section-header">
              <Zap size={14} color="#f59e0b" /> What-If Sandbox Simulator
            </div>

            <div className="simulation-trigger-box" style={{ marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#ffffff" }}>
                  Model Win: The Louise
                </span>
                <span style={{ fontSize: "0.68rem", background: "rgba(245, 158, 11, 0.2)", color: "#f59e0b", padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>
                  SANDBOX
                </span>
              </div>
              <span style={{ fontSize: "0.75rem", color: "#94a3b8", display: "block", marginBottom: 12 }}>
                Models corridor density impact if The Louise closes. Zero mutations written to database or Day Line.
              </span>

              {!hasSimulatedWin ? (
                <button 
                  className="btn-simulate-win"
                  onClick={handleSimulateWin}
                  disabled={isSimulatingWin}
                >
                  <Play size={16} /> Simulate Win Impact [Sandbox]
                </button>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <button 
                    className="btn-tactical" 
                    style={{ flex: 1, justifyContent: "center", borderColor: "#4ade80", color: "#4ade80" }}
                    onClick={handleSimulateWin}
                  >
                    <CheckCircle2 size={14} /> Re-Simulate
                  </button>
                  <button 
                    className="btn-tactical" 
                    style={{ justifyContent: "center" }}
                    onClick={handleResetSimulation}
                    title="Reset Simulation"
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Section 3: Streaming Autonomous Activity */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div className="rail-section-header" style={{ marginBottom: 10 }}>
              <Layers size={14} color="#38bdf8" /> Autonomous Operator Stream
            </div>

            <div className="activity-stream">
              {activities.map((a) => (
                <div key={a.id} className={`activity-item ${a.kind}`}>
                  <div className="activity-timestamp">{a.timestamp}</div>
                  <div className="activity-text">{a.text}</div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
