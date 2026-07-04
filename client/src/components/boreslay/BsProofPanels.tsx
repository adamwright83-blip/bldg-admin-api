import { ArrowRight, Compass, Sparkles } from "lucide-react";

export function BsProofPanels() {
  return (
    <section id="how" style={{ background: "var(--bs-dark)", padding: "64px 0" }}>
      <div className="bs-container">
        <h2 className="bs-display" style={{ fontSize: "clamp(28px, 4vw, 40px)", color: "var(--bs-cream)", textAlign: "center", margin: "0 0 32px" }}>
          Real missions. Real outcomes. <span style={{ color: "var(--bs-gold)" }}>Real power.</span>
        </h2>
        <div className="bs-proof-grid">
          <div
            style={{
              borderRadius: 16,
              border: "1px solid rgba(74,222,128,0.3)",
              background: "rgba(20,30,20,0.5)",
              padding: "22px 22px 20px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, display: "grid", placeItems: "center", background: "rgba(74,222,128,0.15)", color: "#4ADE80" }}>
                <Compass size={20} />
              </div>
              <p className="bs-mono" style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#4ADE80", margin: 0 }}>
                AI Crew Mission
              </p>
            </div>
            <h3 className="bs-display" style={{ fontSize: 22, color: "var(--bs-cream)", margin: "0 0 10px" }}>
              Follow Up campaign deployed
            </h3>
            <p style={{ color: "rgba(245,240,232,0.65)", fontSize: 14.5, margin: "0 0 14px" }}>
              Scout found 12 cold estimates. Closer sent personalized follow-up. 2 replied, 1
              estimate reopened. <em>(simulated)</em>
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#4ADE80", fontSize: 14, fontWeight: 700 }}>
              Mission complete <ArrowRight size={16} />
            </div>
          </div>
          <div
            style={{
              borderRadius: 16,
              border: "1px solid rgba(196,145,255,0.3)",
              background: "rgba(30,20,40,0.5)",
              padding: "22px 22px 20px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, display: "grid", placeItems: "center", background: "rgba(196,145,255,0.15)", color: "#C495FF" }}>
                <Sparkles size={20} />
              </div>
              <p className="bs-mono" style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#C495FF", margin: 0 }}>
                Reality Rift
              </p>
            </div>
            <h3 className="bs-display" style={{ fontSize: 22, color: "var(--bs-cream)", margin: "0 0 10px" }}>
              Live call with SAGE
            </h3>
            <p style={{ color: "rgba(245,240,232,0.65)", fontSize: 14.5, margin: "0 0 14px" }}>
              High-value moment detected. Sage coaches you live while the battle pauses. Objection
              handled, meeting set for Thursday. <em>(simulated)</em>
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#C495FF", fontSize: 14, fontWeight: 700 }}>
              Rift conquered <ArrowRight size={16} />
            </div>
            <p className="bs-mono" style={{ color: "rgba(245,240,232,0.4)", fontSize: 11.5, margin: "10px 0 0" }}>
              Coming to the playable demo above
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
