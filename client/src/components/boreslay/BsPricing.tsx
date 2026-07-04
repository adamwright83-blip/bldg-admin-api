import { Check } from "lucide-react";

const INCLUDED = [
  "Spark, Sage, Scout, Closer, Treasurer, and Guardian",
  "All current realms and mission types",
  "Playable business missions",
  "True Net tracking",
  "Customer reactivation",
  "Estimate follow-up",
  "Payment reminder missions",
  "Review and reputation missions",
  "New-customer opportunity missions where supported",
  "Live Sage coaching during Reality Rifts when available",
  "Human support from the BORESLAY team",
];

export function BsPricing({ onCta }: { onCta: () => void }) {
  return (
    <section id="pricing" style={{ padding: "76px 0" }}>
      <div className="bs-container" style={{ maxWidth: 720 }}>
        <div
          style={{
            borderRadius: 20,
            border: "1.5px solid var(--bs-line)",
            background: "var(--bs-surface)",
            padding: "32px 30px",
            display: "grid",
            gap: 24,
          }}
          className="bs-pricing-grid"
        >
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span className="bs-display" style={{ fontSize: 52, color: "var(--bs-ink)" }}>$299</span>
              <span style={{ fontSize: 18, color: "var(--bs-ink-soft)", fontWeight: 600 }}>/ month</span>
            </div>
            <p style={{ color: "var(--bs-ink-soft)", fontSize: 15.5, margin: "10px 0 0" }}>
              A complete business-growth crew inside a game you'll actually want to play. One
              price. The whole crew. Every current realm. Month to month — cancel anytime.
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: "22px 0 0", display: "grid", gap: 11 }}>
              {INCLUDED.map(item => (
                <li key={item} style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 15.5 }}>
                  <Check size={19} style={{ color: "var(--bs-navy)", flexShrink: 0, marginTop: 3 }} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 12 }}>
            <button type="button" className="bs-cta" style={{ width: "100%" }} onClick={onCta}>
              Connect My Business
            </button>
            <p style={{ fontSize: 14, color: "var(--bs-ink-soft)", textAlign: "center", margin: 0 }}>
              Setup starts with a short conversation about your business. No credit card required
              for the demo. One reopened estimate can cover the month — and Treasurer will show
              you whether it did.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
