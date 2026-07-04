const REALMS = [
  {
    name: "Sunbright Isles",
    tagline: "Bright. Fast. Opportunity everywhere.",
    engine: "New-customer acquisition",
    caption: "Scout discovers new demand in your market.",
    gradient: "linear-gradient(160deg, #FDE68A 0%, #F2A65A 45%, #38BDF8 100%)",
  },
  {
    name: "Wildwood",
    tagline: "Deep. Untamed. Loyalty is power.",
    engine: "Retention & reactivation",
    caption: "We win back dormant customers and rebuild loyalty.",
    gradient: "linear-gradient(160deg, #14532D 0%, #166534 45%, #0F2E1B 100%)",
  },
  {
    name: "Clockwork Depths",
    tagline: "Precision. Timing. Nothing slips.",
    engine: "Estimates, payments & follow-up",
    caption: "Automated pursuit keeps cash moving and delays down.",
    gradient: "linear-gradient(160deg, #92400E 0%, #57534E 45%, #1C1917 100%)",
  },
  {
    name: "The Void",
    tagline: "Dangerous. Profitable. High stakes.",
    engine: "High-value prospects & calls",
    caption: "You enter Reality Rifts for moments that need a human.",
    gradient: "linear-gradient(160deg, #4C1D95 0%, #1E1B4B 55%, #0B0A14 100%)",
  },
];

export function BsRealms() {
  return (
    <section style={{ background: "var(--bs-dark)", padding: "72px 0" }}>
      <div className="bs-container">
        <h2 className="bs-display" style={{ fontSize: "clamp(32px, 4.6vw, 48px)", color: "var(--bs-cream)", margin: "0 0 36px" }}>
          Explore realms. Unlock business engines.
        </h2>
        <div className="bs-realm-grid">
          {REALMS.map(realm => (
            <div key={realm.name} style={{ borderRadius: 16, overflow: "hidden", border: "1px solid rgba(201,169,110,0.25)" }}>
              <div style={{ height: 140, background: realm.gradient }} />
              <div style={{ background: "var(--bs-dark-elev)", padding: "16px 16px 18px" }}>
                <h3 className="bs-display" style={{ fontSize: 20, color: "var(--bs-cream)", margin: "0 0 4px" }}>
                  {realm.name}
                </h3>
                <p style={{ fontSize: 13.5, color: "rgba(245,240,232,0.55)", margin: "0 0 12px" }}>{realm.tagline}</p>
                <p
                  className="bs-mono"
                  style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--bs-gold)", margin: "0 0 4px" }}
                >
                  Engine unlocked
                </p>
                <p style={{ fontSize: 14.5, fontWeight: 700, color: "var(--bs-cream)", margin: "0 0 4px" }}>{realm.engine}</p>
                <p style={{ fontSize: 13.5, color: "rgba(245,240,232,0.6)", margin: 0 }}>{realm.caption}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
