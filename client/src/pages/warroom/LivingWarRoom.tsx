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
  xPercent: number; // 0-100% position on map
  yPercent: number;
  routeMarginBoost: string;
}

const INITIAL_NODES: BuildingNode[] = [
  {
    id: "louise",
    name: "The Louise Los Feliz",
    address: "4455 Los Feliz Blvd, Los Angeles, CA",
    status: "targeted",
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
  const [nodes, setNodes] = useState<BuildingNode[]>(INITIAL_NODES);
  const [selectedNode, setSelectedNode] = useState<BuildingNode>(INITIAL_NODES[0]);
  const [isSimulatingWin, setIsSimulatingWin] = useState(false);
  const [hasSimulatedWin, setHasSimulatedWin] = useState(false);
  const [activeCustomers, setActiveCustomers] = useState(24);
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
      text: "Autonomous operator decision engine evaluated loadout priorities for tenant 'default'.",
    },
    {
      id: "act-3",
      timestamp: "01:08:20",
      kind: "normal",
      text: "Fail-closed gate verified: non-won accounts safely rejected with zero synthetic dispatches.",
    },
  ]);

  // Audio synthesizer for tactical sonic boom
  const playWarroomBoom = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      
      // Sub-bass sweep
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

      // Treble sonar ping
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

  const handleSimulateWin = () => {
    if (hasSimulatedWin) return;
    setIsSimulatingWin(true);
    playWarroomBoom();

    // 1. Mark The Louise as WON
    setNodes((prev) =>
      prev.map((n) => (n.id === "louise" ? { ...n, status: "won" } : n))
    );

    // 2. Animate Macro Goal and Margin Boost
    setTimeout(() => {
      setActiveCustomers((c) => c + 1);
      setMarginBoost((m) => +(m + 6.4).toFixed(1));
    }, 400);

    // 3. Claire vocal dispatch
    speakClaireDispatch(
      "Commercial agreement verified at The Louise. Corridor density unlocked. Dispatching 3 conquest objectives to Day Line."
    );

    // 4. Append live activities
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

    setActivities((prev) => [
      {
        id: `act-${Date.now()}-1`,
        timestamp: timeStr,
        kind: "win",
        text: "Account win verified at The Louise Los Feliz! Corridor conquest engine activated.",
      },
      {
        id: `act-${Date.now()}-2`,
        timestamp: timeStr,
        kind: "conquest",
        text: "Geographic conquest propagated: 3 neighbor assets locked into Day Line sequence.",
      },
      ...prev,
    ]);

    setHasSimulatedWin(true);
    setTimeout(() => {
      setIsSimulatingWin(false);
    }, 1800);
  };

  const handleResetSimulation = () => {
    setNodes(INITIAL_NODES);
    setHasSimulatedWin(false);
    setActiveCustomers(24);
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
          <span style={{ fontSize: "0.9rem", color: "#e2e8f0", fontWeight: 600 }}>
            Autonomous Corridor Conquest Atlas · Los Angeles Hub
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
            Heartbeat: <strong style={{ color: "#4ade80" }}>Online (0 Errors)</strong>
          </span>
          <Link href="/driver/cockpit" className="btn-tactical" style={{ padding: "6px 14px", fontSize: "0.8rem" }}>
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
            alt="Los Angeles Tactical Satellite Atlas"
            className="warroom-bg-image"
          />

          {/* SVG Vector Corridor Network */}
          <svg className="warroom-svg-overlay">
            {/* Vector lines connecting nodes */}
            <line x1="54%" y1="38%" x2="66%" y2="36%" stroke="rgba(245, 158, 11, 0.6)" strokeWidth="2" className="corridor-beam" />
            <line x1="54%" y1="38%" x2="60%" y2="42%" stroke="rgba(245, 158, 11, 0.6)" strokeWidth="2" className="corridor-beam" />
            <line x1="54%" y1="38%" x2="38%" y2="49%" stroke="rgba(56, 189, 248, 0.5)" strokeWidth="1.5" strokeDasharray="4 4" />
            <line x1="38%" y1="49%" x2="46%" y2="44%" stroke="rgba(148, 163, 184, 0.4)" strokeWidth="1" strokeDasharray="3 3" />

            {/* Shockwave circle during win simulation */}
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
              <span className="hud-label">Corridor Siege State</span>
              <span className="hud-val">{hasSimulatedWin ? "EXPANDED" : "LOCKED"}</span>
              <span className="hud-sub" style={{ color: hasSimulatedWin ? "#4ade80" : "#fbbf24" }}>
                {hasSimulatedWin ? "3 Targets Queued" : "Conquest Primed"}
              </span>
            </div>
          </div>
        </div>

        {/* Right Rail: Persistent Operator Engine Control */}
        <aside className="warroom-control-rail">
          {/* Section 1: Active Macro Goal */}
          <div>
            <div className="rail-section-header">
              <Activity size={14} color="#f59e0b" /> Macro Goal Heartbeat
            </div>

            <div className="macro-goal-card" style={{ marginTop: 10 }}>
              <div className="macro-goal-header">
                <span className="goal-metric-title">Active Customers Target</span>
                <span className="goal-metric-numbers">{activeCustomers} / 50</span>
              </div>
              <div className="progress-bar-track">
                <div className="progress-bar-fill" style={{ width: `${(activeCustomers / 50) * 100}%` }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "#94a3b8" }}>
                <span>Baseline: 23</span>
                <span>Target: 50 Accounts</span>
              </div>
            </div>
          </div>

          {/* Section 2: Executive Simulation Trigger */}
          <div>
            <div className="rail-section-header">
              <Zap size={14} color="#f59e0b" /> Executive Siege Simulator
            </div>

            <div className="simulation-trigger-box" style={{ marginTop: 10 }}>
              <div>
                <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#ffffff", display: "block" }}>
                  Trigger Account Win at The Louise
                </span>
                <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                  Ripples corridor conquest shockwave, dispatches Claire voice briefing, and materializes Day Line items.
                </span>
              </div>

              {!hasSimulatedWin ? (
                <button 
                  className="btn-simulate-win"
                  onClick={handleSimulateWin}
                  disabled={isSimulatingWin}
                >
                  <Play size={16} /> Simulate Win & Corridor Siege
                </button>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <button 
                    className="btn-tactical" 
                    style={{ flex: 1, justifyContent: "center", borderColor: "#4ade80", color: "#4ade80" }}
                    onClick={handleSimulateWin}
                  >
                    <CheckCircle2 size={14} /> Win Re-Fired
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
