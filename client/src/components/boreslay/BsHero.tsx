import { ArrowRight, Play, Rocket } from "lucide-react";

const VERTICALS = [
  "Laundromats",
  "Plumbing",
  "Landscaping",
  "Contracting",
  "Cleaning",
  "Detailing",
];

function SampleMissionCard() {
  return (
    <div
      style={{
        borderRadius: 16,
        background: "var(--bs-dark)",
        border: "1px solid rgba(201, 169, 110, 0.35)",
        padding: "22px 22px 20px",
        boxShadow: "0 30px 70px rgba(26,23,18,0.28)",
        color: "var(--bs-cream)",
      }}
    >
      <p
        className="bs-mono"
        style={{
          fontSize: 12,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--bs-gold)",
          margin: "0 0 10px",
        }}
      >
        Sample mission · New customers
      </p>
      <h3 className="bs-display" style={{ fontSize: 30, margin: "0 0 14px", color: "var(--bs-cream)" }}>
        Fill next week's open days
      </h3>
      <p style={{ fontSize: 14.5, color: "rgba(245,240,232,0.6)", margin: "0 0 8px" }}>
        BORESLAY prepared:
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 18px", display: "grid", gap: 8 }}>
        {[
          "A neighborhood offer for nearby prospects",
          "A review push to boost local discovery",
          "Win-back texts for customers who drifted",
          "Follow-up for every inquiry that answers",
        ].map(item => (
          <li key={item} style={{ display: "flex", gap: 9, alignItems: "baseline", fontSize: 15.5 }}>
            <span style={{ color: "var(--bs-gold)" }}>◆</span>
            <span style={{ color: "rgba(245,240,232,0.88)" }}>{item}</span>
          </li>
        ))}
      </ul>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: "1px solid rgba(245,240,232,0.14)",
          paddingTop: 16,
        }}
      >
        <div>
          <p className="bs-mono" style={{ fontSize: 12, color: "rgba(245,240,232,0.55)", margin: 0 }}>
            PROJECTED BOOKINGS · 8–17
          </p>
          <p className="bs-mono" style={{ fontSize: 16, color: "#4ADE80", margin: "3px 0 0", fontWeight: 700 }}>
            $640–$1,530
          </p>
        </div>
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 18px",
            borderRadius: 10,
            background: "rgba(245,240,232,0.1)",
            border: "1px solid rgba(245,240,232,0.25)",
            color: "var(--bs-cream)",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          <Rocket size={16} /> Launch Mission
        </span>
      </div>
    </div>
  );
}

export function BsHero({ onCta }: { onCta: () => void }) {
  return (
    <section id="top" style={{ padding: "56px 0 72px" }}>
      <div className="bs-container bs-hero-grid">
        <div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
            {VERTICALS.map(v => (
              <span
                key={v}
                style={{
                  padding: "5px 13px",
                  borderRadius: 999,
                  border: "1px solid var(--bs-line)",
                  background: "var(--bs-surface)",
                  color: "var(--bs-ink-soft)",
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                {v}
              </span>
            ))}
          </div>
          <h1
            className="bs-display"
            style={{ fontSize: "clamp(52px, 7.5vw, 88px)", margin: "0 0 10px", color: "var(--bs-ink)" }}
          >
            Slay the <span style={{ color: "var(--bs-navy)" }}>slow days.</span>
          </h1>
          <p style={{ fontSize: 21, fontWeight: 700, color: "var(--bs-ink)", margin: "0 0 12px" }}>
            Press play. Bring in more business.
          </p>
          <p style={{ fontSize: 18.5, color: "var(--bs-ink-soft)", maxWidth: 540, margin: "0 0 10px" }}>
            BORESLAY builds and runs the campaigns that bring in new customers, fill open days, win
            back old customers, collect reviews, and turn missed follow-up into booked revenue.
          </p>
          <p style={{ fontSize: 18.5, color: "var(--bs-ink)", maxWidth: 540, margin: "0 0 28px", fontWeight: 600 }}>
            Choose the result. Approve the mission. BORESLAY handles the campaign.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
            <button type="button" className="bs-cta" onClick={onCta}>
              Show Me My First Customer Mission <ArrowRight size={20} />
            </button>
            <a className="bs-cta-quiet" href="#tour">
              <Play size={18} /> Watch it run a real business
            </a>
          </div>
          <p className="bs-mono" style={{ fontSize: 13.5, color: "var(--bs-ink-soft)", margin: 0 }}>
            15 minutes · built around your business · no sales pitch
          </p>
        </div>
        <div>
          <SampleMissionCard />
        </div>
      </div>
    </section>
  );
}
