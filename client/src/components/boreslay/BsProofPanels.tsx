import { ArrowRight, Compass, Sparkles } from "lucide-react";

export function BsProofPanels() {
  return (
    <section style={{ background: "var(--bs-dark)", padding: "64px 0" }}>
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
              Follow-Up Campaign Deployed
            </h3>
            <p style={{ color: "rgba(245,240,232,0.65)", fontSize: 14.5, margin: "0 0 14px" }}>
              Scout went through the graveyard and found 12 estimates you wrote, sent, and never
              heard back on. Closer reopened the conversations — personal, specific, in your
              voice — and kept every one of them moving.
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 14px", display: "grid", gap: 6 }}>
              <li style={{ color: "rgba(245,240,232,0.8)", fontSize: 14 }}>→ 2 replies received</li>
              <li style={{ color: "rgba(245,240,232,0.8)", fontSize: 14 }}>→ 1 job back from the dead — they want to talk</li>
              <li style={{ color: "rgba(245,240,232,0.8)", fontSize: 14 }}>→ Estimated opportunity: $740</li>
            </ul>
            <p style={{ color: "rgba(245,240,232,0.7)", fontSize: 14, margin: "0 0 14px" }}>
              You commanded the mission. The crew did the chasing. Spark hits harder.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#4ADE80", fontSize: 14, fontWeight: 700 }}>
              Mission complete <ArrowRight size={16} />
            </div>
            <p className="bs-mono" style={{ color: "rgba(245,240,232,0.4)", fontSize: 11.5, margin: "10px 0 0" }}>
              SIMULATED DEMO OUTCOME · MISSION COMPLETE
            </p>
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
              Live Call with SAGE
            </h3>
            <p style={{ color: "rgba(245,240,232,0.65)", fontSize: 14.5, margin: "0 0 10px" }}>
              A decision-maker is on the line. This is not a job for automation. It's a job for
              you.
            </p>
            <p style={{ color: "rgba(245,240,232,0.65)", fontSize: 14.5, margin: "0 0 14px" }}>
              The battle freezes. Sage steps out of the fight carrying the context, the opening
              line, and the counter to the objection you're about to hear.
            </p>
            <p style={{ color: "rgba(245,240,232,0.65)", fontSize: 14.5, margin: "0 0 14px" }}>
              You still run the call. Sage just makes sure you never walk in blind.
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 14px", display: "grid", gap: 6 }}>
              <li style={{ color: "rgba(245,240,232,0.8)", fontSize: 14 }}>→ Objection identified</li>
              <li style={{ color: "rgba(245,240,232,0.8)", fontSize: 14 }}>→ Decision-maker engaged</li>
              <li style={{ color: "rgba(245,240,232,0.8)", fontSize: 14 }}>→ Meeting on the calendar</li>
            </ul>
            <p style={{ color: "rgba(245,240,232,0.7)", fontSize: 14, margin: "0 0 14px" }}>
              You were the weapon. Sage was the aim.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#C495FF", fontSize: 14, fontWeight: 700 }}>
              Rift conquered <ArrowRight size={16} />
            </div>
            <p className="bs-mono" style={{ color: "rgba(245,240,232,0.4)", fontSize: 11.5, margin: "10px 0 0" }}>
              SIMULATED DEMO OUTCOME · RIFT CONQUERED
            </p>
            <p className="bs-mono" style={{ color: "rgba(245,240,232,0.4)", fontSize: 11.5, margin: "6px 0 0", fontStyle: "italic" }}>
              Coming to the playable demo.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
