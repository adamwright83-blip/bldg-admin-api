import { Check } from "lucide-react";

const INCLUDED = [
  "Founder-guided setup and your first mission",
  "Missions for new customers, reviews, win-backs, estimate follow-up, and overdue payments",
  "True Net Cockpit, Mission Board, Kingdom Mode, and SAGE Outreach",
  "Every customer message staged for your approval",
  "Revenue tracked by mission — the score is booked dollars",
  "2,000 message segments included monthly",
  "Human support — you text a person, not a bot",
];

export function BsPricing({ onCta }: { onCta: () => void }) {
  return (
    <section id="pricing" style={{ padding: "76px 0" }}>
      <div className="bs-container" style={{ maxWidth: 760 }}>
        <h2 className="bs-display" style={{ fontSize: "clamp(36px, 5vw, 54px)", margin: "0 0 8px", textAlign: "center" }}>
          One plan. Built to pay for itself.
        </h2>
        <p style={{ color: "var(--bs-ink-soft)", fontSize: 18, textAlign: "center", margin: "0 0 36px" }}>
          Pays for itself with 2–3 recovered jobs.
        </p>

        <div
          style={{
            borderRadius: 20,
            border: "1.5px solid var(--bs-line)",
            background: "var(--bs-surface)",
            overflow: "hidden",
            boxShadow: "0 24px 60px rgba(26,23,18,0.08)",
          }}
        >
          <div
            style={{
              background: "var(--bs-navy)",
              color: "#fff",
              padding: "12px 24px",
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 16 }}>Founding Operator — first 20 businesses</span>
            <span style={{ fontSize: 15, opacity: 0.9 }}>Growth Engine plan</span>
          </div>
          <div style={{ padding: "30px 28px" }}>
            <p style={{ color: "var(--bs-ink-soft)", fontSize: 18, margin: "0 0 2px" }}>
              <s>$249/month</s>
            </p>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span className="bs-display" style={{ fontSize: 52, color: "var(--bs-ink)" }}>
                $199<span style={{ fontSize: 24 }}>/month</span>
              </span>
              <span style={{ fontSize: 18, color: "var(--bs-ink-soft)", fontWeight: 600 }}>per location</span>
            </div>
            <p style={{ color: "var(--bs-navy)", fontSize: 16, fontWeight: 700, margin: "6px 0 0" }}>
              Founding price locked for 12 months.
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: "22px 0 26px", display: "grid", gap: 12 }}>
              {INCLUDED.map(item => (
                <li key={item} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 16.5 }}>
                  <Check size={20} style={{ color: "var(--bs-navy)", flexShrink: 0, marginTop: 3 }} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <button type="button" className="bs-cta" style={{ width: "100%" }} onClick={onCta}>
              Start My Guided Launch
            </button>
            <p style={{ fontSize: 14, color: "var(--bs-ink-soft)", textAlign: "center", margin: "14px 0 0" }}>
              Three-month initial commitment. Month-to-month after that. No annual contract.
              Additional locations $125/month. We ask before you incur any messaging charge.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
