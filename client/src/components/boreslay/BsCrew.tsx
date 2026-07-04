import { Coins, Compass, Flame, Handshake, ShieldCheck, Target } from "lucide-react";

const CREW = [
  { name: "Spark", role: "Field Commander", desc: "Player-controlled. Fights the boss directly.", icon: Flame },
  { name: "Sage", role: "Live Strategist", desc: "Scripts, objection handling, and live coaching during Reality Rifts.", icon: Target },
  { name: "Scout", role: "Opportunity Hunter", desc: "Finds dormant customers, open capacity, and cold estimates.", icon: Compass },
  { name: "Closer", role: "Follow-Through", desc: "Keeps conversations moving until booking, decline, or escalation.", icon: Handshake },
  { name: "Treasurer", role: "True Net Tracker", desc: "Tracks booked revenue minus labor, fuel, vendors, and direct costs.", icon: Coins },
  { name: "Guardian", role: "Reputation Defender", desc: "Runs review missions and flags reputation threats.", icon: ShieldCheck },
];

export function BsCrew() {
  return (
    <section id="crew" style={{ padding: "72px 0" }}>
      <div className="bs-container">
        <h2 className="bs-display" style={{ fontSize: "clamp(32px, 4.6vw, 48px)", margin: "0 0 8px" }}>
          The crew you command
        </h2>
        <p style={{ color: "var(--bs-ink-soft)", fontSize: 17, margin: "0 0 32px" }}>
          Specialists that run the day-to-day while you focus on big moves and high-leverage moments.
        </p>
        <div className="bs-crew-grid">
          {CREW.map(member => (
            <div
              key={member.name}
              style={{
                borderRadius: 14,
                border: "1.5px solid var(--bs-line)",
                background: "var(--bs-surface)",
                padding: "18px 16px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--bs-navy)", color: "#fff" }}>
                  <member.icon size={19} />
                </div>
                <div>
                  <p className="bs-display" style={{ fontSize: 18, margin: 0 }}>{member.name}</p>
                  <p style={{ fontSize: 12.5, color: "var(--bs-ink-soft)", margin: 0 }}>{member.role}</p>
                </div>
              </div>
              <p style={{ fontSize: 14, color: "var(--bs-ink-soft)", margin: 0 }}>{member.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
