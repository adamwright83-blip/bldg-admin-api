import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { 
  Building2, 
  CheckCircle2, 
  Compass, 
  Cpu, 
  Flame, 
  Globe, 
  Layers, 
  Loader2, 
  MapPin, 
  Navigation, 
  PhoneCall, 
  Plus, 
  Radio, 
  Sparkles, 
  TrendingUp, 
  Users, 
  X 
} from "lucide-react";
import "./franchise-factory.css";

interface ProvisioningTelemetryStep {
  step: number;
  title: string;
  detail: string;
  timestamp: string;
  status: "completed" | "active" | "pending";
}

export default function FranchiseFactoryPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [city, setCity] = useState("Austin");
  const [stateCode, setStateCode] = useState("TX");
  const [vertical, setVertical] = useState<"commercial_laundry" | "highrise_amenity" | "commercial_textiles">("commercial_laundry");
  const [targetMrr, setTargetMrr] = useState(25000);
  const [operatorName, setOperatorName] = useState("Autonomous Lead Fleet");
  const [voicePersona, setVoicePersona] = useState("eve");
  const [telemetry, setTelemetry] = useState<ProvisioningTelemetryStep[]>([]);
  const [isIgniting, setIsIgniting] = useState(false);
  const [provisionedId, setProvisionedId] = useState<string | null>(null);

  const { data: franchises = [], refetch, isLoading } = trpc.system.franchise.list.useQuery();
  const provisionMutation = trpc.system.franchise.provision.useMutation();

  const handleIgnite = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsIgniting(true);
    setTelemetry([]);
    setProvisionedId(null);

    try {
      const res = await provisionMutation.mutateAsync({
        city,
        state: stateCode,
        vertical,
        targetMrrCents: targetMrr * 100,
        operatorName,
        voicePersona,
      });

      // Stream the telemetry steps for cinematic visual feedback
      for (const step of res.telemetry) {
        await new Promise((r) => setTimeout(r, 180));
        setTelemetry((prev) => [...prev, step]);
      }

      setProvisionedId(res.franchise.id);
      await refetch();
    } catch (err) {
      console.error("Franchise ignition failed:", err);
    } finally {
      setIsIgniting(false);
    }
  };

  const totalAccounts = franchises.reduce((acc, f) => acc + (f.metrics?.activeAccounts || 0), 0);
  const totalFleet = franchises.reduce((acc, f) => acc + (f.fleetCount || 1), 0);
  const avgDensity = franchises.length > 0
    ? Math.round(franchises.reduce((acc, f) => acc + (f.corridorDensityScore || 90), 0) / franchises.length)
    : 92;

  return (
    <div className="franchise-factory-page">
      <div className="franchise-grid-overlay" />

      {/* Header */}
      <header className="franchise-header">
        <div className="franchise-title-area">
          <div className="franchise-tagline">
            <span className="franchise-badge-live">
              <span className="pulse-dot" /> Autonomous Network Live
            </span>
            <span>Multi-Tenant Sovereign Operator Engine</span>
          </div>
          <h1>Sovereign Franchise Factory</h1>
        </div>

        <div className="franchise-nav-actions">
          <Link href="/war-room" className="btn-tactical">
            <Compass size={16} /> War Room Canvas
          </Link>
          <Link href="/driver/cockpit" className="btn-tactical">
            <Radio size={16} /> Driver Cockpit HUD
          </Link>
          <button 
            className="btn-tactical btn-ignite"
            onClick={() => setModalOpen(true)}
          >
            <Flame size={16} /> Ignite New Metro
          </button>
        </div>
      </header>

      {/* Hero Interconnected Network Map */}
      <div className="franchise-hero-map">
        <img 
          src="/assets/sovereign/franchise-network-grid.jpg" 
          alt="Sovereign Franchise Autonomous Route Grid" 
        />
        <div className="hero-map-overlay">
          <div className="hero-stats-row">
            <div className="hero-stat-card">
              <span className="hero-stat-label">Active Metro Hubs</span>
              <span className="hero-stat-value">{isLoading ? "--" : franchises.length}</span>
              <span className="hero-stat-sub">Flagship + Expansion Hubs</span>
            </div>
            <div className="hero-stat-card">
              <span className="hero-stat-label">Corridor Accounts</span>
              <span className="hero-stat-value">{isLoading ? "--" : totalAccounts}</span>
              <span className="hero-stat-sub">High-Rise Verified Custody</span>
            </div>
            <div className="hero-stat-card">
              <span className="hero-stat-label">Autonomous Fleets</span>
              <span className="hero-stat-value">{isLoading ? "--" : totalFleet}</span>
              <span className="hero-stat-sub">Day Line Dispatch Live</span>
            </div>
            <div className="hero-stat-card">
              <span className="hero-stat-label">Network Density Score</span>
              <span className="hero-stat-value">{avgDensity}%</span>
              <span className="hero-stat-sub">Corridor Margin Optimization</span>
            </div>
          </div>
        </div>
      </div>

      {/* Active Franchise Fleet Grid */}
      <h2 className="section-label">
        <Building2 size={20} color="#f59e0b" /> Active Autonomous Metro Franchises ({franchises.length})
      </h2>

      <div className="franchise-cards-grid">
        {franchises.map((f) => (
          <div key={f.id} className="franchise-card">
            <div className="franchise-card-header">
              <div>
                <h3 className="franchise-card-title">{f.name}</h3>
                <p className="franchise-card-location">{f.city}, {f.state} · Partition: {f.tenantId}</p>
              </div>
              <span className="franchise-status-pill">{f.status}</span>
            </div>

            <div className="franchise-card-metrics">
              <div className="card-metric-block">
                <span className="card-metric-label">Macro Goal Target</span>
                <span className="card-metric-val">
                  {f.macroGoal.metricKey === "monthly_recurring_revenue"
                    ? `$${Number(f.macroGoal.targetValue).toLocaleString()} MRR`
                    : `${f.macroGoal.currentValue}/${f.macroGoal.targetValue} ${f.macroGoal.unit}`}
                </span>
              </div>
              <div className="card-metric-block">
                <span className="card-metric-label">Corridor Density</span>
                <span className="card-metric-val">{f.corridorDensityScore}%</span>
              </div>
              <div className="card-metric-block">
                <span className="card-metric-label">Claire Copilot</span>
                <span className="card-metric-val">{f.claireConfig.voice.toUpperCase()} · xAI Eve</span>
              </div>
              <div className="card-metric-block">
                <span className="card-metric-label">Fleet Units</span>
                <span className="card-metric-val">{f.fleetCount} Active Van</span>
              </div>
            </div>

            <div>
              <span className="card-metric-label" style={{ display: "block", marginBottom: 6 }}>
                High-Density Corridor Anchors ({f.territoryAnchors.length})
              </span>
              <div className="franchise-anchors-list">
                {f.territoryAnchors.slice(0, 3).map((anchor) => (
                  <div key={anchor.id} className="anchor-pill">
                    <span className="anchor-name">{anchor.name}</span>
                    <span className={`anchor-status-tag ${anchor.status}`}>
                      {anchor.status}
                    </span>
                  </div>
                ))}
                {f.territoryAnchors.length > 3 && (
                  <span style={{ fontSize: "0.75rem", color: "#64748b", textAlign: "center" }}>
                    + {f.territoryAnchors.length - 3} more high-rise anchors
                  </span>
                )}
              </div>
            </div>

            <div className="franchise-card-actions">
              <Link 
                href={`/war-room?tenant=${f.tenantId}`} 
                className="btn-tactical" 
                style={{ flex: 1, justifyContent: "center" }}
              >
                <Compass size={14} /> War Room
              </Link>
              <Link 
                href={`/driver/cockpit?tenant=${f.tenantId}`} 
                className="btn-tactical" 
                style={{ flex: 1, justifyContent: "center" }}
              >
                <Radio size={14} /> In-Cab HUD
              </Link>
            </div>
          </div>
        ))}
      </div>

      {/* Ignition Modal */}
      {modalOpen && (
        <div className="modal-overlay" onClick={() => !isIgniting && setModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Ignite Autonomous Metro Franchise</h2>
              {!isIgniting && (
                <button 
                  onClick={() => setModalOpen(false)}
                  style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer" }}
                >
                  <X size={20} />
                </button>
              )}
            </div>

            {!provisionedId ? (
              <form onSubmit={handleIgnite} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                  <div className="form-field">
                    <label className="form-label">Target City / Metro</label>
                    <select 
                      className="form-select"
                      value={city}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCity(val);
                        if (val === "Austin") setStateCode("TX");
                        if (val === "Seattle") setStateCode("WA");
                        if (val === "Miami") setStateCode("FL");
                        if (val === "Denver") setStateCode("CO");
                        if (val === "Chicago") setStateCode("IL");
                      }}
                      disabled={isIgniting}
                    >
                      <option value="Austin">Austin, TX (Rainey & Downtown)</option>
                      <option value="Seattle">Seattle, WA (South Lake Union)</option>
                      <option value="Miami">Miami, FL (Brickell Financial)</option>
                      <option value="Denver">Denver, CO (LoDo & Union Station)</option>
                      <option value="Chicago">Chicago, IL (Fulton Market)</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label className="form-label">State</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={stateCode} 
                      onChange={(e) => setStateCode(e.target.value)}
                      disabled={isIgniting}
                    />
                  </div>
                </div>

                <div className="form-field">
                  <label className="form-label">Route Vertical</label>
                  <select 
                    className="form-select"
                    value={vertical}
                    onChange={(e) => setVertical(e.target.value as any)}
                    disabled={isIgniting}
                  >
                    <option value="commercial_laundry">Commercial High-Rise Laundry & Linens</option>
                    <option value="highrise_amenity">Luxury Residential Amenity Logistics</option>
                    <option value="commercial_textiles">B2B Uniform & Textile Delivery</option>
                  </select>
                </div>

                <div className="form-field">
                  <label className="form-label">Target Monthly Revenue Goal: ${(targetMrr).toLocaleString()} MRR</label>
                  <input 
                    type="range" 
                    min={10000} 
                    max={100000} 
                    step={5000}
                    value={targetMrr} 
                    onChange={(e) => setTargetMrr(Number(e.target.value))}
                    disabled={isIgniting}
                    style={{ accentColor: "#f59e0b" }}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="form-field">
                    <label className="form-label">Operator / Lead Unit</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={operatorName} 
                      onChange={(e) => setOperatorName(e.target.value)}
                      disabled={isIgniting}
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">Voice Copilot Persona</label>
                    <select 
                      className="form-select"
                      value={voicePersona}
                      onChange={(e) => setVoicePersona(e.target.value)}
                      disabled={isIgniting}
                    >
                      <option value="eve">Claire · Eve (xAI Neural Direct)</option>
                      <option value="marcus">Marcus · Tactical Dispatch</option>
                    </select>
                  </div>
                </div>

                {isIgniting && (
                  <div className="telemetry-terminal">
                    {telemetry.map((t) => (
                      <div key={t.step} className="telemetry-line">
                        <span className="telemetry-step">[PHASE {t.step}/6]</span>
                        <span className="telemetry-detail">{t.detail}</span>
                      </div>
                    ))}
                    <div className="telemetry-line" style={{ color: "#f59e0b" }}>
                      <Loader2 size={12} className="animate-spin" /> Provisioning sovereign route infrastructure...
                    </div>
                  </div>
                )}

                <button 
                  type="submit" 
                  className="btn-tactical btn-ignite" 
                  style={{ width: "100%", justifyContent: "center", padding: 14 }}
                  disabled={isIgniting}
                >
                  {isIgniting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Igniting Autonomous Route Infrastructure...
                    </>
                  ) : (
                    <>
                      <Flame size={16} /> Ignite Autonomous Franchise
                    </>
                  )}
                </button>
              </form>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ textAlign: "center", padding: "20px 0" }}>
                  <CheckCircle2 size={54} color="#4ade80" style={{ margin: "0 auto 12px auto" }} />
                  <h3 style={{ fontSize: "1.3rem", margin: "0 0 6px 0", color: "#ffffff" }}>
                    Franchise Online & Dispatched
                  </h3>
                  <p style={{ color: "#94a3b8", margin: 0, fontSize: "0.9rem" }}>
                    Goldline {city} Central has been provisioned with isolated tenant partitions, seeded corridor high-rise targets, and an active Day Line.
                  </p>
                </div>

                <div className="telemetry-terminal">
                  {telemetry.map((t) => (
                    <div key={t.step} className="telemetry-line">
                      <span className="telemetry-success">✓ [PHASE {t.step}/6]</span>
                      <span className="telemetry-detail">{t.detail}</span>
                    </div>
                  ))}
                  <div className="telemetry-line telemetry-success">
                    ✓ ALL OPERATIONAL GATES PRIMED — FLEET DISPATCHED
                  </div>
                </div>

                <div style={{ display: "flex", gap: 12 }}>
                  <Link 
                    href={`/war-room`} 
                    className="btn-tactical btn-ignite" 
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={() => setModalOpen(false)}
                  >
                    Open Living War Room
                  </Link>
                  <Link 
                    href={`/driver/cockpit`} 
                    className="btn-tactical" 
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={() => setModalOpen(false)}
                  >
                    Open Driver Cockpit
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
