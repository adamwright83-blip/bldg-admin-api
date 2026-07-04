const REALMS = [
  {
    name: "Sunbright Isles",
    tagline: "Bright. Fast. Opportunity everywhere.",
    engine: "New-customer acquisition",
    caption:
      "Scout reads your market like a treasure map: demand, open capacity, getting random bookings because happy customers sent their inquiring neighbors your way, prospects worth a first move.",
    gradient: "linear-gradient(160deg, #FDE68A 0%, #F2A65A 45%, #38BDF8 100%)",
  },
  {
    name: "Wildwood",
    tagline: "Deep. Untamed. Loyalty is power.",
    engine: "Retention & reactivation",
    caption: "Customers rarely leave angry. They drift. The crew tracks them down in the tall grass and brings them home.",
    gradient: "linear-gradient(160deg, #14532D 0%, #166534 45%, #0F2E1B 100%)",
  },
  {
    name: "Clockwork Depths",
    tagline: "Precision. Timing. Nothing slips.",
    engine: "Estimates, payments & follow-up",
    caption:
      "Every open quote, every \"let me think about it,\" every unpaid balance, every \"just circling back\" — Closer keeps them ticking until they resolve: booked, paid, declined, or escalated to you.",
    gradient: "linear-gradient(160deg, #92400E 0%, #57534E 45%, #1C1917 100%)",
  },
  {
    name: "The Void",
    tagline: "High stakes. High value. Human judgment required.",
    engine: "High-value prospects & live calls",
    caption:
      "Some conversations are too important to automate — they're the conversations that can change your month. You enter the Rift. Sage rides with you.",
    gradient: "linear-gradient(160deg, #4C1D95 0%, #1E1B4B 55%, #0B0A14 100%)",
  },
];

export function BsRealms() {
  return (
    <section style={{ background: "var(--bs-dark)", padding: "72px 0" }}>
      <div className="bs-container">
        <h2 className="bs-display" style={{ fontSize: "clamp(32px, 4.6vw, 48px)", color: "var(--bs-cream)", margin: "0 0 12px" }}>
          Explore realms. Unlock business engines.
        </h2>
        <p style={{ color: "rgba(245,240,232,0.65)", fontSize: 17, margin: "0 0 32px", maxWidth: 640 }}>
          Four worlds. Four engines. Every realm you clear turns on another part of the machine.
        </p>
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
