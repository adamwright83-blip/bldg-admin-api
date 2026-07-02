import { Compass, Magnet } from "lucide-react";

export function BsInsideOutside() {
  return (
    <section style={{ padding: "56px 0" }}>
      <div className="bs-container">
        <h2 className="bs-display" style={{ fontSize: "clamp(30px, 4.2vw, 44px)", margin: "0 0 28px", maxWidth: 720 }}>
          New customers outside. More money from the customers already inside.
        </h2>
        <div className="bs-steps-grid" style={{ gap: 28 }}>
          <div
            style={{
              borderRadius: 16,
              border: "1.5px solid var(--bs-line)",
              background: "var(--bs-surface)",
              padding: "24px 22px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center", background: "var(--bs-navy)", color: "#fff" }}>
                <Magnet size={22} />
              </div>
              <h3 className="bs-display" style={{ fontSize: 26, margin: 0 }}>
                Bring in new business
              </h3>
            </div>
            <p style={{ color: "var(--bs-ink-soft)", fontSize: 16.5, margin: 0 }}>
              BORESLAY launches local offers, review pushes, referral asks, and lead follow-up
              designed to put new jobs on the calendar — and keeps chasing every inquiry so you
              don't have to.
            </p>
          </div>
          <div
            style={{
              borderRadius: 16,
              border: "1.5px solid var(--bs-line)",
              background: "var(--bs-surface)",
              padding: "24px 22px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center", background: "var(--bs-navy)", color: "#fff" }}>
                <Compass size={22} />
              </div>
              <h3 className="bs-display" style={{ fontSize: 26, margin: 0 }}>
                Get more from what you already have
              </h3>
            </div>
            <p style={{ color: "var(--bs-ink-soft)", fontSize: 16.5, margin: 0 }}>
              It brings back past customers, follows up on unsold estimates, fills empty schedule
              gaps, and collects money that was left unfinished — so the business you already earned
              doesn't slip away.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
