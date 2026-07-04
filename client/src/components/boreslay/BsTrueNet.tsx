const LEDGER = [
  { label: "Revenue booked", value: "$28,940", positive: true },
  { label: "Direct costs", value: "-$8,640" },
  { label: "Labor", value: "-$6,210" },
  { label: "Fuel & supplies", value: "-$2,410" },
  { label: "Vendor / other", value: "-$1,330" },
];

const MISSIONS = [
  { label: "Review Collection", detail: "18 new reviews", prefix: "Estimated impact:", value: "+$1,240" },
  { label: "Estimate Follow-Up", detail: "3 estimates reopened", prefix: "Estimated opportunity:", value: "+$740" },
  { label: "Win-Back Campaign", detail: "5 customers reactivated", prefix: "Estimated value:", value: "+$1,980" },
  { label: "Payment Reminders", detail: "12 overdue balances paid", prefix: "Cash recovered:", value: "+$3,420" },
];

export function BsTrueNet() {
  return (
    <section id="truenet" style={{ padding: "72px 0" }}>
      <div className="bs-container">
        <h2 className="bs-display" style={{ fontSize: "clamp(32px, 4.6vw, 48px)", margin: "0 0 16px" }}>
          The game is fun.
          <br />
          The ledger is real.
        </h2>
        <p style={{ color: "var(--bs-ink-soft)", fontSize: 16, margin: "0 0 28px", maxWidth: 680 }}>
          Most software shows you revenue and calls it winning. BORESLAY doesn't confuse the
          scoreboard with the bank account. True Net is booked revenue minus what it cost to
          produce — labor, fuel, supplies, vendors. If a mission doesn't clear its own cost,
          you'll see that too. That's the point.
        </p>
        <div className="bs-truenet-grid">
          <div style={{ borderRadius: 14, border: "1.5px solid var(--bs-line)", background: "var(--bs-surface)", padding: "20px 22px" }}>
            <p className="bs-mono" style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--bs-ink-soft)", margin: "0 0 12px" }}>
              Example True Net ledger — illustrative · this month
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              {LEDGER.map(row => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 15.5 }}>
                  <span style={{ color: "var(--bs-ink-soft)" }}>{row.label}</span>
                  <span style={{ fontWeight: 700, color: row.positive ? "var(--bs-navy)" : "var(--bs-ink)" }}>{row.value}</span>
                </div>
              ))}
            </div>
            <div style={{ borderTop: "1.5px solid var(--bs-line)", marginTop: 12, paddingTop: 12, display: "flex", justifyContent: "space-between" }}>
              <span className="bs-display" style={{ fontSize: 18 }}>True Net Profit</span>
              <span className="bs-display" style={{ fontSize: 22, color: "var(--bs-navy)" }}>$10,350</span>
            </div>
          </div>
          <div style={{ borderRadius: 14, border: "1.5px solid var(--bs-line)", background: "var(--bs-surface)", padding: "20px 22px" }}>
            <p className="bs-mono" style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--bs-ink-soft)", margin: "0 0 12px" }}>
              Top-performing missions — illustrative examples
            </p>
            <div style={{ display: "grid", gap: 12 }}>
              {MISSIONS.map(m => (
                <div key={m.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{m.label}</p>
                    <p style={{ margin: 0, fontSize: 13, color: "var(--bs-ink-soft)" }}>
                      {m.detail} · {m.prefix}
                    </p>
                  </div>
                  <span style={{ fontWeight: 700, color: "var(--bs-navy)", fontSize: 15 }}>{m.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
