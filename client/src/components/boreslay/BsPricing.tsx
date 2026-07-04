import { Check } from "lucide-react";

const INCLUDED = [
  "All crew members: Spark, Sage, Scout, Closer, Treasurer, Guardian",
  "All realms and missions",
  "Live SAGE coaching during Reality Rifts",
  "True Net tracking — revenue minus what it actually cost you",
  "Customer reactivation and estimate follow-up",
  "Review and reputation missions",
  "New-customer missions where operationally supported",
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
            <p style={{ color: "var(--bs-ink-soft)", fontSize: 15, margin: "6px 0 0" }}>
              Cancel anytime. Just results.
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
              Start your expedition in 60 seconds.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
