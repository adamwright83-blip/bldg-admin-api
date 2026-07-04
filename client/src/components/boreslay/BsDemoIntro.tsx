export function BsDemoIntro() {
  return (
    <section style={{ background: "var(--bs-dark)", padding: "0 0 28px" }}>
      <div className="bs-container" style={{ maxWidth: 780, textAlign: "center" }}>
        <p className="bs-mono" style={{ color: "var(--bs-gold)", fontSize: 13, letterSpacing: "0.1em", margin: "0 0 10px" }}>
          YOU ARE SPARK.
        </p>
        <p style={{ color: "rgba(245,240,232,0.75)", fontSize: 17, margin: "0 0 14px" }}>
          Somewhere between the missed calls, the unpaid invoices, and all the "I'll get to it
          Monday"s, he took form:
        </p>
        <h2 className="bs-display" style={{ fontSize: "clamp(26px, 3.6vw, 36px)", color: "var(--bs-cream)", margin: "0 0 2px" }}>
          The Procrastinator
        </h2>
        <p style={{ fontStyle: "italic", color: "rgba(245,240,232,0.55)", fontSize: 15, margin: "0 0 14px" }}>
          Tomorrow's Champion
        </p>
        <p style={{ color: "rgba(245,240,232,0.75)", fontSize: 17, margin: "0 0 22px" }}>
          He's been running your calendar for years. Time to return the favor.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10, marginBottom: 20 }}>
          {[
            ["MOVE", "WASD / Arrow Keys"],
            ["DASH", "Space"],
            ["FIRE BREATH", "Click / F"],
            ["PAUSE", "Esc"],
          ].map(([label, keys]) => (
            <div
              key={label}
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                border: "1px solid rgba(201,169,110,0.3)",
                background: "var(--bs-dark-elev)",
              }}
            >
              <span className="bs-mono" style={{ fontSize: 11, color: "var(--bs-gold)", letterSpacing: "0.06em" }}>
                {label}
              </span>{" "}
              <span style={{ fontSize: 13.5, color: "rgba(245,240,232,0.75)" }}>— {keys}</span>
            </div>
          ))}
        </div>

        <p style={{ color: "var(--bs-cream)", fontWeight: 700, fontSize: 17, margin: 0 }}>
          Dodge the EXCUSE. Burn the delay. Take back the week.
        </p>
      </div>
    </section>
  );
}
